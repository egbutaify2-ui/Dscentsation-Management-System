import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../db/pool.js';

let actorId: string;
let staffRoleId: string;

beforeAll(async () => {
  const [ownerRole, staffRole] = await Promise.all([
    pool.query<{ id: string }>("SELECT id FROM roles WHERE code = 'OWNER'"),
    pool.query<{ id: string }>("SELECT id FROM roles WHERE code = 'STAFF'"),
  ]);
  if (!ownerRole.rows[0] || !staffRole.rows[0]) {
    throw new Error('Employee role seeds are missing.');
  }
  const actor = await pool.query<{ id: string }>(
    `INSERT INTO users(email_normalized, display_name, password_hash, role_id)
     VALUES ($1, 'Synthetic Password Reset Owner', 'synthetic-test-hash', $2)
     RETURNING id`,
    [`task035.database.owner.${randomUUID()}@example.invalid`, ownerRole.rows[0].id],
  );
  actorId = actor.rows[0]!.id;
  staffRoleId = staffRole.rows[0].id;
});

afterAll(async () => {
  await pool.end();
});

describe('Employee Password Reset database safeguards', () => {
  it('stores a SHA-256 digest and enforces one open reset token per employee', async () => {
    const employee = await pool.query<{ id: string }>(
      `INSERT INTO users(email_normalized, display_name, password_hash, role_id, created_by)
       VALUES ($1, 'Synthetic Reset Employee', 'synthetic-test-hash', $2, $3)
       RETURNING id`,
      [`task035.database.employee.${randomUUID()}@example.invalid`, staffRoleId, actorId],
    );
    const rawToken = randomUUID().replaceAll('-', '') + randomUUID().slice(0, 4);
    const digest = createHash('sha256').update(rawToken).digest('hex');
    const inserted = await pool.query<{ id: string; token_hash: string }>(
      `INSERT INTO user_password_resets(user_id, token_hash, expires_at, created_by)
       VALUES ($1, $2, now() + interval '24 hours', $3)
       RETURNING id, token_hash`,
      [employee.rows[0]!.id, digest, actorId],
    );

    expect(inserted.rows[0]?.token_hash.trim()).toBe(digest);
    expect(inserted.rows[0]?.token_hash).not.toContain(rawToken);
    await expect(
      pool.query(
        `INSERT INTO user_password_resets(user_id, token_hash, expires_at, created_by)
         VALUES ($1, $2, now() + interval '24 hours', $3)`,
        [employee.rows[0]!.id, createHash('sha256').update(randomUUID()).digest('hex'), actorId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('makes reset-token identity immutable and permits only one terminal transition', async () => {
    const employee = await pool.query<{ id: string }>(
      `INSERT INTO users(email_normalized, display_name, password_hash, role_id, created_by)
       VALUES ($1, 'Synthetic Immutable Reset Employee', 'synthetic-test-hash', $2, $3)
       RETURNING id`,
      [`task035.database.immutable.${randomUUID()}@example.invalid`, staffRoleId, actorId],
    );
    const tokenHash = createHash('sha256').update(randomUUID()).digest('hex');
    const reset = await pool.query<{ id: string }>(
      `INSERT INTO user_password_resets(user_id, token_hash, expires_at, created_by)
       VALUES ($1, $2, now() + interval '24 hours', $3)
       RETURNING id`,
      [employee.rows[0]!.id, tokenHash, actorId],
    );
    const resetId = reset.rows[0]!.id;

    await expect(
      pool.query('UPDATE user_password_resets SET expires_at = now() WHERE id = $1', [resetId]),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'user_password_resets_immutable_fields',
    });
    await expect(
      pool.query('DELETE FROM user_password_resets WHERE id = $1', [resetId]),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'user_password_resets_history_immutable',
    });
    await expect(pool.query('TRUNCATE user_password_resets')).rejects.toMatchObject({
      code: '23514',
      constraint: 'user_password_resets_history_immutable',
    });

    await pool.query('UPDATE user_password_resets SET revoked_at = now() WHERE id = $1', [resetId]);
    await expect(
      pool.query('UPDATE user_password_resets SET consumed_at = now() WHERE id = $1', [resetId]),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'user_password_resets_terminal_state',
    });
  });
});
