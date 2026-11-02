import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { createApp } from '../../app.js';

const app = createApp();
const password = 'DMS-task020-synthetic-password';
const suffix = randomUUID();
const supplierPermissionCodes = [
  'suppliers.view',
  'suppliers.create',
  'suppliers.update',
  'suppliers.manage_status',
] as const;

interface TestAccount {
  id: string;
  email: string;
  roleId: string;
}

async function createRole(code: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    'INSERT INTO roles(code, name, description) VALUES ($1, $2, $3) RETURNING id',
    [code, code, 'Synthetic Task 020 test role.'],
  );
  return result.rows[0]!.id;
}

async function createAccount(roleId: string, label: string): Promise<TestAccount> {
  const email = 'task020.' + label + '.' + suffix + '@example.invalid';
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users(email_normalized, display_name, password_hash, role_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [email, 'Synthetic Supplier ' + label, passwordHash, roleId],
  );
  return { id: result.rows[0]!.id, email, roleId };
}

async function assignPermissions(roleId: string, permissions: readonly string[]): Promise<void> {
  await pool.query(
    `INSERT INTO role_permissions(role_id, permission_id)
     SELECT $1, p.id
       FROM permissions p
      WHERE p.code = ANY($2::text[])
     ON CONFLICT DO NOTHING`,
    [roleId, permissions],
  );
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

async function post(agent: ReturnType<typeof request.agent>, path: string, body: object = {}) {
  const token = await csrf(agent);
  return agent.post(path).set('Origin', env.APP_ORIGIN).set('X-CSRF-Token', token).send(body);
}

async function patch(agent: ReturnType<typeof request.agent>, path: string, body: object) {
  const token = await csrf(agent);
  return agent.patch(path).set('Origin', env.APP_ORIGIN).set('X-CSRF-Token', token).send(body);
}

describe('Supplier Directory API', () => {
  let ownerWithoutPermissions: TestAccount;
  let managerWithoutPermissions: TestAccount;
  let staffWithoutPermissions: TestAccount;
  let viewOnly: TestAccount;
  let createOnly: TestAccount;
  let fullAccess: TestAccount;
  let viewAgent: ReturnType<typeof request.agent>;
  let createAgent: ReturnType<typeof request.agent>;
  let fullAgent: ReturnType<typeof request.agent>;
  let temporaryRoleIds: string[] = [];
  let temporaryUserIds: string[] = [];
  let temporaryCustomUserIds: string[] = [];
  const createdSupplierIds: string[] = [];

  beforeAll(async () => {
    await pool.query('SELECT 1');
    const roles = await pool.query<{ id: string; code: string }>(
      'SELECT id, code FROM roles WHERE code = ANY($1::text[])',
      [['OWNER', 'MANAGER', 'STAFF']],
    );
    const roleByCode = new Map(roles.rows.map((role) => [role.code, role.id]));
    if (!roleByCode.get('OWNER') || !roleByCode.get('MANAGER') || !roleByCode.get('STAFF')) {
      throw new Error('Required Owner, Manager and Staff role seeds are missing.');
    }

    ownerWithoutPermissions = await createAccount(roleByCode.get('OWNER')!, 'owner-denied');
    managerWithoutPermissions = await createAccount(roleByCode.get('MANAGER')!, 'manager-denied');
    staffWithoutPermissions = await createAccount(roleByCode.get('STAFF')!, 'staff-denied');

    const viewRole = await createRole('T020_VIEW_' + suffix.slice(0, 8).toUpperCase());
    const createRoleId = await createRole('T020_CREATE_' + suffix.slice(0, 8).toUpperCase());
    const fullRole = await createRole('T020_FULL_' + suffix.slice(0, 8).toUpperCase());
    temporaryRoleIds = [viewRole, createRoleId, fullRole];

    await assignPermissions(viewRole, ['suppliers.view']);
    await assignPermissions(createRoleId, ['suppliers.create']);
    await assignPermissions(fullRole, supplierPermissionCodes);

    viewOnly = await createAccount(viewRole, 'view-only');
    createOnly = await createAccount(createRoleId, 'create-only');
    fullAccess = await createAccount(fullRole, 'full-access');
    temporaryUserIds = [
      ownerWithoutPermissions.id,
      managerWithoutPermissions.id,
      staffWithoutPermissions.id,
      viewOnly.id,
      createOnly.id,
      fullAccess.id,
    ];
    temporaryCustomUserIds = [viewOnly.id, createOnly.id, fullAccess.id];

    viewAgent = request.agent(app);
    createAgent = request.agent(app);
    fullAgent = request.agent(app);
    await signIn(viewAgent, viewOnly.email);
    await signIn(createAgent, createOnly.email);
    await signIn(fullAgent, fullAccess.email);
  });

  afterAll(async () => {
    if (temporaryRoleIds.length) {
      await pool.query('DELETE FROM role_permissions WHERE role_id = ANY($1::uuid[])', [
        temporaryRoleIds,
      ]);
    }
    if (temporaryUserIds.length) {
      await pool.query('DELETE FROM user_sessions WHERE user_id = ANY($1::uuid[])', [
        temporaryUserIds,
      ]);
      if (createdSupplierIds.length) {
        await pool.query(
          `UPDATE suppliers
              SET status = 'inactive', updated_by = $1, updated_at = now()
            WHERE id = ANY($2::uuid[])`,
          [fullAccess.id, createdSupplierIds],
        );
      }
      await pool.query(
        "UPDATE users SET status = 'disabled', updated_at = now() WHERE id = ANY($1::uuid[])",
        [temporaryUserIds],
      );
    }
    if (temporaryCustomUserIds.length && temporaryRoleIds.length) {
      const staffRole = await pool.query<{ id: string }>(
        "SELECT id FROM roles WHERE code = 'STAFF'",
      );
      if (!staffRole.rows[0]) throw new Error('Staff role seed is missing during test cleanup.');
      await pool.query('UPDATE users SET role_id = $2 WHERE id = ANY($1::uuid[])', [
        temporaryCustomUserIds,
        staffRole.rows[0].id,
      ]);
      await pool.query('DELETE FROM roles WHERE id = ANY($1::uuid[])', [temporaryRoleIds]);
    }
    await pool.end();
  });

  it('requires authentication for supplier directory reads and writes', async () => {
    await request(app).get('/api/v1/suppliers').expect(401);
    await request(app).get('/api/v1/suppliers/duplicate-check?name=Acme').expect(401);
    await request(app)
      .get('/api/v1/suppliers/' + randomUUID())
      .expect(401);
  });

  it.each([
    ['Owner', 'owner'],
    ['Manager', 'manager'],
    ['Staff', 'staff'],
  ] as const)(
    '%s remains denied without an explicitly granted supplier permission',
    async (_label, role) => {
      const account =
        role === 'owner'
          ? ownerWithoutPermissions
          : role === 'manager'
            ? managerWithoutPermissions
            : staffWithoutPermissions;
      const agent = request.agent(app);
      await signIn(agent, account.email);

      await agent.get('/api/v1/suppliers').expect(403);
      await agent.get('/api/v1/suppliers/duplicate-check?name=Acme').expect(403);
      await post(agent, '/api/v1/suppliers', { displayName: 'Denied Synthetic Supplier' }).then(
        (response) => expect(response.status).toBe(403),
      );
      await patch(agent, '/api/v1/suppliers/' + randomUUID(), {
        displayName: 'Denied Updated Supplier',
      }).then((response) => expect(response.status).toBe(403));
      await post(agent, '/api/v1/suppliers/' + randomUUID() + '/deactivate').then((response) =>
        expect(response.status).toBe(403),
      );
    },
  );

  it('enforces exact permissions for view-only and create-only principals', async () => {
    await viewAgent.get('/api/v1/suppliers').expect(200);
    await viewAgent.get('/api/v1/suppliers/duplicate-check?name=Example').expect(200);
    await post(viewAgent, '/api/v1/suppliers', {
      displayName: 'View Only Cannot Create',
    }).then((response) => expect(response.status).toBe(403));

    const created = await post(createAgent, '/api/v1/suppliers', {
      displayName: 'Synthetic Create Only ' + suffix.slice(0, 8),
    });
    expect(created.status).toBe(201);
    createdSupplierIds.push(created.body.data.id as string);
    await createAgent.get('/api/v1/suppliers').expect(403);
    await createAgent.get('/api/v1/suppliers/duplicate-check?name=Example').expect(403);
  });

  it('enforces CSRF on supplier mutations', async () => {
    const response = await fullAgent
      .post('/api/v1/suppliers')
      .set('Origin', env.APP_ORIGIN)
      .send({ displayName: 'Synthetic CSRF Rejected' })
      .expect(403);
    expect(response.body.error.code).toBe('CSRF_TOKEN_REQUIRED');
  });

  it('creates suppliers with backend references and PII-safe transactional audit records', async () => {
    const displayName = 'Synthetic Supplier ' + suffix.slice(0, 8);
    const response = await post(fullAgent, '/api/v1/suppliers', { displayName });
    expect(response.status).toBe(201);
    const supplier = response.body.data as {
      id: string;
      supplierCode: string;
      displayName: string;
      status: string;
      createdBy: string;
      updatedBy: string;
    };
    createdSupplierIds.push(supplier.id);
    expect(supplier).toMatchObject({
      displayName,
      status: 'active',
      createdBy: fullAccess.id,
      updatedBy: fullAccess.id,
    });
    expect(supplier.supplierCode).toMatch(/^SUP-[0-9]{6,}$/);

    const audit = await pool.query<{
      actor_user_id: string;
      action: string;
      entity_type: string;
      entity_id: string;
      request_id: string;
      safe_metadata: Record<string, unknown>;
    }>(
      `SELECT actor_user_id, action, entity_type, entity_id, request_id, safe_metadata
         FROM audit_logs
        WHERE entity_type = 'supplier' AND entity_id = $1 AND action = 'supplier.created'`,
      [supplier.id],
    );
    expect(audit.rows[0]).toMatchObject({
      actor_user_id: fullAccess.id,
      action: 'supplier.created',
      entity_type: 'supplier',
      entity_id: supplier.id,
      request_id: response.headers['x-request-id'],
    });
    expect(audit.rows[0]!.safe_metadata).toEqual({
      supplierCode: supplier.supplierCode,
      changedFields: ['displayName'],
    });
    expect(JSON.stringify(audit.rows[0]!.safe_metadata)).not.toContain(displayName);
  });

  it('supports normalized-name search, bounded pagination and status filters', async () => {
    const name = 'Synthetic Search ' + suffix.slice(0, 8);
    const first = await post(createAgent, '/api/v1/suppliers', { displayName: name });
    const second = await post(createAgent, '/api/v1/suppliers', {
      displayName: '  ' + name.toUpperCase() + '  ',
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    createdSupplierIds.push(first.body.data.id as string, second.body.data.id as string);

    const pageOne = await fullAgent
      .get('/api/v1/suppliers?q=' + encodeURIComponent(name.toLowerCase()) + '&page=1&pageSize=1')
      .expect(200);
    expect(pageOne.body.data).toHaveLength(1);
    expect(pageOne.body.meta).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 2,
      totalPages: 2,
    });

    const pageTwo = await fullAgent
      .get('/api/v1/suppliers?q=' + encodeURIComponent(name.toLowerCase()) + '&page=2&pageSize=1')
      .expect(200);
    expect(pageTwo.body.data).toHaveLength(1);
    expect(pageTwo.body.data[0].id).not.toBe(pageOne.body.data[0].id);

    const inactive = await fullAgent
      .get('/api/v1/suppliers?status=inactive&q=task020-no-match-' + suffix.slice(0, 8))
      .expect(200);
    expect(inactive.body.data).toEqual([]);
    await fullAgent.get('/api/v1/suppliers?page=0').expect(400);
    await fullAgent.get('/api/v1/suppliers?pageSize=101').expect(400);
    await fullAgent.get('/api/v1/suppliers?status=blocked').expect(400);
    await fullAgent.get('/api/v1/suppliers?q=' + 'x'.repeat(101)).expect(400);
  });

  it('rejects names that exceed 200 characters after compatibility normalization', async () => {
    const expandedName = '\uFB03'.repeat(100);
    const rejectedCreate = await post(fullAgent, '/api/v1/suppliers', {
      displayName: expandedName,
    });
    expect(rejectedCreate.status).toBe(400);
    expect(rejectedCreate.body.error.code).toBe('INVALID_REQUEST');

    const created = await post(fullAgent, '/api/v1/suppliers', {
      displayName: 'Synthetic Unicode Length ' + suffix.slice(0, 8),
    });
    expect(created.status).toBe(201);
    const supplierId = created.body.data.id as string;
    createdSupplierIds.push(supplierId);

    const rejectedUpdate = await patch(fullAgent, '/api/v1/suppliers/' + supplierId, {
      displayName: expandedName,
    });
    expect(rejectedUpdate.status).toBe(400);
    expect(rejectedUpdate.body.error.code).toBe('INVALID_REQUEST');

    const persisted = await fullAgent.get('/api/v1/suppliers/' + supplierId).expect(200);
    expect(persisted.body.data.displayName).toBe('Synthetic Unicode Length ' + suffix.slice(0, 8));
  });

  it('returns supplier details, validates UUIDs and reports missing suppliers', async () => {
    const created = await post(fullAgent, '/api/v1/suppliers', {
      displayName: 'Synthetic Detail ' + suffix.slice(0, 8),
    });
    expect(created.status).toBe(201);
    const supplier = created.body.data as { id: string };
    createdSupplierIds.push(supplier.id);

    const detail = await fullAgent.get('/api/v1/suppliers/' + supplier.id).expect(200);
    expect(detail.body.data.id).toBe(supplier.id);
    await fullAgent.get('/api/v1/suppliers/not-a-uuid').expect(400);
    const missing = await fullAgent.get('/api/v1/suppliers/' + randomUUID()).expect(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });

  it('updates the business name while preserving the generated supplier reference', async () => {
    const created = await post(fullAgent, '/api/v1/suppliers', {
      displayName: 'Synthetic Original Name ' + suffix.slice(0, 8),
    });
    expect(created.status).toBe(201);
    const supplier = created.body.data as { id: string; supplierCode: string };
    createdSupplierIds.push(supplier.id);

    const updatedName = 'Synthetic Updated Name ' + suffix.slice(0, 8);
    const updated = await patch(fullAgent, '/api/v1/suppliers/' + supplier.id, {
      displayName: updatedName,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.displayName).toBe(updatedName);
    expect(updated.body.data.supplierCode).toBe(supplier.supplierCode);

    const found = await fullAgent
      .get('/api/v1/suppliers?q=' + encodeURIComponent(updatedName.toLowerCase()))
      .expect(200);
    expect(found.body.data.some((item: { id: string }) => item.id === supplier.id)).toBe(true);
    await patch(fullAgent, '/api/v1/suppliers/' + supplier.id, {}).then((response) =>
      expect(response.status).toBe(400),
    );
    await patch(fullAgent, '/api/v1/suppliers/' + supplier.id, {
      displayName: 'Spoofed Actor',
      actorUserId: ownerWithoutPermissions.id,
    }).then((response) => expect(response.status).toBe(400));
  });

  it('identifies possible duplicate names without blocking legitimate separate suppliers', async () => {
    const displayName = 'Synthetic Duplicate Candidate ' + suffix.slice(0, 8);
    const original = await post(createAgent, '/api/v1/suppliers', { displayName });
    expect(original.status).toBe(201);
    createdSupplierIds.push(original.body.data.id as string);

    const candidates = await fullAgent
      .get(
        '/api/v1/suppliers/duplicate-check?name=' + encodeURIComponent(displayName.toUpperCase()),
      )
      .expect(200);
    expect(
      candidates.body.data.some((item: { id: string }) => item.id === original.body.data.id),
    ).toBe(true);

    const separate = await post(createAgent, '/api/v1/suppliers', {
      displayName: displayName.toUpperCase(),
    });
    expect(separate.status).toBe(201);
    expect(separate.body.data.id).not.toBe(original.body.data.id);
    createdSupplierIds.push(separate.body.data.id as string);
  });

  it('activates and deactivates suppliers with audited status transitions', async () => {
    const created = await post(fullAgent, '/api/v1/suppliers', {
      displayName: 'Synthetic Status ' + suffix.slice(0, 8),
    });
    expect(created.status).toBe(201);
    const supplierId = created.body.data.id as string;
    createdSupplierIds.push(supplierId);

    const deactivate = await post(fullAgent, '/api/v1/suppliers/' + supplierId + '/deactivate');
    expect(deactivate.status).toBe(200);
    expect(deactivate.body.data.status).toBe('inactive');
    const repeatedDeactivate = await post(
      fullAgent,
      '/api/v1/suppliers/' + supplierId + '/deactivate',
    );
    expect(repeatedDeactivate.status).toBe(409);
    expect(repeatedDeactivate.body.error.code).toBe('INVALID_STATUS_TRANSITION');

    const activate = await post(fullAgent, '/api/v1/suppliers/' + supplierId + '/activate');
    expect(activate.status).toBe(200);
    expect(activate.body.data.status).toBe('active');

    const history = await pool.query<{ action: string }>(
      `SELECT action
         FROM audit_logs
        WHERE entity_type = 'supplier' AND entity_id = $1
        ORDER BY occurred_at, id`,
      [supplierId],
    );
    expect(history.rows.map((row) => row.action)).toEqual([
      'supplier.created',
      'supplier.deactivated',
      'supplier.activated',
    ]);
  });

  it('rolls back create, update and status mutations if the audit insert fails', async () => {
    const activeName = 'Synthetic Audit Rollback Active ' + suffix.slice(0, 8);
    const inactiveName = 'Synthetic Audit Rollback Inactive ' + suffix.slice(0, 8);
    const rejectedCreateName = 'Synthetic Audit Rollback Create ' + suffix.slice(0, 8);

    const active = await post(fullAgent, '/api/v1/suppliers', { displayName: activeName });
    const inactive = await post(fullAgent, '/api/v1/suppliers', { displayName: inactiveName });
    expect(active.status).toBe(201);
    expect(inactive.status).toBe(201);
    const activeId = active.body.data.id as string;
    const inactiveId = inactive.body.data.id as string;
    createdSupplierIds.push(activeId, inactiveId);

    await post(fullAgent, '/api/v1/suppliers/' + inactiveId + '/deactivate').expect(200);

    await pool.query(`
      CREATE OR REPLACE FUNCTION dms_test_reject_supplier_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action LIKE 'supplier.%' THEN
          RAISE EXCEPTION 'Synthetic supplier audit failure';
        END IF;
        RETURN NEW;
      END;
      $$;
    `);
    await pool.query(`
      CREATE TRIGGER dms_test_reject_supplier_audit
      BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION dms_test_reject_supplier_audit();
    `);

    try {
      const failedCreate = await post(fullAgent, '/api/v1/suppliers', {
        displayName: rejectedCreateName,
      });
      expect(failedCreate.status).toBe(500);
      expect(failedCreate.body.error.code).toBe('INTERNAL_SERVER_ERROR');

      const failedUpdate = await patch(fullAgent, '/api/v1/suppliers/' + activeId, {
        displayName: 'Synthetic Audit Rollback Updated ' + suffix.slice(0, 8),
      });
      expect(failedUpdate.status).toBe(500);
      expect(failedUpdate.body.error.code).toBe('INTERNAL_SERVER_ERROR');

      const failedDeactivate = await post(
        fullAgent,
        '/api/v1/suppliers/' + activeId + '/deactivate',
      );
      expect(failedDeactivate.status).toBe(500);
      expect(failedDeactivate.body.error.code).toBe('INTERNAL_SERVER_ERROR');

      const failedActivate = await post(
        fullAgent,
        '/api/v1/suppliers/' + inactiveId + '/activate',
      );
      expect(failedActivate.status).toBe(500);
      expect(failedActivate.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS dms_test_reject_supplier_audit ON audit_logs');
      await pool.query('DROP FUNCTION IF EXISTS dms_test_reject_supplier_audit()');
    }

    const persisted = await pool.query<{
      id: string;
      display_name: string;
      status: string;
    }>(
      'SELECT id, display_name, status FROM suppliers WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[activeId, inactiveId].sort()],
    );
    expect(persisted.rows).toHaveLength(2);
    const activeRecord = persisted.rows.find((row) => row.id === activeId);
    const inactiveRecord = persisted.rows.find((row) => row.id === inactiveId);
    expect(activeRecord).toMatchObject({ display_name: activeName, status: 'active' });
    expect(inactiveRecord).toMatchObject({ display_name: inactiveName, status: 'inactive' });

    const failedCreateRecord = await pool.query(
      'SELECT 1 FROM suppliers WHERE normalized_name = $1',
      [rejectedCreateName.toLowerCase()],
    );
    expect(failedCreateRecord.rowCount).toBe(0);

    const auditActionQuery = `
      SELECT action
        FROM audit_logs
       WHERE entity_type = 'supplier'
         AND entity_id = $1
       ORDER BY occurred_at, id
    `;
    const activeAudit = await pool.query<{ action: string }>(auditActionQuery, [activeId]);
    const inactiveAudit = await pool.query<{ action: string }>(auditActionQuery, [inactiveId]);
    expect(activeAudit.rows.map((row) => row.action)).toEqual(['supplier.created']);
    expect(inactiveAudit.rows.map((row) => row.action)).toEqual([
      'supplier.created',
      'supplier.deactivated',
    ]);
  });
});
