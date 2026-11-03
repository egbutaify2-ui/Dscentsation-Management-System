\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  order_tables TEXT[];
  order_permissions TEXT[];
  assigned_permissions INTEGER;
  amount_type TEXT;
  order_fk_count INTEGER;
  item_fk_count INTEGER;
  index_count INTEGER;
  trigger_count INTEGER;
  order_status_definition TEXT;
  order_channel_definition TEXT;
BEGIN
  SELECT array_agg(table_name ORDER BY table_name)
    INTO order_tables
    FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_type = 'BASE TABLE'
     AND table_name IN ('orders', 'order_items');

  IF order_tables IS DISTINCT FROM ARRAY['order_items', 'orders']::TEXT[] THEN
    RAISE EXCEPTION 'Order Foundation tables are missing or unexpected: %', order_tables;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'orders'
       AND column_name IN (
         'customer_name_snapshot', 'customer_phone_snapshot', 'customer_email_snapshot'
       )
     GROUP BY table_name HAVING count(*) = 3
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'order_items'
       AND column_name IN (
         'product_name_snapshot', 'variant_name_snapshot', 'sku_snapshot',
         'unit_of_measure_snapshot'
       )
     GROUP BY table_name HAVING count(*) = 4
  ) THEN
    RAISE EXCEPTION 'Customer and product snapshot columns are incomplete';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO order_status_definition
    FROM pg_constraint
   WHERE conrelid = 'orders'::regclass AND conname = 'orders_status_check';
  SELECT pg_get_constraintdef(oid) INTO order_channel_definition
    FROM pg_constraint
   WHERE conrelid = 'orders'::regclass AND conname = 'orders_source_channel_check';
  IF order_status_definition IS NULL
     OR position('received' in order_status_definition) = 0
     OR position('fulfilment_hold' in order_status_definition) = 0
     OR order_channel_definition IS NULL
     OR position('whatsapp' in order_channel_definition) = 0
     OR position('website' in order_channel_definition) = 0 THEN
    RAISE EXCEPTION 'Order source-channel or accepted lifecycle constraints are incomplete';
  END IF;

  SELECT data_type INTO amount_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'orders'
     AND column_name = 'total_minor';
  IF amount_type IS DISTINCT FROM 'bigint' THEN
    RAISE EXCEPTION 'Order total_minor must use BIGINT integer kobo';
  END IF;

  SELECT count(*) INTO order_fk_count
    FROM pg_constraint
   WHERE conrelid = 'orders'::regclass AND contype = 'f';
  SELECT count(*) INTO item_fk_count
    FROM pg_constraint
   WHERE conrelid = 'order_items'::regclass AND contype = 'f';
  IF order_fk_count <> 4 OR item_fk_count <> 4 THEN
    RAISE EXCEPTION 'Order foreign keys are incomplete (headers %, items %)',
      order_fk_count, item_fk_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'orders'::regclass
       AND conname = 'orders_total_matches_components'
       AND contype = 'c'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'order_items'::regclass
       AND conname = 'order_items_total_matches_components'
       AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'Order amount arithmetic constraints are missing';
  END IF;

  SELECT count(*) INTO index_count
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname IN (
       'orders_status_created_idx', 'orders_customer_created_idx',
       'orders_location_created_idx', 'orders_source_created_idx',
       'order_items_product_idx', 'order_items_variant_idx', 'order_items_order_line_idx',
       'product_variants_product_id_id_uidx'
     );
  IF index_count <> 8 THEN
    RAISE EXCEPTION 'Order query indexes are incomplete; found % of 8', index_count;
  END IF;

  SELECT count(*) INTO trigger_count
    FROM pg_trigger
   WHERE tgrelid = 'orders'::regclass
     AND tgname IN ('orders_no_delete', 'orders_no_truncate')
     AND tgenabled IN ('O', 'A')
     AND NOT tgisinternal;
  IF trigger_count <> 2 THEN
    RAISE EXCEPTION 'Order retention triggers are incomplete';
  END IF;

  SELECT array_agg(code ORDER BY code)
    INTO order_permissions
    FROM permissions
   WHERE code IN ('orders.view', 'orders.create', 'orders.update');
  IF order_permissions IS DISTINCT FROM ARRAY[
    'orders.create', 'orders.update', 'orders.view'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'Order permission definitions are missing or unexpected: %', order_permissions;
  END IF;

  SELECT count(*) INTO assigned_permissions
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
   WHERE p.code IN ('orders.view', 'orders.create', 'orders.update');
  IF assigned_permissions <> 0 THEN
    RAISE EXCEPTION 'Order permissions must not be assigned to production roles; found %',
      assigned_permissions;
  END IF;

  IF EXISTS (SELECT 1 FROM orders) OR EXISTS (SELECT 1 FROM order_items) THEN
    RAISE EXCEPTION 'Order schema verification must run before test/business data exists';
  END IF;
END;
$$;

ROLLBACK;
