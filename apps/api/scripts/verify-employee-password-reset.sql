\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  reset_columns INTEGER;
  required_indexes INTEGER;
  owner_manage_grants INTEGER;
  non_owner_manage_grants INTEGER;
BEGIN
  IF to_regclass('public.user_password_resets') IS NULL THEN
    RAISE EXCEPTION 'Employee password-reset token table is missing';
  END IF;

  SELECT count(*)
    INTO reset_columns
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'user_password_resets'
     AND column_name IN (
       'id', 'user_id', 'token_hash', 'expires_at',
       'created_by', 'created_at', 'revoked_at', 'consumed_at'
     );
  IF reset_columns <> 8 THEN
    RAISE EXCEPTION 'Employee password-reset token table has an incomplete lifecycle schema';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.user_password_resets'::regclass
       AND conname = 'user_password_resets_token_hash_check'
       AND pg_get_constraintdef(oid) ILIKE '%token_hash%'
       AND pg_get_constraintdef(oid) ILIKE '%64%'
  ) THEN
    RAISE EXCEPTION 'Password-reset token digest format constraint is missing';
  END IF;

  SELECT count(*) INTO required_indexes
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename = 'user_password_resets'
     AND indexname IN (
       'user_password_resets_token_hash_key',
       'user_password_resets_one_open_per_user_idx',
       'user_password_resets_expiry_idx',
       'user_password_resets_user_created_idx'
     );
  IF required_indexes <> 4 THEN
    RAISE EXCEPTION 'Password-reset token uniqueness, open-token or expiry indexes are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'user_password_resets_validate_transition'
       AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'user_password_resets_no_delete'
       AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'user_password_resets_no_truncate'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Password-reset token transition or history-retention triggers are missing';
  END IF;

  SELECT count(*) INTO owner_manage_grants
    FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.code = 'OWNER' AND p.code = 'users.manage';

  SELECT count(*) INTO non_owner_manage_grants
    FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.code IN ('MANAGER', 'STAFF') AND p.code = 'users.manage';

  IF owner_manage_grants <> 1 OR non_owner_manage_grants <> 0 THEN
    RAISE EXCEPTION 'Existing users.manage Owner-only permission grant changed';
  END IF;
END;
$$;

ROLLBACK;
