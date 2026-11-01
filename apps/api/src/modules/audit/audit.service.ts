import type { Pool, PoolClient } from 'pg';
import { pool } from '../../db/pool.js';

export type AuditJsonValue =
  | string
  | number
  | boolean
  | null
  | AuditJsonValue[]
  | { [key: string]: AuditJsonValue };

export interface AuditEventInput {
  actorUserId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  requestId?: string | null;
  safeMetadata?: Record<string, AuditJsonValue>;
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
