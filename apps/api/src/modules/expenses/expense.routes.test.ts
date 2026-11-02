import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { createApp } from '../../app.js';

const app = createApp();
const password = 'DMS-task021-synthetic-password';
const suffix = randomUUID();
const permissionCodes = [
  'expense_categories.view',
  'expense_categories.manage',
  'expenses.view',
  'expenses.create',
  'expenses.update',
] as const;

interface Account {
  id: string;
  email: string;
}

let testRoleId: string;
let ownerRoleId: string;
let testActor: Account;
let owner: Account;
let manager: Account;
let staff: Account;
let testAgent: ReturnType<typeof request.agent>;
let currentExpenseId: string;
let currentCategoryId: string;

async function createAccount(
  roleId: string,
  prefix: string,
  displayName: string,
): Promise<Account> {
  const email = prefix + '.' + suffix + '@example.invalid';
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users(email_normalized, display_name, password_hash, role_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [email, displayName, passwordHash, roleId],
  );
  return { id: result.rows[0]!.id, email };
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

describe('Expense Management API', () => {
  beforeAll(async () => {
    await pool.query('SELECT 1');
    const roles = await pool.query<{ id: string; code: string }>(
      "SELECT id, code FROM roles WHERE code IN ('OWNER', 'MANAGER', 'STAFF')",
    );
    const roleByCode = new Map(roles.rows.map((row) => [row.code, row.id]));
    ownerRoleId = roleByCode.get('OWNER')!;
    if (!ownerRoleId || !roleByCode.get('MANAGER') || !roleByCode.get('STAFF')) {
      throw new Error('Foundation role seeds are incomplete.');
    }

    const testRole = await pool.query<{ id: string }>(
      "INSERT INTO roles(code, name, description) VALUES ('TASK021_TEST', 'Task 021 Test', 'Disposable test-only permission role.') RETURNING id",
    );
    testRoleId = testRole.rows[0]!.id;
    await pool.query(
      `INSERT INTO role_permissions(role_id, permission_id)
       SELECT $1, id FROM permissions WHERE code = ANY($2::text[])`,
      [testRoleId, permissionCodes],
    );

    testActor = await createAccount(testRoleId, 'task021.actor', 'Synthetic Expense Test Actor');
    owner = await createAccount(
      ownerRoleId,
      'task021.owner',
      'Synthetic Owner Without Expense Grants',
    );
    manager = await createAccount(
      roleByCode.get('MANAGER')!,
      'task021.manager',
      'Synthetic Manager Without Expense Grants',
    );
    staff = await createAccount(
      roleByCode.get('STAFF')!,
      'task021.staff',
      'Synthetic Staff Without Expense Grants',
    );

    testAgent = request.agent(app);
    await signIn(testAgent, testActor.email);
  });

  afterAll(async () => {
    try {
      if (testActor?.id) {
        await pool.query('DELETE FROM user_sessions WHERE user_id = $1', [testActor.id]);
        await pool.query('UPDATE users SET role_id = $2 WHERE id = $1', [
          testActor.id,
          ownerRoleId,
        ]);
      }
      if (testRoleId) {
        await pool.query('DELETE FROM role_permissions WHERE role_id = $1', [testRoleId]);
        await pool.query('DELETE FROM roles WHERE id = $1', [testRoleId]);
      }
    } finally {
      await pool.end();
    }
  });

  it('rejects unauthenticated category and expense access', async () => {
    await request(app).get('/api/v1/expense-categories').expect(401);
    await request(app).get('/api/v1/expenses').expect(401);

    const anonymousAgent = request.agent(app);
    const anonymousCsrf = await csrf(anonymousAgent);
    await anonymousAgent
      .post('/api/v1/expenses')
      .set('Origin', env.APP_ORIGIN)
      .set('X-CSRF-Token', anonymousCsrf)
      .send({})
      .expect(401);
  });

  it.each([
    ['Owner', () => owner],
    ['Manager', () => manager],
    ['Staff', () => staff],
  ] as const)(
    '%s receives no expense access without an explicit test grant',
    async (_label, accountFn) => {
      const account = accountFn();
      const agent = request.agent(app);
      await signIn(agent, account.email);
      await agent.get('/api/v1/expense-categories').expect(403);
      await agent.get('/api/v1/expenses').expect(403);
      await post(agent, '/api/v1/expense-categories', {
        code: 'DENIED-' + suffix.slice(0, 8),
        name: 'Denied synthetic category',
      }).then((response) => expect(response.status).toBe(403));
      await post(agent, '/api/v1/expenses', {}).then((response) =>
        expect(response.status).toBe(403),
      );
    },
  );

  it('enforces CSRF for authenticated state-changing expense operations', async () => {
    const response = await testAgent
      .post('/api/v1/expense-categories')
      .set('Origin', env.APP_ORIGIN)
      .send({ code: 'CSRF-' + suffix.slice(0, 8), name: 'CSRF category' });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CSRF_TOKEN_REQUIRED');
  });

  it('creates, searches, updates, activates and deactivates categories with safe audit metadata', async () => {
    const created = await post(testAgent, '/api/v1/expense-categories', {
      code: 'OPS-' + suffix.slice(0, 8),
      name: 'Operational Costs ' + suffix.slice(0, 6),
      description: 'Synthetic category description.',
    });
    expect(created.status).toBe(201);
    currentCategoryId = created.body.data.id as string;
    expect(created.body.data).toMatchObject({ isActive: true });

    const duplicateCode = await post(testAgent, '/api/v1/expense-categories', {
      code: 'OPS-' + suffix.slice(0, 8),
      name: 'Another category ' + suffix.slice(0, 6),
    });
    expect(duplicateCode.status).toBe(409);

    const duplicateName = await post(testAgent, '/api/v1/expense-categories', {
      code: 'OTHER-' + suffix.slice(0, 8),
      name: ('Operational Costs ' + suffix.slice(0, 6)).toUpperCase(),
    });
    expect(duplicateName.status).toBe(409);

    const blank = await post(testAgent, '/api/v1/expense-categories', {
      code: '   ',
      name: ' ',
    });
    expect(blank.status).toBe(400);

    const updated = await patch(testAgent, '/api/v1/expense-categories/' + currentCategoryId, {
      name: 'Updated Operational Costs ' + suffix.slice(0, 6),
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toContain('Updated Operational Costs');

    const searched = await testAgent
      .get(
        '/api/v1/expense-categories?q=Updated%20Operational%20Costs%20' +
          suffix.slice(0, 6) +
          '&page=1&pageSize=1',
      )
      .expect(200);
    expect(searched.body.data.items).toHaveLength(1);
    expect(searched.body.data.total).toBe(1);

    const deactivate = await post(
      testAgent,
      '/api/v1/expense-categories/' + currentCategoryId + '/deactivate',
    );
    expect(deactivate.status).toBe(200);
    expect(deactivate.body.data.isActive).toBe(false);

    const activate = await post(
      testAgent,
      '/api/v1/expense-categories/' + currentCategoryId + '/activate',
    );
    expect(activate.status).toBe(200);
    expect(activate.body.data.isActive).toBe(true);

    const audit = await pool.query<{
      action: string;
      actor_user_id: string;
      safe_metadata: object;
    }>(
      `SELECT action, actor_user_id, safe_metadata FROM audit_logs
        WHERE entity_type = 'expense_category' AND entity_id = $1
        ORDER BY occurred_at`,
      [currentCategoryId],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      'expense.category.created',
      'expense.category.updated',
      'expense.category.deactivated',
      'expense.category.activated',
    ]);
    expect(audit.rows.every((row) => row.actor_user_id === testActor.id)).toBe(true);
    expect(JSON.stringify(audit.rows.map((row) => row.safe_metadata))).not.toContain(
      'Operational Costs',
    );
  });

  it('validates draft input, creates a draft and returns it through list/detail/history routes', async () => {
    const invalidAmount = await post(testAgent, '/api/v1/expenses', {
      categoryId: currentCategoryId,
      description: 'Invalid amount test',
      amountMinor: '0',
      currency: 'NGN',
      incurredOn: '2026-10-10',
      payeeName: 'Synthetic payee',
    });
    expect(invalidAmount.status).toBe(400);

    const negativeAmount = await post(testAgent, '/api/v1/expenses', {
      categoryId: currentCategoryId,
      description: 'Negative amount test',
      amountMinor: '-1',
      currency: 'NGN',
      incurredOn: '2026-10-10',
      payeeName: 'Synthetic payee',
    });
    expect(negativeAmount.status).toBe(400);

    const missingCategory = await post(testAgent, '/api/v1/expenses', {
      categoryId: randomUUID(),
      description: 'Missing category test',
      amountMinor: '1000',
      currency: 'NGN',
      incurredOn: '2026-10-10',
      payeeName: 'Synthetic payee',
    });
    expect(missingCategory.status).toBe(400);

    const invalidCurrency = await post(testAgent, '/api/v1/expenses', {
      categoryId: currentCategoryId,
      description: 'Invalid currency test',
      amountMinor: '1000',
      currency: 'USD',
      incurredOn: '2026-10-10',
      payeeName: 'Synthetic payee',
    });
    expect(invalidCurrency.status).toBe(400);

    const invalidDate = await post(testAgent, '/api/v1/expenses', {
      categoryId: currentCategoryId,
      description: 'Invalid date test',
      amountMinor: '1000',
      currency: 'NGN',
      incurredOn: '2026-02-30',
      payeeName: 'Synthetic payee',
    });
    expect(invalidDate.status).toBe(400);

    const spoofedActor = await post(testAgent, '/api/v1/expenses', {
      categoryId: currentCategoryId,
      description: 'Spoofed actor test',
      amountMinor: '1000',
      currency: 'NGN',
      incurredOn: '2026-10-10',
      payeeName: 'Synthetic payee',
      actorId: owner.id,
      createdBy: owner.id,
      status: 'approved',
    });
    expect(spoofedActor.status).toBe(400);

    const created = await post(testAgent, '/api/v1/expenses', {
      categoryId: currentCategoryId,
      description: 'Synthetic logistics expense ' + suffix.slice(0, 8),
      amountMinor: '125050',
      currency: 'NGN',
      incurredOn: '2026-10-10',
      payeeName: 'Synthetic courier',
    });
    expect(created.status).toBe(201);
    currentExpenseId = created.body.data.id as string;
    expect(created.body.data.status).toBe('draft');
    expect(created.body.data.currentRevision).toMatchObject({
      revisionNumber: 1,
      categoryId: currentCategoryId,
      amountMinor: '125050',
      currency: 'NGN',
      incurredOn: '2026-10-10',
      payeeName: 'Synthetic courier',
    });

    const detail = await testAgent.get('/api/v1/expenses/' + currentExpenseId).expect(200);
    expect(detail.body.data.id).toBe(currentExpenseId);

    const list = await testAgent
      .get(
        '/api/v1/expenses?q=Synthetic%20logistics%20expense%20' +
          suffix.slice(0, 8) +
          '&page=1&pageSize=1',
      )
      .expect(200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.total).toBe(1);

    const history = await testAgent
      .get('/api/v1/expenses/' + currentExpenseId + '/revisions')
      .expect(200);
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0].revisionNumber).toBe(1);

    const audit = await pool.query<{
      actor_user_id: string;
      action: string;
      safe_metadata: object;
    }>(
      `SELECT actor_user_id, action, safe_metadata FROM audit_logs
        WHERE entity_type = 'expense' AND entity_id = $1`,
      [currentExpenseId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.actor_user_id).toBe(testActor.id);
    expect(audit.rows[0]?.action).toBe('expense.draft.created');
    const metadata = JSON.stringify(audit.rows[0]?.safe_metadata ?? {});
    expect(metadata).not.toContain('Synthetic courier');
    expect(metadata).not.toContain('125050');
    expect(metadata).not.toContain('Synthetic logistics expense');
  });

  it('creates immutable revisions for draft edits and rejects edits after category deactivation', async () => {
    const update = await patch(testAgent, '/api/v1/expenses/' + currentExpenseId, {
      description: 'Updated synthetic logistics expense',
      amountMinor: '150000',
    });
    expect(update.status).toBe(200);
    expect(update.body.data.currentRevision.revisionNumber).toBe(2);
    expect(update.body.data.currentRevision.amountMinor).toBe('150000');

    const history = await testAgent
      .get('/api/v1/expenses/' + currentExpenseId + '/revisions')
      .expect(200);
    expect(history.body.data).toHaveLength(2);
    expect(history.body.data[0]).toMatchObject({
      revisionNumber: 1,
      amountMinor: '125050',
      description: 'Synthetic logistics expense ' + suffix.slice(0, 8),
    });
    expect(history.body.data[1]).toMatchObject({
      revisionNumber: 2,
      amountMinor: '150000',
      description: 'Updated synthetic logistics expense',
    });

    const deactivate = await post(
      testAgent,
      '/api/v1/expense-categories/' + currentCategoryId + '/deactivate',
    );
    expect(deactivate.status).toBe(200);

    const inactiveDraft = await post(testAgent, '/api/v1/expenses', {
      categoryId: currentCategoryId,
      description: 'Must not use inactive category',
      amountMinor: '1000',
      currency: 'NGN',
      incurredOn: '2026-10-11',
      payeeName: 'Synthetic payee',
    });
    expect(inactiveDraft.status).toBe(409);

    const rejectedUpdate = await patch(testAgent, '/api/v1/expenses/' + currentExpenseId, {
      description: 'Should not create a new revision',
    });
    expect(rejectedUpdate.status).toBe(409);

    const retained = await testAgent
      .get('/api/v1/expenses/' + currentExpenseId + '/revisions')
      .expect(200);
    expect(retained.body.data).toHaveLength(2);
    expect(
      retained.body.data.every(
        (revision: { categoryId: string }) => revision.categoryId === currentCategoryId,
      ),
    ).toBe(true);

    const reactivate = await post(
      testAgent,
      '/api/v1/expense-categories/' + currentCategoryId + '/activate',
    );
    expect(reactivate.status).toBe(200);
  });

  it('serializes concurrent draft edits without losing revisions or updates', async () => {
    const created = await post(testAgent, '/api/v1/expenses', {
      categoryId: currentCategoryId,
      description: 'Concurrent baseline expense',
      amountMinor: '50000',
      currency: 'NGN',
      incurredOn: '2026-10-12',
      payeeName: 'Concurrent baseline payee',
    });
    expect(created.status).toBe(201);
    const expenseId = created.body.data.id as string;
    const token = await csrf(testAgent);

    const [descriptionUpdate, payeeUpdate] = await Promise.all([
      testAgent
        .patch('/api/v1/expenses/' + expenseId)
        .set('Origin', env.APP_ORIGIN)
        .set('X-CSRF-Token', token)
        .send({ description: 'Concurrent description revision' }),
      testAgent
        .patch('/api/v1/expenses/' + expenseId)
        .set('Origin', env.APP_ORIGIN)
        .set('X-CSRF-Token', token)
        .send({ payeeName: 'Concurrent updated payee' }),
    ]);

    expect(descriptionUpdate.status).toBe(200);
    expect(payeeUpdate.status).toBe(200);

    const history = await testAgent.get('/api/v1/expenses/' + expenseId + '/revisions').expect(200);
    expect(
      history.body.data.map((revision: { revisionNumber: number }) => revision.revisionNumber),
    ).toEqual([1, 2, 3]);

    const current = await testAgent.get('/api/v1/expenses/' + expenseId).expect(200);
    expect(current.body.data.currentRevision).toMatchObject({
      revisionNumber: 3,
      description: 'Concurrent description revision',
      payeeName: 'Concurrent updated payee',
    });

    const audit = await pool.query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM audit_logs
        WHERE entity_type = 'expense'
          AND entity_id = $1
          AND action = 'expense.draft.revised'`,
      [expenseId],
    );
    expect(audit.rows[0]?.total).toBe('2');
  });

  it('rolls back category and expense mutations when audit insertion fails', async () => {
    await pool.query(`
      CREATE FUNCTION task021_fail_expense_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action LIKE 'expense.%' THEN
          RAISE EXCEPTION 'synthetic task 021 audit failure';
        END IF;
        RETURN NEW;
      END;
      $$;
    `);
    await pool.query(`
      CREATE TRIGGER task021_fail_expense_audit
      BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION task021_fail_expense_audit();
    `);

    const failedCode = 'FAIL-' + suffix.slice(0, 8);
    try {
      const failedCategory = await post(testAgent, '/api/v1/expense-categories', {
        code: failedCode,
        name: 'Audit failure category ' + suffix.slice(0, 6),
      });
      expect(failedCategory.status).toBe(500);
      const categoryCount = await pool.query('SELECT 1 FROM expense_categories WHERE code = $1', [
        failedCode,
      ]);
      expect(categoryCount.rowCount).toBe(0);

      const failedDescription = 'Audit failure expense ' + suffix.slice(0, 8);
      const failedExpense = await post(testAgent, '/api/v1/expenses', {
        categoryId: currentCategoryId,
        description: failedDescription,
        amountMinor: '2000',
        currency: 'NGN',
        incurredOn: '2026-10-13',
        payeeName: 'Synthetic payee',
      });
      expect(failedExpense.status).toBe(500);
      const failedExpenseCount = await pool.query<{ total: string }>(
        `SELECT count(*)::text AS total
           FROM expenses e
           JOIN expense_revisions r ON r.expense_id = e.id
          WHERE r.description = $1`,
        [failedDescription],
      );
      expect(failedExpenseCount.rows[0]?.total).toBe('0');

      const before = await testAgent.get('/api/v1/expenses/' + currentExpenseId).expect(200);
      const beforeRevision = before.body.data.currentRevision.id;
      const failedUpdate = await patch(testAgent, '/api/v1/expenses/' + currentExpenseId, {
        description: 'Audit failure update',
      });
      expect(failedUpdate.status).toBe(500);

      const after = await testAgent.get('/api/v1/expenses/' + currentExpenseId).expect(200);
      expect(after.body.data.currentRevision.id).toBe(beforeRevision);
      const revisions = await pool.query<{ total: string }>(
        'SELECT count(*)::text AS total FROM expense_revisions WHERE expense_id = $1',
        [currentExpenseId],
      );
      expect(revisions.rows[0]?.total).toBe('2');
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS task021_fail_expense_audit ON audit_logs');
      await pool.query('DROP FUNCTION IF EXISTS task021_fail_expense_audit()');
    }
  });

  it('validates UUID path parameters and rejects unsupported request fields', async () => {
    await testAgent.get('/api/v1/expenses/not-a-uuid').expect(400);
    const invalidCategoryId = await patch(testAgent, '/api/v1/expense-categories/not-a-uuid', {
      name: 'Invalid category id',
    });
    expect(invalidCategoryId.status).toBe(400);
    const badQuery = await testAgent.get('/api/v1/expenses?pageSize=1000').expect(400);
    expect(badQuery.body.error.code).toBe('INVALID_REQUEST');
  });
});
