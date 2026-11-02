\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  supplier_columns INTEGER;
  supplier_permissions TEXT[];
  permission_assignments INTEGER;
BEGIN
  IF to_regclass('public.suppliers') IS NULL THEN
    RAISE EXCEPTION 'Supplier table is missing';
  END IF;

  SELECT count(*)
    INTO supplier_columns
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'suppliers'
     AND column_name IN (
       'id', 'supplier_code', 'display_name', 'normalized_name', 'status',
       'created_by', 'updated_by', 'created_at', 'updated_at'
     );
  IF supplier_columns <> 9 THEN
    RAISE EXCEPTION 'Supplier table has an incomplete supplier-directory schema';
  END IF;

  SELECT array_agg(code ORDER BY code)
    INTO supplier_permissions
    FROM permissions
   WHERE code IN (
     'suppliers.view',
     'suppliers.create',
     'suppliers.update',
     'suppliers.manage_status'
   );
  IF supplier_permissions IS DISTINCT FROM ARRAY[
    'suppliers.create', 'suppliers.manage_status', 'suppliers.update', 'suppliers.view'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'Supplier permission codes are missing or unexpected: %', supplier_permissions;
  END IF;

  SELECT count(*)
    INTO permission_assignments
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
   WHERE p.code LIKE 'suppliers.%';
  IF permission_assignments <> 0 THEN
    RAISE EXCEPTION 'Supplier permissions must not be assigned to any role; found %',
      permission_assignments;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'suppliers'
       AND indexname = 'suppliers_normalized_name_idx'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'suppliers'
       AND indexname = 'suppliers_status_name_created_idx'
  ) THEN
    RAISE EXCEPTION 'Supplier normalized-name or listing indexes are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'suppliers'
       AND t.tgname = 'suppliers_no_delete'
       AND t.tgenabled IN ('O', 'A')
       AND NOT t.tgisinternal
       AND position('BEFORE DELETE' IN pg_get_triggerdef(t.oid)) > 0
       AND position('suppliers_hard_delete_prohibited' IN pg_get_functiondef(t.tgfoid)) > 0
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'suppliers'
       AND t.tgname = 'suppliers_no_truncate'
       AND t.tgenabled IN ('O', 'A')
       AND NOT t.tgisinternal
       AND position('BEFORE TRUNCATE' IN pg_get_triggerdef(t.oid)) > 0
       AND position('suppliers_truncate_prohibited' IN pg_get_functiondef(t.tgfoid)) > 0
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'suppliers'
       AND t.tgname = 'suppliers_supplier_code_immutable'
       AND t.tgenabled IN ('O', 'A')
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Supplier hard-delete, truncate or code-immutability protection is missing';
  END IF;
END;
$$;

ROLLBACK;
