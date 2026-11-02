import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { pool } from '../../db/pool.js';
import { appendAuditEvent } from '../audit/audit.service.js';
import { conflict, forbidden, invalid, notFound } from './expense.errors.js';

type Database = Pool | PoolClient;
type CategoryPermission = 'expense_categories.view' | 'expense_categories.manage';
type ExpensePermission = 'expenses.view' | 'expenses.create' | 'expenses.update';

export interface CategoryWriteInput {
  code?: string | undefined;
  name?: string | undefined;
  description?: string | null | undefined;
}

export interface ExpenseWriteInput {
  categoryId?: string | undefined;
  description?: string | undefined;
  amountMinor?: string | undefined;
  currency?: 'NGN' | undefined;
  incurredOn?: string | undefined;
  payeeName?: string | undefined;
}

export interface CategoryListFilters {
  query?: string | undefined;
  status?: 'active' | 'inactive' | 'all' | undefined;
  page: number;
  pageSize: number;
}

export interface ExpenseListFilters {
  query?: string | undefined;
  categoryId?: string | undefined;
  page: number;
  pageSize: number;
}

interface CategoryRow extends QueryResultRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_by: string;
  updated_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RevisionRow extends QueryResultRow {
  id: string;
  expense_id: string;
  revision_number: number;
  category_id: string;
  category_code: string;
  category_name: string;
  description: string;
  amount_minor: string;
  currency: string;
  incurred_on: string;
  payee_name: string;
  created_by: string;
  created_at: Date | string;
}

interface ExpenseHeaderRow extends QueryResultRow {
  id: string;
  status: 'draft';
  current_revision_id: string;
  created_by: string;
  updated_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ExpenseListRow extends ExpenseHeaderRow {
  revision_number: number;
  category_id: string;
  category_code: string;
  category_name: string;
  description: string;
  amount_minor: string;
  currency: string;
  incurred_on: string;
  payee_name: string;
  revision_created_at: Date | string;
  revision_created_by: string;
}

export interface ExpenseCategory {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseRevision {
  id: string;
  expenseId: string;
  revisionNumber: number;
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  description: string;
  amountMinor: string;
  currency: string;
  incurredOn: string;
  payeeName: string;
  createdBy: string;
  createdAt: string;
}

export interface ExpenseRecord {
  id: string;
  status: 'draft';
  currentRevision: ExpenseRevision;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function mapCategory(row: CategoryRow): ExpenseCategory {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    isActive: row.is_active,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapRevision(row: RevisionRow): ExpenseRevision {
  return {
    id: row.id,
    expenseId: row.expense_id,
    revisionNumber: row.revision_number,
    categoryId: row.category_id,
    categoryCode: row.category_code,
    categoryName: row.category_name,
    description: row.description,
    amountMinor: row.amount_minor,
    currency: row.currency.trim(),
    incurredOn: row.incurred_on,
    payeeName: row.payee_name,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
  };
}

async function inTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function assertPermission(
  database: Database,
  actorId: string,
  permissionCode: CategoryPermission | ExpensePermission,
): Promise<void> {
  const result = await database.query<{ allowed: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM users u
         JOIN role_permissions rp ON rp.role_id = u.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE u.id = $1
          AND u.status = 'active'
          AND p.code = $2
     ) AS allowed`,
    [actorId, permissionCode],
  );
  if (!result.rows[0]?.allowed) throw forbidden();
}

async function loadCategory(
  database: Database,
  categoryId: string,
  lock = false,
): Promise<ExpenseCategory> {
  const result = await database.query<CategoryRow>(
    `SELECT id, code, name, description, is_active, created_by, updated_by, created_at, updated_at
       FROM expense_categories
      WHERE id = $1
      ${lock ? 'FOR UPDATE' : ''}`,
    [categoryId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('The requested expense category was not found.');
  return mapCategory(row);
}

async function loadExpense(
  database: Database,
  expenseId: string,
  lock = false,
): Promise<ExpenseRecord> {
  if (lock) {
    const locked = await database.query<{ id: string }>(
      'SELECT id FROM expenses WHERE id = $1 FOR UPDATE',
      [expenseId],
    );
    if (!locked.rows[0]) throw notFound();
  }

  const result = await database.query<ExpenseListRow>(
    `SELECT e.id, e.status, e.current_revision_id, e.created_by, e.updated_by,
            e.created_at, e.updated_at,
            r.revision_number, r.category_id, c.code AS category_code, c.name AS category_name,
            r.description, r.amount_minor::text, r.currency, r.incurred_on::text, r.payee_name,
            r.created_by AS revision_created_by, r.created_at AS revision_created_at
       FROM expenses e
       JOIN expense_revisions r
         ON r.expense_id = e.id AND r.id = e.current_revision_id
       JOIN expense_categories c ON c.id = r.category_id
      WHERE e.id = $1`,
    [expenseId],
  );
  const row = result.rows[0];
  if (!row) throw notFound();
  const revision: RevisionRow = {
    id: row.current_revision_id,
    expense_id: row.id,
    revision_number: row.revision_number,
    category_id: row.category_id,
    category_code: row.category_code,
    category_name: row.category_name,
    description: row.description,
    amount_minor: row.amount_minor,
    currency: row.currency,
    incurred_on: row.incurred_on,
    payee_name: row.payee_name,
    created_by: row.revision_created_by,
    created_at: row.revision_created_at,
  };
  return {
    id: row.id,
    status: row.status,
    currentRevision: mapRevision(revision),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function requireActiveCategory(database: Database, categoryId: string): Promise<void> {
  const result = await database.query<{ is_active: boolean }>(
    'SELECT is_active FROM expense_categories WHERE id = $1 FOR SHARE',
    [categoryId],
  );
  if (!result.rows[0]) throw invalid('The selected expense category does not exist.');
  if (!result.rows[0].is_active) throw conflict('Choose an active expense category.');
}

async function createRevision(
  client: PoolClient,
  expenseId: string,
  revisionId: string,
  revisionNumber: number,
  actorId: string,
  values: {
    categoryId: string;
    description: string;
    amountMinor: string;
    currency: 'NGN';
    incurredOn: string;
    payeeName: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO expense_revisions(
       id, expense_id, revision_number, category_id, description, amount_minor,
       currency, incurred_on, payee_name, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6::bigint, $7, $8::date, $9, $10)`,
    [
      revisionId,
      expenseId,
      revisionNumber,
      values.categoryId,
      values.description,
      values.amountMinor,
      values.currency,
      values.incurredOn,
      values.payeeName,
      actorId,
    ],
  );
}

export async function listExpenseCategories(
  actorId: string,
  filters: CategoryListFilters,
): Promise<Page<ExpenseCategory>> {
  await assertPermission(pool, actorId, 'expense_categories.view');
  const query = filters.query?.trim() || null;
  const status =
    filters.status === 'all'
      ? null
      : filters.status === 'inactive'
        ? false
        : filters.status === 'active'
          ? true
          : null;
  const offset = (filters.page - 1) * filters.pageSize;
  const count = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total
       FROM expense_categories c
      WHERE ($1::text IS NULL OR position(lower($1) in lower(c.code)) > 0
        OR position(lower($1) in lower(c.name)) > 0)
        AND ($2::boolean IS NULL OR c.is_active = $2)`,
    [query, status],
  );
  const result = await pool.query<CategoryRow>(
    `SELECT id, code, name, description, is_active, created_by, updated_by, created_at, updated_at
       FROM expense_categories c
      WHERE ($1::text IS NULL OR position(lower($1) in lower(c.code)) > 0
        OR position(lower($1) in lower(c.name)) > 0)
        AND ($2::boolean IS NULL OR c.is_active = $2)
      ORDER BY c.is_active DESC, lower(c.name), c.id
      LIMIT $3 OFFSET $4`,
    [query, status, filters.pageSize, offset],
  );
  const total = Number(count.rows[0]?.total ?? 0);
  return {
    items: result.rows.map(mapCategory),
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.ceil(total / filters.pageSize),
  };
}

export async function createExpenseCategory(
  actorId: string,
  requestId: string,
  input: CategoryWriteInput & { code: string; name: string },
): Promise<ExpenseCategory> {
  return inTransaction(async (client) => {
    await assertPermission(client, actorId, 'expense_categories.manage');
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO expense_categories(code, name, description, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $4)
       RETURNING id`,
      [input.code, input.name, input.description ?? null, actorId],
    );
    const category = await loadCategory(client, inserted.rows[0]!.id);
    await appendAuditEvent(
      {
        actorUserId: actorId,
        action: 'expense.category.created',
        entityType: 'expense_category',
        entityId: category.id,
        requestId,
        safeMetadata: {
          categoryId: category.id,
          changedFields: ['code', 'name', 'description'],
        },
      },
      client,
    );
    return category;
  });
}

export async function updateExpenseCategory(
  actorId: string,
  requestId: string,
  categoryId: string,
  input: CategoryWriteInput,
): Promise<ExpenseCategory> {
  return inTransaction(async (client) => {
    await assertPermission(client, actorId, 'expense_categories.manage');
    const before = await loadCategory(client, categoryId, true);
    const changedFields = Object.keys(input).filter(
      (field) => input[field as keyof CategoryWriteInput] !== undefined,
    );
    await client.query(
      `UPDATE expense_categories
          SET code = CASE WHEN $2::boolean THEN $3 ELSE code END,
              name = CASE WHEN $4::boolean THEN $5 ELSE name END,
              description = CASE WHEN $6::boolean THEN $7 ELSE description END,
              updated_by = $8,
              updated_at = now()
        WHERE id = $1`,
      [
        categoryId,
        input.code !== undefined,
        input.code ?? null,
        input.name !== undefined,
        input.name ?? null,
        input.description !== undefined,
        input.description ?? null,
        actorId,
      ],
    );
    const after = await loadCategory(client, categoryId);
    await appendAuditEvent(
      {
        actorUserId: actorId,
        action: 'expense.category.updated',
        entityType: 'expense_category',
        entityId: categoryId,
        requestId,
        safeMetadata: { categoryId, changedFields },
      },
      client,
    );
    void before;
    return after;
  });
}

export async function setExpenseCategoryActive(
  actorId: string,
  requestId: string,
  categoryId: string,
  isActive: boolean,
): Promise<ExpenseCategory> {
  return inTransaction(async (client) => {
    await assertPermission(client, actorId, 'expense_categories.manage');
    const before = await loadCategory(client, categoryId, true);
    if (before.isActive === isActive) return before;
    await client.query(
      `UPDATE expense_categories
          SET is_active = $2, updated_by = $3, updated_at = now()
        WHERE id = $1`,
      [categoryId, isActive, actorId],
    );
    const after = await loadCategory(client, categoryId);
    await appendAuditEvent(
      {
        actorUserId: actorId,
        action: isActive ? 'expense.category.activated' : 'expense.category.deactivated',
        entityType: 'expense_category',
        entityId: categoryId,
        requestId,
        safeMetadata: {
          categoryId,
          changedFields: ['isActive'],
          beforeActive: before.isActive,
          afterActive: after.isActive,
        },
      },
      client,
    );
    return after;
  });
}

export async function listExpenseDrafts(
  actorId: string,
  filters: ExpenseListFilters,
): Promise<Page<ExpenseRecord>> {
  await assertPermission(pool, actorId, 'expenses.view');
  const query = filters.query?.trim() || null;
  const categoryId = filters.categoryId ?? null;
  const offset = (filters.page - 1) * filters.pageSize;
  const count = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total
       FROM expenses e
       JOIN expense_revisions r ON r.expense_id = e.id AND r.id = e.current_revision_id
      WHERE e.status = 'draft'
        AND ($1::text IS NULL OR position(lower($1) in lower(r.description)) > 0
          OR position(lower($1) in lower(r.payee_name)) > 0
          OR position(lower($1) in lower(e.id::text)) > 0)
        AND ($2::uuid IS NULL OR r.category_id = $2)`,
    [query, categoryId],
  );
  const result = await pool.query<ExpenseListRow>(
    `SELECT e.id, e.status, e.current_revision_id, e.created_by, e.updated_by,
            e.created_at, e.updated_at,
            r.revision_number, r.category_id, c.code AS category_code, c.name AS category_name,
            r.description, r.amount_minor::text, r.currency, r.incurred_on::text, r.payee_name,
            r.created_by AS revision_created_by, r.created_at AS revision_created_at
       FROM expenses e
       JOIN expense_revisions r ON r.expense_id = e.id AND r.id = e.current_revision_id
       JOIN expense_categories c ON c.id = r.category_id
      WHERE e.status = 'draft'
        AND ($1::text IS NULL OR position(lower($1) in lower(r.description)) > 0
          OR position(lower($1) in lower(r.payee_name)) > 0
          OR position(lower($1) in lower(e.id::text)) > 0)
        AND ($2::uuid IS NULL OR r.category_id = $2)
      ORDER BY e.created_at DESC, e.id
      LIMIT $3 OFFSET $4`,
    [query, categoryId, filters.pageSize, offset],
  );
  const total = Number(count.rows[0]?.total ?? 0);
  return {
    items: result.rows.map((row) => ({
      id: row.id,
      status: row.status,
      currentRevision: mapRevision({
        id: row.current_revision_id,
        expense_id: row.id,
        revision_number: row.revision_number,
        category_id: row.category_id,
        category_code: row.category_code,
        category_name: row.category_name,
        description: row.description,
        amount_minor: row.amount_minor,
        currency: row.currency,
        incurred_on: row.incurred_on,
        payee_name: row.payee_name,
        created_by: row.revision_created_by,
        created_at: row.revision_created_at,
      }),
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    })),
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.ceil(total / filters.pageSize),
  };
}

export async function getExpenseDraft(actorId: string, expenseId: string): Promise<ExpenseRecord> {
  await assertPermission(pool, actorId, 'expenses.view');
  return loadExpense(pool, expenseId);
}

export async function getExpenseRevisionHistory(
  actorId: string,
  expenseId: string,
): Promise<ExpenseRevision[]> {
  await assertPermission(pool, actorId, 'expenses.view');
  const exists = await pool.query('SELECT 1 FROM expenses WHERE id = $1', [expenseId]);
  if (!exists.rowCount) throw notFound();
  const result = await pool.query<RevisionRow>(
    `SELECT r.id, r.expense_id, r.revision_number, r.category_id,
            c.code AS category_code, c.name AS category_name, r.description,
            r.amount_minor::text, r.currency, r.incurred_on::text, r.payee_name,
            r.created_by, r.created_at
       FROM expense_revisions r
       JOIN expense_categories c ON c.id = r.category_id
      WHERE r.expense_id = $1
      ORDER BY r.revision_number`,
    [expenseId],
  );
  return result.rows.map(mapRevision);
}

export async function createExpenseDraft(
  actorId: string,
  requestId: string,
  input: ExpenseWriteInput & {
    categoryId: string;
    description: string;
    amountMinor: string;
    currency: 'NGN';
    incurredOn: string;
    payeeName: string;
  },
): Promise<ExpenseRecord> {
  return inTransaction(async (client) => {
    await assertPermission(client, actorId, 'expenses.create');
    await requireActiveCategory(client, input.categoryId);
    const expenseId = randomUUID();
    const revisionId = randomUUID();
    await client.query(
      `INSERT INTO expenses(id, status, current_revision_id, created_by, updated_by)
       VALUES ($1, 'draft', $2, $3, $3)`,
      [expenseId, revisionId, actorId],
    );
    await createRevision(client, expenseId, revisionId, 1, actorId, {
      categoryId: input.categoryId,
      description: input.description,
      amountMinor: input.amountMinor,
      currency: input.currency,
      incurredOn: input.incurredOn,
      payeeName: input.payeeName,
    });
    const expense = await loadExpense(client, expenseId);
    await appendAuditEvent(
      {
        actorUserId: actorId,
        action: 'expense.draft.created',
        entityType: 'expense',
        entityId: expenseId,
        requestId,
        safeMetadata: {
          expenseId,
          revisionId,
          revisionNumber: 1,
          changedFields: [
            'categoryId',
            'description',
            'amountMinor',
            'currency',
            'incurredOn',
            'payeeName',
          ],
        },
      },
      client,
    );
    return expense;
  });
}

export async function updateExpenseDraft(
  actorId: string,
  requestId: string,
  expenseId: string,
  input: ExpenseWriteInput,
): Promise<ExpenseRecord> {
  return inTransaction(async (client) => {
    await assertPermission(client, actorId, 'expenses.update');
    const before = await loadExpense(client, expenseId, true);
    if (before.status !== 'draft') throw conflict('Only draft expenses can be edited.');
    const current = before.currentRevision;
    const values = {
      categoryId: input.categoryId ?? current.categoryId,
      description: input.description ?? current.description,
      amountMinor: input.amountMinor ?? current.amountMinor,
      currency: input.currency ?? (current.currency as 'NGN'),
      incurredOn: input.incurredOn ?? current.incurredOn,
      payeeName: input.payeeName ?? current.payeeName,
    };
    await requireActiveCategory(client, values.categoryId);
    const next = await client.query<{ next_revision: number }>(
      'SELECT COALESCE(max(revision_number), 0) + 1 AS next_revision FROM expense_revisions WHERE expense_id = $1',
      [expenseId],
    );
    const revisionNumber = next.rows[0]?.next_revision ?? 2;
    const revisionId = randomUUID();
    await createRevision(client, expenseId, revisionId, revisionNumber, actorId, values);
    await client.query(
      `UPDATE expenses
          SET current_revision_id = $2, updated_by = $3, updated_at = now()
        WHERE id = $1`,
      [expenseId, revisionId, actorId],
    );
    const after = await loadExpense(client, expenseId);
    await appendAuditEvent(
      {
        actorUserId: actorId,
        action: 'expense.draft.revised',
        entityType: 'expense',
        entityId: expenseId,
        requestId,
        safeMetadata: {
          expenseId,
          revisionId,
          revisionNumber,
          changedFields: Object.keys(input),
          previousRevisionId: current.id,
        },
      },
      client,
    );
    return after;
  });
}

export function isExpenseDatabaseConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    ['23503', '23505', '23514', '23502', '22001'].includes(error.code)
  );
}

export function expenseDataConflictError() {
  return conflict('The requested expense change conflicts with expense data integrity rules.');
}
