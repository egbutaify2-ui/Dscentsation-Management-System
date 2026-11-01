import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { createApp } from '../../app.js';

const app = createApp();
const password = 'DMS-task007-synthetic-password';
const suffix = randomUUID();

interface TestAccount {
  id: string;
  email: string;
}

async function createAccount(roleCode: 'OWNER' | 'MANAGER' | 'STAFF'): Promise<TestAccount> {
  const role = await pool.query<{ id: string }>('SELECT id FROM roles WHERE code = $1', [roleCode]);
  if (!role.rows[0]) throw new Error(`Missing role seed: ${roleCode}`);
  const email = `task007.${roleCode.toLowerCase()}.${suffix}@example.invalid`;
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const inserted = await pool.query<{ id: string }>(
    'INSERT INTO users(email_normalized, display_name, password_hash, role_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [email, `Synthetic ${roleCode}`, hash, role.rows[0].id],
  );
  return { id: inserted.rows[0]!.id, email };
}

function signIn(agent: ReturnType<typeof request.agent>, email: string) {
  return agent.get('/api/v1/auth/csrf').then(async (csrf) => {
    await agent
      .post('/api/v1/auth/login')
      .set('Origin', env.APP_ORIGIN)
      .set('X-CSRF-Token', csrf.body.data.token as string)
      .send({ email, password })
      .expect(200);
  });
}

async function csrf(agent: ReturnType<typeof request.agent>): Promise<string> {
  const response = await agent.get('/api/v1/auth/csrf').expect(200);
  return response.body.data.token as string;
}

async function post(agent: ReturnType<typeof request.agent>, path: string, body: object) {
  return agent
    .post(path)
    .set('Origin', env.APP_ORIGIN)
    .set('X-CSRF-Token', await csrf(agent))
    .send(body);
}

async function patch(agent: ReturnType<typeof request.agent>, path: string, body: object) {
  return agent
    .patch(path)
    .set('Origin', env.APP_ORIGIN)
    .set('X-CSRF-Token', await csrf(agent))
    .send(body);
}

describe('Product Management API', () => {
  let owner: TestAccount;
  let manager: TestAccount;
  let staff: TestAccount;
  let ownerAgent: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    await pool.query('SELECT 1');
    owner = await createAccount('OWNER');
    manager = await createAccount('MANAGER');
    staff = await createAccount('STAFF');
    ownerAgent = request.agent(app);
    await signIn(ownerAgent, owner.email);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('rejects unauthenticated product and category requests', async () => {
    await request(app).get('/api/v1/products').expect(401);
    await request(app).get('/api/v1/categories').expect(401);
  });

  it.each([
    ['Manager', 'manager'],
    ['Staff', 'staff'],
  ] as const)('%s is denied by backend product permission checks', async (_label, role) => {
    const account = role === 'manager' ? manager : staff;
    const agent = request.agent(app);
    await signIn(agent, account.email);
    await agent.get('/api/v1/products').expect(403);
    await agent.get('/api/v1/categories').expect(403);
    await post(agent, '/api/v1/products', {
      name: 'Denied synthetic item',
      variant: {
        name: 'Default',
        unitOfMeasure: 'unit',
        sellingPrice: '10.00',
        costPrice: '5.00',
      },
    }).then((response) => expect(response.status).toBe(403));
  });

  it('creates products manually with a default variant and stores NGN prices as integer kobo', async () => {
    const categoryResponse = await post(ownerAgent, '/api/v1/categories', {
      name: `Synthetic fragrance ${suffix.slice(0, 8)}`,
      description: 'Synthetic category used by automated tests.',
    });
    expect(categoryResponse.status).toBe(201);
    const categoryId = categoryResponse.body.data.id as string;

    const response = await post(ownerAgent, '/api/v1/products', {
      name: `Synthetic Product ${suffix.slice(0, 8)}`,
      description: 'A synthetic test product.',
      internalCode: `DMS-007-${suffix.slice(0, 8)}`,
      categoryId,
      variant: {
        name: 'Default',
        sku: 'DMS-007-DUPLICATE-SKU',
        unitOfMeasure: 'bottle',
        sellingPrice: '1250.50',
        costPrice: '500.25',
      },
    });
    expect(response.status).toBe(201);
    expect(response.body.data.variants).toHaveLength(1);
    expect(response.body.data.variants[0]).toMatchObject({
      name: 'Default',
      unitOfMeasure: 'bottle',
      sellingPrice: '1250.50',
      costPrice: '500.25',
      currency: 'NGN',
      isDefault: true,
    });

    const productId = response.body.data.id as string;
    const stored = await pool.query<{
      selling_price_minor: string;
      cost_price_minor: string;
      currency: string;
      is_default: boolean;
    }>(
      'SELECT selling_price_minor::text, cost_price_minor::text, currency, is_default FROM product_variants WHERE product_id = $1',
      [productId],
    );
    expect(stored.rows[0]).toEqual({
      selling_price_minor: '125050',
      cost_price_minor: '50025',
      currency: 'NGN',
      is_default: true,
    });

    const audit = await pool.query<{
      actor_user_id: string;
      action: string;
      entity_type: string;
      entity_id: string;
      request_id: string;
      safe_metadata: { before: string; after: string };
    }>(
      `SELECT actor_user_id, action, entity_type, entity_id, request_id, safe_metadata
         FROM audit_logs WHERE entity_id = $1 AND action = 'product.created'
         ORDER BY occurred_at DESC LIMIT 1`,
      [productId],
    );
    expect(audit.rows[0]?.actor_user_id).toBe(owner.id);
    expect(audit.rows[0]?.entity_type).toBe('product');
    expect(audit.rows[0]?.entity_id).toBe(productId);
    expect(audit.rows[0]?.request_id).toBe(response.headers['x-request-id']);
    expect(audit.rows[0]?.safe_metadata.before).toBe('null');
    const after = JSON.parse(audit.rows[0]!.safe_metadata.after) as {
      product: { name: string };
      initialVariant: { sellingPrice: string; costPrice: string; currency: string };
    };
    expect(after.product.name).toContain('Synthetic Product');
    expect(after.initialVariant).toMatchObject({
      sellingPrice: '1250.50',
      costPrice: '500.25',
      currency: 'NGN',
    });
    const initialVariantAudit = await pool.query<{
      actor_user_id: string;
      action: string;
      entity_type: string;
      entity_id: string;
      safe_metadata: { before: string; after: string };
    }>(
      `SELECT actor_user_id, action, entity_type, entity_id, safe_metadata
         FROM audit_logs
        WHERE entity_type = 'product_variant'
          AND entity_id = $1
          AND action = 'product.variant.created'`,
      [response.body.data.variants[0].id],
    );
    expect(initialVariantAudit.rows[0]).toMatchObject({
      actor_user_id: owner.id,
      action: 'product.variant.created',
      entity_type: 'product_variant',
      entity_id: response.body.data.variants[0].id,
    });
    expect(JSON.parse(initialVariantAudit.rows[0]!.safe_metadata.before)).toBeNull();

    const details = await ownerAgent.get(`/api/v1/products/${productId}`).expect(200);
    expect(details.body.data.id).toBe(productId);
  });

  it('rejects spoofed actor or audit timestamp fields and invalid money', async () => {
    const spoofed = await post(ownerAgent, '/api/v1/products', {
      name: 'Spoofed product',
      actorUserId: staff.id,
      role: 'OWNER',
      occurredAt: '2000-01-01T00:00:00.000Z',
      variant: {
        name: 'Default',
        unitOfMeasure: 'unit',
        sellingPrice: '1.239',
        costPrice: '1.00',
      },
    });
    expect(spoofed.status).toBe(400);

    const invalidMoney = await post(ownerAgent, '/api/v1/products', {
      name: 'Invalid money product',
      variant: {
        name: 'Default',
        unitOfMeasure: 'unit',
        sellingPrice: '1.239',
        costPrice: '1.00',
      },
    });
    expect(invalidMoney.status).toBe(400);
  });

  it('rejects self-parenting and category cycles', async () => {
    const parent = await post(ownerAgent, '/api/v1/categories', {
      name: `Hierarchy parent ${suffix.slice(0, 6)}`,
    });
    expect(parent.status).toBe(201);
    const child = await post(ownerAgent, '/api/v1/categories', {
      name: `Hierarchy child ${suffix.slice(0, 6)}`,
      parentId: parent.body.data.id,
    });
    expect(child.status).toBe(201);

    const selfParent = await patch(ownerAgent, `/api/v1/categories/${child.body.data.id}`, {
      parentId: child.body.data.id,
    });
    expect(selfParent.status).toBe(400);

    const cycle = await patch(ownerAgent, `/api/v1/categories/${parent.body.data.id}`, {
      parentId: child.body.data.id,
    });
    expect(cycle.status).toBe(400);
  });

  it('audits edits, variant price changes and activation changes with before-and-after values', async () => {
    const created = await post(ownerAgent, '/api/v1/products', {
      name: `Audit target ${suffix.slice(0, 6)}`,
      variant: {
        name: 'Default',
        unitOfMeasure: 'item',
        sellingPrice: '80.00',
        costPrice: '25.00',
      },
    });
    expect(created.status).toBe(201);
    const product = created.body.data as {
      id: string;
      variants: Array<{ id: string; isActive: boolean }>;
    };
    const variantId = product.variants[0]!.id;

    const productUpdate = await patch(ownerAgent, `/api/v1/products/${product.id}`, {
      name: 'Updated audit product',
      description: 'Updated description.',
    });
    expect(productUpdate.status).toBe(200);

    const addedVariant = await post(ownerAgent, `/api/v1/products/${product.id}/variants`, {
      name: '50ml',
      sku: 'DMS-007-DUPLICATE-SKU',
      unitOfMeasure: 'bottle',
      sellingPrice: '100.00',
      costPrice: '40.00',
    });
    expect(addedVariant.status).toBe(201);

    const priceUpdate = await patch(
      ownerAgent,
      `/api/v1/products/${product.id}/variants/${variantId}`,
      { sellingPrice: '95.75', costPrice: '31.20' },
    );
    expect(priceUpdate.status).toBe(200);

    const deactivate = await patch(
      ownerAgent,
      `/api/v1/products/${product.id}/variants/${variantId}/status`,
      { isActive: false },
    );
    expect(deactivate.status).toBe(200);

    const activate = await patch(
      ownerAgent,
      `/api/v1/products/${product.id}/variants/${variantId}/status`,
      { isActive: true },
    );
    expect(activate.status).toBe(200);

    const audit = await pool.query<{
      action: string;
      actor_user_id: string;
      safe_metadata: { before: string; after: string };
    }>(
      `SELECT action, actor_user_id, safe_metadata FROM audit_logs
        WHERE entity_id = $1 AND action IN (
          'product.updated', 'product.variant.created', 'product.variant.updated',
          'product.variant.deactivated', 'product.variant.activated'
        )
        ORDER BY occurred_at`,
      [product.id],
    );
    expect(audit.rows.some((row) => row.action === 'product.updated')).toBe(true);
    const variantAudit = await pool.query<{
      action: string;
      actor_user_id: string;
      entity_id: string;
      safe_metadata: { before: string; after: string };
    }>(
      `SELECT action, actor_user_id, entity_id, safe_metadata FROM audit_logs
        WHERE entity_id = $1 AND action = 'product.variant.updated'`,
      [variantId],
    );
    expect(variantAudit.rows[0]?.actor_user_id).toBe(owner.id);
    const before = JSON.parse(variantAudit.rows[0]!.safe_metadata.before) as {
      sellingPrice: string;
      costPrice: string;
    };
    const after = JSON.parse(variantAudit.rows[0]!.safe_metadata.after) as {
      sellingPrice: string;
      costPrice: string;
    };
    expect(before).toMatchObject({ sellingPrice: '80.00', costPrice: '25.00' });
    expect(after).toMatchObject({ sellingPrice: '95.75', costPrice: '31.20' });
    expect(audit.rows.every((row) => row.actor_user_id === owner.id)).toBe(true);
  });

  it('archives products without deleting products, variants or category associations', async () => {
    const category = await post(ownerAgent, '/api/v1/categories', {
      name: `Archive category ${suffix.slice(0, 6)}`,
    });
    const created = await post(ownerAgent, '/api/v1/products', {
      name: `Archive target ${suffix.slice(0, 6)}`,
      categoryId: category.body.data.id,
      variant: {
        name: 'Default',
        unitOfMeasure: 'unit',
        sellingPrice: '20.00',
        costPrice: '7.50',
      },
    });
    const productId = created.body.data.id as string;
    const archive = await patch(ownerAgent, `/api/v1/products/${productId}/status`, {
      status: 'archived',
    });
    expect(archive.status).toBe(200);
    expect(archive.body.data.status).toBe('archived');

    const rows = await pool.query<{ products: string; variants: string }>(
      `SELECT
         (SELECT count(*)::text FROM products WHERE id = $1) AS products,
         (SELECT count(*)::text FROM product_variants WHERE product_id = $1) AS variants`,
      [productId],
    );
    expect(rows.rows[0]).toEqual({ products: '1', variants: '1' });

    const categoryDeactivate = await patch(
      ownerAgent,
      `/api/v1/categories/${category.body.data.id}`,
      {
        isActive: false,
      },
    );
    expect(categoryDeactivate.status).toBe(200);
    expect(categoryDeactivate.body.data.isActive).toBe(false);
    const categoryProduct = await pool.query(
      'SELECT id FROM products WHERE id = $1 AND category_id = $2',
      [productId, category.body.data.id],
    );
    expect(categoryProduct.rowCount).toBe(1);
  });

  it('supports the all-products filter and validates route identifiers', async () => {
    const all = await ownerAgent.get('/api/v1/products?status=all').expect(200);
    expect(Array.isArray(all.body.data)).toBe(true);
    await ownerAgent.get('/api/v1/products/not-a-uuid').expect(400);
    await ownerAgent
      .patch('/api/v1/categories/not-a-uuid')
      .send({ name: 'Invalid ID' })
      .expect(400);
    await ownerAgent
      .patch('/api/v1/products/not-a-uuid/variants/not-a-uuid')
      .send({ name: 'Invalid ID' })
      .expect(400);
  });

  it('does not impose SKU uniqueness and prevents invalid product-category relationships', async () => {
    const first = await post(ownerAgent, '/api/v1/products', {
      name: `SKU first ${suffix.slice(0, 6)}`,
      variant: {
        name: 'Default',
        sku: 'DMS-007-SHARED-SKU',
        unitOfMeasure: 'unit',
        sellingPrice: '10.00',
        costPrice: '4.00',
      },
    });
    const second = await post(ownerAgent, '/api/v1/products', {
      name: `SKU second ${suffix.slice(0, 6)}`,
      variant: {
        name: 'Default',
        sku: 'DMS-007-SHARED-SKU',
        unitOfMeasure: 'unit',
        sellingPrice: '12.00',
        costPrice: '5.00',
      },
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const invalidCategory = await post(ownerAgent, '/api/v1/products', {
      name: 'Invalid relationship',
      categoryId: randomUUID(),
      variant: {
        name: 'Default',
        unitOfMeasure: 'unit',
        sellingPrice: '1.00',
        costPrice: '0.50',
      },
    });
    expect(invalidCategory.status).toBe(400);
  });
});
