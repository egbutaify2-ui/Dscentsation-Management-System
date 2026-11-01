import type { PoolClient, QueryResultRow } from 'pg';
import { pool } from '../../db/pool.js';
import { appendAuditEvent, type AuditJsonValue } from '../audit/audit.service.js';
import { conflict, invalid, notFound } from './product.errors.js';
import { fromMinorUnits, toMinorUnits } from './product.money.js';

export interface VariantInput {
  name: string;
  sku?: string | null | undefined;
  unitOfMeasure: string;
  sellingPrice: string;
  costPrice: string;
}

export interface ProductCreateInput {
  name: string;
  description?: string | null | undefined;
  internalCode?: string | null | undefined;
  categoryId?: string | null | undefined;
  variant: VariantInput;
}

export interface ProductUpdateInput {
  name?: string | undefined;
  description?: string | null | undefined;
  internalCode?: string | null | undefined;
  categoryId?: string | null | undefined;
}

export interface CategoryCreateInput {
  name: string;
  description?: string | null | undefined;
  parentId?: string | null | undefined;
}

export interface CategoryUpdateInput {
  name?: string | undefined;
  description?: string | null | undefined;
  parentId?: string | null | undefined;
  isActive?: boolean | undefined;
}

export interface VariantUpdateInput {
  name?: string | undefined;
  sku?: string | null | undefined;
  unitOfMeasure?: string | undefined;
  sellingPrice?: string | undefined;
  costPrice?: string | undefined;
}

interface ProductRow extends QueryResultRow {
  id: string;
  name: string;
  description: string | null;
  internal_code: string | null;
  category_id: string | null;
  category_name: string | null;
  status: 'active' | 'archived';
  created_at: Date;
  updated_at: Date;
}

interface VariantRow extends QueryResultRow {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
  unit_of_measure: string;
  selling_price_minor: string;
  cost_price_minor: string;
  currency: string;
  is_active: boolean;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

interface CategoryRow extends QueryResultRow {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  parent_name?: string | null;
  is_active: boolean;
  product_count?: string;
  created_at: Date;
  updated_at: Date;
}

export interface ProductVariant {
  id: string;
  productId: string;
  name: string;
  sku: string | null;
  unitOfMeasure: string;
  sellingPrice: string;
  costPrice: string;
  currency: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  internalCode: string | null;
  categoryId: string | null;
  categoryName: string | null;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  variants: ProductVariant[];
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  parentName: string | null;
  isActive: boolean;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

function variantFromRow(row: VariantRow): ProductVariant {
  return {
    id: row.id,
    productId: row.product_id,
    name: row.name,
    sku: row.sku,
    unitOfMeasure: row.unit_of_measure,
    sellingPrice: fromMinorUnits(row.selling_price_minor),
    costPrice: fromMinorUnits(row.cost_price_minor),
    currency: row.currency,
    isActive: row.is_active,
    isDefault: row.is_default,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function productFromRow(row: ProductRow, variants: ProductVariant[] = []): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    internalCode: row.internal_code,
    categoryId: row.category_id,
    categoryName: row.category_name,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    variants,
  };
}

function categoryFromRow(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    parentId: row.parent_id,
    parentName: row.parent_name ?? null,
    isActive: row.is_active,
    productCount: Number(row.product_count ?? 0),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function inTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
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

async function loadVariants(client: PoolClient, productId: string): Promise<ProductVariant[]> {
  const result = await client.query<VariantRow>(
    `SELECT id, product_id, name, sku, unit_of_measure, selling_price_minor::text,
            cost_price_minor::text, currency, is_active, is_default, created_at, updated_at
       FROM product_variants
      WHERE product_id = $1
      ORDER BY is_default DESC, created_at, id`,
    [productId],
  );
  return result.rows.map(variantFromRow);
}

async function loadProduct(client: PoolClient, productId: string, lock = false): Promise<Product> {
  const result = await client.query<ProductRow>(
    `SELECT p.id, p.name, p.description, p.internal_code, p.category_id,
            c.name AS category_name, p.status, p.created_at, p.updated_at
       FROM products p
       LEFT JOIN product_categories c ON c.id = p.category_id
      WHERE p.id = $1
      ${lock ? 'FOR UPDATE OF p' : ''}`,
    [productId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('The requested product was not found.');
  return productFromRow(row, await loadVariants(client, productId));
}

function productFields(product: Product): Record<string, AuditJsonValue> {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    internalCode: product.internalCode,
    categoryId: product.categoryId,
    categoryName: product.categoryName,
    status: product.status,
  };
}

function categoryFields(category: Category): Record<string, AuditJsonValue> {
  return {
    id: category.id,
    name: category.name,
    description: category.description,
    parentId: category.parentId,
    parentName: category.parentName,
    isActive: category.isActive,
  };
}

function variantFields(variant: ProductVariant): Record<string, AuditJsonValue> {
  return {
    id: variant.id,
    productId: variant.productId,
    name: variant.name,
    sku: variant.sku,
    unitOfMeasure: variant.unitOfMeasure,
    sellingPrice: variant.sellingPrice,
    costPrice: variant.costPrice,
    currency: variant.currency,
    isActive: variant.isActive,
    isDefault: variant.isDefault,
  };
}

async function requireActiveCategory(client: PoolClient, categoryId: string | null): Promise<void> {
  if (!categoryId) return;
  const category = await client.query<{ is_active: boolean }>(
    'SELECT is_active FROM product_categories WHERE id = $1',
    [categoryId],
  );
  if (!category.rows[0]) throw invalid('The selected category does not exist.');
  if (!category.rows[0].is_active) throw conflict('Choose an active product category.');
}

async function checkParentCategory(
  client: PoolClient,
  categoryId: string | null,
  parentId: string | null,
): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(73518021)');
  if (!parentId) return;
  if (parentId === categoryId) throw invalid('A category cannot be its own parent.');
  const parent = await client.query<{ id: string; is_active: boolean }>(
    'SELECT id, is_active FROM product_categories WHERE id = $1 FOR UPDATE',
    [parentId],
  );
  if (!parent.rows[0]) throw invalid('The selected parent category does not exist.');
  if (!parent.rows[0].is_active) throw conflict('Choose an active parent category.');
  if (categoryId) {
    const cycle = await client.query(
      `WITH RECURSIVE descendants(id) AS (
         SELECT id FROM product_categories WHERE id = $1
         UNION
         SELECT child.id
           FROM product_categories child
           JOIN descendants parent ON child.parent_id = parent.id
       )
       SELECT 1 FROM descendants WHERE id = $2 LIMIT 1`,
      [categoryId, parentId],
    );
    if (cycle.rowCount) throw invalid('A category cannot be moved beneath one of its descendants.');
  }
}

export async function listProducts(
  query: string | undefined,
  status: 'active' | 'archived' | undefined,
): Promise<Product[]> {
  const result = await pool.query<ProductRow>(
    `SELECT p.id, p.name, p.description, p.internal_code, p.category_id,
            c.name AS category_name, p.status, p.created_at, p.updated_at
       FROM products p
       LEFT JOIN product_categories c ON c.id = p.category_id
      WHERE ($1::text IS NULL
        OR p.name ILIKE '%' || $1 || '%'
        OR COALESCE(p.internal_code, '') ILIKE '%' || $1 || '%'
        OR EXISTS (
          SELECT 1 FROM product_variants pv
           WHERE pv.product_id = p.id
             AND COALESCE(pv.sku, '') ILIKE '%' || $1 || '%'
        ))
        AND ($2::text IS NULL OR p.status = $2)
      ORDER BY lower(p.name), p.created_at DESC`,
    [query || null, status ?? null],
  );
  if (!result.rows.length) return [];
  const ids = result.rows.map((row) => row.id);
  const variantResult = await pool.query<VariantRow>(
    `SELECT id, product_id, name, sku, unit_of_measure, selling_price_minor::text,
            cost_price_minor::text, currency, is_active, is_default, created_at, updated_at
       FROM product_variants
      WHERE product_id = ANY($1::uuid[])
      ORDER BY is_default DESC, created_at, id`,
    [ids],
  );
  const byProduct = new Map<string, ProductVariant[]>();
  for (const row of variantResult.rows) {
    const list = byProduct.get(row.product_id) ?? [];
    list.push(variantFromRow(row));
    byProduct.set(row.product_id, list);
  }
  return result.rows.map((row) => productFromRow(row, byProduct.get(row.id) ?? []));
}

export async function getProduct(productId: string): Promise<Product> {
  const client = await pool.connect();
  try {
    return await loadProduct(client, productId);
  } finally {
    client.release();
  }
}

export async function listCategories(): Promise<Category[]> {
  const result = await pool.query<CategoryRow>(
    `SELECT c.id, c.name, c.description, c.parent_id, p.name AS parent_name,
            c.is_active, count(pr.id)::text AS product_count, c.created_at, c.updated_at
       FROM product_categories c
       LEFT JOIN product_categories p ON p.id = c.parent_id
       LEFT JOIN products pr ON pr.category_id = c.id
      GROUP BY c.id, p.name
      ORDER BY c.is_active DESC, lower(c.name)`,
  );
  return result.rows.map(categoryFromRow);
}

async function loadCategory(client: PoolClient, categoryId: string): Promise<Category> {
  const result = await client.query<CategoryRow>(
    `SELECT c.id, c.name, c.description, c.parent_id, p.name AS parent_name,
            c.is_active, count(pr.id)::text AS product_count, c.created_at, c.updated_at
       FROM product_categories c
       LEFT JOIN product_categories p ON p.id = c.parent_id
       LEFT JOIN products pr ON pr.category_id = c.id
      WHERE c.id = $1
      GROUP BY c.id, p.name`,
    [categoryId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('The requested category was not found.');
  return categoryFromRow(row);
}

export async function createCategory(
  actorId: string,
  requestId: string,
  input: CategoryCreateInput,
): Promise<Category> {
  return inTransaction(async (client) => {
    const parentId = input.parentId ?? null;
    await checkParentCategory(client, null, parentId);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO product_categories(name, description, parent_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $4) RETURNING id`,
      [input.name, input.description ?? null, parentId, actorId],
    );
    const category = await loadCategory(client, inserted.rows[0]!.id);
    await appendAuditEvent(
      {
        actorUserId: actorId,
        action: 'product.category.created',
        entityType: 'product_category',
        entityId: category.id,
        requestId,
        safeMetadata: { before: null, after: categoryFields(category) },
      },
      client,
    );
    return category;
  });
}

export async function updateCategory(
  actorId: string,
  requestId: string,
  categoryId: string,
  input: CategoryUpdateInput,
): Promise<Category> {
  return inTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(73518021)');
    const locked = await client.query<CategoryRow>(
      'SELECT id FROM product_categories WHERE id = $1 FOR UPDATE',
      [categoryId],
    );
    if (!locked.rows[0]) throw notFound('The requested category was not found.');
    const before = await loadCategory(client, categoryId);
    const parentId = input.parentId === undefined ? before.parentId : input.parentId;
    if (input.parentId !== undefined) await checkParentCategory(client, categoryId, parentId);
    if (input.isActive === true && parentId) {
      const parent = await client.query<{ is_active: boolean }>(
        'SELECT is_active FROM product_categories WHERE id = $1',
        [parentId],
      );
      if (!parent.rows[0]?.is_active)
        throw conflict('An active category must have an active parent.');
    }
    if (input.isActive === false) {
      const children = await client.query(
        'SELECT 1 FROM product_categories WHERE parent_id = $1 AND is_active = true LIMIT 1',
        [categoryId],
      );
      if (children.rowCount) throw conflict('Deactivate or move active child categories first.');
    }
    await client.query(
      `UPDATE product_categories
          SET name = COALESCE($2, name),
              description = CASE WHEN $3::boolean THEN $4 ELSE description END,
              parent_id = $5,
              is_active = COALESCE($6, is_active),
              updated_by = $7,
              updated_at = now()
        WHERE id = $1`,
      [
        categoryId,
        input.name ?? null,
        input.description !== undefined,
        input.description ?? null,
        parentId,
        input.isActive ?? null,
        actorId,
      ],
    );
    const after = await loadCategory(client, categoryId);
    const action =
      after.isActive === before.isActive
        ? 'product.category.updated'
        : after.isActive
          ? 'product.category.activated'
          : 'product.category.deactivated';
    await appendAuditEvent(
      {
        actorUserId: actorId,
        action,
        entityType: 'product_category',
        entityId: categoryId,
        requestId,
        safeMetadata: {
          before: categoryFields(before),
          after: categoryFields(after),
        },
      },
      client,
    );
    return after;
  });
}

export async function createProduct(
  actorId: string,
  requestId: string,
  input: ProductCreateInput,
): Promise<Product> {
  return inTransaction(async (client) => {
    const categoryId = input.categoryId ?? null;
    await requireActiveCategory(client, categoryId);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO products(name, description, internal_code, category_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
      [input.name, input.description ?? null, input.internalCode ?? null, categoryId, actorId],
    );
    const productId = inserted.rows[0]!.id;
    const variant = input.variant;
    const isDefault = true;
    await client.query(
      `INSERT INTO product_variants(
         product_id, name, sku, unit_of_measure, selling_price_minor, cost_price_minor,
         currency, is_default, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5::bigint, $6::bigint, 'NGN', $7, $8, $8)`,
      [
        productId,
        variant.name,
        variant.sku ?? null,
        variant.unitOfMeasure,
        toMinorUnits(variant.sellingPrice),
        toMinorUnits(variant.costPrice),
        isDefault,
        actorId,
      ],
    );
    const product = await loadProduct(client, productId);
    const initialVariant = product.variants[0];
    if (!initialVariant) throw new Error('The product initial variant could not be loaded.');
    await appendAuditEvent(
      {
        actorUserId: actorId,
        action: 'product.created',
        entityType: 'product',
        entityId: productId,
        requestId,
        safeMetadata: {
          before: null,
          after: {
            product: productFields(product),
            initialVariant: variantFields(initialVariant),
          },
        },
      },
      client,
    );
    await appendAuditEvent(
      {
        actorUserId: actorId,
        action: 'product.variant.created',
        entityType: 'product_variant',
        entityId: initialVariant.id,
        requestId,
        safeMetadata: {
          before: null,
          after: variantFields(initialVariant),
        },
      },
      client,
    );
    return product;
  });
}

export async function updateProduct(
  actorId: string,
  requestId: string,
  productId: string,
  input: ProductUpdateInput,
): Promise<Product> {
  return inTransaction(async (client) => {
    const before = await loadProduct(client, productId, true);
    const categoryId = input.categoryId === undefined ? before.categoryId : input.categoryId;
    if (input.categoryId !== undefined && categoryId !== before.categoryId)
      await requireActiveCategory(client, categoryId);
    await client.query(
      `UPDATE products
          SET name = COALESCE($2, name),
              description = CASE WHEN $3::boolean THEN $4 ELSE description END,
              internal_code = CASE WHEN $5::boolean THEN $6 ELSE internal_code END,
              category_id = $7,
              updated_by = $8,
              updated_at = now()
        WHERE id = $1`,
      [
        productId,
        input.name ?? null,
        input.description !== undefined,
        input.description ?? null,
        input.internalCode !== undefined,
        input.internalCode ?? null,
        categoryId,
        actorId,
      ],
    );
    const after = await loadProduct(client, productId);
    await appendAuditEvent(
      {
        actorUserId: actorId,
        action: 'product.updated',
        entityType: 'product',
        entityId: productId,
        requestId,
        safeMetadata: {
          before: productFields(before),
          after: productFields(after),
        },
      },
      client,
    );
    return after;
  });
}

export async function setProductStatus(
  actorId: string,
  requestId: string,
  productId: string,
  status: 'active' | 'archived',
): Promise<Product> {
  return inTransaction(async (client) => {
    const before = await loadProduct(client, productId, true);
    if (before.status === status) return before;
    if (status === 'active' && !before.variants.some((variant) => variant.isActive)) {
      throw conflict('Activate at least one variant before activating this product.');
    }
    await client.query(
      'UPDATE products SET status = $2, updated_by = $3, updated_at = now() WHERE id = $1',
      [productId, status, actorId],
    );
    const after = await loadProduct(client, productId);
    await appendAuditEvent(
      {
        actorUserId: actorId,
        action: status === 'archived' ? 'product.archived' : 'product.activated',
        entityType: 'product',
        entityId: productId,
        requestId,
        safeMetadata: {
          before: productFields(before),
          after: productFields(after),
        },
      },
      client,
    );
    return after;
  });
}

export async function createVariant(
  actorId: string,
  requestId: string,
  productId: string,
  input: VariantInput,
): Promise<ProductVariant> {
  return inTransaction(async (client) => {
    await loadProduct(client, productId, true);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO product_variants(
         product_id, name, sku, unit_of_measure, selling_price_minor, cost_price_minor,
         currency, is_default, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5::bigint, $6::bigint, 'NGN', false, $7, $7)
       RETURNING id`,
      [
        productId,
        input.name,
        input.sku ?? null,
        input.unitOfMeasure,
        toMinorUnits(input.sellingPrice),
        toMinorUnits(input.costPrice),
        actorId,
      ],
    );
    const product = await loadProduct(client, productId);
    const variant = product.variants.find((item) => item.id === inserted.rows[0]!.id);
    if (!variant) throw new Error('The created product variant could not be loaded.');
    await appendAuditEvent(
      {
        actorUserId: actorId,
        action: 'product.variant.created',
        entityType: 'product_variant',
        entityId: variant.id,
        requestId,
        safeMetadata: { before: null, after: variantFields(variant) },
      },
      client,
    );
    return variant;
  });
}

export async function updateVariant(
  actorId: string,
  requestId: string,
  productId: string,
  variantId: string,
  input: VariantUpdateInput,
): Promise<ProductVariant> {
  return inTransaction(async (client) => {
    await loadProduct(client, productId, true);
    const result = await client.query<VariantRow>(
      `SELECT id, product_id, name, sku, unit_of_measure, selling_price_minor::text,
              cost_price_minor::text, currency, is_active, is_default, created_at, updated_at
         FROM product_variants
        WHERE id = $1 AND product_id = $2
        FOR UPDATE`,
      [variantId, productId],
    );
    if (!result.rows[0]) throw notFound('The requested variant was not found for this product.');
    const before = variantFromRow(result.rows[0]);
    await client.query(
      `UPDATE product_variants
          SET name = COALESCE($3, name),
              sku = CASE WHEN $4::boolean THEN $5 ELSE sku END,
              unit_of_measure = COALESCE($6, unit_of_measure),
              selling_price_minor = COALESCE($7::bigint, selling_price_minor),
              cost_price_minor = COALESCE($8::bigint, cost_price_minor),
              updated_by = $9,
              updated_at = now()
        WHERE id = $1 AND product_id = $2`,
      [
        variantId,
        productId,
        input.name ?? null,
        input.sku !== undefined,
        input.sku ?? null,
        input.unitOfMeasure ?? null,
        input.sellingPrice === undefined ? null : toMinorUnits(input.sellingPrice),
        input.costPrice === undefined ? null : toMinorUnits(input.costPrice),
        actorId,
      ],
    );
    const product = await loadProduct(client, productId);
    const after = product.variants.find((item) => item.id === variantId);
    if (!after) throw new Error('The updated product variant could not be loaded.');
    await appendAuditEvent(
      {
        actorUserId: actorId,
        action: 'product.variant.updated',
        entityType: 'product_variant',
        entityId: variantId,
        requestId,
        safeMetadata: {
          before: variantFields(before),
          after: variantFields(after),
        },
      },
      client,
    );
    return after;
  });
}

export async function setVariantActive(
  actorId: string,
  requestId: string,
  productId: string,
  variantId: string,
  isActive: boolean,
): Promise<ProductVariant> {
  return inTransaction(async (client) => {
    const product = await loadProduct(client, productId, true);
    const variantResult = await client.query<VariantRow>(
      `SELECT id, product_id, name, sku, unit_of_measure, selling_price_minor::text,
              cost_price_minor::text, currency, is_active, is_default, created_at, updated_at
         FROM product_variants
        WHERE id = $1 AND product_id = $2
        FOR UPDATE`,
      [variantId, productId],
    );
    if (!variantResult.rows[0])
      throw notFound('The requested variant was not found for this product.');
    const before = variantFromRow(variantResult.rows[0]);
    if (before.isActive === isActive) return before;
    if (!isActive && product.status === 'active') {
      const activeVariants = product.variants.filter((item) => item.isActive);
      if (activeVariants.length <= 1) {
        throw conflict(
          'Archive the product or activate another variant before deactivating this one.',
        );
      }
    }
    await client.query(
      'UPDATE product_variants SET is_active = $3, updated_by = $4, updated_at = now() WHERE id = $1 AND product_id = $2',
      [variantId, productId, isActive, actorId],
    );
    const updated = await loadProduct(client, productId);
    const after = updated.variants.find((item) => item.id === variantId);
    if (!after) throw new Error('The updated product variant could not be loaded.');
    await appendAuditEvent(
      {
        actorUserId: actorId,
        action: isActive ? 'product.variant.activated' : 'product.variant.deactivated',
        entityType: 'product_variant',
        entityId: variantId,
        requestId,
        safeMetadata: {
          before: variantFields(before),
          after: variantFields(after),
        },
      },
      client,
    );
    return after;
  });
}
