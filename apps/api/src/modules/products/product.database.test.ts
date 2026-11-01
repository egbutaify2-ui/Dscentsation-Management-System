import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../db/pool.js';
import { fromMinorUnits, toMinorUnits } from './product.money.js';

let actorId: string;

beforeAll(async () => {
  const ownerRole = await pool.query<{ id: string }>('SELECT id FROM roles WHERE code = $1', ['OWNER']);
  if (!ownerRole.rows[0]) throw new Error('Owner role seed is missing.');
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users(email_normalized, display_name, password_hash, role_id)
     VALUES ($1, 'Synthetic Product DB Actor', 'synthetic-test-hash', $2)
     RETURNING id`,
    [`task007.database.${randomUUID()}@example.invalid`, ownerRole.rows[0].id],
  );
  actorId = user.rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
});

describe('Product Management database invariants', () => {
  it('converts decimal naira values to integer kobo without floating-point arithmetic', () => {
    expect(toMinorUnits('1250')).toBe('125000');
    expect(toMinorUnits('1250.5')).toBe('125050');
    expect(toMinorUnits('0.01')).toBe('1');
    expect(fromMinorUnits('9223372036854775807')).toBe('92233720368547758.07');
    expect(() => toMinorUnits('1.005')).toThrow(/two decimal places/i);
    expect(() => toMinorUnits('92233720368547758.08')).toThrow(/too large/i);
  });

  it('rejects a product transaction that does not create at least one variant', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO products(name, created_by, updated_by) VALUES ($1, $2, $2)',
        [`Missing variant ${randomUUID()}`, actorId],
      );
      await expect(client.query('COMMIT')).rejects.toThrow(/at least one variant/i);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('prevents category cycles at the database boundary', async () => {
    const root = await pool.query<{ id: string }>(
      'INSERT INTO product_categories(name, created_by, updated_by) VALUES ($1, $2, $2) RETURNING id',
      [`Cycle root ${randomUUID()}`, actorId],
    );
    const child = await pool.query<{ id: string }>(
      'INSERT INTO product_categories(name, parent_id, created_by, updated_by) VALUES ($1, $2, $3, $3) RETURNING id',
      [`Cycle child ${randomUUID()}`, root.rows[0]!.id, actorId],
    );
    await expect(
      pool.query('UPDATE product_categories SET parent_id = $2 WHERE id = $1', [
        root.rows[0]!.id,
        child.rows[0]!.id,
      ]),
    ).rejects.toThrow(/cycle/i);
  });

  it('keeps product and variant records non-deletable and retains category references', async () => {
    const category = await pool.query<{ id: string }>(
      'INSERT INTO product_categories(name, created_by, updated_by) VALUES ($1, $2, $2) RETURNING id',
      [`Delete guard category ${randomUUID()}`, actorId],
    );
    const product = await pool.query<{ id: string }>(
      'INSERT INTO products(name, category_id, created_by, updated_by) VALUES ($1, $2, $3, $3) RETURNING id',
      [`Delete guard product ${randomUUID()}`, category.rows[0]!.id, actorId],
    );
    const variant = await pool.query<{ id: string }>(
      `INSERT INTO product_variants(
         product_id, name, unit_of_measure, selling_price_minor, cost_price_minor,
         created_by, updated_by
       ) VALUES ($1, 'Default', 'test-unit-label', 101, 50, $2, $2) RETURNING id`,
      [product.rows[0]!.id, actorId],
    );

    await expect(
      pool.query('DELETE FROM product_variants WHERE id = $1', [variant.rows[0]!.id]),
    ).rejects.toThrow(/must be deactivated or archived/i);
    await expect(
      pool.query('DELETE FROM products WHERE id = $1', [product.rows[0]!.id]),
    ).rejects.toThrow(/must be deactivated or archived/i);
    await expect(
      pool.query('DELETE FROM product_categories WHERE id = $1', [category.rows[0]!.id]),
    ).rejects.toThrow(/must be deactivated or archived/i);

    const linked = await pool.query(
      'SELECT id FROM products WHERE id = $1 AND category_id = $2',
      [product.rows[0]!.id, category.rows[0]!.id],
    );
    expect(linked.rowCount).toBe(1);
  });

  it('uses BIGINT money columns and keeps currency in the initial NGN boundary', async () => {
    const columns = await pool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'product_variants'
          AND column_name IN ('selling_price_minor', 'cost_price_minor')`,
    );
    expect(columns.rows).toEqual([
      { column_name: 'cost_price_minor', data_type: 'bigint' },
      { column_name: 'selling_price_minor', data_type: 'bigint' },
    ]);
    const product = await pool.query<{ id: string }>(
      'INSERT INTO products(name, created_by, updated_by) VALUES ($1, $2, $2) RETURNING id',
      [`Currency constraint product ${randomUUID()}`, actorId],
    );
    await pool.query(
      `INSERT INTO product_variants(
         product_id, name, unit_of_measure, selling_price_minor, cost_price_minor,
         currency, is_default, created_by, updated_by
       ) VALUES ($1, 'Default', 'unit', 10, 5, 'NGN', true, $2, $2)`,
      [product.rows[0]!.id, actorId],
    );
    await expect(
      pool.query(
        `INSERT INTO product_variants(
           product_id, name, unit_of_measure, selling_price_minor, cost_price_minor,
           currency, created_by, updated_by
         ) VALUES ($1, 'Unsupported currency', 'unit', 10, 5, 'USD', $2, $2)`,
        [product.rows[0]!.id, actorId],
      ),
    ).rejects.toThrow();
  });
});
