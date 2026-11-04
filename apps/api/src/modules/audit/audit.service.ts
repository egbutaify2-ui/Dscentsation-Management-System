import type { Pool, PoolClient } from 'pg';
import { pool } from '../../db/pool.js';

export type AuditJsonValue =
  string | number | boolean | null | AuditJsonValue[] | { [key: string]: AuditJsonValue };

export interface AuditEventInput {
  actorUserId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  requestId?: string | null;
  safeMetadata?: Record<string, AuditJsonValue>;
}

export interface AuditActivityFilters {
  actorUserId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export interface AuditActivityItem {
  id: string;
  actorUserId: string | null;
  actorDisplayName: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  occurredAt: string;
}

export interface AuditActivityActor {
  id: string;
  displayName: string;
}

export interface AuditActivityPage {
  items: AuditActivityItem[];
  actors: AuditActivityActor[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface AuditActivityRow {
  id: string;
  actor_user_id: string | null;
  actor_display_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  occurred_at: Date | string;
}

interface AuditActorRow {
  id: string;
  display_name: string;
}

const MAX_AUDIT_NESTING = 12;

function sanitiseValue(value: unknown, depth = 0): AuditJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Audit metadata cannot contain non-finite numbers.');
    }
    return value;
  }

  if (depth >= MAX_AUDIT_NESTING) {
    throw new RangeError('Audit metadata exceeds the supported nesting depth.');
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitiseValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const safe: Record<string, AuditJsonValue> = {};
    for (const [key, child] of Object.entries(value)) {
      if (/password|secret|token|cookie|authorization|credential|session/i.test(key)) continue;
      safe[key] = sanitiseValue(child, depth + 1);
    }
    return safe;
  }

  throw new TypeError('Audit metadata must contain JSON-compatible values.');
}

function sanitiseMetadata(
  metadata: Record<string, AuditJsonValue> | undefined,
): Record<string, AuditJsonValue> {
  if (!metadata) return {};
  const safe = sanitiseValue(metadata);
  if (safe === null || Array.isArray(safe) || typeof safe !== 'object') {
    throw new TypeError('Audit metadata must be a JSON object.');
  }
  return safe;
}

export async function appendAuditEvent(
  input: AuditEventInput,
  client: Pool | PoolClient = pool,
): Promise<void> {
  await client.query(
    `
      INSERT INTO audit_logs (
        actor_user_id, action, entity_type, entity_id, request_id, safe_metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      input.actorUserId ?? null,
      input.action,
      input.entityType ?? null,
      input.entityId ?? null,
      input.requestId ?? null,
      JSON.stringify(sanitiseMetadata(input.safeMetadata)),
    ],
  );
}

export async function listAuditActivity(filters: AuditActivityFilters): Promise<AuditActivityPage> {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transactionStarted = true;

    const conditions: string[] = [];
    const values: Array<string | number> = [];
    const bind = (value: string): string => {
      values.push(value);
      return `$${values.length}`;
    };

    if (filters.actorUserId) {
      conditions.push(`l.actor_user_id = ${bind(filters.actorUserId)}`);
    }
    if (filters.action) {
      conditions.push(`l.action = ${bind(filters.action)}`);
    }
    if (filters.entityType) {
      conditions.push(`l.entity_type = ${bind(filters.entityType)}`);
    }
    if (filters.entityId) {
      conditions.push(`l.entity_id = ${bind(filters.entityId)}`);
    }
    if (filters.from) {
      conditions.push(
        `l.occurred_at >= (${bind(filters.from)}::date::timestamp AT TIME ZONE 'Africa/Lagos')`,
      );
    }
    if (filters.to) {
      conditions.push(
        `l.occurred_at < ((${bind(filters.to)}::date + 1)::timestamp AT TIME ZONE 'Africa/Lagos')`,
      );
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const count = await client.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM audit_logs l ${whereClause}`,
      values,
    );
    const total = Number(count.rows[0]?.total ?? '0');

    const limitParameter = values.length + 1;
    const offsetParameter = values.length + 2;
    const offset = (filters.page - 1) * filters.pageSize;
    const result = await client.query<AuditActivityRow>(
      `
        SELECT
          l.id,
          l.actor_user_id,
          CASE WHEN l.actor_user_id IS NULL THEN 'System'
               ELSE COALESCE(u.display_name, 'System') END AS actor_display_name,
          l.action,
          l.entity_type,
          l.entity_id,
          l.occurred_at
        FROM audit_logs l
        LEFT JOIN users u ON u.id = l.actor_user_id
        ${whereClause}
        ORDER BY l.occurred_at DESC, l.id DESC
        LIMIT $${limitParameter}::integer
        OFFSET $${offsetParameter}::integer
      `,
      [...values, filters.pageSize, offset],
    );

    const actors = await client.query<AuditActorRow>(
      `
        SELECT DISTINCT u.id, u.display_name
        FROM audit_logs l
        INNER JOIN users u ON u.id = l.actor_user_id
        ORDER BY u.display_name, u.id
      `,
    );

    await client.query('COMMIT');
    transactionStarted = false;

    return {
      items: result.rows.map((row) => {
        const occurredAt =
          row.occurred_at instanceof Date ? row.occurred_at : new Date(row.occurred_at);
        return {
          id: row.id,
          actorUserId: row.actor_user_id,
          actorDisplayName: row.actor_display_name ?? 'System',
          action: row.action,
          entityType: row.entity_type,
          entityId: row.entity_id,
          occurredAt: occurredAt.toISOString(),
        };
      }),
      actors: actors.rows.map((row) => ({ id: row.id, displayName: row.display_name })),
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.ceil(total / filters.pageSize),
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original query error.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}
