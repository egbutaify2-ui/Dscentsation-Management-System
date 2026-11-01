import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import argon2 from 'argon2';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { revokeSessionsForUser, rotateSession } from '../auth/auth.session.js';
import { appendAuditEvent } from '../audit/audit.service.js';
import { UserAdminError } from './user-admin.errors.js';

type EmployeeRole = 'MANAGER' | 'STAFF';
type EmployeeStatus = 'active' | 'suspended' | 'disabled' | 'invited';

export interface EmployeeFilters {
  search?: string;
  role?: EmployeeRole | 'all';
  status?: EmployeeStatus | 'all';
}

interface EmployeeRow {
  id: string;
  email: string;
  display_name: string;
  role_code: EmployeeRole;
  role_name: string;
  status: EmployeeStatus;
  created_at: Date | string;
  last_login_at: Date | string | null;
}

export interface EmployeeRecord {
  id: string;
  email: string;
  displayName: string;
  roleCode: EmployeeRole;
  roleName: string;
  status: EmployeeStatus;
  createdAt: string;
  lastLoginAt: string | null;
}

function mapEmployee(row: EmployeeRow): EmployeeRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    roleCode: row.role_code,
    roleName: row.role_name,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
  };
}

function tokenDigest(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export async function listEmployees(filters: EmployeeFilters = {}): Promise<EmployeeRecord[]> {
  const result = await pool.query<EmployeeRow>(
    `SELECT u.id, u.email_normalized AS email, u.display_name,
            r.code AS role_code, r.name AS role_name, u.status,
            u.created_at, u.last_login_at
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE r.code IN ('MANAGER', 'STAFF')
        AND ($1::text IS NULL OR position(lower($1) in lower(u.display_name)) > 0
             OR position(lower($1) in u.email_normalized) > 0)
        AND ($2::text IS NULL OR r.code = $2)
        AND ($3::text IS NULL OR u.status = $3)
      ORDER BY u.created_at DESC, u.id`,
    [
      filters.search?.trim() || null,
      filters.role && filters.role !== 'all' ? filters.role : null,
      filters.status && filters.status !== 'all' ? filters.status : null,
    ],
  );
  return result.rows.map(mapEmployee);
}

export async function createEmployeeInvitation(
  actorUserId: string,
  requestId: string,
  input: { displayName: string; email: string; role: EmployeeRole },
): Promise<{ employee: EmployeeRecord; setupUrl: string; expiresAt: string }> {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = tokenDigest(token);
  const placeholderHash = await argon2.hash(randomBytes(32).toString('hex'), {
    type: argon2.argon2id,
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const role = await client.query<{ id: string; name: string }>(
      "SELECT id, name FROM roles WHERE code = $1 AND code IN ('MANAGER', 'STAFF')",
      [input.role],
    );
    if (!role.rows[0]) {
      throw new UserAdminError('Only Manager and Staff accounts may be invited.', 400, 'INVALID_ROLE');
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO users(
         email_normalized, display_name, password_hash, role_id, status, created_by
       )
       VALUES ($1, $2, $3, $4, 'invited', $5)
       RETURNING id`,
      [
        input.email.trim().toLowerCase(),
        input.displayName.trim(),
        placeholderHash,
        role.rows[0].id,
        actorUserId,
      ],
    );
    const employeeId = inserted.rows[0]?.id;
    if (!employeeId) throw new Error('Employee invitation could not create an account.');

    const employeeResult = await client.query<EmployeeRow>(
      `SELECT u.id, u.email_normalized AS email, u.display_name,
              r.code AS role_code, r.name AS role_name, u.status,
              u.created_at, u.last_login_at
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1`,
      [employeeId],
    );
    const employee = employeeResult.rows[0];
    if (!employee) throw new Error('Employee invitation could not load the new account.');

    const invitation = await client.query<{ expires_at: Date | string }>(
      `INSERT INTO user_invitations(user_id, token_hash, expires_at, created_by)
       VALUES ($1, $2, now() + ($3::int * interval '1 hour'), $4)
       RETURNING expires_at`,
      [employeeId, tokenHash, env.INVITATION_EXPIRY_HOURS, actorUserId],
    );
    const expiresAt = new Date(invitation.rows[0]!.expires_at).toISOString();

    await appendAuditEvent(
      {
        actorUserId,
        action: 'user.invitation.created',
        entityType: 'user',
        entityId: employeeId,
        requestId,
        safeMetadata: {
          before: null,
          after: {
            displayName: employee.display_name,
            email: employee.email,
            role: { code: employee.role_code, name: employee.role_name },
            status: employee.status,
          },
          invitationExpiresAt: expiresAt,
          delivery: 'manual_company_email',
        },
      },
      client,
    );
    await client.query('COMMIT');

    const setupUrl =
      `${env.APP_ORIGIN.replace(/\/$/, '')}/#/invite/accept?token=${encodeURIComponent(token)}`;
    return { employee: mapEmployee(employee), setupUrl, expiresAt };
  } catch (error) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(error)) {
      throw new UserAdminError(
        'An account already exists for that email address.',
        409,
        'EMAIL_ALREADY_EXISTS',
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function acceptEmployeeInvitation(
  request: Request,
  token: string,
  password: string,
  requestId: string,
): Promise<void> {
  const digest = tokenDigest(token);
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const client = await pool.connect();
  let acceptedUserId: string;
  try {
    await client.query('BEGIN');
    const invitation = await client.query<{
      id: string;
      user_id: string;
      expires_at: Date | string;
      revoked_at: Date | string | null;
      consumed_at: Date | string | null;
      status: string;
    }>(
      `SELECT i.id, i.user_id, i.expires_at, i.revoked_at, i.consumed_at, u.status
         FROM user_invitations i
         JOIN users u ON u.id = i.user_id
        WHERE i.token_hash = $1
        FOR UPDATE OF i, u`,
      [digest],
    );
    const row = invitation.rows[0];
    if (
      !row ||
      row.revoked_at ||
      row.consumed_at ||
      new Date(row.expires_at).getTime() <= Date.now() ||
      row.status !== 'invited'
    ) {
      throw new UserAdminError(
        'This invitation is invalid, expired or no longer available.',
        400,
        'INVITATION_INVALID',
      );
    }

    const activated = await client.query<{ id: string }>(
      `UPDATE users
          SET password_hash = $2, status = 'active', updated_at = now()
        WHERE id = $1 AND status = 'invited'
        RETURNING id`,
      [row.user_id, passwordHash],
    );
    if (!activated.rows[0]) {
      throw new UserAdminError(
        'This invitation is invalid, expired or no longer available.',
        400,
        'INVITATION_INVALID',
      );
    }

    const consumed = await client.query(
      `UPDATE user_invitations
          SET consumed_at = now()
        WHERE id = $1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
      [row.id],
    );
    if (consumed.rowCount !== 1) {
      throw new UserAdminError(
        'This invitation is invalid, expired or no longer available.',
        400,
        'INVITATION_INVALID',
      );
    }

    acceptedUserId = row.user_id;
    await appendAuditEvent(
      {
        actorUserId: acceptedUserId,
        action: 'user.invitation.accepted',
        entityType: 'user',
        entityId: acceptedUserId,
        requestId,
        safeMetadata: {
          before: { status: 'invited', passwordConfigured: false },
          after: { status: 'active', passwordConfigured: true },
          actorType: 'invited_employee',
        },
      },
      client,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await rotateSession(request, acceptedUserId);
}

export async function setEmployeeStatus(
  actorUserId: string,
  requestId: string,
  userId: string,
  status: 'active' | 'suspended',
): Promise<{ employee: EmployeeRecord; sessionsRevoked: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<EmployeeRow>(
      `SELECT u.id, u.email_normalized AS email, u.display_name,
              r.code AS role_code, r.name AS role_name, u.status,
              u.created_at, u.last_login_at
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1
        FOR UPDATE OF u`,
      [userId],
    );
    const current = result.rows[0];
    if (!current) throw new UserAdminError('Employee account was not found.', 404, 'USER_NOT_FOUND');
    if (userId === actorUserId) {
      throw new UserAdminError('You cannot change your own account status here.', 409, 'SELF_STATUS_CHANGE');
    }
    if (current.role_code !== 'MANAGER' && current.role_code !== 'STAFF') {
      throw new UserAdminError(
        'Owner accounts cannot be managed through employee administration.',
        409,
        'OWNER_ACCOUNT_PROTECTED',
      );
    }
    if (current.status === status) {
      throw new UserAdminError('The employee already has that account status.', 409, 'STATUS_UNCHANGED');
    }
    if (status === 'active' && current.status !== 'suspended') {
      throw new UserAdminError('Only suspended accounts can be reactivated.', 409, 'STATUS_TRANSITION_INVALID');
    }
    if (status === 'suspended' && current.status !== 'active') {
      throw new UserAdminError('Only active accounts can be suspended.', 409, 'STATUS_TRANSITION_INVALID');
    }

    const updated = await client.query(
      'UPDATE users SET status = $2, updated_at = now() WHERE id = $1',
      [userId, status],
    );
    if (updated.rowCount !== 1) throw new UserAdminError('Employee account was not found.', 404, 'USER_NOT_FOUND');
    const sessionsRevoked = status === 'suspended' ? await revokeSessionsForUser(userId, client) : 0;
    await appendAuditEvent(
      {
        actorUserId,
        action: status === 'suspended' ? 'user.status.suspended' : 'user.status.reactivated',
        entityType: 'user',
        entityId: userId,
        requestId,
        safeMetadata: {
          before: {
            displayName: current.display_name,
            email: current.email,
            role: current.role_code,
            status: current.status,
          },
          after: {
            displayName: current.display_name,
            email: current.email,
            role: current.role_code,
            status,
          },
          sessionsRevoked,
        },
      },
      client,
    );
    await client.query('COMMIT');

    return { employee: mapEmployee({ ...current, status }), sessionsRevoked };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeEmployeeSessions(
  actorUserId: string,
  requestId: string,
  userId: string,
): Promise<{ sessionsRevoked: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target = await client.query<{ id: string; role_code: string }>(
      `SELECT u.id, r.code AS role_code
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1
        FOR UPDATE OF u`,
      [userId],
    );
    if (!target.rows[0]) throw new UserAdminError('Employee account was not found.', 404, 'USER_NOT_FOUND');
    if (userId === actorUserId) {
      throw new UserAdminError('You cannot revoke your own session through employee administration.', 409, 'SELF_SESSION_REVOCATION');
    }
    if (target.rows[0].role_code !== 'MANAGER' && target.rows[0].role_code !== 'STAFF') {
      throw new UserAdminError('Owner sessions cannot be managed through employee administration.', 409, 'OWNER_ACCOUNT_PROTECTED');
    }

    const sessionsRevoked = await revokeSessionsForUser(userId, client);
    await appendAuditEvent(
      {
        actorUserId,
        action: 'user.sessions.revoked',
        entityType: 'user',
        entityId: userId,
        requestId,
        safeMetadata: { sessionsRevoked },
      },
      client,
    );
    await client.query('COMMIT');
    return { sessionsRevoked };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeEmployeeInvitation(
  actorUserId: string,
  requestId: string,
  userId: string,
): Promise<{ revoked: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target = await client.query<{ id: string; status: string; role_code: string }>(
      `SELECT u.id, u.status, r.code AS role_code
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1
        FOR UPDATE OF u`,
      [userId],
    );
    const row = target.rows[0];
    if (!row) throw new UserAdminError('Employee account was not found.', 404, 'USER_NOT_FOUND');
    if (row.role_code !== 'MANAGER' && row.role_code !== 'STAFF') {
      throw new UserAdminError('Owner invitations cannot be managed here.', 409, 'OWNER_ACCOUNT_PROTECTED');
    }
    if (row.status !== 'invited') {
      throw new UserAdminError('Only pending invitations can be revoked.', 409, 'INVITATION_NOT_PENDING');
    }

    const revoked = await client.query(
      `UPDATE user_invitations
          SET revoked_at = now()
        WHERE user_id = $1 AND revoked_at IS NULL AND consumed_at IS NULL
          AND expires_at > now()`,
      [userId],
    );
    if (revoked.rowCount !== 1) {
      throw new UserAdminError('No active invitation is available to revoke.', 409, 'INVITATION_NOT_PENDING');
    }
    await appendAuditEvent(
      {
        actorUserId,
        action: 'user.invitation.revoked',
        entityType: 'user',
        entityId: userId,
        requestId,
        safeMetadata: {
          before: { status: 'invited', invitationActive: true },
          after: { status: 'invited', invitationActive: false },
        },
      },
      client,
    );
    await client.query('COMMIT');
    return { revoked: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
