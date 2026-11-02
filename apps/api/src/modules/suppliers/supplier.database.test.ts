import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../db/pool.js';

let actorId: string;

beforeAll(async () => {
  const role = await pool.query<{ id: string }>("SELECT id FROM roles WHERE code = 'OWNER'");
  if (!role.rows[0]) throw new Error('Owner role seed is missing.');
  const actor = await pool.query<{ id: string }>(
    `INSERT INTO users(email_normalized, display_name, password_hash, role_id)
     VALUES ($1, 'Synthetic Supplier DB Actor', 'synthetic-test-hash', $2)
     RETURNING id`,
    ['task020.database.' + randomUUID() + '@example.invalid', role.rows[0].id],
  );
  actorId = actor.rows[0]!.id;
});

afterAll(async () => {
  if (actorId) {
    await pool.query(
      "UPDATE suppliers SET status = 'inactive', updated_by = $1, updated_at = now() WHERE created_by = $1 AND status = 'active'",
      [actorId],
    );
  }
  await pool.end();
});

describe('Supplier Directory database invariants', () => {
  it('generates unique SUP references for concurrent inserts', async () => {
    const inserts = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        pool.query<{ id: string; supplier_code: string }>(
          `INSERT INTO suppliers(display_name, normalized_name, created_by, updated_by)
           VALUES ($1, $2, $3, $3)
           RETURNING id, supplier_code`,
          [
            'Synthetic Concurrent Supplier ' + index + ' ' + randomUUID().slice(0, 8),
            'synthetic concurrent supplier ' + index + ' ' + randomUUID().slice(0, 8),
            actorId,
          ],
        ),
      ),
    );
    const codes = inserts.map((result) => result.rows[0]!.supplier_code);
    expect(new Set(codes).size).toBe(16);
    expect(codes.every((code) => /^SUP-[0-9]{6,}$/.test(code))).toBe(true);
  });

  it('enforces trimmed required names, normalized-name format and valid statuses', async () => {
    await expect(
      pool.query(
        `INSERT INTO suppliers(display_name, normalized_name, created_by, updated_by)
         VALUES ('   ', '   ', $1, $1)`,
        [actorId],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      pool.query(
        `INSERT INTO suppliers(display_name, normalized_name, created_by, updated_by)
         VALUES ('Synthetic Name', 'Synthetic Name', $1, $1)`,
        [actorId],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      pool.query(
        `INSERT INTO suppliers(display_name, normalized_name, status, created_by, updated_by)
         VALUES ('Synthetic Invalid Status', 'synthetic invalid status', 'blocked', $1, $1)`,
        [actorId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces creator and updater foreign keys', async () => {
    await expect(
      pool.query(
        `INSERT INTO suppliers(display_name, normalized_name, created_by, updated_by)
         VALUES ('Synthetic Invalid Actor', 'synthetic invalid actor', $1, $2)`,
        [randomUUID(), actorId],
      ),
    ).rejects.toMatchObject({ code: '23503' });

    await expect(
      pool.query(
        `INSERT INTO suppliers(display_name, normalized_name, created_by, updated_by)
         VALUES ('Synthetic Invalid Updater', 'synthetic invalid updater', $1, $2)`,
        [actorId, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('allows similar and identical normalized names without silently blocking separate suppliers', async () => {
    const displayName = 'Synthetic Duplicate Awareness ' + randomUUID().slice(0, 8);
    const normalizedName = displayName.toLowerCase();
    const result = await pool.query<{ id: string; supplier_code: string }>(
      `INSERT INTO suppliers(display_name, normalized_name, created_by, updated_by)
       VALUES ($1, $2, $3, $3), ($1, $2, $3, $3)
       RETURNING id, supplier_code`,
      [displayName, normalizedName, actorId],
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.id).not.toBe(result.rows[1]!.id);
    expect(result.rows[0]!.supplier_code).not.toBe(result.rows[1]!.supplier_code);
  });

  it('keeps supplier codes immutable and prohibits DELETE and TRUNCATE', async () => {
    const inserted = await pool.query<{ id: string; supplier_code: string }>(
      `INSERT INTO suppliers(display_name, normalized_name, created_by, updated_by)
       VALUES ('Synthetic Protected Supplier', 'synthetic protected supplier', $1, $1)
       RETURNING id, supplier_code`,
      [actorId],
    );
    const supplier = inserted.rows[0]!;

    await expect(
      pool.query('UPDATE suppliers SET supplier_code = $2 WHERE id = $1', [
        supplier.id,
        'SUP-999999',
      ]),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      pool.query('DELETE FROM suppliers WHERE id = $1', [supplier.id]),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'suppliers_hard_delete_prohibited',
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expect(client.query('TRUNCATE TABLE suppliers')).rejects.toMatchObject({
        code: '23514',
        constraint: 'suppliers_truncate_prohibited',
      });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }

    const retained = await pool.query<{ supplier_code: string }>(
      'SELECT supplier_code FROM suppliers WHERE id = $1',
      [supplier.id],
    );
    expect(retained.rows[0]?.supplier_code).toBe(supplier.supplier_code);
  });

  it('persists all four supplier permission codes', async () => {
    const permissions = await pool.query<{ code: string }>(
      `SELECT code FROM permissions
        WHERE code IN (
          'suppliers.view',
          'suppliers.create',
          'suppliers.update',
          'suppliers.manage_status'
        )
        ORDER BY code`,
    );
    expect(permissions.rows.map((row) => row.code)).toEqual([
      'suppliers.create',
      'suppliers.manage_status',
      'suppliers.update',
      'suppliers.view',
    ]);
  });
});
