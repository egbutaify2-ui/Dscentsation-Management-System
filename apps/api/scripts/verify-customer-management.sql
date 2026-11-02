\\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  customer_columns INTEGER;
  customer_permissions TEXT[];
  permission_assignments INTEGER;
BEGIN
  IF to_regclass('public.customers') IS NULL THEN
    RAISE EXCEPTION 'Customer table is missing';
  END IF;

  SELECT count(*)
    INTO customer_columns
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'customers'
     AND column_name IN (
       'id', 'full_name', 'phone', 'email', 'notes', 'status',
       'created_by', 'updated_by', 'created_at', 'updated_at'
     );
  IF customer_columns <> 10 THEN
    RAISE EXCEPTION 'Customer table has an incomplete profile/actor schema';
  END IF;

  SELECT array_agg(code ORDER BY code)
    INTO customer_permissions
    FROM permissions
   WHERE code IN ('customers.view', 'customers.create', 'customers.update', 'customers.archive');
  IF customer_permissions IS DISTINCT FROM ARRAY[
    'customers.archive', 'customers.create', 'customers.update', 'customers.view'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'Customer permission codes are missing or unexpected: %', customer_permissions;
  END IF;

  SELECT count(*)
    INTO permission_assignments
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
   WHERE p.code LIKE 'customers.%';
  IF permission_assignments <> 0 THEN
    RAISE EXCEPTION 'Customer permissions must not be assigned to any role; found %', permission_assignments;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'customers'
       AND indexname = 'customers_status_name_created_idx'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'customers'
       AND indexname = 'customers_phone_idx'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'customers'
       AND indexname = 'customers_email_lower_idx'
  ) THEN
    RAISE EXCEPTION 'Customer listing/search indexes are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'customers'
       AND t.tgname = 'customers_no_delete'
       AND t.tgenabled IN ('O', 'A')
       AND NOT t.tgisinternal
       AND position('BEFORE DELETE' IN pg_get_triggerdef(t.oid)) > 0
       AND position('customers_hard_delete_prohibited' IN pg_get_functiondef(t.tgfoid)) > 0
  ) THEN
    RAISE EXCEPTION 'Enabled customer hard-delete protection is missing';
  END IF;
END;
$$;

ROLLBACK;
