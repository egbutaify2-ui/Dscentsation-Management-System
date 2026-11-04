import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { createApp } from '../../app.js';

const app = createApp();
const suffix = randomUUID();
const password = 'DMS-task032-test-password';
const ownerEmail = 'task032.owner.' + suffix + '@example.invalid';
const managerEmail = 'task032.manager.' + suffix + '@example.invalid';
const staffEmail = 'task032.staff.' + suffix + '@example.invalid';
const locationCode = 'T032-' + suffix.slice(0, 12).toUpperCase();

type Agent = ReturnType<typeof request.agent>;

let ownerId = '';
let ownerAgent: Agent;
let ownerCsrf = '';
let managerAgent: Agent;
let managerCsrf = '';
let staffAgent: Agent;
let staffCsrf = '';
let customerId = '';
let locationId = '';

async function createUser(email: string, roleId: string): Promise<string> {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const result = await pool.query<{ id: string }>(
    'INSERT INTO users(email_normalized, display_name, password_hash, role_id) ' +
      'VALUES ($1, $2, $3, $4) RETURNING id',
    [email, 'Task 032 Payment Integration Test', passwordHash, roleId],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Task 032 integration test user was not created.');
  return id;
}

async function login(email: string): Promise<{ agent: Agent; csrf: string }> {
  const agent = request.agent(app);
  const initialCsrf = await agent.get('/api/v1/auth/csrf').expect(200);
  await agent
    .post('/api/v1/auth/login')
    .set('Origin', env.APP_ORIGIN)
    .set('X-CSRF-Token', initialCsrf.body.data.token as string)
    .send({ email, password })
    .expect(200);
  const refreshedCsrf = await agent.get('/api/v1/auth/csrf').expect(200);
  return { agent, csrf: refreshedCsrf.body.data.token as string };
}

async function createOrder(totalMinor: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    'INSERT INTO orders (' +
      'customer_id, customer_name_snapshot, source_channel, status, fulfilment_location_id, ' +
      'currency, subtotal_minor, discount_minor, delivery_fee_minor, total_minor, created_by, updated_by' +
      ") VALUES ($1, 'Task 032 Fixture Customer', 'phone', 'received', $2, 'NGN', $3::bigint, " +
      '0, 0, $3::bigint, $4, $4) RETURNING id',
    [customerId, locationId, totalMinor, ownerId],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Task 032 test order was not created.');
  return id;
}

function postPayment(
  agent: Agent,
  csrf: string,
  orderId: string,
  amountMinor: string,
  idempotencyKey = randomUUID(),
  additional: Record<string, unknown> = {},
) {
  return agent
    .post('/api/v1/orders/' + orderId + '/payments')
    .set('Origin', env.APP_ORIGIN)
    .set('X-CSRF-Token', csrf)
    .set('Idempotency-Key', idempotencyKey)
    .send({ amountMinor, currency: 'NGN', ...additional });
}

function verifyPayment(agent: Agent, csrf: string, paymentId: string) {
  return agent
    .post('/api/v1/payments/' + paymentId + '/verify')
    .set('Origin', env.APP_ORIGIN)
    .set('X-CSRF-Token', csrf)
    .send({});
}

async function createPayment(
  orderId: string,
  amountMinor: string,
  key = randomUUID(),
  additional: Record<string, unknown> = {},
): Promise<string> {
  const response = await postPayment(staffAgent, staffCsrf, orderId, amountMinor, key, additional)
    .expect(201);
  return response.body.data.id as string;
}

describe('Payment Management API and PostgreSQL integrity', () => {
  beforeAll(async () => {
    await pool.query('SELECT 1');

    const roles = await pool.query<{ id: string; code: string }>(
      "SELECT id, code FROM roles WHERE code IN ('OWNER', 'MANAGER', 'STAFF')",
    );
    const roleIds = new Map(roles.rows.map((role) => [role.code, role.id]));
    const ownerRoleId = roleIds.get('OWNER');
    const managerRoleId = roleIds.get('MANAGER');
    const staffRoleId = roleIds.get('STAFF');
    if (!ownerRoleId || !managerRoleId || !staffRoleId) {
      throw new Error('The seeded DMS payment roles are missing.');
    }

    const grants = await pool.query<{ role_code: string; permission_code: string }>(
      'SELECT r.code AS role_code, p.code AS permission_code ' +
        'FROM role_permissions rp JOIN roles r ON r.id = rp.role_id ' +
        'JOIN permissions p ON p.id = rp.permission_id ' +
        "WHERE p.code IN ('payments.record', 'payments.verify')",
    );
    const grantSet = new Set(grants.rows.map((grant) => grant.role_code + ':' + grant.permission_code));
    expect(grantSet.has('OWNER:payments.record')).toBe(true);
    expect(grantSet.has('MANAGER:payments.record')).toBe(true);
    expect(grantSet.has('STAFF:payments.record')).toBe(true);
    expect(grantSet.has('OWNER:payments.verify')).toBe(true);
    expect(grantSet.has('MANAGER:payments.verify')).toBe(true);
    expect(grantSet.has('STAFF:payments.verify')).toBe(false);

    ownerId = await createUser(ownerEmail, ownerRoleId);
    await createUser(managerEmail, managerRoleId);
    await createUser(staffEmail, staffRoleId);

    const location = await pool.query<{ id: string }>(
      'INSERT INTO locations(code, name, address) VALUES ($1, $2, $3) RETURNING id',
      [locationCode, 'Task 032 Payment Test Location', 'Lagos, Nigeria'],
    );
    locationId = location.rows[0]?.id ?? '';
    if (!locationId) throw new Error('Task 032 test location was not created.');

    const customer = await pool.query<{ id: string }>(
      'INSERT INTO customers(full_name, created_by, updated_by) VALUES ($1, $2, $2) RETURNING id',
      ['Task 032 Fixture Customer', ownerId],
    );
    customerId = customer.rows[0]?.id ?? '';
    if (!customerId) throw new Error('Task 032 test customer was not created.');

    const owner = await login(ownerEmail);
    ownerAgent = owner.agent;
    ownerCsrf = owner.csrf;
    const manager = await login(managerEmail);
    managerAgent = manager.agent;
    managerCsrf = manager.csrf;
    const staff = await login(staffEmail);
    staffAgent = staff.agent;
    staffCsrf = staff.csrf;
  });

  it('rejects unauthenticated payment recording, verification and financial reads', async () => {
    const orderId = await createOrder('100000');
    const anonymous = request.agent(app);
    const csrf = await anonymous.get('/api/v1/auth/csrf').expect(200);
    const payment = await postPayment(
      anonymous,
      csrf.body.data.token as string,
      orderId,
      '10000',
      randomUUID(),
    ).expect(401);
    expect(payment.body.error.code).toBe('AUTHENTICATION_REQUIRED');

    await anonymous.get('/api/v1/orders/' + orderId + '/payments').expect(401);
    await anonymous.get('/api/v1/orders/' + orderId + '/payments/summary').expect(401);
    await anonymous
      .post('/api/v1/payments/' + randomUUID() + '/verify')
      .set('Origin', env.APP_ORIGIN)
      .set('X-CSRF-Token', csrf.body.data.token as string)
      .send({})
      .expect(401);
  });

  it('allows Staff to record a pending payment but denies Staff verification and financial-history reads', async () => {
    const orderId = await createOrder('100000');
    const response = await postPayment(staffAgent, staffCsrf, orderId, '25000', randomUUID(), {
      method: 'Cash / manual label',
      reference: 'DUPLICATE-REFERENCE-OK',
    }).expect(201);

    const payment = response.body.data;
    expect(payment).toMatchObject({
      orderId,
      amountMinor: '25000',
      currency: 'NGN',
      method: 'Cash / manual label',
      reference: 'DUPLICATE-REFERENCE-OK',
      status: 'pending',
      recordedBy: expect.any(String),
      verifiedBy: null,
      verifiedAt: null,
    });
    expect(payment.recordedBy).not.toBe('');
    expect(payment.history).toHaveLength(1);
    expect(payment.history[0]).toMatchObject({
      eventType: 'recorded',
      amountMinor: '25000',
      actorUserId: payment.recordedBy,
    });

    await verifyPayment(staffAgent, staffCsrf, payment.id).expect(403);
    await staffAgent.get('/api/v1/orders/' + orderId + '/payments').expect(403);
    await staffAgent.get('/api/v1/payments/' + payment.id).expect(403);
    await staffAgent.get('/api/v1/orders/' + orderId + '/payments/summary').expect(403);
  });

  it('validates positive integer kobo amounts and rejects unsupported BIGINT values', async () => {
    const orderId = await createOrder('100000');
    for (const amountMinor of ['0', '-1', '1.25', '9223372036854775808']) {
      const response = await postPayment(
        staffAgent,
        staffCsrf,
        orderId,
        amountMinor,
        randomUUID(),
      ).expect(400);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
    }
    await postPayment(
      staffAgent,
      staffCsrf,
      orderId,
      '100',
      randomUUID(),
      { method: '   ' },
    ).expect(400);
    await postPayment(
      staffAgent,
      staffCsrf,
      orderId,
      '100',
      randomUUID(),
      { currency: 'USD' },
    ).expect(400);
  });

  it('returns not found for an unknown order and unknown payment', async () => {
    await postPayment(staffAgent, staffCsrf, randomUUID(), '100', randomUUID()).expect(404);
    await managerAgent.get('/api/v1/payments/' + randomUUID()).expect(404);
  });

  it('makes payment recording idempotent and rejects a reused key with different content', async () => {
    const orderId = await createOrder('100000');
    const key = randomUUID();
    const first = await postPayment(staffAgent, staffCsrf, orderId, '15000', key, {
      method: 'Unconfigured method label',
      reference: 'OPTIONAL-REF-1',
    }).expect(201);
    const replay = await postPayment(staffAgent, staffCsrf, orderId, '15000', key, {
      method: 'Unconfigured method label',
      reference: 'OPTIONAL-REF-1',
    }).expect(201);
    expect(replay.body.data.id).toBe(first.body.data.id);

    const changed = await postPayment(staffAgent, staffCsrf, orderId, '16000', key, {
      method: 'Unconfigured method label',
      reference: 'OPTIONAL-REF-1',
    }).expect(409);
    expect(changed.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const duplicateReference = await postPayment(
      staffAgent,
      staffCsrf,
      orderId,
      '10000',
      randomUUID(),
      { reference: 'OPTIONAL-REF-1' },
    ).expect(201);
    expect(duplicateReference.body.data.reference).toBe('OPTIONAL-REF-1');

    const history = await pool.query<{ event_count: string }>(
      "SELECT count(*)::text AS event_count FROM payment_events WHERE payment_id = $1 AND event_type = 'recorded'",
      [first.body.data.id],
    );
    expect(history.rows[0]?.event_count).toBe('1');
  });

  it('allows Manager and Owner to verify a pending payment exactly once', async () => {
    const orderId = await createOrder('100000');
    const managerPaymentId = await createPayment(orderId, '30000');
    const managerVerified = await verifyPayment(managerAgent, managerCsrf, managerPaymentId)
      .expect(200);
    expect(managerVerified.body.data.status).toBe('verified');
    expect(managerVerified.body.data.verifiedBy).toBeTruthy();
    expect(managerVerified.body.data.verifiedAt).toBeTruthy();
    expect(managerVerified.body.data.history.map((event: { eventType: string }) => event.eventType))
      .toEqual(['recorded', 'verified']);

    const duplicate = await verifyPayment(managerAgent, managerCsrf, managerPaymentId).expect(409);
    expect(duplicate.body.error.code).toBe('PAYMENT_ALREADY_VERIFIED');

    const ownerPaymentId = await createPayment(orderId, '20000');
    const ownerVerified = await verifyPayment(ownerAgent, ownerCsrf, ownerPaymentId).expect(200);
    expect(ownerVerified.body.data.status).toBe('verified');
    expect(ownerVerified.body.data.verifiedBy).toBe(ownerId);
  });

  it('lists payment history and returns one payment with immutable event attribution', async () => {
    const orderId = await createOrder('100000');
    const paymentId = await createPayment(orderId, '12000');
    await verifyPayment(managerAgent, managerCsrf, paymentId).expect(200);

    const list = await managerAgent.get('/api/v1/orders/' + orderId + '/payments').expect(200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0]).toMatchObject({
      id: paymentId,
      orderId,
      amountMinor: '12000',
      status: 'verified',
    });
    expect(list.body.data.items[0].history).toHaveLength(2);

    const detail = await managerAgent.get('/api/v1/payments/' + paymentId).expect(200);
    expect(detail.body.data.history.map((event: { eventType: string }) => event.eventType))
      .toEqual(['recorded', 'verified']);
    expect(detail.body.data).not.toHaveProperty('idempotencyKey');
    expect(detail.body.data).not.toHaveProperty('requestFingerprint');
  });

  it('derives a partially paid balance from verified payments and excludes pending amounts', async () => {
    const orderId = await createOrder('100000');
    const verifiedId = await createPayment(orderId, '30000');
    await verifyPayment(managerAgent, managerCsrf, verifiedId).expect(200);
    await createPayment(orderId, '50000');

    const summary = await managerAgent
      .get('/api/v1/orders/' + orderId + '/payments/summary')
      .expect(200);
    expect(summary.body.data).toMatchObject({
      orderId,
      currency: 'NGN',
      orderTotalMinor: '100000',
      verifiedPaidMinor: '30000',
      pendingPaymentMinor: '50000',
      outstandingMinor: '70000',
      paymentCount: 2,
      pendingCount: 1,
      verifiedCount: 1,
      paymentStatus: 'partially_paid',
    });
  });

  it('derives a fully paid order only when verified entries equal the order total', async () => {
    const orderId = await createOrder('100000');
    const first = await createPayment(orderId, '25000');
    const second = await createPayment(orderId, '75000');
    await verifyPayment(managerAgent, managerCsrf, first).expect(200);
    await verifyPayment(ownerAgent, ownerCsrf, second).expect(200);

    const summary = await ownerAgent
      .get('/api/v1/orders/' + orderId + '/payments/summary')
      .expect(200);
    expect(summary.body.data).toMatchObject({
      orderTotalMinor: '100000',
      verifiedPaidMinor: '100000',
      pendingPaymentMinor: '0',
      outstandingMinor: '0',
      paymentStatus: 'paid',
      pendingCount: 0,
      verifiedCount: 2,
    });
  });

  it('rejects verification that would exceed the immutable order total', async () => {
    const orderId = await createOrder('100000');
    const first = await createPayment(orderId, '80000');
    const second = await createPayment(orderId, '30000');
    await verifyPayment(managerAgent, managerCsrf, first).expect(200);

    const rejected = await verifyPayment(ownerAgent, ownerCsrf, second).expect(409);
    expect(rejected.body.error.code).toBe('PAYMENT_WOULD_OVERPAY');

    const pending = await pool.query<{ status: string }>(
      'SELECT status FROM payments WHERE id = $1',
      [second],
    );
    expect(pending.rows[0]?.status).toBe('pending');
    const verifiedEvents = await pool.query<{ total: string }>(
      "SELECT count(*)::text AS total FROM payment_events WHERE payment_id = $1 AND event_type = 'verified'",
      [second],
    );
    expect(verifiedEvents.rows[0]?.total).toBe('0');
  });

  it('serializes concurrent verification so only one request adds a verified event', async () => {
    const orderId = await createOrder('100000');
    const paymentId = await createPayment(orderId, '40000');
    const results = await Promise.all([
      verifyPayment(managerAgent, managerCsrf, paymentId),
      verifyPayment(ownerAgent, ownerCsrf, paymentId),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);

    const rows = await pool.query<{ total: string }>(
      "SELECT count(*)::text AS total FROM payment_events WHERE payment_id = $1 AND event_type = 'verified'",
      [paymentId],
    );
    expect(rows.rows[0]?.total).toBe('1');
    const payment = await pool.query<{ status: string }>(
      'SELECT status FROM payments WHERE id = $1',
      [paymentId],
    );
    expect(payment.rows[0]?.status).toBe('verified');
  });

  it('rolls back the payment and payment event when audit insertion fails', async () => {
    const orderId = await createOrder('100000');
    await pool.query(\`
      CREATE OR REPLACE FUNCTION task032_reject_payment_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'payment.recorded' THEN
          RAISE EXCEPTION 'Task 032 synthetic audit failure';
        END IF;
        RETURN NEW;
      END;
      $$;
    \`);
    await pool.query(
      "CREATE TRIGGER task032_reject_payment_audit BEFORE INSERT ON audit_logs " +
        "FOR EACH ROW WHEN (NEW.action = 'payment.recorded') " +
        'EXECUTE FUNCTION task032_reject_payment_audit()',
    );
    try {
      await postPayment(staffAgent, staffCsrf, orderId, '10000', randomUUID()).expect(500);
      const payments = await pool.query<{ total: string }>(
        'SELECT count(*)::text AS total FROM payments WHERE order_id = $1',
        [orderId],
      );
      const events = await pool.query<{ total: string }>(
        'SELECT count(*)::text AS total FROM payment_events pe ' +
          'JOIN payments p ON p.id = pe.payment_id WHERE p.order_id = $1',
        [orderId],
      );
      expect(payments.rows[0]?.total).toBe('0');
      expect(events.rows[0]?.total).toBe('0');
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS task032_reject_payment_audit ON audit_logs');
      await pool.query('DROP FUNCTION IF EXISTS task032_reject_payment_audit()');
    }
  });

  it('preserves payment details, history, and the order total against mutation or deletion', async () => {
    const orderId = await createOrder('100000');
    const paymentId = await createPayment(orderId, '15000');
    await verifyPayment(managerAgent, managerCsrf, paymentId).expect(200);
    const events = await pool.query<{ id: string }>(
      'SELECT id FROM payment_events WHERE payment_id = $1 ORDER BY occurred_at, id',
      [paymentId],
    );
    expect(events.rows).toHaveLength(2);

    await expect(
      pool.query('UPDATE payments SET amount_minor = 1 WHERE id = $1', [paymentId]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('UPDATE payments SET status = $2 WHERE id = $1', [paymentId, 'pending']),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query('DELETE FROM payments WHERE id = $1', [paymentId])).rejects.toMatchObject({
      code: '23514',
    });
    await expect(
      pool.query("UPDATE payment_events SET reason = 'edited' WHERE id = $1", [events.rows[0]?.id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('DELETE FROM payment_events WHERE id = $1', [events.rows[0]?.id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query('TRUNCATE payment_events')).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('UPDATE orders SET total_minor = total_minor + 1 WHERE id = $1', [orderId]),
    ).rejects.toMatchObject({ code: '23514' });

    const order = await pool.query<{ total_minor: string }>(
      'SELECT total_minor::text AS total_minor FROM orders WHERE id = $1',
      [orderId],
    );
    expect(order.rows[0]?.total_minor).toBe('100000');
  });
});
