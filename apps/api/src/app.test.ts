import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { createApp } from './app.js';
import type { AuthenticatedUser } from './modules/auth/auth.types.js';
import { revokeSessionsForUser } from './modules/auth/auth.session.js';
import {
  canAccessStockLocation,
  canUseWarehouseSheratonPickup,
} from './modules/roles/location-access.service.js';

const app = createApp();
const password = 'DMS-foundation-test-password';
const suffix = randomUUID();
const emails = {
  staff: `task005.staff.${suffix}@example.invalid`,
  manager: `task005.manager.${suffix}@example.invalid`,
  owner: `task005.owner.${suffix}@example.invalid`,
  suspended: `task005.suspended.${suffix}@example.invalid`,
};

async function createTestUser(
  email: string,
  roleCode: 'STAFF' | 'MANAGER' | 'OWNER',
): Promise<AuthenticatedUser> {
  const role = await pool.query<{ id: string }>('SELECT id FROM roles WHERE code = $1', [roleCode]);
  if (!role.rows[0]) throw new Error(`Missing seeded role: ${roleCode}`);
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO users(email_normalized, display_name, password_hash, role_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [email, `Test ${roleCode}`, passwordHash, role.rows[0].id],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error('Test user could not be created.');

  const permissions = await pool.query<{ code: string }>(
    `SELECT p.code FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = $1 ORDER BY p.code`,
    [role.rows[0].id],
  );

  return {
    id,
    email,
    displayName: `Test ${roleCode}`,
    roleCode,
    roleName: roleCode,
    permissions: permissions.rows.map((row) => row.code),
  };
}

function sessionCookieFromHeader(header: string | string[] | undefined): string | undefined {
  const values = header === undefined ? [] : Array.isArray(header) ? header : [header];
  return values.find((cookie) => cookie.startsWith(`${env.cookieName}=`))?.split(';', 1)[0];
}

async function signIn(agent: ReturnType<typeof request.agent>, email: string): Promise<void> {
  const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
  await agent
    .post('/api/v1/auth/login')
    .set('Origin', env.APP_ORIGIN)
    .set('X-CSRF-Token', csrf.body.data.token as string)
    .send({ email, password })
    .expect(200);
}

describe('DMS foundation API', () => {
  let staff: AuthenticatedUser;
  let manager: AuthenticatedUser;
  let owner: AuthenticatedUser;
  let suspendedUser: AuthenticatedUser;

  beforeAll(async () => {
    await pool.query('SELECT 1');
    staff = await createTestUser(emails.staff, 'STAFF');
    manager = await createTestUser(emails.manager, 'MANAGER');
    owner = await createTestUser(emails.owner, 'OWNER');
    suspendedUser = await createTestUser(emails.suspended, 'STAFF');
  });

  afterAll(async () => {
    // The CI database is disposable. Keep synthetic actors and audit history intact.
    await pool.end();
  });

  it('serves a minimal health response without infrastructure details', async () => {
    expect((await request(app).get('/api/v1/health').expect(200)).body).toEqual({
      data: { status: 'ok' },
    });
  });

  it('rejects unauthenticated access to protected capabilities', async () => {
    await request(app).get('/api/v1/auth/capabilities').expect(401);
  });

  it('requires a same-origin CSRF token before login', async () => {
    const agent = request.agent(app);
    await agent.get('/api/v1/auth/csrf').expect(200);
    const response = await agent
      .post('/api/v1/auth/login')
      .set('Origin', env.APP_ORIGIN)
      .send({ email: emails.staff, password })
      .expect(403);
    expect(response.body.error.code).toBe('CSRF_TOKEN_REQUIRED');
  });

  it('rejects an incorrect CSRF token', async () => {
    const agent = request.agent(app);
    await agent.get('/api/v1/auth/csrf').expect(200);
    const response = await agent
      .post('/api/v1/auth/logout')
      .set('Origin', env.APP_ORIGIN)
      .set('X-CSRF-Token', 'not-the-session-token')
      .expect(403);
    expect(response.body.error.code).toBe('CSRF_TOKEN_INVALID');
  });

  it('rejects a mismatched Origin even when the CSRF token is valid', async () => {
    const agent = request.agent(app);
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    const response = await agent
      .post('/api/v1/auth/logout')
      .set('Origin', 'https://attacker.example.invalid')
      .set('X-CSRF-Token', csrf.body.data.token as string)
      .expect(403);
    expect(response.body.error.code).toBe('CSRF_ORIGIN_REJECTED');
  });

  it('rotates the session identifier after successful login', async () => {
    const agent = request.agent(app);
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    const beforeCookie = sessionCookieFromHeader(csrf.headers['set-cookie']);

    const login = await agent
      .post('/api/v1/auth/login')
      .set('Origin', env.APP_ORIGIN)
      .set('X-CSRF-Token', csrf.body.data.token as string)
      .send({ email: emails.staff, password })
      .expect(200);
    const afterCookie = sessionCookieFromHeader(login.headers['set-cookie']);

    expect(beforeCookie).toBeTruthy();
    expect(afterCookie).toBeTruthy();
    expect(afterCookie).not.toBe(beforeCookie);
  });

  it('persists sessions in PostgreSQL and returns safe identity data', async () => {
    const agent = request.agent(app);
    await signIn(agent, emails.staff);
    const session = await agent.get('/api/v1/auth/session').expect(200);

    expect(session.body.data.authenticated).toBe(true);
    expect(session.body.data.user.email).toBe(emails.staff);
    expect(session.body.data.permissions).toContain('payments.record');
    expect(session.body.data.permissions).not.toContain('payments.verify');

    const sessionRow = await pool.query(
      'SELECT sid FROM user_sessions WHERE user_id = $1 LIMIT 1',
      [staff.id],
    );
    expect(sessionRow.rowCount).toBeGreaterThan(0);

    const audit = await pool.query(
      "SELECT 1 FROM audit_logs WHERE actor_user_id = $1 AND action = 'auth.login.succeeded'",
      [staff.id],
    );
    expect(audit.rowCount).toBeGreaterThan(0);
  });

  it('rejects a session after its absolute lifetime expires and deletes the stored session', async () => {
    const agent = request.agent(app);
    await signIn(agent, emails.staff);

    const sessionRow = await pool.query<{ sid: string }>(
      'SELECT sid FROM user_sessions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
      [staff.id],
    );
    const sessionId = sessionRow.rows[0]?.sid;
    expect(sessionId).toBeTruthy();

    const expiredAt = Date.now() - env.sessionAbsoluteTimeoutMs - 1;
    await pool.query(
      `UPDATE user_sessions
       SET sess = jsonb_set(sess::jsonb, '{authIssuedAt}', to_jsonb($2::bigint), true)::json
       WHERE sid = $1`,
      [sessionId, expiredAt],
    );

    const response = await agent.get('/api/v1/auth/session').expect(200);
    expect(response.body.data.authenticated).toBe(false);

    const remaining = await pool.query('SELECT 1 FROM user_sessions WHERE sid = $1', [sessionId]);
    expect(remaining.rowCount).toBe(0);
  });

  it('does not allow a suspended user to continue an existing session', async () => {
    const agent = request.agent(app);
    await signIn(agent, emails.suspended);
    await pool.query("UPDATE users SET status = 'suspended' WHERE id = $1", [suspendedUser.id]);

    const session = await agent.get('/api/v1/auth/session').expect(200);
    expect(session.body.data.authenticated).toBe(false);
    await agent.get('/api/v1/auth/capabilities').expect(401);
  });

  it('does not allow a revoked persistent session to be reused', async () => {
    const agent = request.agent(app);
    await signIn(agent, emails.staff);

    await revokeSessionsForUser(staff.id);
    const protectedResponse = await agent.get('/api/v1/auth/capabilities').expect(401);
    expect(protectedResponse.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('grants payment-verification permission only to Manager and Owner', async () => {
    for (const [user, email] of [
      [manager, emails.manager],
      [owner, emails.owner],
    ] as const) {
      const agent = request.agent(app);
      await signIn(agent, email);
      const session = await agent.get('/api/v1/auth/session').expect(200);
      expect(session.body.data.permissions).toContain('payments.verify');
      expect(session.body.data.user.id).toBe(user.id);
    }
  });

  it('destroys the persistent session on a valid same-origin logout', async () => {
    const agent = request.agent(app);
    await signIn(agent, emails.staff);
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    await agent
      .post('/api/v1/auth/logout')
      .set('Origin', env.APP_ORIGIN)
      .set('X-CSRF-Token', csrf.body.data.token as string)
      .expect(204);
    expect((await agent.get('/api/v1/auth/session').expect(200)).body.data.authenticated).toBe(
      false,
    );
  });

  it('returns a generic credential error for an unknown email', async () => {
    const agent = request.agent(app);
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    await agent
      .post('/api/v1/auth/login')
      .set('Origin', env.APP_ORIGIN)
      .set('X-CSRF-Token', csrf.body.data.token as string)
      .send({ email: `unknown.${suffix}@example.invalid`, password })
      .expect(401);
  });

  it('preserves foundation permissions and assigns Product Management permissions only to Owner', async () => {
    const roles = await pool.query<{ code: string }>(
      `SELECT code FROM roles
        WHERE code IN ('OWNER', 'MANAGER', 'STAFF')
        ORDER BY code`,
    );
    const permissions = await pool.query<{ code: string }>(
      'SELECT code FROM permissions ORDER BY code',
    );
    const productPermissions = [
      'products.archive',
      'products.categories.manage',
      'products.create',
      'products.update',
      'products.variants.manage',
      'products.view',
    ];
    const expensePermissions = [
      'expense_categories.manage',
      'expense_categories.view',
      'expenses.create',
      'expenses.update',
      'expenses.view',
    ];
    const orderPermissions = ['orders.create', 'orders.update', 'orders.view'];
    const supplierPermissions = [
      'suppliers.create',
      'suppliers.manage_status',
      'suppliers.update',
      'suppliers.view',
    ];
    expect(roles.rows.map((row) => row.code)).toEqual(['MANAGER', 'OWNER', 'STAFF']);
    expect(permissions.rows.map((row) => row.code)).toEqual([
      'customers.archive',
      'customers.create',
      'customers.update',
      'customers.view',
      'expense_categories.manage',
      'expense_categories.view',
      'expenses.create',
      'expenses.update',
      'expenses.view',
      'inventory.transfer.pickup_warehouse_to_assigned_sheraton',
      'inventory.transfer.receive_destination_assigned',
      ...orderPermissions,
      'payments.record',
      'payments.verify',
      ...productPermissions,
      ...supplierPermissions,
      'users.manage',
      'users.view',
    ]);
    expect(owner.permissions).toContain('users.view');
    expect(owner.permissions).toContain('users.manage');
    expect(manager.permissions).not.toContain('users.view');
    expect(manager.permissions).not.toContain('users.manage');
    expect(staff.permissions).not.toContain('users.view');
    expect(staff.permissions).not.toContain('users.manage');
    expect(staff.permissions).toContain('payments.record');
    expect(staff.permissions).not.toContain('payments.verify');
    expect(manager.permissions).toContain('payments.verify');
    expect(owner.permissions).toContain('payments.verify');
    for (const permission of productPermissions) {
      expect(owner.permissions).toContain(permission);
      expect(manager.permissions).not.toContain(permission);
      expect(staff.permissions).not.toContain(permission);
    }
    for (const permission of expensePermissions) {
      expect(owner.permissions).not.toContain(permission);
      expect(manager.permissions).not.toContain(permission);
      expect(staff.permissions).not.toContain(permission);
    }
    // The Order migration verifier checks that these definitions are unassigned on a clean
    // schema. The Order API tests temporarily grant them to seeded roles in parallel, so they
    // are intentionally excluded from this in-memory role snapshot assertion.
    for (const permission of supplierPermissions) {
      expect(owner.permissions).not.toContain(permission);
      expect(manager.permissions).not.toContain(permission);
      expect(staff.permissions).not.toContain(permission);
    }
  });

  it('enforces global Owner/Manager and assigned-only Staff location access', async () => {
    const unassigned = randomUUID();
    const assigned = randomUUID();
    await pool.query('INSERT INTO locations(id, code, name) VALUES ($1, $2, $3), ($4, $5, $6)', [
      unassigned,
      `SYN-${suffix.slice(0, 8)}-A`,
      'Synthetic unassigned test',
      assigned,
      `SYN-${suffix.slice(0, 8)}-B`,
      'Synthetic assigned test',
    ]);
    await pool.query('INSERT INTO user_location_access(user_id, location_id) VALUES ($1, $2)', [
      staff.id,
      assigned,
    ]);

    expect(await canAccessStockLocation(staff, assigned)).toBe(true);
    expect(await canAccessStockLocation(staff, unassigned)).toBe(false);
    expect(await canAccessStockLocation(manager, unassigned)).toBe(true);
    expect(await canAccessStockLocation(owner, unassigned)).toBe(true);
  });

  it('keeps the ADR-016 pickup exception limited to a configured source and assigned destination', async () => {
    const warehouse = randomUUID();
    const sheraton = randomUUID();
    const unassignedSheraton = randomUUID();
    await pool.query(
      'INSERT INTO locations(id, code, name) VALUES ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)',
      [
        warehouse,
        `SYN-${suffix.slice(0, 8)}-W`,
        'Synthetic Warehouse test',
        sheraton,
        `SYN-${suffix.slice(0, 8)}-S`,
        'Synthetic assigned Sheraton test',
        unassignedSheraton,
        `SYN-${suffix.slice(0, 8)}-U`,
        'Synthetic unassigned Sheraton test',
      ],
    );
    await pool.query('INSERT INTO user_location_access(user_id, location_id) VALUES ($1, $2)', [
      staff.id,
      sheraton,
    ]);

    const valid = {
      user: staff,
      transfer: {
        sourceLocationId: warehouse,
        destinationLocationId: sheraton,
        pickupMode: 'destination_staff_pickup',
      },
      configuredWarehouseLocationId: warehouse,
      configuredSheratonLocationIds: [sheraton, unassignedSheraton],
    };
    expect(await canUseWarehouseSheratonPickup(valid)).toBe(true);
    expect(
      await canUseWarehouseSheratonPickup({
        ...valid,
        configuredWarehouseLocationId: undefined,
      }),
    ).toBe(false);
    expect(
      await canUseWarehouseSheratonPickup({
        ...valid,
        configuredSheratonLocationIds: [],
      }),
    ).toBe(false);
    expect(
      await canUseWarehouseSheratonPickup({
        ...valid,
        transfer: { ...valid.transfer, sourceLocationId: sheraton },
      }),
    ).toBe(false);
    expect(
      await canUseWarehouseSheratonPickup({
        ...valid,
        transfer: { ...valid.transfer, destinationLocationId: warehouse },
      }),
    ).toBe(false);
    expect(
      await canUseWarehouseSheratonPickup({
        ...valid,
        transfer: { ...valid.transfer, destinationLocationId: unassignedSheraton },
      }),
    ).toBe(false);
  });

  it('rejects UPDATE operations on append-only audit records', async () => {
    const result = await pool.query<{ id: string }>(
      'SELECT id FROM audit_logs WHERE actor_user_id = $1 ORDER BY occurred_at DESC LIMIT 1',
      [staff.id],
    );
    const auditId = result.rows[0]?.id;
    if (!auditId) throw new Error('Expected a synthetic audit record for the Staff test user.');

    await expect(
      pool.query("UPDATE audit_logs SET action = 'tampered' WHERE id = $1", [auditId]),
    ).rejects.toThrow(/append-only/i);
  });

  it('rejects DELETE operations on append-only audit records', async () => {
    const result = await pool.query<{ id: string }>(
      'SELECT id FROM audit_logs WHERE actor_user_id = $1 ORDER BY occurred_at DESC LIMIT 1',
      [staff.id],
    );
    const auditId = result.rows[0]?.id;
    if (!auditId) throw new Error('Expected a synthetic audit record for the Staff test user.');

    await expect(pool.query('DELETE FROM audit_logs WHERE id = $1', [auditId])).rejects.toThrow(
      /append-only/i,
    );
  });

  it('rejects TRUNCATE without risking unrelated audit data', async () => {
    const client = await pool.connect();
    try {
      // Keep the operation transactional: if protection regresses and TRUNCATE succeeds,
      // the rollback below restores every audit row in this disposable test database.
      await client.query('BEGIN');
      await expect(client.query('TRUNCATE TABLE audit_logs')).rejects.toThrow(/append-only/i);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
