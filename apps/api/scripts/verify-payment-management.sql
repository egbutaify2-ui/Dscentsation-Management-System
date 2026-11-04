\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  payment_tables TEXT[];
  amount_type TEXT;
  event_amount_type TEXT;
  required_index_count INTEGER;
  record_permission_grants INTEGER;
  verify_permission_grants INTEGER;
  payment_view_count INTEGER;
BEGIN
  SELECT array_agg(table_name ORDER BY table_name)
    INTO payment_tables
    FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_type = 'BASE TABLE'
     AND table_name IN ('payments', 'payment_events');

  IF payment_tables IS DISTINCT FROM ARRAY['payment_events', 'payments']::TEXT[] THEN
    RAISE EXCEPTION 'Payment Management tables are missing or unexpected: %', payment_tables;
  END IF;

  SELECT data_type INTO amount_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'payments'
     AND column_name = 'amount_minor';
  SELECT data_type INTO event_amount_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'payment_events'
     AND column_name = 'amount_minor';

  IF amount_type IS DISTINCT FROM 'bigint' OR event_amount_type IS DISTINCT FROM 'bigint' THEN
    RAISE EXCEPTION 'Payment and event amounts must use BIGINT integer kobo';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'payments'
       AND column_name IN (
         'order_id', 'currency', 'method', 'reference', 'status', 'recorded_by',
         'occurred_at', 'created_at', 'verified_by', 'verified_at',
         'idempotency_key', 'request_fingerprint'
       )
     GROUP BY table_name HAVING count(*) = 12
  ) THEN
    RAISE EXCEPTION 'Payment attribution, optional details or idempotency columns are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'payment_events'
       AND column_name IN (
         'payment_id', 'event_type', 'amount_minor', 'reason', 'actor_user_id', 'occurred_at'
       )
     GROUP BY table_name HAVING count(*) = 6
  ) THEN
    RAISE EXCEPTION 'Append-only payment event history columns are incomplete';
  END IF;

  SELECT count(*) INTO required_index_count
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname IN (
       'payments_recorded_by_idempotency_key_uq',
       'payments_order_created_idx',
       'payments_order_status_created_idx',
       'payments_recorded_by_created_idx',
       'payments_verified_by_created_idx',
       'payment_events_payment_type_uq',
       'payment_events_payment_occurred_idx',
       'payment_events_actor_occurred_idx'
     );
  IF required_index_count <> 8 THEN
    RAISE EXCEPTION 'Payment indexes are incomplete: expected 8, found %', required_index_count;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payments_no_delete' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payments_no_truncate' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payments_validate_update' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payment_events_no_update' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payment_events_no_delete' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payment_events_no_truncate' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payment_events_validate_insert' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payments_history_consistency' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payment_events_history_consistency' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'orders_payment_total_immutable' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Payment immutability, transition, history or order-total safeguards are incomplete';
  END IF;

  SELECT count(*) INTO record_permission_grants
    FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE p.code = 'payments.record'
     AND r.code IN ('OWNER', 'MANAGER', 'STAFF');
  SELECT count(*) INTO verify_permission_grants
    FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE p.code = 'payments.verify'
     AND r.code IN ('OWNER', 'MANAGER', 'STAFF');
  SELECT count(*) INTO payment_view_count FROM permissions WHERE code = 'payments.view';

  IF record_permission_grants <> 3 OR verify_permission_grants <> 2 THEN
    RAISE EXCEPTION 'Existing payment role grants changed (record %, verify %)',
      record_permission_grants, verify_permission_grants;
  END IF;
  IF payment_view_count <> 0 THEN
    RAISE EXCEPTION 'Task 032 must not invent a payments.view permission or role grant';
  END IF;
END;
$$;

ROLLBACK;
