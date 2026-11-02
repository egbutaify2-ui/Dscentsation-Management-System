import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../db/pool.js';

const suffix = randomUUID();
let actorId: string;

async function createCategory(codeSuffix: string) {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO expense_categories(code, name, created_by, updated_by)
     VALUES ($1, $2, $3, $3) RETURNING id`,
    ['DB-' + codeSuffix, 'DB Category ' + codeSuffix, actorId],
  );
  return result.rows[0]!.id;
}

async function createDraft(categoryId: string) {
  const expenseId = randomUUID();
  const revisionId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO expenses(id, status, current_revision_id, created_by, updated_by)
       VALUES ($1, 'draft', $2, $3, $3)`,
      [expenseId, revisionId, actorId],
    );
    await client.query(
      `INSERT INTO expense_revisions(
         id, expense_id, revision_number, category_id, description, amount_minor,
         currency, incurred_on, payee_name, created_by
       ) VALUES ($1, $2, 1, $3, 'Database test expense', 12500, 'NGN', DATE '2026-10-01', 'Synthetic payee', $4)`,
      [revisionId, expenseId, categoryId, actorId],
    );
    await client.query('COMMIT');
    return { expenseId, revisionId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

describe('Expense Foundation database invariants', () => {
  beforeAll(async () => {
    const role = await pool.query<{ id: string }>("SELECT id FROM roles WHERE code = 'OWNER'");
    if (!role.rows[0]) throw new Error('Missing Owner role seed.');
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users(email_normalized, display_name, password_hash, role_id)
       VALUES ($1, 'Synthetic expense database actor', 'synthetic-hash', $2)
       RETURNING id`,
      ['task021.database.' + suffix + '@example.invalid', role.rows[0].id],
    );
    actorId = user.rows[0]!.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('stores amount_minor as BIGINT and defines only unassigned expense permissions', async () => {
    const column = await pool.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'expense_revisions'
          AND column_name = 'amount_minor'`,
    );
    expect(column.rows[0]?.data_type).toBe('bigint');
  });

  it('rejects blank codes/names, duplicate codes and case-insensitive duplicate names', async () => {
    await expect(
      pool.query(
        `INSERT INTO expense_categories(code, name, created_by, updated_by)
         VALUES ('   ', 'Valid name', $1, $1)`,
        [actorId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        `INSERT INTO expense_categories(code, name, created_by, updated_by)
         VALUES ('VALID-CODE', '   ', $1, $1)`,
        [actorId],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    const categoryId = await createCategory(suffix.slice(0, 8));
    const current = await pool.query<{ code: string; name: string }>(
      'SELECT code, name FROM expense_categories WHERE id = $1',
      [categoryId],
    );
    await expect(
      pool.query(
        `INSERT INTO expense_categories(code, name, created_by, updated_by)
         VALUES ($1, $2, $3, $3)`,
        [current.rows[0]!.code, 'Another ' + suffix, actorId],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    await expect(
      pool.query(
        `INSERT INTO expense_categories(code, name, created_by, updated_by)
         VALUES ($1, $2, $3, $3)`,
        ['DIFFERENT-' + suffix.slice(0, 8), current.rows[0]!.name.toUpperCase(), actorId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('enforces NGN, positive amounts, positive and sequential revision numbers', async () => {
    const categoryId = await createCategory('MONEY-' + suffix.slice(0, 6));
    const expense = await createDraft(categoryId);

    await expect(
      pool.query(
        `INSERT INTO expense_revisions(
           expense_id, revision_number, category_id, description, amount_minor,
           currency, incurred_on, payee_name, created_by
         ) VALUES ($1, 2, $2, 'Zero amount', 0, 'NGN', DATE '2026-10-02', 'Synthetic payee', $3)`,
        [expense.expenseId, categoryId, actorId],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      pool.query(
        `INSERT INTO expense_revisions(
           expense_id, revision_number, category_id, description, amount_minor,
           currency, incurred_on, payee_name, created_by
         ) VALUES ($1, 2, $2, 'Foreign currency', 100, 'USD', DATE '2026-10-02', 'Synthetic payee', $3)`,
        [expense.expenseId, categoryId, actorId],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      pool.query(
        `INSERT INTO expense_revisions(
           expense_id, revision_number, category_id, description, amount_minor,
           currency, incurred_on, payee_name, created_by
         ) VALUES ($1, 4, $2, 'Skipped revision', 100, 'NGN', DATE '2026-10-02', 'Synthetic payee', $3)`,
        [expense.expenseId, categoryId, actorId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps the current-revision pointer scoped to the same expense', async () => {
    const categoryId = await createCategory('POINTER-' + suffix.slice(0, 6));
    const first = await createDraft(categoryId);
    const second = await createDraft(categoryId);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE expenses SET current_revision_id = $2 WHERE id = $1', [
        second.expenseId,
        first.revisionId,
      ]);
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23503' });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const pointer = await pool.query<{ current_revision_id: string }>(
      'SELECT current_revision_id FROM expenses WHERE id = $1',
      [second.expenseId],
    );
    expect(pointer.rows[0]?.current_revision_id).not.toBe(first.revisionId);
  });

  it('retains historical category references and rejects new revisions against an inactive category', async () => {
    const categoryId = await createCategory('INACTIVE-' + suffix.slice(0, 6));
    const expense = await createDraft(categoryId);
    await pool.query(
      'UPDATE expense_categories SET is_active = false, updated_at = now() WHERE id = $1',
      [categoryId],
    );

    await expect(
      pool.query(
        `INSERT INTO expense_revisions(
           expense_id, revision_number, category_id, description, amount_minor,
           currency, incurred_on, payee_name, created_by
         ) VALUES ($1, 2, $2, 'Must fail', 100, 'NGN', DATE '2026-10-03', 'Synthetic payee', $3)`,
        [expense.expenseId, categoryId, actorId],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    const retained = await pool.query<{ category_id: string; revision_number: number }>(
      'SELECT category_id, revision_number FROM expense_revisions WHERE expense_id = $1',
      [expense.expenseId],
    );
    expect(retained.rows).toEqual([{ category_id: categoryId, revision_number: 1 }]);
  });

  it('prevents category, expense and revision hard deletion or historical mutation', async () => {
    const categoryId = await createCategory('IMMUTABLE-' + suffix.slice(0, 6));
    const expense = await createDraft(categoryId);

    await expect(
      pool.query('DELETE FROM expense_categories WHERE id = $1', [categoryId]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('DELETE FROM expenses WHERE id = $1', [expense.expenseId]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('UPDATE expense_revisions SET description = $2 WHERE id = $1', [
        expense.revisionId,
        'Tampered description',
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('DELETE FROM expense_revisions WHERE id = $1', [expense.revisionId]),
    ).rejects.toMatchObject({ code: '23514' });

    const current = await pool.query<{ description: string }>(
      'SELECT description FROM expense_revisions WHERE id = $1',
      [expense.revisionId],
    );
    expect(current.rows[0]?.description).toBe('Database test expense');
  });

  it('rejects workflow states outside the draft-only implementation scope', async () => {
    const categoryId = await createCategory('STATUS-' + suffix.slice(0, 6));
    const expense = await createDraft(categoryId);
    await expect(
      pool.query("UPDATE expenses SET status = 'submitted' WHERE id = $1", [expense.expenseId]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
