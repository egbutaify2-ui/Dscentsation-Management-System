import { createHash, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../db/pool.js';

let actorId: string;
let ownerRoleId: string;

beforeAll(async () => {
  const ownerRole = await pool.query<{ id: string }>("SELECT id FROM roles WHERE code = 'OWNER'");
  if (!ownerRole.rows[0]) throw new Error('Owner role seed is missing.');
  ownerRoleId = ownerRole.rows[0].id;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users(email_normalized, display_name, password_hash, role_id)
     VALUES ($1, 'Synthetic Account Administration Actor', 'synthetic-test-hash', $2)
     RETURNING id`,
    [`task008.database.actor.${randomUUID()}@example.invalid`, ownerRoleId],
  );
  actorId = user.rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
});

describe('Employee Account Administration database invariants', () => {
  it('permits invited users and stores only the SHA-256 invitation-token digest', async () => {
    const role = await pool.query<{ id: string }>("SELECT id FROM roles WHERE code = 'STAFF'");
    const rawToken = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
    const digest = createHash('sha256').update(rawToken).digest('hex');
    const passwordHash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
    const employee = await pool.query<{ id: string }>(
      `INSERT INTO users(email_normalized, display_name, password_hash, role_id, status, created_by)
       VALUES ($1, 'Synthetic Invited Employee', $2, $3, 'invited', $4)
       RETURNING id`,
      [`task008.invited.${randomUUID()}@example.invalid`, passwordHash, role.rows[0]!.id, actorId],
    );
    const invitation = await pool.query<{ token_hash: string; expires_at: Date | string }>(
      `INSERT INTO user_invitations(user_id, token_hash, expires_at, created_by)
       VALUES ($1, $2, now() + interval '24 hours', $3)
       RETURNING token_hash, expires_at`,
      [employee.rows[0]!.id, digest, actorId],
    );

    expect(invitation.rows[0]!.token_hash.trim()).toBe(digest);
    expect(invitation.rows[0]!.token_hash).not.toContain(rawToken);
    expect(new Date(invitation.rows[0]!.expires_at).getTime()).toBeGreaterThan(Date.now());
    await expect(
      pool.query(
        `INSERT INTO user_invitations(user_id, token_hash, expires_at, created_by)
         VALUES ($1, $2, now() + interval '24 hours', $3)`,
        [employee.rows[0]!.id, digest, actorId],
      ),
    ).rejects.toThrow(/duplicate key/i);
    await expect(
      pool.query(
        `UPDATE user_invitations
            SET revoked_at = now(), consumed_at = now()
          WHERE user_id = $1`,
        [employee.rows[0]!.id],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it('prevents hard deletion of employee user accounts at the database boundary', async () => {
    const role = await pool.query<{ id: string }>("SELECT id FROM roles WHERE code = 'STAFF'");
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users(email_normalized, display_name, password_hash, role_id, created_by)
       VALUES ($1, 'Synthetic Non-deletable Employee', 'synthetic-hash', $2, $3)
       RETURNING id`,
      [`task008.no-delete.${randomUUID()}@example.invalid`, role.rows[0]!.id, actorId],
    );

    await expect(
      pool.query('DELETE FROM users WHERE id = $1', [user.rows[0]!.id]),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'users_hard_delete_prohibited',
    });
    const retained = await pool.query('SELECT 1 FROM users WHERE id = $1', [user.rows[0]!.id]);
    expect(retained.rowCount).toBe(1);
  });

  it('allows the invited status through the migrated users status constraint', async () => {
    const constraint = await pool.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = 'users'::regclass AND conname = 'users_status_check'`,
    );
    expect(constraint.rows[0]?.definition).toContain('invited');
  });

  it('protects the last active Owner while allowing a non-final Owner to be suspended', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE users IN ACCESS EXCLUSIVE MODE');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('dms.last-active-owner'))");
      // Isolate this invariant inside a rolled-back transaction from synthetic Owners
      // created by other integration suites in the disposable database.
      await client.query('SET LOCAL session_replication_role = replica');
      await client.query(
        `UPDATE users u
            SET status = 'suspended'
           FROM roles r
          WHERE r.id = u.role_id AND r.code = 'OWNER' AND u.status = 'active'`,
      );
      const first = await client.query<{ id: string }>(
        `INSERT INTO users(email_normalized, display_name, password_hash, role_id, created_by)
         VALUES ($1, 'Synthetic Owner One', 'synthetic-hash', $2, $3)
         RETURNING id`,
        [`task008.owner.one.${randomUUID()}@example.invalid`, ownerRoleId, actorId],
      );
      const second = await client.query<{ id: string }>(
        `INSERT INTO users(email_normalized, display_name, password_hash, role_id, created_by)
         VALUES ($1, 'Synthetic Owner Two', 'synthetic-hash', $2, $3)
         RETURNING id`,
        [`task008.owner.two.${randomUUID()}@example.invalid`, ownerRoleId, actorId],
      );
      await client.query('SET LOCAL session_replication_role = origin');

      await client.query("UPDATE users SET status = 'suspended' WHERE id = $1", [first.rows[0]!.id]);
      await expect(
        client.query("UPDATE users SET status = 'disabled' WHERE id = $1", [second.rows[0]!.id]),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'users_last_active_owner_protected',
      });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
