\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  invitation_columns INTEGER;
  employee_permissions TEXT[];
  owner_assignments INTEGER;
  non_owner_assignments INTEGER;
  status_constraint TEXT;
BEGIN
  IF to_regclass('public.user_invitations') IS NULL THEN
    RAISE EXCEPTION 'Employee invitation table is missing';
  END IF;

  SELECT count(*)
    INTO invitation_columns
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'user_invitations'
     AND column_name IN (
       'id', 'user_id', 'token_hash', 'expires_at',
       'created_by', 'created_at', 'revoked_at', 'consumed_at'
     );
  IF invitation_columns <> 8 THEN
    RAISE EXCEPTION 'Employee invitation table has an incomplete token lifecycle schema';
  END IF;

  SELECT pg_get_constraintdef(oid)
    INTO status_constraint
    FROM pg_constraint
   WHERE conrelid = 'public.users'::regclass
     AND conname = 'users_status_check';
  IF status_constraint IS NULL OR position('invited' IN status_constraint) = 0 THEN
    RAISE EXCEPTION 'Users status constraint does not permit the pending invited state';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'user_invitations'
       AND indexname = 'user_invitations_token_hash_key'
       AND indexdef ILIKE '%UNIQUE%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'user_invitations'
       AND indexname = 'user_invitations_one_open_per_user_idx'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'user_invitations'
       AND indexname = 'user_invitations_expiry_idx'
  ) THEN
    RAISE EXCEPTION 'Invitation token uniqueness, open-token or expiry indexes are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'users'
       AND t.tgname = 'users_protect_last_active_owner'
       AND t.tgenabled IN ('O', 'A')
       AND NOT t.tgisinternal
       AND position('BEFORE UPDATE OF status' IN pg_get_triggerdef(t.oid)) > 0
       AND position('active_owner_count <= 1' IN pg_get_functiondef(t.tgfoid)) > 0
       AND position('23514' IN pg_get_functiondef(t.tgfoid)) > 0
       AND position('dms.last-active-owner' IN pg_get_functiondef(t.tgfoid)) > 0
  ) THEN
    RAISE EXCEPTION 'Enabled last-active-Owner guard trigger or enforcement function is missing';
  END IF;

  SELECT array_agg(code ORDER BY code)
    INTO employee_permissions
    FROM permissions
   WHERE code IN ('users.view', 'users.manage');
  IF employee_permissions IS DISTINCT FROM ARRAY['users.manage', 'users.view']::TEXT[] THEN
    RAISE EXCEPTION 'Employee administration permissions are missing or unexpected: %', employee_permissions;
  END IF;

  SELECT count(*)
    INTO owner_assignments
    FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.code = 'OWNER' AND p.code IN ('users.view', 'users.manage');

  SELECT count(*)
    INTO non_owner_assignments
    FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.code IN ('MANAGER', 'STAFF') AND p.code IN ('users.view', 'users.manage');

  IF owner_assignments <> 2 OR non_owner_assignments <> 0 THEN
    RAISE EXCEPTION 'Employee administration permissions must be Owner-only; owner %, non-owner %',
      owner_assignments, non_owner_assignments;
  END IF;
END;
$$;

ROLLBACK;
