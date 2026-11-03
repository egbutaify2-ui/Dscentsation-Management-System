import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { createApp } from '../../app.js';
import { findActiveUserById } from '../users/user.service.js';
import {
  canAccessStockLocation,
  canUseWarehouseSheratonPickup,
} from '../roles/location-access.service.js';
import { PostgresOrderRepository } from '../orders/order.postgres.repository.js';

const app = createApp();
const repository = new PostgresOrderRepository();
const suffix = randomUUID();
const password = 'DMS-task022g-synthetic-password';

type Agent = ReturnType<typeof request.agent>;

interface TestAccount {
  id: string;
  email: string;
}

interface TestLocation {
  id: string;
  code: string;
  name: string;
}

let owner: TestAccount;
let manager: TestAccount;
let staff: TestAccount;
let restricted: TestAccount;
let sheratonLocation: TestLocation;
let warehouseLocation: TestLocation;
let otherLocation: TestLocation;
let inactiveLocation: TestLocation;
let customerId = '';
let productId = '';
let variantId = '';
let restrictedPermissionGrants: Array<{ role_id: string; permission_id: string }> = [];

async function createUserWithRole(email: string, roleId: string): Promise<TestAccount> {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const result = await pool.query<{ id: string }>(
    'INSERT INTO users(email_normalized, display_name, password_hash, role_id) ' +
      'VALUES ($1, $2, $3, $4) RETURNING id',
    [email, 'Synthetic location access test account', passwordHash, roleId],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Synthetic location test account was not created.');
  return { id, email };
}

async function createUser(email: string, roleCode: 'OWNER' | 'MANAGER' | 'STAFF') {
  const role = await pool.query<{ id: string }>('SELECT id FROM roles WHERE code = $1', [roleCode]);
  const roleId = role.rows[0]?.id;
  if (!roleId) throw new Error(`Missing seeded role: ${roleCode}`);
  return createUserWithRole(email, roleId);
}

async function createLocation(
  code: string,
  name: string,
  isActive: boolean,
): Promise<TestLocation> {
  const result = await pool.query<{ id: string }>(
    'INSERT INTO locations(code, name, address, contact_name, contact_phone, is_active) ' +
      'VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [
      code,
      name,
      'Synthetic internal address; not a real business address.',
      'Synthetic contact',
      '+2348000000000',
      isActive,
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Synthetic location fixture was not created.');
  return { id, code, name };
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

function postOrder(agent: Agent, csrf: string, fulfilmentLocationId: string) {
  return agent
    .post('/api/v1/orders')
    .set('Origin', env.APP_ORIGIN)
    .set('X-CSRF-Token', csrf)
    .send({
      customerId,
      sourceChannel: 'whatsapp',
      fulfilmentLocationId,
      items: [{ productId, variantId, quantity: 1 }],
    });
}

describe('authenticated fulfilment Location API and Order location enforcement', () => {
  beforeAll(async () => {
    await pool.query('SELECT 1');

    owner = await createUser(`task022g.owner.${suffix}@example.invalid`, 'OWNER');
    manager = await createUser(`task022g.manager.${suffix}@example.invalid`, 'MANAGER');
    staff = await createUser(`task022g.staff.${suffix}@example.invalid`, 'STAFF');

    const restrictedRoleCode = 'T022G_DENIED_' + suffix.replace(/-/g, '').slice(0, 8).toUpperCase();
    const roleResult = await pool.query<{ id: string }>(
      'INSERT INTO roles(code, name, description) VALUES ($1, $2, $3) RETURNING id',
      [
        restrictedRoleCode,
        'Synthetic restricted order test role',
        'Temporary automated-test role; not a production role.',
      ],
    );
    const restrictedRoleId = roleResult.rows[0]?.id;
    if (!restrictedRoleId) throw new Error('Restricted synthetic role was not created.');

    const permissionResult = await pool.query<{ role_id: string; permission_id: string }>(
      'INSERT INTO role_permissions(role_id, permission_id) ' +
        'SELECT $1, id FROM permissions WHERE code = ANY($2::text[]) ' +
        'ON CONFLICT DO NOTHING RETURNING role_id, permission_id',
      [restrictedRoleId, ['orders.create', 'orders.update']],
    );
    restrictedPermissionGrants = permissionResult.rows;
    restricted = await createUserWithRole(
      `task022g.restricted.${suffix}@example.invalid`,
      restrictedRoleId,
    );

    const codeSuffix = suffix.replace(/-/g, '').slice(0, 8).toUpperCase();
    sheratonLocation = await createLocation(
      `T022G-SHER-${codeSuffix}`,
      'Synthetic Sheraton Store Fixture',
      true,
    );
    warehouseLocation = await createLocation(
      `T022G-WH-${codeSuffix}`,
      'Synthetic Ajose Warehouse Fixture',
      true,
    );
    otherLocation = await createLocation(
      `T022G-OTHER-${codeSuffix}`,
      'Synthetic Other Fulfilment Fixture',
      true,
    );
    inactiveLocation = await createLocation(
      `T022G-OFF-${codeSuffix}`,
      'Synthetic Inactive Location Fixture',
      false,
    );

    await pool.query(
      'INSERT INTO user_location_access(user_id, location_id, granted_by) VALUES ($1, $2, $3)',
      [staff.id, sheratonLocation.id, owner.id],
    );

    const customer = await pool.query<{ id: string }>(
      'INSERT INTO customers(full_name, created_by, updated_by) VALUES ($1, $2, $2) RETURNING id',
      ['Synthetic Order Location Customer', owner.id],
    );
    customerId = customer.rows[0]?.id ?? '';
    if (!customerId) throw new Error('Synthetic order customer fixture was not created.');

    const product = await pool.query<{ id: string }>(
      'INSERT INTO products(name, created_by, updated_by) VALUES ($1, $2, $2) RETURNING id',
      ['Synthetic Order Location Product', owner.id],
    );
    productId = product.rows[0]?.id ?? '';
    if (!productId) throw new Error('Synthetic order product fixture was not created.');

    const variant = await pool.query<{ id: string }>(
      'INSERT INTO product_variants(' +
        'product_id, name, unit_of_measure, selling_price_minor, cost_price_minor, currency, ' +
        'is_active, is_default, created_by, updated_by' +
        ") VALUES ($1, 'Synthetic unit', 'unit', 10000, 5000, 'NGN', true, true, $2, $2) " +
        'RETURNING id',
      [productId, owner.id],
    );
    variantId = variant.rows[0]?.id ?? '';
    if (!variantId) throw new Error('Synthetic order variant fixture was not created.');
  });

  afterAll(async () => {
    if (restrictedPermissionGrants.length > 0) {
      await pool.query(
        'DELETE FROM role_permissions rp ' +
          'USING unnest($1::uuid[], $2::uuid[]) AS granted(role_id, permission_id) ' +
          'WHERE rp.role_id = granted.role_id AND rp.permission_id = granted.permission_id',
        [
          restrictedPermissionGrants.map((grant) => grant.role_id),
          restrictedPermissionGrants.map((grant) => grant.permission_id),
        ],
      );
    }
    await pool.end();
  });

  it('requires authentication for location lookup', async () => {
    await request(app).get('/api/v1/locations').expect(401);
  });

  it('returns safe active location fields to Owner and Manager', async () => {
    const ownerSession = await login(owner.email);
    const ownerResponse = await ownerSession.agent.get('/api/v1/locations').expect(200);
    const managerSession = await login(manager.email);
    const managerResponse = await managerSession.agent.get('/api/v1/locations').expect(200);

    for (const response of [ownerResponse, managerResponse]) {
      expect(response.body).toHaveProperty('data');
      expect(response.body).not.toHaveProperty('meta');
      const rows = response.body.data as Array<Record<string, unknown>>;
      const ids = rows.map((location) => location.id);
      expect(ids).toContain(sheratonLocation.id);
      expect(ids).toContain(warehouseLocation.id);
      expect(ids).toContain(otherLocation.id);
      expect(ids).not.toContain(inactiveLocation.id);

      const selected = rows.find((location) => location.id === sheratonLocation.id);
      expect(selected).toEqual({
        id: sheratonLocation.id,
        code: sheratonLocation.code,
        name: `${sheratonLocation.name} (${sheratonLocation.code})`,
        isActive: true,
      });
      expect(selected).not.toHaveProperty('address');
      expect(selected).not.toHaveProperty('contactName');
      expect(selected).not.toHaveProperty('contactPhone');
    }
  });

  it('limits Staff to assigned locations and keeps pickup action-scoped', async () => {
    const staffSession = await login(staff.email);
    const response = await staffSession.agent.get('/api/v1/locations').expect(200);
    expect(response.body.data).toEqual([
      {
        id: sheratonLocation.id,
        code: sheratonLocation.code,
        name: `${sheratonLocation.name} (${sheratonLocation.code})`,
        isActive: true,
      },
    ]);

    const authenticatedStaff = await findActiveUserById(staff.id);
    const authenticatedManager = await findActiveUserById(manager.id);
    const authenticatedOwner = await findActiveUserById(owner.id);
    expect(authenticatedStaff).not.toBeNull();
    expect(authenticatedManager).not.toBeNull();
    expect(authenticatedOwner).not.toBeNull();

    expect(await canAccessStockLocation(authenticatedStaff!, sheratonLocation.id)).toBe(true);
    expect(await canAccessStockLocation(authenticatedStaff!, warehouseLocation.id)).toBe(false);
    expect(await canAccessStockLocation(authenticatedStaff!, otherLocation.id)).toBe(false);
    expect(await canAccessStockLocation(authenticatedManager!, warehouseLocation.id)).toBe(true);
    expect(await canAccessStockLocation(authenticatedOwner!, warehouseLocation.id)).toBe(true);
    expect(await canAccessStockLocation(authenticatedOwner!, inactiveLocation.id)).toBe(false);

    expect(
      await canUseWarehouseSheratonPickup({
        user: authenticatedStaff!,
        transfer: {
          sourceLocationId: warehouseLocation.id,
          destinationLocationId: sheratonLocation.id,
          pickupMode: 'destination_staff_pickup',
        },
        configuredWarehouseLocationId: warehouseLocation.id,
        configuredSheratonLocationIds: [sheratonLocation.id],
      }),
    ).toBe(true);
  });

  it('rejects inactive and unauthorised locations on create and amendment', async () => {
    const ownerWrite = await repository.createReceivedOrder(
      {
        customerId,
        customerNameSnapshot: 'Synthetic Order Location Customer',
        customerPhoneSnapshot: null,
        customerEmailSnapshot: null,
        sourceChannel: 'whatsapp',
        status: 'received',
        fulfilmentLocationId: sheratonLocation.id,
        items: [
          {
            productId,
            productVariantId: variantId,
            productNameSnapshot: 'Synthetic Order Location Product',
            variantNameSnapshot: 'Synthetic unit',
            skuSnapshot: null,
            unitOfMeasureSnapshot: 'unit',
            unitPriceMinor: '10000',
            quantity: 1,
            discountMinor: '0',
            lineTotalMinor: '10000',
          },
        ],
        currency: 'NGN',
        deliveryAddressSnapshot: null,
        notes: null,
        createdBy: owner.id,
        subtotalMinor: '10000',
        discountMinor: '0',
        deliveryFeeMinor: '0',
        totalMinor: '10000',
      },
      { actorId: owner.id, requestId: randomUUID() },
    );

    const restrictedSession = await login(restricted.email);
    const warehouseCreate = await postOrder(
      restrictedSession.agent,
      restrictedSession.csrf,
      warehouseLocation.id,
    ).expect(403);
    expect(warehouseCreate.body.error.code).toBe('LOCATION_ACCESS_DENIED');

    const inactiveCreate = await postOrder(
      restrictedSession.agent,
      restrictedSession.csrf,
      inactiveLocation.id,
    ).expect(403);
    expect(inactiveCreate.body.error.code).toBe('LOCATION_ACCESS_DENIED');

    const unassignedCreate = await postOrder(
      restrictedSession.agent,
      restrictedSession.csrf,
      otherLocation.id,
    ).expect(403);
    expect(unassignedCreate.body.error.code).toBe('LOCATION_ACCESS_DENIED');

    const warehouseAmend = await restrictedSession.agent
      .patch(`/api/v1/orders/${ownerWrite.id}`)
      .set('Origin', env.APP_ORIGIN)
      .set('X-CSRF-Token', restrictedSession.csrf)
      .send({ fulfilmentLocationId: warehouseLocation.id })
      .expect(403);
    expect(warehouseAmend.body.error.code).toBe('LOCATION_ACCESS_DENIED');

    const unchanged = await repository.getOrder(ownerWrite.id);
    expect(unchanged.fulfilmentLocationId).toBe(sheratonLocation.id);
  });
});
