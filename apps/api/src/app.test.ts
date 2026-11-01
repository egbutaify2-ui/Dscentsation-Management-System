import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { createApp } from './app.js';
import type { AuthenticatedUser } from './modules/auth/auth.types.js';
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

  beforeAll(async () => {
    await pool.query('SELECT 1');
    staff = await createTestUser(emails.staff, 'STAFF');
    manager = await createTestUser(emails.manager, 'MANAGER');
    owner = await createTestUser(emails.owner, 'OWNER');
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

  it('requires a same-origin CSRF token for login', async () => {
    const agent = request.agent(app);
    await agent.get('/api/v1/auth/csrf').expect(200);
    await agent
      .post('/api/v1/auth/login')
      .set('Origin', env.APP_ORIGIN)
      .send({ email: emails.staff, password })
      .expect(403);
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
    expect(sessionRow.rowCount).toBe(1);

    const audit = await pool.query(
      "SELECT 1 FROM audit_logs WHERE actor_user_id = $1 AND action = 'auth.login.succeeded'",
      [staff.id],
    );
    expect(audit.rowCount).toBe(1);
  });

  it('grants payment verification only to Manager and Owner', async () => {
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

  it('destroys a persistent session on logout', async () => {
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

  it('seeds only the three established roles and confirmed permission assignments', async () => {
    const roles = await pool.query<{ code: string }>('SELECT code FROM roles ORDER BY code');
    const permissionCodes = await pool.query<{ code: string }>(
      'SELECT code FROM permissions ORDER BY code',
    );
    expect(roles.rows.map((row) => row.code)).toEqual(['MANAGER', 'OWNER', 'STAFF']);
    expect(permissionCodes.rows.map((row) => row.code)).toEqual([
      'inventory.transfer.pickup_warehouse_to_assigned_sheraton',
      'inventory.transfer.receive_destination_assigned',
      'payments.record',
      'payments.verify',
    ]);
    expect(staff.permissions).toContain('payments.record');
    expect(staff.permissions).not.toContain('payments.verify');
    expect(manager.permissions).toContain('payments.verify');
    expect(owner.permissions).toContain('payments.verify');
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

  it('keeps the ADR-016 pickup exception scoped to configured locations and the assigned destination', async () => {
    const warehouse = randomUUID();
    const sheraton = randomUUID();
    await pool.query('INSERT INTO locations(id, code, name) VALUES ($1, $2, $3), ($4, $5, $6)', [
      warehouse,
      `SYN-${suffix.slice(0, 8)}-W`,
      'Synthetic Warehouse test',
      sheraton,
      `SYN-${suffix.slice(0, 8)}-S`,
      'Synthetic Sheraton test',
    ]);
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
      configuredSheratonLocationIds: [sheraton],
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
  });

  it('prevents ordinary updates to append-only audit records', async () => {
    await expect(
      pool.query("UPDATE audit_logs SET action = 'tampered' WHERE actor_user_id = $1", [staff.id]),
    ).rejects.toThrow(/append-only/i);
  });
});
