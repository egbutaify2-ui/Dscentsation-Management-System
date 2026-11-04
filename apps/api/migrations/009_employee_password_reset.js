export async function up(pgm) {
  pgm.sql(`
    CREATE TABLE user_password_resets (
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

    CREATE UNIQUE INDEX user_password_resets_one_open_per_user_idx
      ON user_password_resets(user_id)
      WHERE revoked_at IS NULL AND consumed_at IS NULL;
    CREATE INDEX user_password_resets_expiry_idx
      ON user_password_resets(expires_at);
    CREATE INDEX user_password_resets_user_created_idx
      ON user_password_resets(user_id, created_at DESC);

    CREATE FUNCTION enforce_user_password_reset_transition() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF ROW(
        NEW.id, NEW.user_id, NEW.token_hash, NEW.expires_at,
        NEW.created_by, NEW.created_at
      ) IS DISTINCT FROM ROW(
        OLD.id, OLD.user_id, OLD.token_hash, OLD.expires_at,
        OLD.created_by, OLD.created_at
      ) THEN
        RAISE EXCEPTION 'Password-reset token identity and expiry are immutable'
          USING ERRCODE = '23514',
                CONSTRAINT = 'user_password_resets_immutable_fields';
      END IF;

      IF OLD.revoked_at IS NOT NULL OR OLD.consumed_at IS NOT NULL THEN
        RAISE EXCEPTION 'A revoked or consumed password-reset token is terminal'
          USING ERRCODE = '23514',
                CONSTRAINT = 'user_password_resets_terminal_state';
      END IF;

      IF NOT (
        (NEW.revoked_at IS NOT NULL AND NEW.consumed_at IS NULL)
        OR (NEW.revoked_at IS NULL AND NEW.consumed_at IS NOT NULL)
      ) THEN
        RAISE EXCEPTION 'An unused password-reset token may be revoked or consumed exactly once'
          USING ERRCODE = '23514',
                CONSTRAINT = 'user_password_resets_single_terminal_transition';
      END IF;

      RETURN NEW;
    END;
    $$;

    CREATE FUNCTION prevent_user_password_reset_history_mutation() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'Password-reset token history is retained and cannot be deleted'
        USING ERRCODE = '23514',
              CONSTRAINT = 'user_password_resets_history_immutable';
    END;
    $$;

    CREATE TRIGGER user_password_resets_validate_transition
      BEFORE UPDATE ON user_password_resets
      FOR EACH ROW EXECUTE FUNCTION enforce_user_password_reset_transition();
    CREATE TRIGGER user_password_resets_no_delete
      BEFORE DELETE ON user_password_resets
      FOR EACH ROW EXECUTE FUNCTION prevent_user_password_reset_history_mutation();
    CREATE TRIGGER user_password_resets_no_truncate
      BEFORE TRUNCATE ON user_password_resets
      FOR EACH STATEMENT EXECUTE FUNCTION prevent_user_password_reset_history_mutation();
  `);
}

export async function down(pgm) {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM user_password_resets)
         OR EXISTS (
           SELECT 1 FROM audit_logs
            WHERE action IN ('user.password_reset.issued', 'user.password_reset.consumed')
         ) THEN
        RAISE EXCEPTION 'Cannot roll back Employee Password Reset while reset-token or audit history exists';
      END IF;
    END;
    $$;

    DROP TRIGGER IF EXISTS user_password_resets_no_truncate ON user_password_resets;
    DROP TRIGGER IF EXISTS user_password_resets_no_delete ON user_password_resets;
    DROP TRIGGER IF EXISTS user_password_resets_validate_transition ON user_password_resets;

    DROP TABLE IF EXISTS user_password_resets;

    DROP FUNCTION IF EXISTS prevent_user_password_reset_history_mutation();
    DROP FUNCTION IF EXISTS enforce_user_password_reset_transition();
  `);
}
