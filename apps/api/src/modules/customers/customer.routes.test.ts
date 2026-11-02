import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { createApp } from '../../app.js';

const app = createApp();
const password = 'DMS-task011-synthetic-password';
const suffix = randomUUID();
const customerPermissions = [
  'customers.archive',
  'customers.create',
  'customers.update',
  'customers.view',
] as const;

interface TestAccount {
  id: string;
  email: string;
}

async function createAccount(roleCode: 'OWNER' | 'MANAGER' | 'STAFF'): Promise<TestAccount> {
  const role = await pool.query<{ id: string }>('SELECT id FROM roles WHERE code = $1', [roleCode]);
  if (!role.rows[0]) throw new Error(`Missing role seed: ${roleCode}`);
  const email = `task011.${roleCode.toLowerCase()}.${suffix}@example.invalid`;
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO users(email_normalized, display_name, password_hash, role_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [email, `Synthetic ${roleCode}`, hash, role.rows[0].id],
  );
  return { id: inserted.rows[0]!.id, email };
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

async function csrf(agent: ReturnType<typeof request.agent>): Promise<string> {
  const response = await agent.get('/api/v1/auth/csrf').expect(200);
  return response.body.data.token as string;
}

function post(
  agent: ReturnType<typeof request.agent>,
  path: string,
  body: object = {},
) {
  return {
    expect: async (status: number) =>
      agent
        .post(path)
        .set('Origin', env.APP_ORIGIN)
        .set('X-CSRF-Token', await csrf(agent))
        .send(body)
        .expect(status),
  };
}

function patch(
  agent: ReturnType<typeof request.agent>,
  path: string,
  body: object,
) {
  return {
    expect: async (status: number) =>
      agent
        .patch(path)
        .set('Origin', env.APP_ORIGIN)
        .set('X-CSRF-Token', await csrf(agent))
        .send(body)
        .expect(status),
  };
}

describe('Customer Management API', () => {
  let owner: TestAccount;
  let manager: TestAccount;
  let staff: TestAccount;
  let ownerAgent: ReturnType<typeof request.agent>;
  let managerAgent: ReturnType<typeof request.agent>;
  let staffAgent: ReturnType<typeof request.agent>;
  let grantedRoleId: string;
  let grantedPermissionIds: string[] = [];

  beforeAll(async () => {
    await pool.query('SELECT 1');
    const existingGrants = await pool.query(
      `SELECT 1
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
        WHERE p.code = ANY($1::text[])`,
      [customerPermissions],
    );
    if (existingGrants.rowCount) {
      throw new Error('Customer permissions must not be granted by migration seeds.');
    }
    const role = await pool.query<{ id: string }>("SELECT id FROM roles WHERE code = 'OWNER'");
    grantedRoleId = role.rows[0]!.id;
    const grants = await pool.query<{ permission_id: string }>(
      `INSERT INTO role_permissions(role_id, permission_id)
       SELECT $1, p.id FROM permissions p WHERE p.code = ANY($2::text[])
       ON CONFLICT DO NOTHING
       RETURNING permission_id`,
      [grantedRoleId, customerPermissions],
    );
    grantedPermissionIds = grants.rows.map((row) => row.permission_id);

    owner = await createAccount('OWNER');
    manager = await createAccount('MANAGER');
    staff = await createAccount('STAFF');
    ownerAgent = request.agent(app);
    managerAgent = request.agent(app);
    staffAgent = request.agent(app);
    await signIn(ownerAgent, owner.email);
    await signIn(managerAgent, manager.email);
    await signIn(staffAgent, staff.email);
  });

  afterAll(async () => {
    if (grantedPermissionIds.length) {
      await pool.query(
        'DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = ANY($2::uuid[])',
        [grantedRoleId, grantedPermissionIds],
      );
    }
    await pool.end();
  });

  async function createCustomer(fullName: string, fields: Record<string, unknown> = {}) {
    const response = await post(ownerAgent, '/api/v1/customers', { fullName, ...fields }).expect(201);
    return response.body.data as {
      id: string;
      fullName: string;
      phone: string | null;
      email: string | null;
      notes: string | null;
      status: string;
      createdBy: string;
      updatedBy: string;
    };
  }

  it('rejects unauthenticated customer access', async () => {
    await request(app).get('/api/v1/customers').expect(401);
    const agent = request.agent(app);
    const token = await agent.get('/api/v1/auth/csrf').expect(200);
    await agent
      .post('/api/v1/customers')
      .set('Origin', env.APP_ORIGIN)
      .set('X-CSRF-Token', token.body.data.token as string)
      .send({ fullName: 'No session' })
      .expect(401);
  });

  it('denies Manager and Staff when they do not hold the exact customer permissions', async () => {
    for (const agent of [managerAgent, staffAgent]) {
      await agent.get('/api/v1/customers').expect(403);
      await agent
        .post('/api/v1/customers')
        .set('Origin', env.APP_ORIGIN)
        .set('X-CSRF-Token', await csrf(agent))
        .send({ fullName: 'Denied synthetic customer' })
        .expect(403);
      await patch(agent, `/api/v1/customers/${randomUUID()}`, {
        fullName: 'Denied synthetic update',
      }).expect(403);
      await post(agent, `/api/v1/customers/${randomUUID()}/archive`).expect(403);
    }
  });

  it('creates customers for an explicitly authorised synthetic account and derives actor fields server-side', async () => {
    const name = `Task011 Create ${suffix.slice(0, 8)}`;
    const response = await post(ownerAgent, '/api/v1/customers', {
      fullName: `  ${name}  `,
      phone: '  +234 800 123 4567  ',
      email: '  Customer.Example@example.invalid  ',
      notes: '  Synthetic note  ',
    }).expect(201);
    expect(response.body.data).toMatchObject({
      fullName: name,
      phone: '+234 800 123 4567',
      email: 'Customer.Example@example.invalid',
      notes: 'Synthetic note',
      status: 'active',
      createdBy: owner.id,
      updatedBy: owner.id,
    });
    expect(response.body.data.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    await post(ownerAgent, '/api/v1/customers', {
      fullName: 'Spoof attempt',
      createdBy: manager.id,
      updatedBy: manager.id,
      status: 'archived',
    }).expect(400);
  });

  it('requires CSRF protection for customer write operations', async () => {
    await ownerAgent
      .post('/api/v1/customers')
      .set('Origin', env.APP_ORIGIN)
      .send({ fullName: 'Missing CSRF synthetic' })
      .expect(403);
  });

  it('rejects invalid profile fields and pagination inputs', async () => {
    await post(ownerAgent, '/api/v1/customers', { fullName: '   ' }).expect(400);
    await post(ownerAgent, '/api/v1/customers', {
      fullName: 'Invalid Email',
      email: 'not-an-email',
    }).expect(400);
    await post(ownerAgent, '/api/v1/customers', {
      fullName: 'Oversized Phone',
      phone: '1'.repeat(41),
    }).expect(400);
    await ownerAgent.get('/api/v1/customers?page=0').expect(400);
    await ownerAgent.get('/api/v1/customers?status=deleted').expect(400);
  });

  it('retrieves a customer and returns a consistent not-found response', async () => {
    const customer = await createCustomer(`Task011 Get ${suffix.slice(0, 8)}`);
    const response = await ownerAgent.get(`/api/v1/customers/${customer.id}`).expect(200);
    expect(response.body.data).toMatchObject({ id: customer.id, fullName: customer.fullName });
    const missing = randomUUID();
    const notFound = await ownerAgent.get(`/api/v1/customers/${missing}`).expect(404);
    expect(notFound.body.error.code).toBe('NOT_FOUND');
    const invalid = await ownerAgent.get('/api/v1/customers/not-a-uuid').expect(400);
    expect(invalid.body.error.code).toBe('INVALID_REQUEST');
  });

  it('lists, paginates, searches by name, phone and email, and filters by status', async () => {
    const token = randomUUID().replaceAll('-', '').slice(0, 8);
    const named = await createCustomer(`NameSearch${token}`, {
      phone: `+23480001${token}`,
      email: `emailsearch${token}@example.invalid`,
    });
    await createCustomer(`SecondCustomer${token}`);
    const phoneSearch = await ownerAgent
      .get('/api/v1/customers')
      .query({ q: `+23480001${token}` })
      .expect(200);
    expect(phoneSearch.body.data.map((item: { id: string }) => item.id)).toContain(named.id);
    const emailSearch = await ownerAgent
      .get('/api/v1/customers')
      .query({ q: `emailsearch${token}` })
      .expect(200);
    expect(emailSearch.body.data.map((item: { id: string }) => item.id)).toContain(named.id);
    const nameSearch = await ownerAgent
      .get('/api/v1/customers')
      .query({ q: `NameSearch${token}` })
      .expect(200);
    expect(nameSearch.body.data.map((item: { id: string }) => item.id)).toContain(named.id);
    const firstPage = await ownerAgent
      .get('/api/v1/customers')
      .query({ q: token, page: '1', pageSize: '1' })
      .expect(200);
    expect(firstPage.body.data).toHaveLength(1);
    expect(firstPage.body.meta).toMatchObject({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
    expect(firstPage.body.data[0].id).toBeTruthy();
    const all = await ownerAgent.get('/api/v1/customers').query({ q: token }).expect(200);
    expect(all.body.data).toHaveLength(2);
    expect(
      all.body.data[0].fullName.toLowerCase().localeCompare(all.body.data[1].fullName.toLowerCase()),
    ).toBeLessThanOrEqual(0);

    await post(ownerAgent, `/api/v1/customers/${named.id}/archive`).expect(200);
    const archived = await ownerAgent
      .get('/api/v1/customers')
      .query({ q: token, status: 'archived' })
      .expect(200);
    expect(archived.body.data.map((item: { id: string }) => item.id)).toEqual([named.id]);
    const active = await ownerAgent
      .get('/api/v1/customers')
      .query({ q: token, status: 'active' })
      .expect(200);
    expect(active.body.data.map((item: { id: string }) => item.id)).toEqual(
      all.body.data.filter((item: { id: string }) => item.id !== named.id).map((item: { id: string }) => item.id),
    );
    await ownerAgent.get('/api/v1/customers?page=1&pageSize=101').expect(400);
  });

  it('uses parameterised literal search and rejects SQL injection attempts', async () => {
    const hostileQuery = `no-match-${suffix}' OR '1'='1`;
    const result = await ownerAgent.get('/api/v1/customers').query({ q: hostileQuery }).expect(200);
    expect(result.body.data).toHaveLength(0);
  });

  it('updates profile fields without allowing system-managed fields to be changed', async () => {
    const customer = await createCustomer(`Task011 Update ${suffix.slice(0, 8)}`, {
      phone: '+2348000000001',
      notes: 'Before update',
    });
    const response = await patch(ownerAgent, `/api/v1/customers/${customer.id}`, {
      fullName: '  Updated Customer  ',
      phone: null,
      notes: '  Updated synthetic note  ',
    }).expect(200);
    expect(response.body.data).toMatchObject({
      id: customer.id,
      fullName: 'Updated Customer',
      phone: null,
      notes: 'Updated synthetic note',
      createdBy: owner.id,
      updatedBy: owner.id,
      status: 'active',
    });
    await patch(ownerAgent, `/api/v1/customers/${customer.id}`, {
      updatedBy: manager.id,
    }).expect(400);
    await patch(ownerAgent, `/api/v1/customers/${customer.id}`, {
      status: 'archived',
    }).expect(400);
    await patch(ownerAgent, `/api/v1/customers/${customer.id}`, {}).expect(400);
  });

  it('archives without deleting, preserves attribution and makes repeated submissions idempotent', async () => {
    const customer = await createCustomer(`Task011 Archive ${suffix.slice(0, 8)}`);
    const first = await post(ownerAgent, `/api/v1/customers/${customer.id}/archive`).expect(200);
    const second = await post(ownerAgent, `/api/v1/customers/${customer.id}/archive`).expect(200);
    expect(first.body.data.status).toBe('archived');
    expect(second.body.data).toMatchObject({
      id: customer.id,
      status: 'archived',
      updatedBy: owner.id,
    });
    const stored = await pool.query<{ status: string }>(
      'SELECT status FROM customers WHERE id = $1',
      [customer.id],
    );
    expect(stored.rows[0]?.status).toBe('archived');
    const audit = await pool.query(
      `SELECT 1 FROM audit_logs
        WHERE entity_type = 'customer' AND entity_id = $1 AND action = 'customer.archived'`,
      [customer.id],
    );
    expect(audit.rowCount).toBe(1);
  });

  it('records create, update and archive events without writing customer PII into audit metadata', async () => {
    const marker = `PII_MARKER_${suffix}`;
    const customer = await createCustomer(marker, {
      phone: `PHONE_${suffix}`,
      email: `EMAIL_${suffix}@example.invalid`,
      notes: `NOTES_${suffix}`,
    });
    await patch(ownerAgent, `/api/v1/customers/${customer.id}`, { notes: 'Changed synthetic note' }).expect(200);
    await post(ownerAgent, `/api/v1/customers/${customer.id}/archive`).expect(200);
    const result = await pool.query<{ action: string; safe_metadata: Record<string, unknown> }>(
      `SELECT action, safe_metadata
         FROM audit_logs
        WHERE entity_type = 'customer' AND entity_id = $1
        ORDER BY occurred_at, id`,
      [customer.id],
    );
    expect(result.rows.map((row) => row.action)).toEqual([
      'customer.created',
      'customer.updated',
      'customer.archived',
    ]);
    const serialized = JSON.stringify(result.rows.map((row) => row.safe_metadata));
    for (const personalValue of [marker, `PHONE_${suffix}`, `EMAIL_${suffix}`, `NOTES_${suffix}`]) {
      expect(serialized).not.toContain(personalValue);
    }
  });

  it('rolls back customer create, update and archive when the audit insert fails', async () => {
    const existing = await createCustomer(`AuditRollback ${suffix}`, { notes: 'Original value' });
    await pool.query(`
      CREATE FUNCTION dms_test_fail_customer_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.entity_type = 'customer' THEN
          RAISE EXCEPTION 'synthetic customer audit failure';
        END IF;
        RETURN NEW;
      END;
      $$;
    `);
    await pool.query(`
      CREATE TRIGGER dms_test_fail_customer_audit
      BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION dms_test_fail_customer_audit()
    `);
    try {
      await post(ownerAgent, '/api/v1/customers', {
        fullName: `RolledBackCreate ${suffix}`,
      }).expect(500);
      const created = await pool.query(
        'SELECT 1 FROM customers WHERE full_name = $1',
        [`RolledBackCreate ${suffix}`],
      );
      expect(created.rowCount).toBe(0);

      await patch(ownerAgent, `/api/v1/customers/${existing.id}`, {
        notes: 'Should roll back',
      }).expect(500);
      const afterUpdate = await pool.query<{ notes: string | null }>(
        'SELECT notes FROM customers WHERE id = $1',
        [existing.id],
      );
      expect(afterUpdate.rows[0]?.notes).toBe('Original value');

      await post(ownerAgent, `/api/v1/customers/${existing.id}/archive`).expect(500);
      const afterArchive = await pool.query<{ status: string }>(
        'SELECT status FROM customers WHERE id = $1',
        [existing.id],
      );
      expect(afterArchive.rows[0]?.status).toBe('active');
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS dms_test_fail_customer_audit ON audit_logs');
      await pool.query('DROP FUNCTION IF EXISTS dms_test_fail_customer_audit()');
    }
  });
});
