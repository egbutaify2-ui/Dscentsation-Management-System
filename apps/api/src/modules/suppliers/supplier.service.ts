import type { PoolClient, QueryResultRow } from 'pg';
import { pool } from '../../db/pool.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { appendAuditEvent } from '../audit/audit.service.js';
import { hasPermission } from '../roles/permission.service.js';
import {
  SupplierError,
  supplierConflict,
  supplierInvalid,
  supplierNotFound,
} from './supplier.errors.js';

export type SupplierStatus = 'active' | 'inactive';

export type SupplierActor = AuthenticatedUser;

export interface Supplier {
  id: string;
  supplierCode: string;
  displayName: string;
  status: SupplierStatus;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierListFilters {
  query?: string | undefined;
  status?: SupplierStatus | 'all' | undefined;
  page: number;
  pageSize: number;
}

export interface SupplierPage {
  items: Supplier[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface SupplierRow extends QueryResultRow {
  id: string;
  supplier_code: string;
  display_name: string;
  status: SupplierStatus;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}

function assertPermission(actor: SupplierActor, permission: string): void {
  if (!hasPermission(actor.permissions, permission)) {
    throw new SupplierError(
      'You are not authorised to perform this supplier action.',
      403,
      'PERMISSION_DENIED',
    );
  }
}

function normalizeSupplierName(value: string): {
  displayName: string;
  normalizedName: string;
} {
  const displayName = value
    .normalize('NFKC')
    .trim()
    .replace(/[\s\u00a0]+/gu, ' ');
  return {
    displayName,
    normalizedName: displayName.toLowerCase(),
  };
}

function assertSupplierNameLength(displayName: string, normalizedName: string): void {
  if (Array.from(displayName).length > 200 || Array.from(normalizedName).length > 200) {
    throw supplierInvalid(
      'Supplier business names must not exceed 200 characters after normalization.',
    );
  }
}

function supplierFromRow(row: SupplierRow): Supplier {
  return {
    id: row.id,
    supplierCode: row.supplier_code,
    displayName: row.display_name,
    status: row.status,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
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

async function loadSupplier(
  client: PoolClient,
  supplierId: string,
  lock = false,
): Promise<Supplier> {
  const result = await client.query<SupplierRow>(
    `SELECT id, supplier_code, display_name, status, created_by, updated_by,
            created_at, updated_at
       FROM suppliers
      WHERE id = $1
      ${lock ? 'FOR UPDATE' : ''}`,
    [supplierId],
  );
  const row = result.rows[0];
  if (!row) throw supplierNotFound();
  return supplierFromRow(row);
}

export async function listSuppliers(
  actor: SupplierActor,
  filters: SupplierListFilters,
): Promise<SupplierPage> {
  assertPermission(actor, 'suppliers.view');
  const normalizedQuery = filters.query
    ? normalizeSupplierName(filters.query).normalizedName || null
    : null;
  const status = filters.status && filters.status !== 'all' ? filters.status : null;
  const offset = (filters.page - 1) * filters.pageSize;

  const count = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total
       FROM suppliers s
      WHERE ($1::text IS NULL OR position($1 in s.normalized_name) > 0)
        AND ($2::text IS NULL OR s.status = $2)`,
    [normalizedQuery, status],
  );
  const total = Number(count.rows[0]?.total ?? 0);

  const result = await pool.query<SupplierRow>(
    `SELECT id, supplier_code, display_name, status, created_by, updated_by,
            created_at, updated_at
       FROM suppliers
      WHERE ($1::text IS NULL OR position($1 in normalized_name) > 0)
        AND ($2::text IS NULL OR status = $2)
      ORDER BY normalized_name, created_at DESC, id
      LIMIT $3 OFFSET $4`,
    [normalizedQuery, status, filters.pageSize, offset],
  );

  return {
    items: result.rows.map(supplierFromRow),
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.ceil(total / filters.pageSize),
  };
}

export async function getSupplier(actor: SupplierActor, supplierId: string): Promise<Supplier> {
  assertPermission(actor, 'suppliers.view');
  const client = await pool.connect();
  try {
    return await loadSupplier(client, supplierId);
  } finally {
    client.release();
  }
}

export async function findPossibleSupplierDuplicates(
  actor: SupplierActor,
  displayName: string,
): Promise<Supplier[]> {
  assertPermission(actor, 'suppliers.view');
  const { normalizedName } = normalizeSupplierName(displayName);
  const result = await pool.query<SupplierRow>(
    `SELECT id, supplier_code, display_name, status, created_by, updated_by,
            created_at, updated_at
       FROM suppliers
      WHERE normalized_name = $1
         OR position($1 in normalized_name) > 0
         OR position(normalized_name in $1) > 0
      ORDER BY (normalized_name = $1) DESC, normalized_name, created_at DESC, id
      LIMIT 10`,
    [normalizedName],
  );
  return result.rows.map(supplierFromRow);
}

export async function createSupplier(
  actor: SupplierActor,
  requestId: string,
  input: { displayName: string },
): Promise<Supplier> {
  assertPermission(actor, 'suppliers.create');
  const { displayName, normalizedName } = normalizeSupplierName(input.displayName);
  if (!displayName || !normalizedName) {
    throw supplierInvalid('A supplier business name is required.');
  }
  assertSupplierNameLength(displayName, normalizedName);

  return inTransaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO suppliers(display_name, normalized_name, created_by, updated_by)
       VALUES ($1, $2, $3, $3)
       RETURNING id`,
      [displayName, normalizedName, actor.id],
    );
    const supplierId = inserted.rows[0]?.id;
    if (!supplierId) throw new Error('Supplier creation did not return a record identifier.');

    const supplier = await loadSupplier(client, supplierId);
    await appendAuditEvent(
      {
        actorUserId: actor.id,
        action: 'supplier.created',
        entityType: 'supplier',
        entityId: supplierId,
        requestId,
        safeMetadata: {
          supplierCode: supplier.supplierCode,
          changedFields: ['displayName'],
        },
      },
      client,
    );
    return supplier;
  });
}

export async function updateSupplier(
  actor: SupplierActor,
  requestId: string,
  supplierId: string,
  input: { displayName?: string | undefined },
): Promise<Supplier> {
  assertPermission(actor, 'suppliers.update');
  const { displayName, normalizedName } =
    input.displayName === undefined
      ? { displayName: undefined, normalizedName: undefined }
      : normalizeSupplierName(input.displayName);

  if (displayName !== undefined && (!displayName || !normalizedName)) {
    throw supplierInvalid('A supplier business name is required.');
  }
  if (displayName !== undefined && normalizedName !== undefined) {
    assertSupplierNameLength(displayName, normalizedName);
  }

  return inTransaction(async (client) => {
    const before = await loadSupplier(client, supplierId, true);
    if (displayName === undefined || displayName === before.displayName) return before;

    await client.query(
      `UPDATE suppliers
          SET display_name = $2,
              normalized_name = $3,
              updated_by = $4,
              updated_at = now()
        WHERE id = $1`,
      [supplierId, displayName, normalizedName, actor.id],
    );
    const after = await loadSupplier(client, supplierId);
    await appendAuditEvent(
      {
        actorUserId: actor.id,
        action: 'supplier.updated',
        entityType: 'supplier',
        entityId: supplierId,
        requestId,
        safeMetadata: {
          supplierCode: after.supplierCode,
          changedFields: ['displayName'],
        },
      },
      client,
    );
    return after;
  });
}

export async function setSupplierStatus(
  actor: SupplierActor,
  requestId: string,
  supplierId: string,
  status: SupplierStatus,
): Promise<Supplier> {
  assertPermission(actor, 'suppliers.manage_status');
  return inTransaction(async (client) => {
    const before = await loadSupplier(client, supplierId, true);
    if (before.status === status) {
      throw supplierConflict(`The supplier is already ${status}.`, 'INVALID_STATUS_TRANSITION');
    }

    await client.query(
      `UPDATE suppliers
          SET status = $2, updated_by = $3, updated_at = now()
        WHERE id = $1`,
      [supplierId, status, actor.id],
    );
    const after = await loadSupplier(client, supplierId);
    await appendAuditEvent(
      {
        actorUserId: actor.id,
        action: status === 'active' ? 'supplier.activated' : 'supplier.deactivated',
        entityType: 'supplier',
        entityId: supplierId,
        requestId,
        safeMetadata: {
          supplierCode: after.supplierCode,
          beforeStatus: before.status,
          afterStatus: after.status,
        },
      },
      client,
    );
    return after;
  });
}

export function isSupplierDatabaseConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    ['23503', '23505', '23514'].includes(error.code)
  );
}
