import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { createApp } from '../../app.js';

const app = createApp();
const password = 'DMS-task027-synthetic-password';
const suffix = randomUUID();

interface TestUser {
  id: string;
  email: string;
  displayName: string;
}

const ownerEmail = `task027.owner.${suffix}@example.invalid`;
const managerEmail = `task027.manager.${suffix}@example.invalid`;
const staffEmail = `task027.staff.${suffix}@example.invalid`;

const ownerAgent = request.agent(app);
const managerAgent = request.agent(app);
const staffAgent = request.agent(app);

let owner: TestUser;
let manager: TestUser;
let staff: TestUser;

const actorEventType = `task027-actor-${suffix}`;
const filterEventType = `task027-filter-${suffix}`;
const dateEventType = `task027-date-${suffix}`;
const pageEventType = `task027-page-${suffix}`;
const targetEntityId = randomUUID();
const dateTargetId = randomUUID();
const actorAction = `task027.actor.event.${suffix}`;
const filterAction = `task027.filter.action.${suffix}`;
const systemAction = `task027.system.generated.${suffix}`;

async function createUser(
  email: string,
  roleCode: 'OWNER' | 'MANAGER' | 'STAFF',
): Promise<TestUser> {
  const role = await pool.query<{ id: string }>('SELECT id FROM roles WHERE code = $1', [roleCode]);
  if (!role.rows[0]) throw new Error(`Missing seeded role: ${roleCode}`);

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO users(email_normalized, display_name, password_hash, role_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [email, `Task 027 ${roleCode} ${suffix.slice(0, 8)}`, passwordHash, role.rows[0].id],
  );
  return {
    id: inserted.rows[0]!.id,
    email,
    displayName: `Task 027 ${roleCode} ${suffix.slice(0, 8)}`,
  };
}

async function signIn(agent: typeof ownerAgent, email: string): Promise<void> {
  const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
  await agent
    .post('/api/v1/auth/login')
    .set('Origin', env.APP_ORIGIN)
    .set('X-CSRF-Token', csrf.body.data.token as string)
    .send({ email, password })
    .expect(200);
}

async function insertAuditEvent(input: {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  occurredAt: string;
  safeMetadata?: Record<string, unknown>;
}): Promise<string> {
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO audit_logs(
       actor_user_id, action, entity_type, entity_id, request_id, safe_metadata, occurred_at
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)
     RETURNING id`,
    [
      input.actorUserId,
      input.action,
      input.entityType,
      input.entityId,
      `task027-${randomUUID()}`,
      JSON.stringify(input.safeMetadata ?? {}),
      input.occurredAt,
    ],
  );
  return inserted.rows[0]!.id;
}

describe('Audit activity history API', () => {
  let pageEventIds: string[];

  beforeAll(async () => {
    await pool.query('SELECT 1');
    owner = await createUser(ownerEmail, 'OWNER');
    manager = await createUser(managerEmail, 'MANAGER');
    staff = await createUser(staffEmail, 'STAFF');

    await signIn(ownerAgent, ownerEmail);
    await signIn(managerAgent, managerEmail);
    await signIn(staffAgent, staffEmail);

    await insertAuditEvent({
      actorUserId: owner.id,
      action: actorAction,
      entityType: actorEventType,
      entityId: targetEntityId,
      occurredAt: '2026-06-04T12:00:00.000Z',
      safeMetadata: {
        harmless: 'must-not-be-returned',
        password: 'synthetic-password-must-not-leak',
        sessionId: 'synthetic-session-must-not-leak',
        accessToken: 'synthetic-token-must-not-leak',
      },
    });
    await insertAuditEvent({
      actorUserId: manager.id,
      action: filterAction,
      entityType: filterEventType,
      entityId: targetEntityId,
      occurredAt: '2026-06-04T11:00:00.000Z',
    });
    await insertAuditEvent({
      actorUserId: null,
      action: systemAction,
      entityType: `task027-system-${suffix}`,
      entityId: null,
      occurredAt: '2026-06-04T10:00:00.000Z',
    });

    await insertAuditEvent({
      actorUserId: owner.id,
      action: 'task027.date.start.included',
      entityType: dateEventType,
      entityId: dateTargetId,
      occurredAt: '2026-05-31T23:00:00.000Z',
    });
    await insertAuditEvent({
      actorUserId: owner.id,
      action: 'task027.date.before.excluded',
      entityType: dateEventType,
      entityId: dateTargetId,
      occurredAt: '2026-05-31T22:59:59.999Z',
    });
    await insertAuditEvent({
      actorUserId: owner.id,
      action: 'task027.date.end.included',
      entityType: dateEventType,
      entityId: dateTargetId,
      occurredAt: '2026-06-01T22:59:59.999Z',
    });
    await insertAuditEvent({
      actorUserId: owner.id,
      action: 'task027.date.after.excluded',
      entityType: dateEventType,
      entityId: dateTargetId,
      occurredAt: '2026-06-01T23:00:00.000Z',
    });

    pageEventIds = [
      await insertAuditEvent({
        actorUserId: owner.id,
        action: 'task027.page.older',
        entityType: pageEventType,
        entityId: targetEntityId,
        occurredAt: '2026-06-03T10:00:00.000Z',
      }),
      await insertAuditEvent({
        actorUserId: owner.id,
        action: 'task027.page.same-time.first',
        entityType: pageEventType,
        entityId: targetEntityId,
        occurredAt: '2026-06-03T12:00:00.000Z',
      }),
      await insertAuditEvent({
        actorUserId: owner.id,
        action: 'task027.page.same-time.second',
        entityType: pageEventType,
        entityId: targetEntityId,
        occurredAt: '2026-06-03T12:00:00.000Z',
      }),
    ];
  });

  afterAll(async () => {
    await pool.end();
  });

  it('allows the Owner with users.view to read a minimal audit activity page', async () => {
    const session = await ownerAgent.get('/api/v1/auth/session').expect(200);
    expect(session.body.data.permissions).toContain('users.view');

    const response = await ownerAgent
      .get('/api/v1/audit-logs')
      .query({ entityType: actorEventType })
      .expect(200);

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0]).toMatchObject({
      id: expect.any(String),
      actorUserId: owner.id,
      actorDisplayName: owner.displayName,
      action: actorAction,
      entityType: actorEventType,
      entityId: targetEntityId,
      occurredAt: '2026-06-04T12:00:00.000Z',
    });
    expect(response.body.data).toMatchObject({
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
    });
    expect(response.body.data.actors).toEqual(
      expect.arrayContaining([
        { id: owner.id, displayName: owner.displayName },
        { id: manager.id, displayName: manager.displayName },
        { id: staff.id, displayName: staff.displayName },
      ]),
    );
  });

  it('rejects unauthenticated access and authenticated users without users.view', async () => {
    await request(app).get('/api/v1/audit-logs').expect(401);

    const managerSession = await managerAgent.get('/api/v1/auth/session').expect(200);
    const staffSession = await staffAgent.get('/api/v1/auth/session').expect(200);
    expect(managerSession.body.data.permissions).not.toContain('users.view');
    expect(staffSession.body.data.permissions).not.toContain('users.view');

    await managerAgent.get('/api/v1/audit-logs').expect(403);
    await staffAgent.get('/api/v1/audit-logs').expect(403);
  });

  it('filters by actor, action, entity type and entity ID', async () => {
    const actorResponse = await ownerAgent
      .get('/api/v1/audit-logs')
      .query({ actorUserId: owner.id, entityType: actorEventType })
      .expect(200);
    expect(actorResponse.body.data.items).toHaveLength(1);
    expect(actorResponse.body.data.items[0].actorUserId).toBe(owner.id);

    const actionResponse = await ownerAgent
      .get('/api/v1/audit-logs')
      .query({ action: filterAction })
      .expect(200);
    expect(actionResponse.body.data.items).toHaveLength(1);
    expect(actionResponse.body.data.items[0].entityType).toBe(filterEventType);

    const entityTypeResponse = await ownerAgent
      .get('/api/v1/audit-logs')
      .query({ entityType: filterEventType })
      .expect(200);
    expect(entityTypeResponse.body.data.items).toHaveLength(1);

    const entityIdResponse = await ownerAgent
      .get('/api/v1/audit-logs')
      .query({ entityId: targetEntityId, entityType: filterEventType })
      .expect(200);
    expect(entityIdResponse.body.data.items).toHaveLength(1);
    expect(entityIdResponse.body.data.items[0].entityId).toBe(targetEntityId);
  });

  it('treats date filters as inclusive Africa/Lagos calendar dates', async () => {
    const response = await ownerAgent
      .get('/api/v1/audit-logs')
      .query({ entityType: dateEventType, from: '2026-06-01', to: '2026-06-01' })
      .expect(200);

    expect(response.body.data.items.map((item: { action: string }) => item.action).sort()).toEqual([
      'task027.date.end.included',
      'task027.date.start.included',
    ]);
  });

  it('paginates with a maximum page size and stable newest-first ordering', async () => {
    const firstPage = await ownerAgent
      .get('/api/v1/audit-logs')
      .query({ entityType: pageEventType, page: '1', pageSize: '2' })
      .expect(200);
    const secondPage = await ownerAgent
      .get('/api/v1/audit-logs')
      .query({ entityType: pageEventType, page: '2', pageSize: '2' })
      .expect(200);

    expect(firstPage.body.data.total).toBe(3);
    expect(firstPage.body.data.totalPages).toBe(2);
    expect(firstPage.body.data.items).toHaveLength(2);
    expect(secondPage.body.data.items).toHaveLength(1);

    const sameTimeIds = pageEventIds.slice(1).sort().reverse();
    expect(firstPage.body.data.items.map((item: { id: string }) => item.id)).toEqual([
      ...sameTimeIds,
    ]);
    expect(secondPage.body.data.items[0].id).toBe(pageEventIds[0]);
    expect(
      firstPage.body.data.items[0].occurredAt >= firstPage.body.data.items[1].occurredAt,
    ).toBe(true);
  });

  it('labels system-generated events without an actor', async () => {
    const response = await ownerAgent
      .get('/api/v1/audit-logs')
      .query({ action: systemAction })
      .expect(200);

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0]).toMatchObject({
      actorUserId: null,
      actorDisplayName: 'System',
    });
  });

  it(
    'returns only approved activity fields and never returns metadata or session data',
    async () => {
      const response = await ownerAgent
        .get('/api/v1/audit-logs')
        .query({ entityType: actorEventType })
        .expect(200);
      const body = response.body as {
        data: {
          items: Array<Record<string, unknown>>;
          actors: Array<Record<string, unknown>>;
        };
      };

      expect(Object.keys(body.data.items[0]!).sort()).toEqual(
        [
          'id',
          'actorUserId',
          'actorDisplayName',
          'action',
          'entityType',
          'entityId',
          'occurredAt',
        ].sort(),
      );
      expect(
        body.data.actors.every((actor) => Object.keys(actor).sort().join(',') === 'displayName,id'),
      ).toBe(true);
      const actorIds = body.data.actors.map((actor) => actor.id);
      expect(new Set(actorIds).size).toBe(actorIds.length);

      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('safeMetadata');
      expect(serialized).not.toContain('must-not-be-returned');
      expect(serialized).not.toContain('synthetic-password-must-not-leak');
      expect(serialized).not.toContain('synthetic-session-must-not-leak');
      expect(serialized).not.toContain('synthetic-token-must-not-leak');
      expect(serialized).not.toMatch(/passwordHash|sessionId|accessToken|cookie|requestId/i);
    },
  );

  it('rejects malformed UUIDs, dates, invalid ranges and unknown query parameters', async () => {
    const invalidQueries = [
      { actorUserId: 'not-a-uuid' },
      { entityId: 'not-a-uuid' },
      { from: '2026-02-30' },
      { to: 'yesterday' },
      { from: '2026-06-02', to: '2026-06-01' },
      { unknown: 'not-allowed' },
      { page: '0' },
    ];

    for (const query of invalidQueries) {
      await ownerAgent.get('/api/v1/audit-logs').query(query).expect(400);
    }
  });

  it('enforces the maximum page size', async () => {
    const response = await ownerAgent
      .get('/api/v1/audit-logs')
      .query({ pageSize: '101' })
      .expect(400);
    expect(response.body.error.code).toBe('INVALID_REQUEST');
  });

  it('does not accept mutation methods for audit activity', async () => {
    const csrf = await ownerAgent.get('/api/v1/auth/csrf').expect(200);
    const mutation = (method: 'post' | 'delete') => {
      const call =
        method === 'post'
          ? ownerAgent.post('/api/v1/audit-logs').send({ action: 'tamper' })
          : ownerAgent.delete('/api/v1/audit-logs');
      return call
        .set('Origin', env.APP_ORIGIN)
        .set('X-CSRF-Token', csrf.body.data.token as string);
    };

    await mutation('post').expect(404);
    await mutation('delete').expect(404);
  });
});
