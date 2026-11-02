import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { pool } from '../../db/pool.js';
import { hasPermission } from '../roles/permission.service.js';
import { appendAuditEvent } from '../audit/audit.service.js';
import { CustomerError, forbidden, notFound } from './customer.errors.js';

export type CustomerPermission =
  | 'customers.view'
  | 'customers.create'
  | 'customers.update'
  | 'customers.archive';

export interface CustomerActor {
  id: string;
  permissions: readonly string[];
}

export interface CustomerWriteInput {
  fullName?: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

export interface CustomerListFilters {
  query?: string;
  status?: 'active' | 'archived' | 'all';
  page: number;
  pageSize: number;
}

interface CustomerRow extends QueryResultRow {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  status: 'active' | 'archived';
  created_by: string;
  updated_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface CustomerRecord {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  status: 'active' | 'archived';
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerPage {
  items: CustomerRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const customerFields = `
  id, full_name, phone, email, notes, status,
  created_by, updated_by, created_at, updated_at
`;

function assertPermission(actor: CustomerActor, permission: CustomerPermission): void {
  if (!hasPermission(actor.permissions, permission)) throw forbidden();
}

function mapCustomer(row: CustomerRow): CustomerRecord {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    status: row.status,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
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

async function loadCustomer(
  database: Pool | PoolClient,
  customerId: string,
  lock = false,
): Promise<CustomerRecord> {
  const result = await database.query<CustomerRow>(
    `SELECT ${customerFields} FROM customers WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`,
    [customerId],
  );
  const row = result.rows[0];
  if (!row) throw notFound();
  return mapCustomer(row);
}

function auditFieldNames(input: CustomerWriteInput): string[] {
  return Object.keys(input).sort();
}

export async function listCustomers(
  actor: CustomerActor,
  filters: CustomerListFilters,
): Promise<CustomerPage> {
  assertPermission(actor, 'customers.view');
  const query = filters.query?.trim() || null;
  const status = filters.status && filters.status !== 'all' ? filters.status : null;
  const offset = (filters.page - 1) * filters.pageSize;

  const count = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total
       FROM customers c
      WHERE ($1::text IS NULL OR
        position(lower($1) in lower(c.full_name)) > 0 OR
        position(lower($1) in lower(COALESCE(c.phone, ''))) > 0 OR
        position(lower($1) in lower(COALESCE(c.email, ''))) > 0)
        AND ($2::text IS NULL OR c.status = $2)`,
    [query, status],
  );
  const total = Number(count.rows[0]?.total ?? 0);

  const result = await pool.query<CustomerRow>(
    `SELECT ${customerFields}
       FROM customers c
      WHERE ($1::text IS NULL OR
        position(lower($1) in lower(c.full_name)) > 0 OR
        position(lower($1) in lower(COALESCE(c.phone, ''))) > 0 OR
        position(lower($1) in lower(COALESCE(c.email, ''))) > 0)
        AND ($2::text IS NULL OR c.status = $2)
      ORDER BY lower(c.full_name), c.created_at DESC, c.id
      LIMIT $3 OFFSET $4`,
    [query, status, filters.pageSize, offset],
  );

  return {
    items: result.rows.map(mapCustomer),
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.ceil(total / filters.pageSize),
  };
}

export async function getCustomer(
  actor: CustomerActor,
  customerId: string,
): Promise<CustomerRecord> {
  assertPermission(actor, 'customers.view');
  return loadCustomer(pool, customerId);
}

export async function createCustomer(
  actor: CustomerActor,
  requestId: string,
  input: CustomerWriteInput & { fullName: string },
): Promise<CustomerRecord> {
  assertPermission(actor, 'customers.create');
  return inTransaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO customers(full_name, phone, email, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5)
       RETURNING id`,
      [input.fullName, input.phone ?? null, input.email ?? null, input.notes ?? null, actor.id],
    );
    const customerId = inserted.rows[0]?.id;
    if (!customerId) throw new Error('Customer creation did not return a record identifier.');
    const customer = await loadCustomer(client, customerId);
    await appendAuditEvent(
      {
        actorUserId: actor.id,
        action: 'customer.created',
        entityType: 'customer',
        entityId: customerId,
        requestId,
        safeMetadata: {
          status: customer.status,
          suppliedFields: auditFieldNames(input),
        },
      },
      client,
    );
    return customer;
  });
}

export async function updateCustomer(
  actor: CustomerActor,
  requestId: string,
  customerId: string,
  input: CustomerWriteInput,
): Promise<CustomerRecord> {
  assertPermission(actor, 'customers.update');
  return inTransaction(async (client) => {
    const before = await loadCustomer(client, customerId, true);
    await client.query(
      `UPDATE customers
          SET full_name = CASE WHEN $2::boolean THEN $3 ELSE full_name END,
              phone = CASE WHEN $4::boolean THEN $5 ELSE phone END,
              email = CASE WHEN $6::boolean THEN $7 ELSE email END,
              notes = CASE WHEN $8::boolean THEN $9 ELSE notes END,
              updated_by = $10,
              updated_at = now()
        WHERE id = $1`,
      [
        customerId,
        input.fullName !== undefined,
        input.fullName ?? null,
        input.phone !== undefined,
        input.phone ?? null,
        input.email !== undefined,
        input.email ?? null,
        input.notes !== undefined,
        input.notes ?? null,
        actor.id,
      ],
    );
    const after = await loadCustomer(client, customerId);
    await appendAuditEvent(
      {
        actorUserId: actor.id,
        action: 'customer.updated',
        entityType: 'customer',
        entityId: customerId,
        requestId,
        safeMetadata: {
          changedFields: auditFieldNames(input),
          beforeStatus: before.status,
          afterStatus: after.status,
        },
      },
      client,
    );
    return after;
  });
}

export async function archiveCustomer(
  actor: CustomerActor,
  requestId: string,
  customerId: string,
): Promise<CustomerRecord> {
  assertPermission(actor, 'customers.archive');
  return inTransaction(async (client) => {
    const before = await loadCustomer(client, customerId, true);
    if (before.status === 'archived') return before;

    await client.query(
      `UPDATE customers
          SET status = 'archived', updated_by = $2, updated_at = now()
        WHERE id = $1`,
      [customerId, actor.id],
    );
    const after = await loadCustomer(client, customerId);
    await appendAuditEvent(
      {
        actorUserId: actor.id,
        action: 'customer.archived',
        entityType: 'customer',
        entityId: customerId,
        requestId,
        safeMetadata: { beforeStatus: before.status, afterStatus: after.status },
      },
      client,
    );
    return after;
  });
}

export function isCustomerDatabaseConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    ['23503', '23505', '23514'].includes(error.code)
  );
}

export function customerOperationError(): CustomerError {
  return new CustomerError(
    'The requested customer change conflicts with customer data integrity rules.',
    409,
    'DATA_CONFLICT',
  );
}
