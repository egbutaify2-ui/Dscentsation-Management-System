export async function up(pgm) {
  pgm.sql(`
    CREATE TABLE roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code VARCHAR(40) NOT NULL UNIQUE,
      name VARCHAR(80) NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE permissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code VARCHAR(120) NOT NULL UNIQUE,
      description TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE role_permissions (
      role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
      permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (role_id, permission_id)
    );

    CREATE TABLE users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email_normalized VARCHAR(254) NOT NULL UNIQUE,
      display_name VARCHAR(120) NOT NULL,
      password_hash TEXT NOT NULL,
      role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
      status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'disabled')),
      created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (email_normalized = lower(email_normalized))
    );

    CREATE INDEX users_role_id_idx ON users(role_id);
    CREATE INDEX users_status_idx ON users(status);

    CREATE TABLE locations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code VARCHAR(60) NOT NULL UNIQUE,
      name VARCHAR(160) NOT NULL,
      address TEXT,
      contact_name VARCHAR(120),
      contact_phone VARCHAR(40),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE user_location_access (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      location_id UUID NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
      granted_by UUID REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, location_id)
    );

    CREATE INDEX user_location_access_location_idx ON user_location_access(location_id);

    -- connect-pg-simple needs sid, sess and expire. user_id is derived from
    -- the opaque session payload for revocation/audit correlation.
    CREATE TABLE user_sessions (
      sid VARCHAR(255) NOT NULL PRIMARY KEY,
      sess JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL,
      user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX user_sessions_expire_idx ON user_sessions(expire);
    CREATE INDEX user_sessions_user_id_idx ON user_sessions(user_id);

    CREATE FUNCTION sync_user_session_identity() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      NEW.user_id := NULLIF(NEW.sess->>'userId', '')::UUID;
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER user_sessions_sync_identity
      BEFORE INSERT OR UPDATE OF sess ON user_sessions
      FOR EACH ROW EXECUTE FUNCTION sync_user_session_identity();

    CREATE TABLE audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
      action VARCHAR(160) NOT NULL,
      entity_type VARCHAR(100),
      entity_id UUID,
      request_id VARCHAR(100),
      safe_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (jsonb_typeof(safe_metadata) = 'object')
    );

    CREATE INDEX audit_logs_actor_time_idx ON audit_logs(actor_user_id, occurred_at DESC);
    CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type, entity_id, occurred_at DESC);
    CREATE INDEX audit_logs_action_time_idx ON audit_logs(action, occurred_at DESC);

    CREATE FUNCTION prevent_audit_log_mutation() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'audit_logs is append-only; UPDATE, DELETE and TRUNCATE operations are prohibited';
    END;
    $$;

    CREATE TRIGGER audit_logs_no_update
      BEFORE UPDATE ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

    CREATE TRIGGER audit_logs_no_delete
      BEFORE DELETE ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

    CREATE TRIGGER audit_logs_no_truncate
      BEFORE TRUNCATE ON audit_logs
      FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_log_mutation();

    INSERT INTO roles(code, name, description) VALUES
      ('OWNER', 'Owner', 'Full business oversight and global stock-location access.'),
      ('MANAGER', 'Manager', 'Day-to-day management and global stock-location access.'),
      ('STAFF', 'Staff', 'Restricted task-based access and assigned stock-location access.')
    ON CONFLICT (code) DO NOTHING;

    -- Only permission codes supported by confirmed ADR-006/ADR-016 rules.
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
  `);
}

export async function down(pgm) {
  pgm.sql(`
    DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs;
    DROP TRIGGER IF EXISTS audit_logs_no_delete ON audit_logs;
    DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
    DROP FUNCTION IF EXISTS prevent_audit_log_mutation();
    DROP TABLE IF EXISTS audit_logs;

    DROP TRIGGER IF EXISTS user_sessions_sync_identity ON user_sessions;
    DROP FUNCTION IF EXISTS sync_user_session_identity();
    DROP TABLE IF EXISTS user_sessions;

    DROP TABLE IF EXISTS user_location_access;
    DROP TABLE IF EXISTS locations;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS role_permissions;
    DROP TABLE IF EXISTS permissions;
    DROP TABLE IF EXISTS roles;
  `);
}
