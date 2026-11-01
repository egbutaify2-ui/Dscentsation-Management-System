import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { appendAuditEvent } from './audit.service.js';

describe('appendAuditEvent metadata safety', () => {
  it('preserves complete nested JSON values and filters sensitive keys recursively', async () => {
    const statements: Array<{ text: string; values: unknown[] }> = [];
    const client = {
      query: async (text: string, values: unknown[] = []) => {
        statements.push({ text, values });
        return { rows: [], rowCount: 1 };
      },
    } as unknown as PoolClient;

    const beforeDescription = '\u0001'.repeat(4000);
    const afterDescription = '\u0002'.repeat(4000);
    await appendAuditEvent(
      {
        actorUserId: '00000000-0000-4000-8000-000000000001',
        action: 'product.updated',
        entityType: 'product',
        entityId: '00000000-0000-4000-8000-000000000002',
        safeMetadata: {
          before: {
            description: beforeDescription,
            password: 'must-not-be-stored',
            nested: { sessionToken: 'must-not-be-stored-either', retained: 'before' },
          },
          after: {
            description: afterDescription,
            apiSecret: 'must-not-be-stored',
            nested: { retained: 'after' },
          },
        },
      },
      client,
    );

    expect(statements).toHaveLength(1);
    const serializedMetadata = statements[0]!.values[5] as string;
    const stored = JSON.parse(serializedMetadata) as {
      before: { description: string; nested: { retained: string }; password?: string };
      after: { description: string; nested: { retained: string }; apiSecret?: string };
    };

    expect(stored.before.description).toBe(beforeDescription);
    expect(stored.after.description).toBe(afterDescription);
    expect(stored.before.nested.retained).toBe('before');
    expect(stored.after.nested.retained).toBe('after');
    expect(stored.before.password).toBeUndefined();
    expect(stored.after.apiSecret).toBeUndefined();
    expect(JSON.stringify(stored).length).toBeGreaterThan(12000);
  });
});
