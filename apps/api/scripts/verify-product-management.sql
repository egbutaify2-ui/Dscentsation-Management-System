\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  product_tables TEXT[];
  product_permissions TEXT[];
  owner_assignments INTEGER;
  non_owner_assignments INTEGER;
BEGIN
  SELECT array_agg(table_name ORDER BY table_name)
    INTO product_tables
    FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_type = 'BASE TABLE'
     AND table_name IN ('product_categories', 'products', 'product_variants');

  IF product_tables IS DISTINCT FROM ARRAY[
    'product_categories', 'product_variants', 'products'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'Product Management tables are missing or unexpected: %', product_tables;
  END IF;

  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'product_variants'
         AND column_name IN ('selling_price_minor', 'cost_price_minor')
         AND data_type = 'bigint') <> 2 THEN
    RAISE EXCEPTION 'Selling and cost prices must be stored as BIGINT minor units';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'product_variants'
       AND indexname = 'product_variants_one_default_idx'
  ) THEN
    RAISE EXCEPTION 'The one-default-variant partial unique index is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'products_require_exactly_one_default'
       AND tgdeferrable = true
       AND tginitdeferred = true
       AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'variants_require_exactly_one_default'
       AND tgdeferrable = true
       AND tginitdeferred = true
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Deferred exactly-one-default-variant enforcement triggers are missing';
  END IF;

  IF position(
       'default_variant_count <> 1'
       IN pg_get_functiondef('assert_product_has_exactly_one_default_variant(uuid)'::regprocedure)
     ) = 0 THEN
    RAISE EXCEPTION 'The deferred database invariant does not enforce exactly one default variant';
  END IF;

  SELECT array_agg(code ORDER BY code)
    INTO product_permissions
    FROM permissions
   WHERE code LIKE 'products.%';

  IF product_permissions IS DISTINCT FROM ARRAY[
    'products.archive',
    'products.categories.manage',
    'products.create',
    'products.update',
    'products.variants.manage',
    'products.view'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'Product Management permissions are missing or unexpected: %', product_permissions;
  END IF;

  SELECT count(*)
    INTO owner_assignments
    FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.code = 'OWNER' AND p.code LIKE 'products.%';

  SELECT count(*)
    INTO non_owner_assignments
    FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.code IN ('MANAGER', 'STAFF') AND p.code LIKE 'products.%';

  IF owner_assignments <> 6 OR non_owner_assignments <> 0 THEN
    RAISE EXCEPTION 'Product permissions must be assigned to Owner only; owner %, non-owner %',
      owner_assignments, non_owner_assignments;
  END IF;
END;
$$;

-- Re-run the conflict-safe Product Management seed to prove it is idempotent.
INSERT INTO permissions(code, description) VALUES
  ('products.view', 'View manually maintained DMS products, categories and variants.'),
  ('products.create', 'Create a product with its initial variant.'),
  ('products.update', 'Edit product details.'),
  ('products.archive', 'Activate or archive products.'),
  ('products.categories.manage', 'Create, edit and deactivate product categories.'),
  ('products.variants.manage', 'Create, edit and activate or deactivate product variants and prices.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  CROSS JOIN permissions p
 WHERE r.code = 'OWNER'
   AND p.code IN (
     'products.view', 'products.create', 'products.update', 'products.archive',
     'products.categories.manage', 'products.variants.manage'
   )
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  owner_assignments INTEGER;
  non_owner_assignments INTEGER;
BEGIN
  SELECT count(*) INTO owner_assignments
    FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.code = 'OWNER' AND p.code LIKE 'products.%';

  SELECT count(*) INTO non_owner_assignments
    FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.code IN ('MANAGER', 'STAFF') AND p.code LIKE 'products.%';

  IF owner_assignments <> 6 OR non_owner_assignments <> 0 THEN
    RAISE EXCEPTION 'Replaying Product Management seeds changed Owner-only permissions';
  END IF;
END;
$$;

ROLLBACK;
