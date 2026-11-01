import type { Pool, PoolClient } from 'pg';
import { pool } from '../../db/pool.js';

export interface AuditEventInput {
  actorUserId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  requestId?: string | null;
  safeMetadata?: Record<string, string | number | boolean | null>;
}

function sanitiseMetadata(
  metadata: Record<string, string | number | boolean | null> | undefined,
): Record<string, string | number | boolean | null> {
  const safe: Record<string, string | number | boolean | null> = {};
  if (!metadata) return safe;
  for (const [key, value] of Object.entries(metadata).slice(0, 30)) {
    if (/password|secret|token|cookie|authorization|credential|session/i.test(key)) continue;
    safe[key.slice(0, 80)] = typeof value === 'string' ? value.slice(0, 250) : value;
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
