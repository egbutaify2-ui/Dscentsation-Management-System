import type { QueryResultRow } from 'pg';
import { pool } from '../../db/pool.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

interface UserQueryRow extends QueryResultRow {
  id: string;
  email: string;
  display_name: string;
  role_code: AuthenticatedUser['roleCode'];
  role_name: string;
  permissions: string[];
}

export interface LoginUserRecord extends AuthenticatedUser {
  passwordHash: string;
  status: string;
}

const userJoins = `
  FROM users u
  JOIN roles r ON r.id = u.role_id
  LEFT JOIN role_permissions rp ON rp.role_id = r.id
  LEFT JOIN permissions p ON p.id = rp.permission_id
`;

const userFields = `
  u.id,
  u.email_normalized AS email,
  u.display_name,
  r.code AS role_code,
  r.name AS role_name,
  COALESCE(
    array_agg(p.code ORDER BY p.code) FILTER (WHERE p.code IS NOT NULL),
    ARRAY[]::VARCHAR[]
  ) AS permissions
`;

export async function findActiveUserById(userId: string): Promise<AuthenticatedUser | null> {
  const result = await pool.query<UserQueryRow>(
    `SELECT ${userFields}
     ${userJoins}
     WHERE u.id = $1 AND u.status = 'active'
     GROUP BY u.id, r.id`,
    [userId],
  );
  const user = result.rows[0];
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    roleCode: user.role_code,
    roleName: user.role_name,
    permissions: user.permissions,
  };
}

export async function findUserForLogin(email: string): Promise<LoginUserRecord | null> {
  const result = await pool.query<UserQueryRow & { password_hash: string; status: string }>(
    `SELECT ${userFields}, u.password_hash, u.status
     ${userJoins}
     WHERE u.email_normalized = $1
     GROUP BY u.id, r.id`,
    [email],
  );
  const user = result.rows[0];
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    roleCode: user.role_code,
    roleName: user.role_name,
    permissions: user.permissions,
    passwordHash: user.password_hash,
    status: user.status,
  };
}
