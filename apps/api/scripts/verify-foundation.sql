\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  expected_tables TEXT[] := ARRAY[
    'audit_logs',
    'locations',
    'permissions',
    'role_permissions',
    'roles',
    'user_location_access',
    'user_sessions',
    'users'
  ];
  actual_tables TEXT[];
  actual_roles TEXT[];
  actual_permissions TEXT[];
BEGIN
  SELECT array_agg(table_name ORDER BY table_name)
    INTO actual_tables
    FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_type = 'BASE TABLE'
     AND table_name = ANY(expected_tables);

  IF actual_tables IS DISTINCT FROM expected_tables THEN
    RAISE EXCEPTION 'Foundation table mismatch. Expected %, found %', expected_tables, actual_tables;
  END IF;

  SELECT array_agg(code ORDER BY code)
    INTO actual_roles
    FROM roles;

  IF actual_roles IS DISTINCT FROM ARRAY['MANAGER', 'OWNER', 'STAFF']::TEXT[] THEN
    RAISE EXCEPTION 'Unexpected role seeds: %', actual_roles;
  END IF;

  SELECT array_agg(code ORDER BY code)
    INTO actual_permissions
    FROM permissions
   WHERE code IN ('payments.record', 'payments.verify',
     'inventory.transfer.receive_destination_assigned',
     'inventory.transfer.pickup_warehouse_to_assigned_sheraton');

  IF actual_permissions IS DISTINCT FROM ARRAY[
    'inventory.transfer.pickup_warehouse_to_assigned_sheraton',
    'inventory.transfer.receive_destination_assigned',
    'payments.record',
    'payments.verify'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'Unexpected permission seeds: %', actual_permissions;
  END IF;
END;
$$;

CREATE TEMP TABLE expected_role_permissions (
  role_code TEXT NOT NULL,
  permission_code TEXT NOT NULL,
  PRIMARY KEY (role_code, permission_code)
) ON COMMIT DROP;

INSERT INTO expected_role_permissions(role_code, permission_code) VALUES
  ('OWNER', 'payments.record'),
  ('OWNER', 'payments.verify'),
  ('MANAGER', 'payments.record'),
  ('MANAGER', 'payments.verify'),
  ('STAFF', 'payments.record'),
  ('STAFF', 'inventory.transfer.receive_destination_assigned'),
  ('STAFF', 'inventory.transfer.pickup_warehouse_to_assigned_sheraton');

DO $$
BEGIN
  IF (SELECT count(*) FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE p.code NOT LIKE 'products.%') <> 7 THEN
    RAISE EXCEPTION 'Expected seven role-permission assignments, found %',
      (SELECT count(*) FROM role_permissions);
  END IF;

  IF EXISTS (
    SELECT r.code, p.code
      FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
    EXCEPT
    SELECT role_code, permission_code FROM expected_role_permissions
  ) OR EXISTS (
    SELECT role_code, permission_code FROM expected_role_permissions
    EXCEPT
    SELECT r.code, p.code
      FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
  ) THEN
    RAISE EXCEPTION 'Role-permission assignments do not match the confirmed matrix';
  END IF;
END;
$$;

-- Replay the migration's conflict-safe seed statements in this transaction.
-- The transaction is rolled back at the end, leaving the disposable DB unchanged.
INSERT INTO roles(code, name, description) VALUES
  ('OWNER', 'Owner', 'Full business oversight and global stock-location access.'),
  ('MANAGER', 'Manager', 'Day-to-day management and global stock-location access.'),
  ('STAFF', 'Staff', 'Restricted task-based access and assigned stock-location access.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions(code, description) VALUES
  ('payments.record', 'Record a payment entry; this does not verify receipt of funds.'),
  ('payments.verify', 'Verify a payment entry; only Owner and Manager may do this.'),
  ('inventory.transfer.receive_destination_assigned', 'Confirm receipt only for a transfer addressed to a location assigned to the Staff user.'),
  ('inventory.transfer.pickup_warehouse_to_assigned_sheraton', 'Use only the destination-scoped Warehouse-to-assigned-Sheraton pickup action defined by ADR-016.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM roles r JOIN permissions p ON p.code = 'payments.record'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM roles r JOIN permissions p ON p.code = 'payments.verify'
WHERE r.code IN ('OWNER', 'MANAGER')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'inventory.transfer.receive_destination_assigned',
  'inventory.transfer.pickup_warehouse_to_assigned_sheraton'
)
WHERE r.code = 'STAFF'
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM roles) <> 3
     OR (SELECT count(*) FROM permissions) <> 10
     OR (SELECT count(*) FROM role_permissions) <> 13 THEN
    RAISE EXCEPTION 'Conflict-safe seed replay changed the number of seed records';
  END IF;

  IF EXISTS (
    SELECT r.code, p.code
      FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
    EXCEPT
    SELECT role_code, permission_code FROM expected_role_permissions
  ) OR EXISTS (
    SELECT role_code, permission_code FROM expected_role_permissions
    EXCEPT
    SELECT r.code, p.code
      FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
  ) THEN
    RAISE EXCEPTION 'Conflict-safe seed replay changed the role-permission matrix';
  END IF;
END;
$$;

ROLLBACK;
