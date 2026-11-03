import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { pool } from '../../db/pool.js';
import { appendAuditEvent, type AuditJsonValue } from '../audit/audit.service.js';
import { orderConflict, orderNotFound } from './order.errors.js';
import type {
  OrderAmendmentWriteModel,
  OrderCreateWriteModel,
  OrderItemSnapshot,
  OrderMutationContext,
  OrderRecord,
  OrderSourceChannel,
  OrderStatus,
} from './order.types.js';
import type { OrderRepository } from './order.repository.js';

type Database = Pool | PoolClient;

interface OrderHeaderRow extends QueryResultRow {
  id: string;
  customer_id: string;
  customer_name_snapshot: string;
  customer_phone_snapshot: string | null;
  customer_email_snapshot: string | null;
  source_channel: OrderSourceChannel;
  status: OrderStatus;
  fulfilment_location_id: string;
  currency: string;
  subtotal_minor: string;
  discount_minor: string;
  delivery_fee_minor: string;
  total_minor: string;
  delivery_address_snapshot: string | null;
  notes: string | null;
  created_by: string;
  updated_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface OrderItemRow extends QueryResultRow {
  order_id?: string;
  product_id: string;
  product_variant_id: string;
  product_name_snapshot: string;
  variant_name_snapshot: string;
  sku_snapshot: string | null;
  unit_of_measure_snapshot: string;
  unit_price_minor: string;
  quantity: number;
  discount_minor: string;
  line_total_minor: string;
}

export interface OrderListFilters {
  query?: string | undefined;
  status?: OrderStatus | 'all' | undefined;
  customerId?: string | undefined;
  sourceChannel?: OrderSourceChannel | undefined;
  fulfilmentLocationId?: string | undefined;
  actorId: string;
  actorRoleCode: string;
  page: number;
  pageSize: number;
}

export interface OrderPage {
  items: OrderRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function auditSnapshot(order: {
  customerId: string;
  sourceChannel: OrderSourceChannel;
  status: OrderStatus;
  fulfilmentLocationId: string;
  currency: 'NGN';
  subtotalMinor: string;
  discountMinor: string;
  deliveryFeeMinor: string;
  totalMinor: string;
  items: readonly OrderItemSnapshot[];
}): Record<string, AuditJsonValue> {
  return {
    customerId: order.customerId,
    sourceChannel: order.sourceChannel,
    status: order.status,
    fulfilmentLocationId: order.fulfilmentLocationId,
    currency: order.currency,
    subtotalMinor: order.subtotalMinor,
    discountMinor: order.discountMinor,
    deliveryFeeMinor: order.deliveryFeeMinor,
    totalMinor: order.totalMinor,
    items: order.items.map((item) => ({
      productId: item.productId,
      productVariantId: item.productVariantId,
      productNameSnapshot: item.productNameSnapshot,
      variantNameSnapshot: item.variantNameSnapshot,
      skuSnapshot: item.skuSnapshot,
      unitOfMeasureSnapshot: item.unitOfMeasureSnapshot,
      unitPriceMinor: item.unitPriceMinor,
      quantity: item.quantity,
      discountMinor: item.discountMinor,
      lineTotalMinor: item.lineTotalMinor,
    })),
  };
}

function changedFields(current: OrderRecord, next: OrderAmendmentWriteModel): string[] {
  const fields: string[] = [];
  if (current.customerId !== next.customerId) fields.push('customerId');
  if (current.sourceChannel !== next.sourceChannel) fields.push('sourceChannel');
  if (current.fulfilmentLocationId !== next.fulfilmentLocationId)
    fields.push('fulfilmentLocationId');
  if (JSON.stringify(current.items) !== JSON.stringify(next.items)) fields.push('items');
  if (current.deliveryAddressSnapshot !== next.deliveryAddressSnapshot)
    fields.push('deliveryAddressSnapshot');
  if (current.notes !== next.notes) fields.push('notes');
  return fields;
}

const orderHeaderColumns = [
  'o.id, o.customer_id, o.customer_name_snapshot, o.customer_phone_snapshot',
  'o.customer_email_snapshot, o.source_channel, o.status, o.fulfilment_location_id',
  'o.currency, o.subtotal_minor::text AS subtotal_minor',
  'o.discount_minor::text AS discount_minor, o.delivery_fee_minor::text AS delivery_fee_minor',
  'o.total_minor::text AS total_minor, o.delivery_address_snapshot, o.notes',
  'o.created_by, o.updated_by, o.created_at, o.updated_at',
].join(', ');

const itemColumns = [
  'oi.product_id, oi.product_variant_id, oi.product_name_snapshot',
  'oi.variant_name_snapshot, oi.sku_snapshot, oi.unit_of_measure_snapshot',
  'oi.unit_price_minor::text AS unit_price_minor, oi.quantity',
  'oi.discount_minor::text AS discount_minor, oi.line_total_minor::text AS line_total_minor',
].join(', ');

function mapItems(rows: readonly OrderItemRow[]): OrderItemSnapshot[] {
  return rows.map((row) => ({
    productId: row.product_id,
    productVariantId: row.product_variant_id,
    productNameSnapshot: row.product_name_snapshot,
    variantNameSnapshot: row.variant_name_snapshot,
    skuSnapshot: row.sku_snapshot,
    unitOfMeasureSnapshot: row.unit_of_measure_snapshot,
    unitPriceMinor: row.unit_price_minor,
    quantity: row.quantity,
    discountMinor: row.discount_minor,
    lineTotalMinor: row.line_total_minor,
  }));
}

function mapOrder(row: OrderHeaderRow, items: OrderItemSnapshot[]): OrderRecord {
  return {
    id: row.id,
    customerId: row.customer_id,
    customerNameSnapshot: row.customer_name_snapshot,
    customerPhoneSnapshot: row.customer_phone_snapshot,
    customerEmailSnapshot: row.customer_email_snapshot,
    sourceChannel: row.source_channel,
    status: row.status,
    fulfilmentLocationId: row.fulfilment_location_id,
    items,
    currency: row.currency.trim() as 'NGN',
    subtotalMinor: row.subtotal_minor,
    discountMinor: row.discount_minor,
    deliveryFeeMinor: row.delivery_fee_minor,
    totalMinor: row.total_minor,
    deliveryAddressSnapshot: row.delivery_address_snapshot,
    notes: row.notes,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function loadItems(database: Database, orderId: string): Promise<OrderItemSnapshot[]> {
  const result = await database.query<OrderItemRow>(
    'SELECT ' + itemColumns + ' FROM order_items oi WHERE oi.order_id = $1 ORDER BY oi.line_number',
    [orderId],
  );
  return mapItems(result.rows);
}

async function loadOrder(database: Database, orderId: string): Promise<OrderRecord> {
  const result = await database.query<OrderHeaderRow>(
    'SELECT ' + orderHeaderColumns + ' FROM orders o WHERE o.id = $1',
    [orderId],
  );
  const header = result.rows[0];
  if (!header) throw orderNotFound();
  return mapOrder(header, await loadItems(database, orderId));
}

async function insertItems(
  client: PoolClient,
  orderId: string,
  items: readonly OrderItemSnapshot[],
): Promise<void> {
  for (const [index, item] of items.entries()) {
    await client.query(
      'INSERT INTO order_items (' +
        'order_id, line_number, product_id, product_variant_id, product_name_snapshot, ' +
        'variant_name_snapshot, sku_snapshot, unit_of_measure_snapshot, unit_price_minor, ' +
        'quantity, discount_minor, line_total_minor' +
        ') VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::bigint, $10, $11::bigint, $12::bigint)',
      [
        orderId,
        index + 1,
        item.productId,
        item.productVariantId,
        item.productNameSnapshot,
        item.variantNameSnapshot,
        item.skuSnapshot,
        item.unitOfMeasureSnapshot,
        item.unitPriceMinor,
        item.quantity,
        item.discountMinor,
        item.lineTotalMinor,
      ],
    );
  }
}

async function withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
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

export class PostgresOrderRepository implements OrderRepository {
  async createReceivedOrder(
    order: OrderCreateWriteModel,
    context: OrderMutationContext,
  ): Promise<OrderRecord> {
    return withTransaction(async (client) => {
      const inserted = await client.query<{ id: string }>(
        'INSERT INTO orders (' +
          'customer_id, customer_name_snapshot, customer_phone_snapshot, ' +
          'customer_email_snapshot, source_channel, status, fulfilment_location_id, ' +
          'currency, subtotal_minor, discount_minor, delivery_fee_minor, total_minor, ' +
          'delivery_address_snapshot, notes, created_by, updated_by' +
          ") VALUES ($1, $2, $3, $4, $5, 'received', $6, $7, $8::bigint, $9::bigint, " +
          '$10::bigint, $11::bigint, $12, $13, $14, $14) RETURNING id',
        [
          order.customerId,
          order.customerNameSnapshot,
          order.customerPhoneSnapshot,
          order.customerEmailSnapshot,
          order.sourceChannel,
          order.fulfilmentLocationId,
          order.currency,
          order.subtotalMinor,
          order.discountMinor,
          order.deliveryFeeMinor,
          order.totalMinor,
          order.deliveryAddressSnapshot,
          order.notes,
          order.createdBy,
        ],
      );
      const orderId = inserted.rows[0]?.id;
      if (!orderId) throw new Error('Order creation did not return a record identifier.');

      await insertItems(client, orderId, order.items);
      await appendAuditEvent(
        {
          actorUserId: context.actorId,
          action: 'order.created',
          entityType: 'order',
          entityId: orderId,
          requestId: context.requestId,
          safeMetadata: {
            before: null,
            after: auditSnapshot(order),
          },
        },
        client,
      );

      return loadOrder(client, orderId);
    });
  }

  async amendReceivedOrder(
    orderId: string,
    context: OrderMutationContext,
    buildAmendment: (current: OrderRecord) => Promise<OrderAmendmentWriteModel>,
  ): Promise<OrderRecord> {
    return withTransaction(async (client) => {
      const locked = await client.query<{ status: OrderStatus }>(
        'SELECT status FROM orders WHERE id = $1 FOR UPDATE',
        [orderId],
      );
      const status = locked.rows[0]?.status;
      if (!status) throw orderNotFound();
      if (status !== 'received') {
        throw orderConflict('Only orders in the received state can be amended.');
      }

      // Resolve current values and run the amendment callback while the row lock is held.
      const current = await loadOrder(client, orderId);
      const amendment = await buildAmendment(current);

      await client.query(
        'UPDATE orders SET customer_id = $2, customer_name_snapshot = $3, ' +
          'customer_phone_snapshot = $4, customer_email_snapshot = $5, source_channel = $6, ' +
          'fulfilment_location_id = $7, currency = $8, subtotal_minor = $9::bigint, ' +
          'discount_minor = $10::bigint, delivery_fee_minor = $11::bigint, ' +
          'total_minor = $12::bigint, delivery_address_snapshot = $13, notes = $14, ' +
          'updated_by = $15, updated_at = now() WHERE id = $1',
        [
          orderId,
          amendment.customerId,
          amendment.customerNameSnapshot,
          amendment.customerPhoneSnapshot,
          amendment.customerEmailSnapshot,
          amendment.sourceChannel,
          amendment.fulfilmentLocationId,
          amendment.currency,
          amendment.subtotalMinor,
          amendment.discountMinor,
          amendment.deliveryFeeMinor,
          amendment.totalMinor,
          amendment.deliveryAddressSnapshot,
          amendment.notes,
          amendment.updatedBy,
        ],
      );

      await client.query('DELETE FROM order_items WHERE order_id = $1', [orderId]);
      await insertItems(client, orderId, amendment.items);
      await appendAuditEvent(
        {
          actorUserId: context.actorId,
          action: 'order.amended',
          entityType: 'order',
          entityId: orderId,
          requestId: context.requestId,
          safeMetadata: {
            changedFields: changedFields(current, amendment),
            before: auditSnapshot(current),
            after: auditSnapshot({ ...amendment, status: current.status }),
          },
        },
        client,
      );

      return loadOrder(client, orderId);
    });
  }

  async getOrder(orderId: string): Promise<OrderRecord> {
    return loadOrder(pool, orderId);
  }

  async getOrderForActor(
    orderId: string,
    actorId: string,
    actorRoleCode: string,
  ): Promise<OrderRecord> {
    const result = await pool.query<OrderHeaderRow>(
      'SELECT ' +
        orderHeaderColumns +
        ' FROM orders o WHERE o.id = $1 AND EXISTS (' +
        'SELECT 1 FROM locations l ' +
        'WHERE l.id = o.fulfilment_location_id AND l.is_active = true ' +
        "AND ($2::text IN ('OWNER', 'MANAGER') OR (" +
        "$2::text = 'STAFF' AND EXISTS (" +
        'SELECT 1 FROM user_location_access ula ' +
        'WHERE ula.user_id = $3::uuid AND ula.location_id = l.id' +
        '))))',
      [orderId, actorRoleCode, actorId],
    );
    const header = result.rows[0];
    if (!header) throw orderNotFound();
    return mapOrder(header, await loadItems(pool, orderId));
  }

  async listOrders(filters: OrderListFilters): Promise<OrderPage> {
    const query = filters.query?.trim() || null;
    const status = !filters.status || filters.status === 'all' ? null : filters.status;
    const offset = (filters.page - 1) * filters.pageSize;
    const params = [
      query,
      status,
      filters.customerId ?? null,
      filters.sourceChannel ?? null,
      filters.fulfilmentLocationId ?? null,
      filters.actorRoleCode,
      filters.actorId,
    ];

    const filterSql =
      ' FROM orders o WHERE ($1::text IS NULL OR ' +
      "o.id::text ILIKE '%' || $1 || '%' OR " +
      "o.customer_name_snapshot ILIKE '%' || $1 || '%' OR " +
      "COALESCE(o.customer_phone_snapshot, '') ILIKE '%' || $1 || '%' OR " +
      "COALESCE(o.customer_email_snapshot, '') ILIKE '%' || $1 || '%') " +
      'AND ($2::text IS NULL OR o.status = $2) ' +
      'AND ($3::uuid IS NULL OR o.customer_id = $3) ' +
      'AND ($4::text IS NULL OR o.source_channel = $4) ' +
      'AND ($5::uuid IS NULL OR o.fulfilment_location_id = $5) ' +
      'AND EXISTS (' +
      'SELECT 1 FROM locations l ' +
      'WHERE l.id = o.fulfilment_location_id AND l.is_active = true ' +
      "AND ($6::text IN ('OWNER', 'MANAGER') OR (" +
      "$6::text = 'STAFF' AND EXISTS (" +
      'SELECT 1 FROM user_location_access ula ' +
      'WHERE ula.user_id = $7::uuid AND ula.location_id = l.id' +
      '))))';

    const count = await pool.query<{ total: string }>(
      'SELECT count(*)::text AS total' + filterSql,
      params,
    );
    const result = await pool.query<OrderHeaderRow>(
      'SELECT ' +
        orderHeaderColumns +
        filterSql +
        ' ORDER BY o.created_at DESC, o.id DESC LIMIT $8 OFFSET $9',
      [...params, filters.pageSize, offset],
    );

    const ids = result.rows.map((row) => row.id);
    let itemRows: OrderItemRow[] = [];
    if (ids.length > 0) {
      const itemResult = await pool.query<OrderItemRow>(
        'SELECT oi.order_id, ' +
          itemColumns +
          ' FROM order_items oi WHERE oi.order_id = ANY($1::uuid[]) ' +
          'ORDER BY oi.order_id, oi.line_number',
        [ids],
      );
      itemRows = itemResult.rows;
    }

    const itemsByOrder = new Map<string, OrderItemSnapshot[]>();
    for (const row of itemRows) {
      if (!row.order_id) continue;
      const current = itemsByOrder.get(row.order_id) ?? [];
      current.push(...mapItems([row]));
      itemsByOrder.set(row.order_id, current);
    }

    const total = Number(count.rows[0]?.total ?? 0);
    return {
      items: result.rows.map((row) => mapOrder(row, itemsByOrder.get(row.id) ?? [])),
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.ceil(total / filters.pageSize),
    };
  }
}
