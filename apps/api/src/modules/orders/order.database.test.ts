import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { createApp } from '../../app.js';
import { PostgresOrderRepository } from './order.postgres.repository.js';
import type {
  OrderAmendmentWriteModel,
  OrderCreateWriteModel,
  OrderRecord,
} from './order.types.js';

const app = createApp();
const repository = new PostgresOrderRepository();
const suffix = randomUUID();
const password = 'DMS-task022-test-password';
const ownerEmail = 'task022.owner.' + suffix + '@example.invalid';
const deniedEmail = 'task022.denied.' + suffix + '@example.invalid';
const assignedStaffEmail = 'task022.assigned-staff.' + suffix + '@example.invalid';
const multiLocationStaffEmail = 'task022.multi-location-staff.' + suffix + '@example.invalid';
const managerEmail = 'task022.manager.' + suffix + '@example.invalid';
const locationCode = 'T022-' + suffix.slice(0, 12).toUpperCase();

let actorId = '';
let customerId = '';
let locationId = '';
let otherLocationId = '';
let warehouseLocationId = '';
let secondAssignedLocationId = '';
let multiLocationStaffId = '';
let otherVariantId = '';
let inactiveLocationId = '';
let productId = '';
let variantId = '';
let otherProductId = '';
let highValueProductId = '';
let highValueVariantId = '';
let createdOrderId = '';
let orderPermissionGrants: Array<{ role_id: string; permission_id: string }> = [];

type Agent = ReturnType<typeof request.agent>;

async function createUser(email: string, roleId: string): Promise<string> {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const result = await pool.query<{ id: string }>(
    'INSERT INTO users(email_normalized, display_name, password_hash, role_id) ' +
      'VALUES ($1, $2, $3, $4) RETURNING id',
    [email, 'Task 022 Integration Test', passwordHash, roleId],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Task 022 integration test user was not created.');
  return id;
}

async function createProduct(
  name: string,
  sku: string,
  sellingPriceMinor: string,
): Promise<{ productId: string; variantId: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const product = await client.query<{ id: string }>(
      'INSERT INTO products(name, created_by, updated_by) VALUES ($1, $2, $2) RETURNING id',
      [name, actorId],
    );
    const id = product.rows[0]?.id;
    if (!id) throw new Error('Task 022 test product was not created.');
    const variant = await client.query<{ id: string }>(
      'INSERT INTO product_variants(' +
        'product_id, name, sku, unit_of_measure, selling_price_minor, cost_price_minor, ' +
        'currency, is_active, is_default, created_by, updated_by' +
        ") VALUES ($1, '100 ml', $2, 'bottle', $3::bigint, 50000, 'NGN', true, true, $4, $4) " +
        'RETURNING id',
      [id, sku, sellingPriceMinor, actorId],
    );
    const variantKey = variant.rows[0]?.id;
    if (!variantKey) throw new Error('Task 022 test variant was not created.');
    await client.query('COMMIT');
    return { productId: id, variantId: variantKey };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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

function postWithCsrf(agent: Agent, csrf: string, body: object) {
  return agent
    .post('/api/v1/orders')
    .set('Origin', env.APP_ORIGIN)
    .set('X-CSRF-Token', csrf)
    .send(body);
}

function createOrderBody(productKey = productId, variantKey = variantId, quantity = 1) {
  return {
    customerId,
    sourceChannel: 'whatsapp',
    fulfilmentLocationId: locationId,
    items: [{ productId: productKey, variantId: variantKey, quantity }],
    deliveryAddress: '12 Test Street, Lagos',
    notes: 'Task 022 integration fixture',
  };
}

function directOrderWrite(notes: string, fulfilmentLocationId = locationId): OrderCreateWriteModel {
  return {
    customerId,
    customerNameSnapshot: 'Captured Integration Customer',
    customerPhoneSnapshot: '+2348000000001',
    customerEmailSnapshot: 'captured.customer@example.invalid',
    sourceChannel: 'website',
    status: 'received',
    fulfilmentLocationId,
    items: [
      {
        productId,
        productVariantId: variantId,
        productNameSnapshot: 'Captured Integration Product',
        variantNameSnapshot: '100 ml',
        skuSnapshot: 'T022-CAPTURE',
        unitOfMeasureSnapshot: 'bottle',
        unitPriceMinor: '150000',
        quantity: 1,
        discountMinor: '0',
        lineTotalMinor: '150000',
      },
    ],
    currency: 'NGN',
    deliveryAddressSnapshot: null,
    notes,
    createdBy: actorId,
    subtotalMinor: '150000',
    discountMinor: '0',
    deliveryFeeMinor: '0',
    totalMinor: '150000',
  };
}

function amendmentFrom(
  current: OrderRecord,
  updatedBy: string,
  notes: string | null,
): OrderAmendmentWriteModel {
  return {
    customerId: current.customerId,
    customerNameSnapshot: current.customerNameSnapshot,
    customerPhoneSnapshot: current.customerPhoneSnapshot,
    customerEmailSnapshot: current.customerEmailSnapshot,
    sourceChannel: current.sourceChannel,
    fulfilmentLocationId: current.fulfilmentLocationId,
    items: current.items,
    currency: 'NGN',
    deliveryAddressSnapshot: current.deliveryAddressSnapshot,
    notes,
    updatedBy,
    subtotalMinor: current.subtotalMinor,
    discountMinor: current.discountMinor,
    deliveryFeeMinor: current.deliveryFeeMinor,
    totalMinor: current.totalMinor,
  };
}

function createReadBarrier(expected: 'detail' | 'list') {
  let signalReached!: () => void;
  let resumeRead!: () => void;
  const reached = new Promise<void>((resolve) => { signalReached = resolve; });
  const resume = new Promise<void>((resolve) => { resumeRead = resolve; });
  return {
    reached,
    release: resumeRead,
    afterHeaderRead: async (kind: 'detail' | 'list') => {
      if (kind === expected) { signalReached(); await resume; }
    },
  };
}

function snapshotV2(current: OrderRecord, updatedBy: string): OrderAmendmentWriteModel {
  const item = current.items[0];
  if (!item) throw new Error('Snapshot concurrency test requires an order item.');
  return {
    ...amendmentFrom(current, updatedBy, 'snapshot-version-two'),
    items: [{
      ...item,
      productId: otherProductId,
      productVariantId: otherVariantId,
      productNameSnapshot: 'Other Fixture Product',
      skuSnapshot: 'T022-PROD-B',
      unitPriceMinor: '99000',
      lineTotalMinor: '99000',
    }],
    subtotalMinor: '99000',
    totalMinor: '99000',
  };
}

describe('Order database persistence and authenticated API', () => {
  beforeAll(async () => {
    await pool.query('SELECT 1');

    const ownerRole = await pool.query<{ id: string }>("SELECT id FROM roles WHERE code = 'OWNER'");
    const ownerRoleId = ownerRole.rows[0]?.id;
    if (!ownerRoleId) throw new Error('The seeded OWNER role is missing.');

    // Add only the Order permissions this test needs, and remove these exact
    // test-only links afterward. Production role grants remain unchanged.
    const grants = await pool.query<{ role_id: string; permission_id: string }>(
      'INSERT INTO role_permissions(role_id, permission_id) ' +
        'SELECT $1, id FROM permissions WHERE code = ANY($2::text[]) ' +
        'ON CONFLICT DO NOTHING RETURNING role_id, permission_id',
      [
        ownerRoleId,
        ['orders.view', 'orders.create', 'orders.update', 'customers.view', 'products.view'],
      ],
    );
    orderPermissionGrants = grants.rows;

    const additionalReadGrants = await pool.query<{ role_id: string; permission_id: string }>(
      'INSERT INTO role_permissions(role_id, permission_id) ' +
        'SELECT r.id, p.id FROM roles r CROSS JOIN permissions p ' +
        "WHERE r.code = ANY($1::text[]) AND p.code = 'orders.view' " +
        'ON CONFLICT DO NOTHING RETURNING role_id, permission_id',
      [['MANAGER', 'STAFF']],
    );
    orderPermissionGrants.push(...additionalReadGrants.rows);
    const staffUpdateGrants = await pool.query<{ role_id: string; permission_id: string }>(
      'INSERT INTO role_permissions(role_id, permission_id) ' +
        'SELECT r.id, p.id FROM roles r CROSS JOIN permissions p ' +
        "WHERE r.code = 'STAFF' AND p.code = 'orders.update' " +
        'ON CONFLICT DO NOTHING RETURNING role_id, permission_id',
    );
    orderPermissionGrants.push(...staffUpdateGrants.rows);

    actorId = await createUser(ownerEmail, ownerRoleId);
    const staffRole = await pool.query<{ id: string }>("SELECT id FROM roles WHERE code = 'STAFF'");
    if (!staffRole.rows[0]) throw new Error('The seeded STAFF role is missing.');
    await createUser(deniedEmail, staffRole.rows[0].id);
    const assignedStaffId = await createUser(assignedStaffEmail, staffRole.rows[0].id);
    multiLocationStaffId = await createUser(multiLocationStaffEmail, staffRole.rows[0].id);
    const managerRole = await pool.query<{ id: string }>(
      "SELECT id FROM roles WHERE code = 'MANAGER'",
    );
    if (!managerRole.rows[0]) throw new Error('The seeded MANAGER role is missing.');
    await createUser(managerEmail, managerRole.rows[0].id);

    const location = await pool.query<{ id: string }>(
      'INSERT INTO locations(code, name, address) VALUES ($1, $2, $3) RETURNING id',
      [locationCode, 'Task 022 Test Fulfilment Location', 'Lagos, Nigeria'],
    );
    locationId = location.rows[0]?.id ?? '';
    if (!locationId) throw new Error('Task 022 test location was not created.');

    const otherLocation = await pool.query<{ id: string }>(
      'INSERT INTO locations(code, name, address) VALUES ($1, $2, $3) RETURNING id',
      [locationCode + '-OTHER', 'Task 022 Other Active Location', 'Lagos, Nigeria'],
    );
    otherLocationId = otherLocation.rows[0]?.id ?? '';
    if (!otherLocationId) throw new Error('Task 022 other location was not created.');

    const warehouseLocation = await pool.query<{ id: string }>(
      'INSERT INTO locations(code, name, address) VALUES ($1, $2, $3) RETURNING id',
      [locationCode + '-WH', 'Task 022 Warehouse Test Location', 'Lagos, Nigeria'],
    );
    warehouseLocationId = warehouseLocation.rows[0]?.id ?? '';
    if (!warehouseLocationId) throw new Error('Task 022 Warehouse location was not created.');

    const secondAssignedLocation = await pool.query<{ id: string }>(
      'INSERT INTO locations(code, name, address) VALUES ($1, $2, $3) RETURNING id',
      [locationCode + '-S2', 'Task 022 Second Assigned Location', 'Lagos, Nigeria'],
    );
    secondAssignedLocationId = secondAssignedLocation.rows[0]?.id ?? '';
    if (!secondAssignedLocationId) throw new Error('Task 022 second assigned location was not created.');

    const inactiveLocation = await pool.query<{ id: string }>(
      'INSERT INTO locations(code, name, address, is_active) VALUES ($1, $2, $3, false) RETURNING id',
      [locationCode + '-OFF', 'Task 022 Inactive Historical Location', 'Lagos, Nigeria'],
    );
    inactiveLocationId = inactiveLocation.rows[0]?.id ?? '';
    if (!inactiveLocationId) throw new Error('Task 022 inactive location was not created.');

    await pool.query(
      'INSERT INTO user_location_access(user_id, location_id, granted_by) VALUES ($1, $2, $3)',
      [assignedStaffId, locationId, actorId],
    );
    await pool.query(
      'INSERT INTO user_location_access(user_id, location_id, granted_by) VALUES ($1, $2, $3), ($1, $4, $3)',
      [multiLocationStaffId, locationId, actorId, secondAssignedLocationId],
    );

    const customer = await pool.query<{ id: string }>(
      'INSERT INTO customers(full_name, phone, email, created_by, updated_by) ' +
        'VALUES ($1, $2, $3, $4, $4) RETURNING id',
      ['Order Fixture Customer', '+2348000000001', 'order.fixture@example.invalid', actorId],
    );
    customerId = customer.rows[0]?.id ?? '';
    if (!customerId) throw new Error('Task 022 test customer was not created.');

    const product = await createProduct('Order Fixture Product', 'T022-PROD-A', '125000');
    productId = product.productId;
    variantId = product.variantId;
    const other = await createProduct('Other Fixture Product', 'T022-PROD-B', '99000');
    otherProductId = other.productId;
    otherVariantId = other.variantId;
  });

  afterAll(async () => {
    await pool.query('DROP TRIGGER IF EXISTS task022_reject_order_audit ON audit_logs');
    await pool.query('DROP FUNCTION IF EXISTS task022_reject_order_audit_fn()');
    if (orderPermissionGrants.length > 0) {
      await pool.query(
        'DELETE FROM role_permissions rp ' +
          'USING unnest($1::uuid[], $2::uuid[]) AS granted(role_id, permission_id) ' +
          'WHERE rp.role_id = granted.role_id AND rp.permission_id = granted.permission_id',
        [
          orderPermissionGrants.map((grant) => grant.role_id),
          orderPermissionGrants.map((grant) => grant.permission_id),
        ],
      );
    }
  });

  it('creates an order with server-side customer/product snapshots and serves list/detail', async () => {
    const { agent, csrf } = await login(ownerEmail);
    const response = await postWithCsrf(agent, csrf, createOrderBody()).expect(201);
    const order = response.body.data;
    createdOrderId = order.id as string;

    expect(order.status).toBe('received');
    expect(order.currency).toBe('NGN');
    expect(order.customerNameSnapshot).toBe('Order Fixture Customer');
    expect(order.customerPhoneSnapshot).toBe('+2348000000001');
    expect(order.customerEmailSnapshot).toBe('order.fixture@example.invalid');
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({
      productId,
      productVariantId: variantId,
      productNameSnapshot: 'Order Fixture Product',
      variantNameSnapshot: '100 ml',
      skuSnapshot: 'T022-PROD-A',
      unitPriceMinor: '125000',
      quantity: 1,
      lineTotalMinor: '125000',
    });
    expect(order.subtotalMinor).toBe('125000');
    expect(order.totalMinor).toBe('125000');

    await pool.query('UPDATE customers SET full_name = $2, phone = $3, email = $4 WHERE id = $1', [
      customerId,
      'Renamed Customer',
      '+2348000000999',
      'renamed@example.invalid',
    ]);
    await pool.query('UPDATE products SET name = $2 WHERE id = $1', [productId, 'Renamed Product']);
    await pool.query(
      'UPDATE product_variants SET name = $2, sku = $3, selling_price_minor = 999999 ' +
        'WHERE id = $1',
      [variantId, 'Updated Variant', 'T022-UPDATED'],
    );

    const amended = await agent
      .patch('/api/v1/orders/' + createdOrderId)
      .set('Origin', env.APP_ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ notes: 'Amended through authenticated API' })
      .expect(200);
    expect(amended.body.data.status).toBe('received');
    expect(amended.body.data.notes).toBe('Amended through authenticated API');

    const detail = await agent.get('/api/v1/orders/' + createdOrderId).expect(200);
    expect(detail.body.data.customerNameSnapshot).toBe('Order Fixture Customer');
    expect(detail.body.data.customerPhoneSnapshot).toBe('+2348000000001');
    expect(detail.body.data.items[0].productNameSnapshot).toBe('Order Fixture Product');
    expect(detail.body.data.items[0].variantNameSnapshot).toBe('100 ml');
    expect(detail.body.data.items[0].skuSnapshot).toBe('T022-PROD-A');
    expect(detail.body.data.items[0].unitPriceMinor).toBe('125000');

    const list = await agent.get('/api/v1/orders?page=1&pageSize=20').expect(200);
    expect(list.body.data.some((item: { id: string }) => item.id === createdOrderId)).toBe(true);
    expect(list.body.meta.total).toBeGreaterThan(0);

    const audit = await pool.query<{ safe_metadata: Record<string, unknown> }>(
      "SELECT safe_metadata FROM audit_logs WHERE entity_type = 'order' AND entity_id = $1 " +
        "AND action = 'order.created'",
      [createdOrderId],
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0]?.safe_metadata).toMatchObject({
      before: null,
      after: {
        customerId,
        sourceChannel: 'whatsapp',
        status: 'received',
        items: [
          {
            productId,
            productVariantId: variantId,
            productNameSnapshot: 'Order Fixture Product',
            unitPriceMinor: '125000',
          },
        ],
      },
    });
    const amendmentAudit = await pool.query<{ safe_metadata: Record<string, unknown> }>(
      "SELECT safe_metadata FROM audit_logs WHERE entity_type = 'order' AND entity_id = $1 " +
        "AND action = 'order.amended'",
      [createdOrderId],
    );
    expect(amendmentAudit.rowCount).toBe(1);
    expect(amendmentAudit.rows[0]?.safe_metadata).toMatchObject({
      changedFields: ['notes'],
      before: { totalMinor: '125000' },
      after: { totalMinor: '125000' },
    });
  });

  it('scopes Order list and detail reads to server-derived active location access', async () => {
    const assignedOrder = await repository.createReceivedOrder(
      directOrderWrite('assigned-location-order'),
      { actorId, requestId: randomUUID() },
    );
    const unassignedOrder = await repository.createReceivedOrder(
      directOrderWrite('unassigned-location-order', otherLocationId),
      { actorId, requestId: randomUUID() },
    );
    const inactiveHistoricalOrder = await repository.createReceivedOrder(
      directOrderWrite('inactive-location-historical-order', inactiveLocationId),
      { actorId, requestId: randomUUID() },
    );

    const assignedStaff = await login(assignedStaffEmail);
    const staffList = await assignedStaff.agent.get('/api/v1/orders').expect(200);
    const staffRows = staffList.body.data as Array<{
      id: string;
      fulfilmentLocationId: string;
    }>;
    expect(staffRows.some((row) => row.id === assignedOrder.id)).toBe(true);
    expect(staffRows.every((row) => row.fulfilmentLocationId === locationId)).toBe(true);
    expect(staffRows.some((row) => row.id === unassignedOrder.id)).toBe(false);
    expect(staffRows.some((row) => row.id === inactiveHistoricalOrder.id)).toBe(false);

    const clientSelectedUnassignedLocation = await assignedStaff.agent
      .get('/api/v1/orders')
      .query({ fulfilmentLocationId: otherLocationId })
      .expect(200);
    expect(clientSelectedUnassignedLocation.body.data).toEqual([]);
    expect(clientSelectedUnassignedLocation.body.meta.total).toBe(0);

    await assignedStaff.agent.get('/api/v1/orders/' + assignedOrder.id).expect(200);
    const inaccessibleDetail = await assignedStaff.agent
      .get('/api/v1/orders/' + unassignedOrder.id)
      .expect(404);
    const nonexistentDetail = await assignedStaff.agent
      .get('/api/v1/orders/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
      .expect(404);
    expect(inaccessibleDetail.body.error.code).toBe(nonexistentDetail.body.error.code);
    expect(inaccessibleDetail.body.error.message).toBe(nonexistentDetail.body.error.message);

    const owner = await login(ownerEmail);
    const ownerList = await owner.agent.get('/api/v1/orders').expect(200);
    expect(ownerList.body.data.some((row: { id: string }) => row.id === assignedOrder.id)).toBe(
      true,
    );
    expect(ownerList.body.data.some((row: { id: string }) => row.id === unassignedOrder.id)).toBe(
      true,
    );
    expect(
      ownerList.body.data.some((row: { id: string }) => row.id === inactiveHistoricalOrder.id),
    ).toBe(false);
    await owner.agent.get('/api/v1/orders/' + unassignedOrder.id).expect(200);
    await owner.agent.get('/api/v1/orders/' + inactiveHistoricalOrder.id).expect(404);

    const manager = await login(managerEmail);
    const managerList = await manager.agent.get('/api/v1/orders').expect(200);
    expect(managerList.body.data.some((row: { id: string }) => row.id === unassignedOrder.id)).toBe(
      true,
    );
    await manager.agent.get('/api/v1/orders/' + unassignedOrder.id).expect(200);
    await manager.agent.get('/api/v1/orders/' + inactiveHistoricalOrder.id).expect(404);

    const unassignedStaff = await login(deniedEmail);
    const emptyAccessibleList = await unassignedStaff.agent.get('/api/v1/orders').expect(200);
    expect(emptyAccessibleList.body.data).toEqual([]);
    expect(emptyAccessibleList.body.meta.total).toBe(0);
    await unassignedStaff.agent.get('/api/v1/orders/' + assignedOrder.id).expect(404);

    // The existing location policy exposes only active assigned locations to Staff
    // and all active locations to Owner/Manager. Historical orders tied to an
    // inactive location therefore remain hidden until a separate visibility rule
    // is approved; they are never silently included in active-location reads.
  });

  it('returns the same 404 for an unauthorized original Warehouse order and leaves every record unchanged', async () => {
    const order = await repository.createReceivedOrder(
      directOrderWrite('warehouse-original-location', warehouseLocationId),
      { actorId, requestId: randomUUID() },
    );
    const staff = await login(assignedStaffEmail);
    const beforeHeader = await pool.query('SELECT * FROM orders WHERE id = $1', [order.id]);
    const beforeItems = await pool.query(
      'SELECT * FROM order_items WHERE order_id = $1 ORDER BY line_number', [order.id],
    );
    const beforeAudit = await pool.query(
      "SELECT id, request_id, action, safe_metadata FROM audit_logs WHERE entity_type = 'order' AND entity_id = $1 ORDER BY occurred_at, id",
      [order.id],
    );

    const rejected = await staff.agent
      .patch('/api/v1/orders/' + order.id)
      .set('Origin', env.APP_ORIGIN)
      .set('X-CSRF-Token', staff.csrf)
      .send({ fulfilmentLocationId: locationId, notes: 'unauthorized destination change' })
      .expect(404);
    const missingId = randomUUID();
    const nonexistent = await staff.agent
      .patch('/api/v1/orders/' + missingId)
      .set('Origin', env.APP_ORIGIN)
      .set('X-CSRF-Token', staff.csrf)
      .send({ fulfilmentLocationId: locationId, notes: 'same request body' })
      .expect(404);

    expect(rejected.body.error.code).toBe(nonexistent.body.error.code);
    expect(rejected.body.error.message).toBe(nonexistent.body.error.message);
    expect(rejected.body.data).toBeUndefined();
    expect((await pool.query('SELECT * FROM orders WHERE id = $1', [order.id])).rows).toEqual(beforeHeader.rows);
    expect((await pool.query(
      'SELECT * FROM order_items WHERE order_id = $1 ORDER BY line_number', [order.id],
    )).rows).toEqual(beforeItems.rows);
    expect((await pool.query(
      "SELECT id, request_id, action, safe_metadata FROM audit_logs WHERE entity_type = 'order' AND entity_id = $1 ORDER BY occurred_at, id",
      [order.id],
    )).rows).toEqual(beforeAudit.rows);
  });

  it('allows Staff to amend an order at their assigned original fulfilment location', async () => {
    const order = await repository.createReceivedOrder(
      directOrderWrite('assigned-original-location'),
      { actorId, requestId: randomUUID() },
    );
    const staff = await login(assignedStaffEmail);
    const response = await staff.agent
      .patch('/api/v1/orders/' + order.id)
      .set('Origin', env.APP_ORIGIN)
      .set('X-CSRF-Token', staff.csrf)
      .send({ notes: 'assigned-location amendment' })
      .expect(200);
    expect(response.body.data.fulfilmentLocationId).toBe(locationId);
    expect(response.body.data.notes).toBe('assigned-location amendment');
  });

  it('allows a location change only when Staff are assigned to both original and destination', async () => {
    const order = await repository.createReceivedOrder(
      directOrderWrite('two-location-original'),
      { actorId, requestId: randomUUID() },
    );
    const staff = await login(multiLocationStaffEmail);
    const response = await staff.agent
      .patch('/api/v1/orders/' + order.id)
      .set('Origin', env.APP_ORIGIN)
      .set('X-CSRF-Token', staff.csrf)
      .send({ fulfilmentLocationId: secondAssignedLocationId, notes: 'authorized location move' })
      .expect(200);
    expect(response.body.data.fulfilmentLocationId).toBe(secondAssignedLocationId);
    expect(response.body.data.notes).toBe('authorized location move');
  });

  it('keeps detail header and items on one snapshot during a concurrent amendment', async () => {
    const order = await repository.createReceivedOrder(
      directOrderWrite('detail-snapshot-version-one'),
      { actorId, requestId: randomUUID() },
    );
    const barrier = createReadBarrier('detail');
    const reader = new PostgresOrderRepository(pool, { afterHeaderRead: barrier.afterHeaderRead });
    const pendingRead = reader.getOrderForActor(order.id, actorId, 'OWNER');
    await barrier.reached;
    await repository.amendReceivedOrder(
      order.id, { id: actorId, roleCode: 'OWNER' },
      { actorId, requestId: randomUUID() },
      async (current) => snapshotV2(current, actorId),
    );
    barrier.release();
    const snapshot = await pendingRead;
    expect(snapshot.notes).toBe('detail-snapshot-version-one');
    expect(snapshot.totalMinor).toBe('150000');
    expect(snapshot.items[0]).toMatchObject({
      productId, unitPriceMinor: '150000', lineTotalMinor: '150000',
    });
    const latest = await repository.getOrder(order.id);
    expect(latest.notes).toBe('snapshot-version-two');
    expect(latest.totalMinor).toBe('99000');
    expect(latest.items[0]).toMatchObject({ productId: otherProductId, unitPriceMinor: '99000' });
  });

  it('keeps list count, page headers and items on one snapshot during a concurrent amendment', async () => {
    const order = await repository.createReceivedOrder(
      directOrderWrite('list-snapshot-version-one'),
      { actorId, requestId: randomUUID() },
    );
    const barrier = createReadBarrier('list');
    const reader = new PostgresOrderRepository(pool, { afterHeaderRead: barrier.afterHeaderRead });
    const pendingRead = reader.listOrders({
      actorId, actorRoleCode: 'OWNER', page: 1, pageSize: 100,
    });
    await barrier.reached;
    await repository.amendReceivedOrder(
      order.id, { id: actorId, roleCode: 'OWNER' },
      { actorId, requestId: randomUUID() },
      async (current) => snapshotV2(current, actorId),
    );
    barrier.release();
    const page = await pendingRead;
    const snapshot = page.items.find((item) => item.id === order.id);
    expect(snapshot).toBeDefined();
    expect(snapshot?.notes).toBe('list-snapshot-version-one');
    expect(snapshot?.totalMinor).toBe('150000');
    expect(snapshot?.items[0]).toMatchObject({ productId, unitPriceMinor: '150000' });
    expect(page.total).toBeGreaterThan(0);
    const latest = await repository.getOrder(order.id);
    expect(latest.notes).toBe('snapshot-version-two');
    expect(latest.totalMinor).toBe('99000');
  });

  it('rolls back and releases a read snapshot transaction after a read failure', async () => {
    const order = await repository.createReceivedOrder(
      directOrderWrite('read-error-release'),
      { actorId, requestId: randomUUID() },
    );
    const reader = new PostgresOrderRepository(pool, {
      afterHeaderRead: async () => { throw new Error('controlled read checkpoint failure'); },
    });
    await expect(reader.getOrderForActor(order.id, actorId, 'OWNER')).rejects.toThrow(
      'controlled read checkpoint failure',
    );
    expect((await repository.getOrderForActor(order.id, actorId, 'OWNER')).id).toBe(order.id);
  });

  it('rejects archived customers, archived products and mismatched product variants', async () => {
    const { agent, csrf } = await login(ownerEmail);
    await pool.query("UPDATE customers SET status = 'archived' WHERE id = $1", [customerId]);
    await postWithCsrf(agent, csrf, createOrderBody()).expect(409);
    await pool.query("UPDATE customers SET status = 'active' WHERE id = $1", [customerId]);

    await postWithCsrf(agent, csrf, createOrderBody(otherProductId, variantId)).expect(400);

    await pool.query("UPDATE products SET status = 'archived' WHERE id = $1", [productId]);
    await postWithCsrf(agent, csrf, createOrderBody()).expect(409);
    await pool.query("UPDATE products SET status = 'active' WHERE id = $1", [productId]);
  });

  it('enforces permissions, CSRF, strict request validation and UUID checks', async () => {
    const denied = await login(deniedEmail);
    const emptyList = await denied.agent.get('/api/v1/orders').expect(200);
    expect(emptyList.body.data).toEqual([]);
    expect(emptyList.body.meta.total).toBe(0);
    await postWithCsrf(denied.agent, denied.csrf, createOrderBody()).expect(403);
    await denied.agent
      .patch('/api/v1/orders/' + createdOrderId)
      .set('Origin', env.APP_ORIGIN)
      .set('X-CSRF-Token', denied.csrf)
      .send({ notes: 'Not allowed' })
      .expect(403);

    const { agent, csrf } = await login(ownerEmail);
    await agent
      .post('/api/v1/orders')
      .set('Origin', env.APP_ORIGIN)
      .send(createOrderBody())
      .expect(403)
      .then((result) => expect(result.body.error.code).toBe('CSRF_TOKEN_REQUIRED'));

    await agent
      .post('/api/v1/orders')
      .set('Origin', 'https://untrusted.example.invalid')
      .set('X-CSRF-Token', csrf)
      .send(createOrderBody())
      .expect(403)
      .then((result) => expect(result.body.error.code).toBe('CSRF_ORIGIN_REJECTED'));

    await postWithCsrf(agent, csrf, {
      ...createOrderBody(),
      totalMinor: '1',
    })
      .expect(400)
      .then((result) => expect(result.body.error.code).toBe('INVALID_REQUEST'));

    await agent
      .patch('/api/v1/orders/' + createdOrderId)
      .set('Origin', env.APP_ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ status: 'confirmed' })
      .expect(400);

    await agent.get('/api/v1/orders/not-a-uuid').expect(400);
    await agent.get('/api/v1/orders?unknownFilter=true').expect(400);
  });

  it('rejects line totals that overflow PostgreSQL BIGINT before writing', async () => {
    const high = await createProduct(
      'Maximum Price Fixture',
      'T022-PROD-MAX',
      '9223372036854775807',
    );
    highValueProductId = high.productId;
    highValueVariantId = high.variantId;
    const { agent, csrf } = await login(ownerEmail);
    const response = await postWithCsrf(
      agent,
      csrf,
      createOrderBody(highValueProductId, highValueVariantId, 2),
    ).expect(400);
    expect(response.body.error.code).toBe('INVALID_REQUEST');
  });

  it('rolls back header and items when the audit append fails', async () => {
    const requestId = randomUUID();
    const marker = 'audit-failure-' + requestId;
    const amendOrder = await repository.createReceivedOrder(
      directOrderWrite('amend-audit-before'),
      { actorId, requestId: randomUUID() },
    );
    const amendRequestId = randomUUID();
    await pool.query(
      'CREATE OR REPLACE FUNCTION task022_reject_order_audit_fn() RETURNS trigger ' +
        'LANGUAGE plpgsql AS $body$ BEGIN ' +
        "IF NEW.request_id IN ('" +
        requestId +
        "', '" +
        amendRequestId +
        "') THEN RAISE EXCEPTION 'Task 022 forced audit failure' USING ERRCODE = '23514'; " +
        'END IF; RETURN NEW; END; $body$',
    );
    await pool.query('DROP TRIGGER IF EXISTS task022_reject_order_audit ON audit_logs');
    await pool.query(
      'CREATE TRIGGER task022_reject_order_audit BEFORE INSERT ON audit_logs ' +
        'FOR EACH ROW EXECUTE FUNCTION task022_reject_order_audit_fn()',
    );

    try {
      await expect(
        repository.createReceivedOrder(directOrderWrite(marker), {
          actorId,
          requestId,
        }),
      ).rejects.toThrow(/Task 022 forced audit failure/);
      const persisted = await pool.query('SELECT 1 FROM orders WHERE notes = $1', [marker]);
      expect(persisted.rowCount).toBe(0);
      await expect(
        repository.amendReceivedOrder(
          amendOrder.id,
          { id: actorId, roleCode: 'OWNER' },
          { actorId, requestId: amendRequestId },
          async (current) => amendmentFrom(current, actorId, 'amend-audit-after'),
        ),
      ).rejects.toThrow(/Task 022 forced audit failure/);
      const unchanged = await repository.getOrder(amendOrder.id);
      expect(unchanged.notes).toBe('amend-audit-before');
      expect(unchanged.items).toHaveLength(1);
      expect(unchanged.items[0]).toMatchObject({
        productNameSnapshot: 'Captured Integration Product',
        unitPriceMinor: '150000',
        lineTotalMinor: '150000',
      });
      const audit = await pool.query(
        'SELECT 1 FROM audit_logs WHERE request_id = ANY($1::text[])',
        [[requestId, amendRequestId]],
      );
      expect(audit.rowCount).toBe(0);
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS task022_reject_order_audit ON audit_logs');
      await pool.query('DROP FUNCTION IF EXISTS task022_reject_order_audit_fn()');
    }
  });

  it('serializes concurrent amendments and gives the second amendment the latest row', async () => {
    const order = await repository.createReceivedOrder(directOrderWrite('concurrent-base'), {
      actorId,
      requestId: randomUUID(),
    });

    let enteredFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      enteredFirst = resolve;
    });
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = repository.amendReceivedOrder(
      order.id,
      { id: actorId, roleCode: 'OWNER' },
      { actorId, requestId: randomUUID() },
      async (current) => {
        enteredFirst();
        await firstGate;
        return amendmentFrom(current, actorId, 'first-amendment');
      },
    );
    await firstEntered;

    let secondCallbackRan = false;
    let secondSawNotes: string | null = null;
    const second = repository.amendReceivedOrder(
      order.id,
      { id: actorId, roleCode: 'OWNER' },
      { actorId, requestId: randomUUID() },
      async (current) => {
        secondCallbackRan = true;
        secondSawNotes = current.notes;
        return amendmentFrom(current, actorId, (current.notes ?? '') + '|second-amendment');
      },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 75));
    expect(secondCallbackRan).toBe(false);
    releaseFirst();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.notes).toBe('first-amendment');
    expect(secondSawNotes).toBe('first-amendment');
    expect(secondResult.notes).toBe('first-amendment|second-amendment');

    const final = await repository.getOrder(order.id);
    expect(final.notes).toBe('first-amendment|second-amendment');
    const audits = await pool.query(
      "SELECT action FROM audit_logs WHERE entity_type = 'order' AND entity_id = $1 " +
        "AND action = 'order.amended'",
      [order.id],
    );
    expect(audits.rowCount).toBe(2);
  });

  it('rejects amendments after the order leaves received status', async () => {
    const order = await repository.createReceivedOrder(directOrderWrite('status-guard'), {
      actorId,
      requestId: randomUUID(),
    });
    await pool.query("UPDATE orders SET status = 'confirmed' WHERE id = $1", [order.id]);

    let amendmentCallbackRan = false;
    await expect(
      repository.amendReceivedOrder(
        order.id,
        { id: actorId, roleCode: 'OWNER' },
        { actorId, requestId: randomUUID() },
        async (row) => {
        amendmentCallbackRan = true;
        return amendmentFrom(row, actorId, 'must-not-save');
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(amendmentCallbackRan).toBe(false);
    const final = await repository.getOrder(order.id);
    expect(final.status).toBe('confirmed');
    expect(final.notes).toBe('status-guard');
  });
});
