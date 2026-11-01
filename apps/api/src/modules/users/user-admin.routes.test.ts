import { createHash, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { createApp } from '../../app.js';

const app = createApp();
const password = 'DMS-task008-synthetic-password';
const suffix = randomUUID();

interface TestAccount {
  id: string;
  email: string;
}

let owner: TestAccount;
let ownerAgent: ReturnType<typeof request.agent>;

async function createAccount(roleCode: 'OWNER' | 'MANAGER' | 'STAFF'): Promise<TestAccount> {
  const role = await pool.query<{ id: string }>('SELECT id FROM roles WHERE code = $1', [roleCode]);
  if (!role.rows[0]) throw new Error(`Missing role seed: ${roleCode}`);
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const email = `task008.${roleCode.toLowerCase()}.${suffix}.${randomUUID()}@example.invalid`;
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO users(email_normalized, display_name, password_hash, role_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [email, `Synthetic ${roleCode}`, hash, role.rows[0].id],
  );
  return { id: inserted.rows[0]!.id, email };
}

async function createActiveEmployee(): Promise<TestAccount> {
  const role = await pool.query<{ id: string }>("SELECT id FROM roles WHERE code = 'STAFF'");
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const email = `task008.employee.${randomUUID()}@example.invalid`;
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO users(email_normalized, display_name, password_hash, role_id, created_by)
     VALUES ($1, 'Synthetic Active Employee', $2, $3, $4) RETURNING id`,
    [email, hash, role.rows[0]!.id, owner.id],
  );
  return { id: inserted.rows[0]!.id, email };
}

async function csrf(agent: ReturnType<typeof request.agent>): Promise<string> {
  const response = await agent.get('/api/v1/auth/csrf').expect(200);
  return response.body.data.token as string;
}

async function post(agent: ReturnType<typeof request.agent>, path: string, body: object) {
  const token = await csrf(agent);
  return agent.post(path).set('Origin', env.APP_ORIGIN).set('X-CSRF-Token', token).send(body);
}

async function patch(agent: ReturnType<typeof request.agent>, path: string, body: object) {
  const token = await csrf(agent);
  return agent.patch(path).set('Origin', env.APP_ORIGIN).set('X-CSRF-Token', token).send(body);
}

async function signIn(agent: ReturnType<typeof request.agent>, email: string, secret = password) {
  const token = await csrf(agent);
  return agent
    .post('/api/v1/auth/login')
    .set('Origin', env.APP_ORIGIN)
    .set('X-CSRF-Token', token)
    .send({ email, password: secret });
}

async function invite(
  role: 'MANAGER' | 'STAFF' = 'STAFF',
  email = `task008.invited.${randomUUID()}@example.invalid`,
) {
  return post(ownerAgent, '/api/v1/users/invitations', {
    displayName: `Synthetic Invite ${suffix.slice(0, 8)}`,
    email,
    role,
  });
}

function tokenFromSetupUrl(setupUrl: string): string {
  const url = new URL(setupUrl);
  expect(url.search).toBe('');
  expect(url.hash).toContain('/invite/accept?token=');
  const token = new URLSearchParams(url.hash.slice(url.hash.indexOf('?') + 1)).get('token');
  if (!token) throw new Error('Invitation URL did not contain its fragment token.');
  return token;
}

describe('Employee Account Administration API', () => {
  let manager: TestAccount;
  let staff: TestAccount;

  beforeAll(async () => {
    await pool.query('SELECT 1');
    owner = await createAccount('OWNER');
    manager = await createAccount('MANAGER');
    staff = await createAccount('STAFF');
    ownerAgent = request.agent(app);
    expect((await signIn(ownerAgent, owner.email)).status).toBe(200);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('requires authentication and denies Manager and Staff employee-administration permissions', async () => {
    await request(app).get('/api/v1/users').expect(401);
    await post(request.agent(app), '/api/v1/users/invitations', {}).then((response) =>
      expect(response.status).toBe(401),
    );

    for (const account of [manager, staff]) {
      const agent = request.agent(app);
      expect((await signIn(agent, account.email)).status).toBe(200);
      await agent.get('/api/v1/users').expect(403);
      const deniedReissue = await post(
        agent,
        `/api/v1/users/${randomUUID()}/invitation/reissue`,
        {},
      );
      expect(deniedReissue.status).toBe(403);
      const denied = await post(agent, '/api/v1/users/invitations', {
        displayName: 'Denied synthetic invite',
        email: `denied.${randomUUID()}@example.invalid`,
        role: 'STAFF',
      });
      expect(denied.status).toBe(403);
    }

    const session = await ownerAgent.get('/api/v1/auth/session').expect(200);
    expect(session.body.data.permissions).toContain('users.view');
    expect(session.body.data.permissions).toContain('users.manage');
    expect(manager.id).toBeTruthy();
    expect(staff.id).toBeTruthy();
  });

  it('creates a Manager invitation with only a token hash and blocks login until acceptance', async () => {
    const response = await invite('MANAGER');
    expect(response.status).toBe(201);
    const { employee, setupUrl, expiresAt } = response.body.data;
    expect(employee).toMatchObject({ roleCode: 'MANAGER', status: 'invited' });
    expect(employee).not.toHaveProperty('passwordHash');
    expect(employee).not.toHaveProperty('sessionId');
    const token = tokenFromSetupUrl(setupUrl);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

    const stored = await pool.query<{ token_hash: string; user_status: string }>(
      `SELECT i.token_hash, u.status AS user_status
         FROM user_invitations i JOIN users u ON u.id = i.user_id
        WHERE i.user_id = $1`,
      [employee.id],
    );
    expect(stored.rows[0]?.token_hash.trim()).toBe(
      createHash('sha256').update(token).digest('hex'),
    );
    expect(stored.rows[0]?.token_hash).not.toContain(token);
    expect(stored.rows[0]?.user_status).toBe('invited');

    const audit = await pool.query<{
      actor_user_id: string;
      request_id: string;
      safe_metadata: object;
    }>(
      `SELECT actor_user_id, request_id, safe_metadata
         FROM audit_logs
        WHERE action = 'user.invitation.created' AND entity_id = $1
        ORDER BY occurred_at DESC LIMIT 1`,
      [employee.id],
    );
    expect(audit.rows[0]?.actor_user_id).toBe(owner.id);
    expect(audit.rows[0]?.request_id).toBe(response.headers['x-request-id']);
    expect(JSON.stringify(audit.rows[0]?.safe_metadata)).not.toContain(token);
    expect(JSON.stringify(audit.rows[0]?.safe_metadata)).not.toContain(setupUrl);

    const invitedAgent = request.agent(app);
    expect((await signIn(invitedAgent, employee.email)).status).toBe(401);
  });

  it('rejects duplicate email addresses and refuses to invite another Owner', async () => {
    const email = `task008.duplicate.${randomUUID()}@example.invalid`;
    expect((await invite('STAFF', email)).status).toBe(201);
    expect((await invite('STAFF', email)).status).toBe(409);
    const ownerRole = await post(ownerAgent, '/api/v1/users/invitations', {
      displayName: 'Synthetic attempted Owner',
      email: `task008.extra-owner.${randomUUID()}@example.invalid`,
      role: 'OWNER',
    });
    expect(ownerRole.status).toBe(400);
  });

  it('lists safe employee fields and supports name/email, role and status filters', async () => {
    const created = await invite('STAFF');
    expect(created.status).toBe(201);
    const employee = created.body.data.employee as {
      id: string;
      email: string;
      displayName: string;
    };
    const all = await ownerAgent.get('/api/v1/users').expect(200);
    const row = all.body.data.find((item: { id: string }) => item.id === employee.id);
    expect(row).toMatchObject({
      id: employee.id,
      email: employee.email,
      displayName: employee.displayName,
      roleCode: 'STAFF',
      status: 'invited',
    });
    expect(row).toHaveProperty('createdAt');
    expect(row).toHaveProperty('lastLoginAt');
    for (const secretField of ['passwordHash', 'tokenHash', 'sessionId', 'sid', 'cookie', 'sess']) {
      expect(row).not.toHaveProperty(secretField);
    }

    const filtered = await ownerAgent
      .get(`/api/v1/users?q=${encodeURIComponent(employee.email)}&role=STAFF&status=invited`)
      .expect(200);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].id).toBe(employee.id);
  });

  it('accepts a valid invitation, activates the account and prevents token reuse', async () => {
    const created = await invite('STAFF');
    expect(created.status).toBe(201);
    const token = tokenFromSetupUrl(created.body.data.setupUrl);
    const newPassword = 'Employee-owned-synthetic-password-2026';
    const agent = request.agent(app);

    const accepted = await post(agent, '/api/v1/users/invitations/accept', {
      token,
      password: newPassword,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.accepted).toBe(true);
    expect((await agent.get('/api/v1/auth/session').expect(200)).body.data.authenticated).toBe(
      true,
    );

    const employeeId = created.body.data.employee.id as string;
    const account = await pool.query<{ status: string; password_hash: string }>(
      'SELECT status, password_hash FROM users WHERE id = $1',
      [employeeId],
    );
    expect(account.rows[0]?.status).toBe('active');
    expect(await argon2.verify(account.rows[0]!.password_hash, newPassword)).toBe(true);
    const lastLogin = await pool.query<{ last_login_at: Date | null }>(
      'SELECT last_login_at FROM users WHERE id = $1',
      [employeeId],
    );
    expect(lastLogin.rows[0]?.last_login_at).toBeTruthy();

    const invitation = await pool.query<{ consumed_at: Date | null }>(
      'SELECT consumed_at FROM user_invitations WHERE user_id = $1',
      [employeeId],
    );
    expect(invitation.rows[0]?.consumed_at).toBeTruthy();

    const audit = await pool.query<{ actor_user_id: string; safe_metadata: object }>(
      `SELECT actor_user_id, safe_metadata FROM audit_logs
        WHERE action = 'user.invitation.accepted' AND entity_id = $1`,
      [employeeId],
    );
    expect(audit.rows[0]?.actor_user_id).toBe(employeeId);
    expect(JSON.stringify(audit.rows[0]?.safe_metadata)).not.toContain(newPassword);

    const reused = await post(request.agent(app), '/api/v1/users/invitations/accept', {
      token,
      password: newPassword,
    });
    expect(reused.status).toBe(400);
  });

  it('rejects invalid, expired and revoked invitations', async () => {
    const invalid = await post(request.agent(app), '/api/v1/users/invitations/accept', {
      token: 'A'.repeat(43),
      password: 'Employee-owned-synthetic-password-2026',
    });
    expect(invalid.status).toBe(400);

    const expired = await invite();
    const expiredToken = tokenFromSetupUrl(expired.body.data.setupUrl);
    await pool.query(
      "UPDATE user_invitations SET expires_at = created_at + interval '1 microsecond' WHERE user_id = $1",
      [expired.body.data.employee.id],
    );
    const expiredResult = await post(request.agent(app), '/api/v1/users/invitations/accept', {
      token: expiredToken,
      password: 'Employee-owned-synthetic-password-2026',
    });
    expect(expiredResult.status).toBe(400);

    const revoked = await invite();
    const revokedToken = tokenFromSetupUrl(revoked.body.data.setupUrl);
    const revokedResponse = await post(
      ownerAgent,
      `/api/v1/users/${revoked.body.data.employee.id}/invitation/revoke`,
      {},
    );
    expect(revokedResponse.status).toBe(200);
    const revokedAcceptance = await post(request.agent(app), '/api/v1/users/invitations/accept', {
      token: revokedToken,
      password: 'Employee-owned-synthetic-password-2026',
    });
    expect(revokedAcceptance.status).toBe(400);
    const audit = await pool.query(
      "SELECT 1 FROM audit_logs WHERE action = 'user.invitation.revoked' AND entity_id = $1",
      [revoked.body.data.employee.id],
    );
    expect(audit.rowCount).toBe(1);
  });

  it('consumes a valid token only once under concurrent acceptance requests', async () => {
    const created = await invite();
    const token = tokenFromSetupUrl(created.body.data.setupUrl);
    const secret = 'Concurrent-synthetic-password-2026';
    const attempts = await Promise.all([
      post(request.agent(app), '/api/v1/users/invitations/accept', { token, password: secret }),
      post(request.agent(app), '/api/v1/users/invitations/accept', { token, password: secret }),
    ]);
    expect(attempts.map((response) => response.status).sort()).toEqual([200, 400]);
    const account = await pool.query<{ status: string }>('SELECT status FROM users WHERE id = $1', [
      created.body.data.employee.id,
    ]);
    expect(account.rows[0]?.status).toBe('active');
  });

  it('suspends an employee and revokes sessions atomically; reactivation does not restore them', async () => {
    const employee = await createActiveEmployee();
    const firstAgent = request.agent(app);
    const secondAgent = request.agent(app);
    expect((await signIn(firstAgent, employee.email)).status).toBe(200);
    expect((await signIn(secondAgent, employee.email)).status).toBe(200);
    const before = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM user_sessions WHERE user_id = $1',
      [employee.id],
    );
    expect(Number(before.rows[0]?.count)).toBe(2);

    const suspended = await patch(ownerAgent, `/api/v1/users/${employee.id}/status`, {
      status: 'suspended',
    });
    expect(suspended.status).toBe(200);
    expect(suspended.body.data.sessionsRevoked).toBe(2);
    expect(suspended.body.data.employee.status).toBe('suspended');
    const afterSuspend = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM user_sessions WHERE user_id = $1',
      [employee.id],
    );
    expect(afterSuspend.rows[0]?.count).toBe('0');
    expect((await signIn(request.agent(app), employee.email)).status).toBe(401);
    expect((await firstAgent.get('/api/v1/auth/capabilities')).status).toBe(401);
    expect((await secondAgent.get('/api/v1/auth/capabilities')).status).toBe(401);

    const reactivated = await patch(ownerAgent, `/api/v1/users/${employee.id}/status`, {
      status: 'active',
    });
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.data.employee.status).toBe('active');
    expect(reactivated.body.data.sessionsRevoked).toBe(0);
    const afterReactivate = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM user_sessions WHERE user_id = $1',
      [employee.id],
    );
    expect(afterReactivate.rows[0]?.count).toBe('0');
    expect((await signIn(request.agent(app), employee.email)).status).toBe(200);

    const audit = await pool.query<{
      action: string;
      actor_user_id: string;
      safe_metadata: Record<string, unknown>;
    }>(
      `SELECT action, actor_user_id, safe_metadata
         FROM audit_logs
        WHERE entity_id = $1
          AND action IN ('user.sessions.revoked', 'user.status.suspended', 'user.status.reactivated')
        ORDER BY occurred_at`,
      [employee.id],
    );
    const auditByAction = new Map(audit.rows.map((row) => [row.action, row]));
    expect(audit.rows).toHaveLength(3);
    expect(auditByAction.has('user.sessions.revoked')).toBe(true);
    expect(audit.rows.every((row) => row.actor_user_id === owner.id)).toBe(true);
    expect(auditByAction.get('user.sessions.revoked')?.safe_metadata).toMatchObject({
      revokedCount: 2,
      reason: 'employee_suspended',
    });
    expect(auditByAction.get('user.status.suspended')?.safe_metadata).toMatchObject({
      before: { status: 'active' },
      after: { status: 'suspended' },
    });
    expect(auditByAction.get('user.status.reactivated')?.safe_metadata).toMatchObject({
      before: { status: 'suspended' },
      after: { status: 'active' },
    });
    expect(suspended.headers['x-request-id']).toBeTruthy();
  });

  it('reissues an expired invitation for the same employee and invalidates the old token', async () => {
    const created = await invite('MANAGER');
    expect(created.status).toBe(201);
    const employee = created.body.data.employee as { id: string; email: string; roleCode: string };
    const oldSetupUrl = created.body.data.setupUrl as string;
    const oldToken = tokenFromSetupUrl(oldSetupUrl);
    await pool.query(
      "UPDATE user_invitations SET expires_at = created_at + interval '1 microsecond' WHERE user_id = $1",
      [employee.id],
    );

    const reissued = await post(ownerAgent, `/api/v1/users/${employee.id}/invitation/reissue`, {});
    expect(reissued.status).toBe(200);
    const replacement = reissued.body.data as {
      employee: { id: string; email: string; roleCode: string; status: string };
      setupUrl: string;
      expiresAt: string;
    };
    expect(replacement.employee).toMatchObject({
      id: employee.id,
      email: employee.email,
      roleCode: 'MANAGER',
      status: 'invited',
    });
    expect(replacement.setupUrl).not.toBe(oldSetupUrl);
    expect(new Date(replacement.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const newToken = tokenFromSetupUrl(replacement.setupUrl);
    expect(newToken).not.toBe(oldToken);

    const account = await pool.query<{ count: string; email: string; role_code: string }>(
      `SELECT count(*) OVER ()::text AS count, u.email_normalized AS email, r.code AS role_code
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1`,
      [employee.id],
    );
    expect(account.rows).toHaveLength(1);
    expect(account.rows[0]).toMatchObject({
      count: '1',
      email: employee.email,
      role_code: 'MANAGER',
    });

    const invitations = await pool.query<{
      token_hash: string;
      expires_at: Date;
      revoked_at: Date | null;
      consumed_at: Date | null;
    }>(
      `SELECT token_hash, expires_at, revoked_at, consumed_at
         FROM user_invitations WHERE user_id = $1 ORDER BY created_at, id`,
      [employee.id],
    );
    expect(invitations.rows).toHaveLength(2);
    expect(invitations.rows[0]?.revoked_at).toBeTruthy();
    expect(invitations.rows[0]?.consumed_at).toBeNull();
    expect(invitations.rows[1]?.token_hash.trim()).toBe(
      createHash('sha256').update(newToken).digest('hex'),
    );
    expect(invitations.rows[1]?.token_hash.trim()).not.toBe(oldToken);
    const openInvitations = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM user_invitations
        WHERE user_id = $1 AND revoked_at IS NULL AND consumed_at IS NULL`,
      [employee.id],
    );
    expect(openInvitations.rows[0]?.count).toBe('1');

    const rejectedOld = await post(request.agent(app), '/api/v1/users/invitations/accept', {
      token: oldToken,
      password: 'Employee-owned-synthetic-password-2026',
    });
    expect(rejectedOld.status).toBe(400);
    const acceptedNew = await post(request.agent(app), '/api/v1/users/invitations/accept', {
      token: newToken,
      password: 'Employee-owned-synthetic-password-2026',
    });
    expect(acceptedNew.status).toBe(200);
    const active = await pool.query<{ status: string; email: string }>(
      'SELECT status, email_normalized AS email FROM users WHERE id = $1',
      [employee.id],
    );
    expect(active.rows[0]).toEqual({ status: 'active', email: employee.email });

    const audit = await pool.query<{
      actor_user_id: string;
      request_id: string;
      safe_metadata: object;
    }>(
      `SELECT actor_user_id, request_id, safe_metadata FROM audit_logs
        WHERE action = 'user.invitation.reissued' AND entity_id = $1`,
      [employee.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.actor_user_id).toBe(owner.id);
    expect(audit.rows[0]?.request_id).toBe(reissued.headers['x-request-id']);
    expect(JSON.stringify(audit.rows[0]?.safe_metadata)).not.toContain(oldToken);
    expect(JSON.stringify(audit.rows[0]?.safe_metadata)).not.toContain(newToken);
    expect(JSON.stringify(audit.rows[0]?.safe_metadata)).not.toContain(oldSetupUrl);
    expect(JSON.stringify(audit.rows[0]?.safe_metadata)).not.toContain(replacement.setupUrl);
  });

  it('reissues a revoked invitation without creating a duplicate employee account', async () => {
    const created = await invite('STAFF');
    expect(created.status).toBe(201);
    const employee = created.body.data.employee as { id: string; email: string; roleCode: string };
    const oldToken = tokenFromSetupUrl(created.body.data.setupUrl);
    const revoked = await post(ownerAgent, `/api/v1/users/${employee.id}/invitation/revoke`, {});
    expect(revoked.status).toBe(200);

    const reissued = await post(ownerAgent, `/api/v1/users/${employee.id}/invitation/reissue`, {});
    expect(reissued.status).toBe(200);
    const replacement = reissued.body.data as {
      employee: { id: string; email: string; roleCode: string };
      setupUrl: string;
    };
    expect(replacement.employee).toMatchObject({
      id: employee.id,
      email: employee.email,
      roleCode: 'STAFF',
    });
    const newToken = tokenFromSetupUrl(replacement.setupUrl);
    expect(newToken).not.toBe(oldToken);

    const oldAcceptance = await post(request.agent(app), '/api/v1/users/invitations/accept', {
      token: oldToken,
      password: 'Employee-owned-synthetic-password-2026',
    });
    expect(oldAcceptance.status).toBe(400);
    const newAcceptance = await post(request.agent(app), '/api/v1/users/invitations/accept', {
      token: newToken,
      password: 'Employee-owned-synthetic-password-2026',
    });
    expect(newAcceptance.status).toBe(200);

    const accountCount = await pool.query<{ count: string; status: string }>(
      'SELECT count(*)::text AS count, max(status) AS status FROM users WHERE email_normalized = $1',
      [employee.email],
    );
    expect(accountCount.rows[0]).toEqual({ count: '1', status: 'active' });
    const audit = await pool.query<{ actor_user_id: string }>(
      `SELECT actor_user_id FROM audit_logs
        WHERE action = 'user.invitation.reissued' AND entity_id = $1`,
      [employee.id],
    );
    expect(audit.rows[0]?.actor_user_id).toBe(owner.id);
  });

  it('rolls back invitation rotation when the reissue audit insert fails', async () => {
    const created = await invite('STAFF');
    expect(created.status).toBe(201);
    const employeeId = created.body.data.employee.id as string;
    const oldToken = tokenFromSetupUrl(created.body.data.setupUrl);
    await pool.query(`
      CREATE FUNCTION test_fail_user_invitation_reissue_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'user.invitation.reissued' THEN
          RAISE EXCEPTION 'Synthetic invitation reissue audit failure';
        END IF;
        RETURN NEW;
      END;
      $$;
    `);
    await pool.query(`
      CREATE TRIGGER test_fail_user_invitation_reissue_audit
      BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION test_fail_user_invitation_reissue_audit();
    `);
    try {
      const failed = await post(ownerAgent, `/api/v1/users/${employeeId}/invitation/reissue`, {});
      expect(failed.status).toBe(500);
      const rows = await pool.query<{
        token_hash: string;
        revoked_at: Date | null;
        consumed_at: Date | null;
      }>(
        `SELECT token_hash, revoked_at, consumed_at FROM user_invitations
          WHERE user_id = $1`,
        [employeeId],
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]?.token_hash.trim()).toBe(
        createHash('sha256').update(oldToken).digest('hex'),
      );
      expect(rows.rows[0]?.revoked_at).toBeNull();
      expect(rows.rows[0]?.consumed_at).toBeNull();
    } finally {
      await pool.query(
        'DROP TRIGGER IF EXISTS test_fail_user_invitation_reissue_audit ON audit_logs',
      );
      await pool.query('DROP FUNCTION IF EXISTS test_fail_user_invitation_reissue_audit()');
    }
  });

  it('serialises concurrent invitation reissues to one open token', async () => {
    const created = await invite('STAFF');
    expect(created.status).toBe(201);
    const employeeId = created.body.data.employee.id as string;
    const firstAgent = request.agent(app);
    const secondAgent = request.agent(app);
    expect((await signIn(firstAgent, owner.email)).status).toBe(200);
    expect((await signIn(secondAgent, owner.email)).status).toBe(200);

    const attempts = await Promise.all([
      post(firstAgent, `/api/v1/users/${employeeId}/invitation/reissue`, {}),
      post(secondAgent, `/api/v1/users/${employeeId}/invitation/reissue`, {}),
    ]);
    expect(attempts.map((response) => response.status)).toEqual([200, 200]);
    const open = await pool.query<{ token_hash: string }>(
      `SELECT token_hash FROM user_invitations
        WHERE user_id = $1 AND revoked_at IS NULL AND consumed_at IS NULL`,
      [employeeId],
    );
    expect(open.rows).toHaveLength(1);
    const candidateTokens = attempts.map((response) =>
      tokenFromSetupUrl(response.body.data.setupUrl),
    );
    expect(
      candidateTokens.filter(
        (token) =>
          createHash('sha256').update(token).digest('hex') === open.rows[0]?.token_hash.trim(),
      ),
    ).toHaveLength(1);

    const activeCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM user_invitations
        WHERE user_id = $1 AND revoked_at IS NULL AND consumed_at IS NULL`,
      [employeeId],
    );
    expect(activeCount.rows[0]?.count).toBe('1');
  });

  it('revokes only the selected employee sessions and never returns session identifiers', async () => {
    const employee = await createActiveEmployee();
    const agent = request.agent(app);
    expect((await signIn(agent, employee.email)).status).toBe(200);
    const response = await post(ownerAgent, `/api/v1/users/${employee.id}/sessions/revoke`, {});
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ sessionsRevoked: 1 });
    const bodyText = JSON.stringify(response.body);
    expect(bodyText).not.toMatch(/sid|sessionId|cookie/i);
    const remaining = await pool.query('SELECT 1 FROM user_sessions WHERE user_id = $1', [
      employee.id,
    ]);
    expect(remaining.rowCount).toBe(0);
  });

  it('rejects self-suspension, self-session revocation and Owner account administration', async () => {
    const selfSuspend = await patch(ownerAgent, `/api/v1/users/${owner.id}/status`, {
      status: 'suspended',
    });
    expect(selfSuspend.status).toBe(409);
    expect(selfSuspend.body.error.code).toBe('SELF_STATUS_CHANGE');
    const selfRevoke = await post(ownerAgent, `/api/v1/users/${owner.id}/sessions/revoke`, {});
    expect(selfRevoke.status).toBe(409);
    expect(selfRevoke.body.error.code).toBe('SELF_SESSION_REVOCATION');

    const secondOwner = await createAccount('OWNER');
    const otherOwner = await patch(ownerAgent, `/api/v1/users/${secondOwner.id}/status`, {
      status: 'suspended',
    });
    expect(otherOwner.status).toBe(409);
    expect(otherOwner.body.error.code).toBe('OWNER_ACCOUNT_PROTECTED');
  });

  it('rolls back account status and session deletion if the audit insert fails', async () => {
    const employee = await createActiveEmployee();
    const agent = request.agent(app);
    expect((await signIn(agent, employee.email)).status).toBe(200);
    await pool.query(`
      CREATE FUNCTION test_fail_user_suspension_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'user.status.suspended' THEN
          RAISE EXCEPTION 'Synthetic user audit failure';
        END IF;
        RETURN NEW;
      END;
      $$;
    `);
    await pool.query(`
      CREATE TRIGGER test_fail_user_suspension_audit
      BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION test_fail_user_suspension_audit();
    `);
    try {
      const failed = await patch(ownerAgent, `/api/v1/users/${employee.id}/status`, {
        status: 'suspended',
      });
      expect(failed.status).toBe(500);
      const state = await pool.query<{ status: string; sessions: string }>(
        `SELECT u.status, count(s.sid)::text AS sessions
           FROM users u LEFT JOIN user_sessions s ON s.user_id = u.id
          WHERE u.id = $1 GROUP BY u.id`,
        [employee.id],
      );
      expect(state.rows[0]).toEqual({ status: 'active', sessions: '1' });
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS test_fail_user_suspension_audit ON audit_logs');
      await pool.query('DROP FUNCTION IF EXISTS test_fail_user_suspension_audit()');
    }
  });
});
