\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  expense_tables TEXT[];
  expense_permissions TEXT[];
  assigned_permissions INTEGER;
  amount_type TEXT;
  current_revision_fk BOOLEAN;
  immutable_trigger_count INTEGER;
BEGIN
  SELECT array_agg(table_name ORDER BY table_name)
    INTO expense_tables
    FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_type = 'BASE TABLE'
     AND table_name IN ('expense_categories', 'expenses', 'expense_revisions');

  IF expense_tables IS DISTINCT FROM ARRAY[
    'expense_categories', 'expense_revisions', 'expenses'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'Expense Foundation tables are missing or unexpected: %', expense_tables;
  END IF;

  SELECT data_type
    INTO amount_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'expense_revisions'
     AND column_name = 'amount_minor';
  IF amount_type IS DISTINCT FROM 'bigint' THEN
    RAISE EXCEPTION 'Expense amount_minor must use BIGINT integer kobo';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'expense_categories'
       AND indexname = 'expense_categories_name_ci_uidx'
  ) THEN
    RAISE EXCEPTION 'Case-insensitive expense category name uniqueness is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'expenses'::regclass
       AND conname = 'expenses_current_revision_fk'
       AND contype = 'f'
       AND condeferrable = true
       AND condeferred = true
  ) THEN
    RAISE EXCEPTION 'Deferred same-expense current revision foreign key is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'expense_revisions'::regclass
       AND tgname = 'expense_revisions_validate_insert'
       AND tgenabled IN ('O', 'A')
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Expense revision insert validation trigger is missing';
  END IF;

  SELECT count(*)
    INTO immutable_trigger_count
    FROM pg_trigger
   WHERE tgrelid = 'expense_revisions'::regclass
     AND tgname IN (
       'expense_revisions_no_update', 'expense_revisions_no_delete',
       'expense_revisions_no_truncate'
     )
     AND tgenabled IN ('O', 'A')
     AND NOT tgisinternal;
  IF immutable_trigger_count <> 3 THEN
    RAISE EXCEPTION 'Expense revision immutability triggers are incomplete';
  END IF;

  SELECT array_agg(code ORDER BY code)
    INTO expense_permissions
    FROM permissions
   WHERE code IN (
     'expense_categories.view', 'expense_categories.manage',
     'expenses.view', 'expenses.create', 'expenses.update'
   );

  IF expense_permissions IS DISTINCT FROM ARRAY[
    'expense_categories.manage', 'expense_categories.view',
    'expenses.create', 'expenses.update', 'expenses.view'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'Expense permission definitions are missing or unexpected: %', expense_permissions;
  END IF;

  SELECT count(*)
    INTO assigned_permissions
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
   WHERE p.code IN (
     'expense_categories.view', 'expense_categories.manage',
     'expenses.view', 'expenses.create', 'expenses.update'
   );

  IF assigned_permissions <> 0 THEN
    RAISE EXCEPTION 'Expense permissions must not be assigned to a production role; found %', assigned_permissions;
  END IF;

  IF EXISTS (SELECT 1 FROM expense_categories) OR EXISTS (SELECT 1 FROM expenses) THEN
    RAISE EXCEPTION 'Expense Foundation schema verification must run before test/business data exists';
  END IF;
END;
$$;

ROLLBACK;
