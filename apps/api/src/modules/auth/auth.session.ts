import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import type { Pool, PoolClient } from 'pg';
import { pool } from '../../db/pool.js';

function regenerate(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function save(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.save((error) => (error ? reject(error) : resolve()));
  });
}

export async function rotateSession(
  request: Request,
  userId: string,
  authIssuedAt = Date.now(),
): Promise<void> {
  await regenerate(request);
  request.session.userId = userId;
  request.session.authIssuedAt = authIssuedAt;
  request.session.csrfToken = randomBytes(32).toString('hex');
  await save(request);
}

export async function issueCsrfToken(request: Request): Promise<string> {
  if (!request.session.csrfToken) {
    request.session.csrfToken = randomBytes(32).toString('hex');
  }
  await save(request);
  return request.session.csrfToken;
}

export async function destroySession(request: Request): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    request.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

export async function revokeSessionsForUser(userId: string, client: Pool | PoolClient = pool): Promise<number> {
  const result = await client.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
  return result.rowCount ?? 0;
}
