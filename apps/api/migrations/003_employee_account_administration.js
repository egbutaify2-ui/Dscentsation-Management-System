export async function up(pgm) {
  pgm.sql(`
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
    ALTER TABLE users
      ADD CONSTRAINT users_status_check
      CHECK (status IN ('active', 'suspended', 'disabled', 'invited'));

    CREATE TABLE user_invitations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      token_hash CHAR(64) NOT NULL UNIQUE
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),
      expires_at TIMESTAMPTZ NOT NULL,
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      revoked_at TIMESTAMPTZ,
      consumed_at TIMESTAMPTZ,
      CHECK (expires_at > created_at),
      CHECK (revoked_at IS NULL OR consumed_at IS NULL)
    );

    CREATE UNIQUE INDEX user_invitations_one_open_per_user_idx
      ON user_invitations(user_id)
      WHERE revoked_at IS NULL AND consumed_at IS NULL;
    CREATE INDEX user_invitations_expiry_idx ON user_invitations(expires_at);
    CREATE INDEX user_invitations_user_created_idx
      ON user_invitations(user_id, created_at DESC);

    CREATE FUNCTION protect_last_active_owner() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE
      active_owner_count INTEGER;
    BEGIN
      IF OLD.status = 'active'
         AND NEW.status <> 'active'
         AND EXISTS (SELECT 1 FROM roles WHERE id = OLD.role_id AND code = 'OWNER') THEN
        PERFORM pg_advisory_xact_lock(hashtext('dms.last-active-owner'));
        SELECT count(*) INTO active_owner_count
          FROM users u
          JOIN roles r ON r.id = u.role_id
         WHERE r.code = 'OWNER' AND u.status = 'active';

        IF active_owner_count <= 1 THEN
          RAISE EXCEPTION 'The last active Owner account cannot be suspended or disabled'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'users_last_active_owner_protected';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER users_protect_last_active_owner
      BEFORE UPDATE OF status ON users
      FOR EACH ROW EXECUTE FUNCTION protect_last_active_owner();

    CREATE FUNCTION prevent_user_hard_delete() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'User accounts must be deactivated, not deleted'
        USING ERRCODE = '23514',
              CONSTRAINT = 'users_hard_delete_prohibited';
    END;
    $$;

    CREATE TRIGGER users_no_delete
      BEFORE DELETE ON users
      FOR EACH ROW EXECUTE FUNCTION prevent_user_hard_delete();

    INSERT INTO permissions(code, description) VALUES
      ('users.view', 'View Manager and Staff employee accounts and their safe account status.'),
      ('users.manage', 'Invite employees, change employee account status and revoke employee sessions.')
    ON CONFLICT (code) DO NOTHING;

    INSERT INTO role_permissions(role_id, permission_id)
    SELECT r.id, p.id
      FROM roles r
      CROSS JOIN permissions p
     WHERE r.code = 'OWNER'
       AND p.code IN ('users.view', 'users.manage')
    ON CONFLICT DO NOTHING;
  `);
}

export async function down(pgm) {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM users WHERE status = 'invited') THEN
        RAISE EXCEPTION 'Cannot roll back employee administration while invited accounts still exist';
      END IF;
    END;
    $$;

    DROP TRIGGER IF EXISTS users_no_delete ON users;
    DROP FUNCTION IF EXISTS prevent_user_hard_delete();
    DROP TRIGGER IF EXISTS users_protect_last_active_owner ON users;
    DROP FUNCTION IF EXISTS protect_last_active_owner();
    DROP TABLE IF EXISTS user_invitations;

    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
    ALTER TABLE users
      ADD CONSTRAINT users_status_check
      CHECK (status IN ('active', 'suspended', 'disabled'));

    DELETE FROM role_permissions
     WHERE permission_id IN (
       SELECT id FROM permissions WHERE code IN ('users.view', 'users.manage')
     );
    DELETE FROM permissions WHERE code IN ('users.view', 'users.manage');
  `);
}
