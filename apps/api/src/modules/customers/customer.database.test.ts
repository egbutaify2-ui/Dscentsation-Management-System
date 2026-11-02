import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../db/pool.js';

const suffix = randomUUID();
let actorId: string;

describe('Customer Management database invariants', () => {
  beforeAll(async () => {
    const role = await pool.query<{ id: string }>("SELECT id FROM roles WHERE code = 'OWNER'");
    if (!role.rows[0]) throw new Error('Missing Owner role seed.');
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users(email_normalized, display_name, password_hash, role_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        `task011.database.${suffix}@example.invalid`,
        'Synthetic customer database actor',
        'synthetic-hash',
        role.rows[0].id,
      ],
    );
    actorId = user.rows[0]!.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('requires a trimmed non-blank name and permits nullable contact fields', async () => {
    await expect(
      pool.query(
        `INSERT INTO customers(full_name, created_by, updated_by)
         VALUES ('   ', $1, $1)`,
        [actorId],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    const result = await pool.query<{
      full_name: string;
      phone: string | null;
      email: string | null;
      notes: string | null;
      status: string;
    }>(
      `INSERT INTO customers(full_name, phone, email, notes, created_by, updated_by)
       VALUES ($1, NULL, NULL, NULL, $2, $2)
       RETURNING full_name, phone, email, notes, status`,
      [`  Synthetic Nullable ${suffix.slice(0, 8)}  `.trim(), actorId],
    );
    expect(result.rows[0]).toMatchObject({
      phone: null,
      email: null,
      notes: null,
      status: 'active',
    });
  });

  it('allows shared phone numbers and email addresses without automatic duplicate handling', async () => {
    const sharedPhone = '+2348000000000';
    const sharedEmail = `shared.${suffix}@example.invalid`;
    const records = await pool.query<{ id: string }>(
      `INSERT INTO customers(full_name, phone, email, created_by, updated_by)
       VALUES ($1, $3, $4, $5, $5), ($2, $3, $4, $5, $5)
       RETURNING id`,
      [
        `Synthetic Contact A ${suffix}`,
        `Synthetic Contact B ${suffix}`,
        sharedPhone,
        sharedEmail,
        actorId,
      ],
    );
    expect(records.rows).toHaveLength(2);
    expect(records.rows[0]!.id).not.toBe(records.rows[1]!.id);
  });

  it('enforces actor foreign keys and preserves archived rows', async () => {
    await expect(
      pool.query(
        `INSERT INTO customers(full_name, created_by, updated_by)
         VALUES ($1, $2, $3)`,
        [`Invalid Actor ${suffix}`, randomUUID(), actorId],
      ),
    ).rejects.toMatchObject({ code: '23503' });

    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO customers(full_name, created_by, updated_by)
       VALUES ($1, $2, $2) RETURNING id`,
      [`Synthetic Archived ${suffix}`, actorId],
    );
    const customerId = inserted.rows[0]!.id;
    await pool.query(
      "UPDATE customers SET status = 'archived', updated_by = $2, updated_at = now() WHERE id = $1",
      [customerId, actorId],
    );
    const archived = await pool.query<{ status: string }>(
      'SELECT status FROM customers WHERE id = $1',
      [customerId],
    );
    expect(archived.rows[0]?.status).toBe('archived');
    await expect(pool.query('DELETE FROM customers WHERE id = $1', [customerId])).rejects.toThrow(
      /archived, not deleted/i,
    );
    expect(await pool.query('SELECT 1 FROM customers WHERE id = $1', [customerId])).toHaveProperty(
      'rowCount',
      1,
    );
  });

  it('enforces actor references for both creation and update attribution', async () => {
    await expect(
      pool.query(
        `INSERT INTO customers(full_name, created_by, updated_by)
         VALUES ($1, $2, $3)`,
        [`Invalid Updated Actor ${suffix}`, actorId, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
});
