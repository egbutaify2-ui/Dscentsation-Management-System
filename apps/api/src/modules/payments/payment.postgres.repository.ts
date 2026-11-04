import { createHash } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { pool } from '../../db/pool.js';
import { appendAuditEvent } from '../audit/audit.service.js';
import { paymentConflict, paymentNotFound } from './payment.errors.js';
import type {
  OrderPaymentSummary,
  PaymentEventRecord,
  PaymentPage,
  PaymentRecord,
  PaymentStatus,
  RecordPaymentInput,
} from './payment.types.js';

interface PaymentRow extends QueryResultRow {
  id: string;
  order_id: string;
  amount_minor: string;
  currency: string;
  method: string | null;
  reference: string | null;
  status: PaymentStatus;
  recorded_by: string;
  occurred_at: Date | string;
  created_at: Date | string;
  verified_by: string | null;
  verified_at: Date | string | null;
}

interface PaymentEventRow extends QueryResultRow {
  id: string;
  payment_id: string;
  event_type: 'recorded' | 'verified';
  amount_minor: string;
  reason: string | null;
  actor_user_id: string;
  occurred_at: Date | string;
}

type DatabaseClient = PoolClient;

function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

const paymentColumns = [
  'p.id, p.order_id, p.amount_minor::text AS amount_minor, p.currency',
  'p.method, p.reference, p.status, p.recorded_by, p.occurred_at, p.created_at',
  'p.verified_by, p.verified_at',
].join(', ');

function mapEvent(row: PaymentEventRow): PaymentEventRecord {
  return {
    id: row.id,
    eventType: row.event_type,
    amountMinor: row.amount_minor,
    reason: row.reason,
    actorUserId: row.actor_user_id,
    occurredAt: new Date(row.occurred_at).toISOString(),
  };
}

function mapPayment(row: PaymentRow, history: PaymentEventRecord[]): PaymentRecord {
  return {
    id: row.id,
    orderId: row.order_id,
    amountMinor: row.amount_minor,
    currency: row.currency.trim() as 'NGN',
    method: row.method,
    reference: row.reference,
    status: row.status,
    recordedBy: row.recorded_by,
    occurredAt: new Date(row.occurred_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    verifiedBy: row.verified_by,
    verifiedAt: iso(row.verified_at),
    history,
  };
}

async function withTransaction<T>(operation: (client: DatabaseClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await operation(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function loadPayment(client: DatabaseClient, paymentId: string): Promise<PaymentRecord> {
  const result = await client.query<PaymentRow>(
    'SELECT ' + paymentColumns + ' FROM payments p WHERE p.id = $1',
    [paymentId],
  );
  const row = result.rows[0];
  if (!row) throw paymentNotFound();
  const events = await client.query<PaymentEventRow>(
    'SELECT id, payment_id, event_type, amount_minor::text AS amount_minor, ' +
      'reason, actor_user_id, occurred_at FROM payment_events ' +
      'WHERE payment_id = $1 ORDER BY occurred_at, id',
    [paymentId],
  );
  return mapPayment(row, events.rows.map(mapEvent));
}

function fingerprint(orderId: string, input: RecordPaymentInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        orderId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        method: input.method ?? null,
        reference: input.reference ?? null,
        occurredAt: input.occurredAt ?? null,
      }),
    )
    .digest('hex');
}

export class PostgresPaymentRepository {
  async recordPayment(
    orderId: string,
    actorId: string,
    requestId: string | undefined,
    idempotencyKey: string,
    input: RecordPaymentInput,
  ): Promise<PaymentRecord> {
    return withTransaction(async (client) => {
      const order = await client.query<{ id: string }>(
        'SELECT id FROM orders WHERE id = $1 FOR UPDATE',
        [orderId],
      );
      if (!order.rows[0]) throw paymentNotFound();

      const requestFingerprint = fingerprint(orderId, input);
      const inserted = await client.query<{ id: string }>(
        'INSERT INTO payments (' +
          'order_id, amount_minor, currency, method, reference, recorded_by, occurred_at, ' +
          'idempotency_key, request_fingerprint' +
          ') VALUES ($1, $2::bigint, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8, $9) ' +
          'ON CONFLICT (recorded_by, idempotency_key) DO NOTHING RETURNING id',
        [
          orderId,
          input.amountMinor,
          input.currency,
          input.method ?? null,
          input.reference ?? null,
          actorId,
          input.occurredAt ?? null,
          idempotencyKey,
          requestFingerprint,
        ],
      );

      const paymentId = inserted.rows[0]?.id;
      if (!paymentId) {
        const existing = await client.query<{ id: string; request_fingerprint: string }>(
          'SELECT id, request_fingerprint FROM payments ' +
            'WHERE recorded_by = $1 AND idempotency_key = $2',
          [actorId, idempotencyKey],
        );
        const previous = existing.rows[0];
        if (!previous) {
          throw paymentConflict('The idempotent payment request could not be resolved.');
        }
        if (previous.request_fingerprint !== requestFingerprint) {
          throw paymentConflict(
            'This idempotency key was already used with different payment details.',
            'IDEMPOTENCY_KEY_REUSED',
          );
        }
        return loadPayment(client, previous.id);
      }

      await client.query(
        'INSERT INTO payment_events(payment_id, event_type, amount_minor, actor_user_id) ' +
          "VALUES ($1, 'recorded', $2::bigint, $3)",
        [paymentId, input.amountMinor, actorId],
      );

      await appendAuditEvent(
        {
          actorUserId: actorId,
          action: 'payment.recorded',
          entityType: 'payment',
          entityId: paymentId,
          requestId,
          safeMetadata: {
            orderId,
            amountMinor: input.amountMinor,
            currency: input.currency,
            method: input.method ?? null,
            outcome: 'pending_verification',
          },
        },
        client,
      );

      return loadPayment(client, paymentId);
    });
  }

  async verifyPayment(
    paymentId: string,
    actorId: string,
    requestId: string | undefined,
  ): Promise<PaymentRecord> {
    return withTransaction(async (client) => {
      const paymentOrder = await client.query<{ order_id: string }>(
        'SELECT order_id FROM payments WHERE id = $1',
        [paymentId],
      );
      const orderId = paymentOrder.rows[0]?.order_id;
      if (!orderId) throw paymentNotFound();

      const order = await client.query<{ total_minor: string }>(
        'SELECT total_minor::text AS total_minor FROM orders WHERE id = $1 FOR UPDATE',
        [orderId],
      );
      const totalMinor = order.rows[0]?.total_minor;
      if (totalMinor === undefined) throw paymentNotFound();

      const locked = await client.query<{
        status: PaymentStatus;
        amount_minor: string;
      }>(
        'SELECT status, amount_minor::text AS amount_minor FROM payments WHERE id = $1 FOR UPDATE',
        [paymentId],
      );
      const current = locked.rows[0];
      if (!current) throw paymentNotFound();
      if (current.status !== 'pending') {
        throw paymentConflict('This payment has already been verified.', 'PAYMENT_ALREADY_VERIFIED');
      }

      const totals = await client.query<{ verified_minor: string }>(
        "SELECT COALESCE(sum(amount_minor), 0)::text AS verified_minor " +
          "FROM payments WHERE order_id = $1 AND status = 'verified'",
        [orderId],
      );
      const verifiedMinor = BigInt(totals.rows[0]?.verified_minor ?? '0');
      const nextVerifiedMinor = verifiedMinor + BigInt(current.amount_minor);
      if (nextVerifiedMinor > BigInt(totalMinor)) {
        throw paymentConflict(
          'Verifying this payment would exceed the order total.',
          'PAYMENT_WOULD_OVERPAY',
        );
      }

      const updated = await client.query(
        "UPDATE payments SET status = 'verified', verified_by = $2, verified_at = now() " +
          "WHERE id = $1 AND status = 'pending'",
        [paymentId, actorId],
      );
      if (updated.rowCount !== 1) {
        throw paymentConflict('This payment is no longer pending.', 'PAYMENT_ALREADY_VERIFIED');
      }

      await client.query(
        'INSERT INTO payment_events(payment_id, event_type, amount_minor, actor_user_id) ' +
          "VALUES ($1, 'verified', $2::bigint, $3)",
        [paymentId, current.amount_minor, actorId],
      );

      await appendAuditEvent(
        {
          actorUserId: actorId,
          action: 'payment.verified',
          entityType: 'payment',
          entityId: paymentId,
          requestId,
          safeMetadata: {
            orderId,
            amountMinor: current.amount_minor,
            currency: 'NGN',
            outcome: 'verified',
          },
        },
        client,
      );

      return loadPayment(client, paymentId);
    });
  }

  async getPayment(paymentId: string): Promise<PaymentRecord> {
    const client = await pool.connect();
    try {
      return await loadPayment(client, paymentId);
    } finally {
      client.release();
    }
  }

  async listOrderPayments(
    orderId: string,
    page: number,
    pageSize: number,
  ): Promise<PaymentPage> {
    const order = await pool.query('SELECT id FROM orders WHERE id = $1', [orderId]);
    if (order.rowCount !== 1) throw paymentNotFound();

    const count = await pool.query<{ total: string }>(
      'SELECT count(*)::text AS total FROM payments WHERE order_id = $1',
      [orderId],
    );
    const total = Number(count.rows[0]?.total ?? '0');
    const rows = await pool.query<PaymentRow>(
      'SELECT ' +
        paymentColumns +
        ' FROM payments p WHERE p.order_id = $1 ' +
        'ORDER BY p.created_at DESC, p.id DESC LIMIT $2 OFFSET $3',
      [orderId, pageSize, (page - 1) * pageSize],
    );

    const ids = rows.rows.map((row) => row.id);
    const eventRows = ids.length
      ? await pool.query<PaymentEventRow>(
          'SELECT id, payment_id, event_type, amount_minor::text AS amount_minor, ' +
            'reason, actor_user_id, occurred_at FROM payment_events ' +
            'WHERE payment_id = ANY($1::uuid[]) ORDER BY occurred_at, id',
          [ids],
        )
      : { rows: [] as PaymentEventRow[] };
    const historyByPayment = new Map<string, PaymentEventRecord[]>();
    for (const event of eventRows.rows) {
      const list = historyByPayment.get(event.payment_id) ?? [];
      list.push(mapEvent(event));
      historyByPayment.set(event.payment_id, list);
    }

    return {
      items: rows.rows.map((row) => mapPayment(row, historyByPayment.get(row.id) ?? [])),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getOrderPaymentSummary(orderId: string): Promise<OrderPaymentSummary> {
    const result = await pool.query<{
      order_total_minor: string;
      verified_paid_minor: string;
      pending_payment_minor: string;
      payment_count: string;
      pending_count: string;
      verified_count: string;
    }>(
      'SELECT o.total_minor::text AS order_total_minor, ' +
        "COALESCE(sum(p.amount_minor) FILTER (WHERE p.status = 'verified'), 0)::text " +
        'AS verified_paid_minor, ' +
        "COALESCE(sum(p.amount_minor) FILTER (WHERE p.status = 'pending'), 0)::text " +
        'AS pending_payment_minor, count(p.id)::text AS payment_count, ' +
        "count(p.id) FILTER (WHERE p.status = 'pending')::text AS pending_count, " +
        "count(p.id) FILTER (WHERE p.status = 'verified')::text AS verified_count " +
        'FROM orders o LEFT JOIN payments p ON p.order_id = o.id ' +
        'WHERE o.id = $1 GROUP BY o.id',
      [orderId],
    );
    const row = result.rows[0];
    if (!row) throw paymentNotFound();

    const orderTotal = BigInt(row.order_total_minor);
    const verifiedPaid = BigInt(row.verified_paid_minor);
    const outstanding = orderTotal - verifiedPaid;
    const paymentStatus =
      verifiedPaid === 0n ? 'unpaid' : verifiedPaid === orderTotal ? 'paid' : 'partially_paid';

    return {
      orderId,
      currency: 'NGN',
      orderTotalMinor: row.order_total_minor,
      verifiedPaidMinor: row.verified_paid_minor,
      pendingPaymentMinor: row.pending_payment_minor,
      outstandingMinor: outstanding.toString(),
      paymentCount: Number(row.payment_count),
      pendingCount: Number(row.pending_count),
      verifiedCount: Number(row.verified_count),
      paymentStatus,
    };
  }
}
