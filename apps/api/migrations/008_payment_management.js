export async function up(pgm) {
  pgm.sql(String.raw\`
    CREATE TABLE payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
      amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
      currency CHAR(3) NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
      method VARCHAR(80)
        CHECK (method IS NULL OR (method = btrim(method) AND length(method) BETWEEN 1 AND 80)),
      reference VARCHAR(160)
        CHECK (reference IS NULL OR
          (reference = btrim(reference) AND length(reference) BETWEEN 1 AND 160)),
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'verified')),
      recorded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      verified_by UUID REFERENCES users(id) ON DELETE RESTRICT,
      verified_at TIMESTAMPTZ,
      idempotency_key VARCHAR(128) NOT NULL
        CHECK (idempotency_key = btrim(idempotency_key)
          AND length(idempotency_key) BETWEEN 8 AND 128),
      request_fingerprint CHAR(64) NOT NULL
        CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
      CONSTRAINT payments_verification_attribution_check CHECK (
        (status = 'pending' AND verified_by IS NULL AND verified_at IS NULL)
        OR (status = 'verified' AND verified_by IS NOT NULL AND verified_at IS NOT NULL)
      ),
      CONSTRAINT payments_recorded_by_idempotency_key_uq
        UNIQUE (recorded_by, idempotency_key)
    );

    CREATE INDEX payments_order_created_idx
      ON payments(order_id, created_at DESC, id DESC);
    CREATE INDEX payments_order_status_created_idx
      ON payments(order_id, status, created_at DESC, id);
    CREATE INDEX payments_recorded_by_created_idx
      ON payments(recorded_by, created_at DESC, id);
    CREATE INDEX payments_verified_by_created_idx
      ON payments(verified_by, verified_at DESC, id)
      WHERE verified_by IS NOT NULL;

    CREATE TABLE payment_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
      event_type VARCHAR(20) NOT NULL
        CHECK (event_type IN ('recorded', 'verified')),
      amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
      reason VARCHAR(1000)
        CHECK (reason IS NULL OR (reason = btrim(reason) AND length(reason) BETWEEN 1 AND 1000)),
      actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT payment_events_payment_type_uq UNIQUE (payment_id, event_type)
    );

    CREATE INDEX payment_events_payment_occurred_idx
      ON payment_events(payment_id, occurred_at, id);
    CREATE INDEX payment_events_actor_occurred_idx
      ON payment_events(actor_user_id, occurred_at DESC, id);

    CREATE FUNCTION prevent_payment_hard_delete() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION '% records must be retained for financial history', TG_TABLE_NAME
        USING ERRCODE = '23514',
              CONSTRAINT = TG_TABLE_NAME || '_hard_delete_prohibited';
    END;
    $$;

    CREATE FUNCTION prevent_payment_history_mutation() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'Payment event history is append-only'
        USING ERRCODE = '23514',
              CONSTRAINT = 'payment_events_immutable';
    END;
    $$;

    CREATE FUNCTION enforce_payment_update() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE
      order_total NUMERIC;
      verified_total NUMERIC;
    BEGIN
      IF ROW(
        NEW.id, NEW.order_id, NEW.amount_minor, NEW.currency, NEW.method, NEW.reference,
        NEW.recorded_by, NEW.occurred_at, NEW.created_at, NEW.idempotency_key,
        NEW.request_fingerprint
      ) IS DISTINCT FROM ROW(
        OLD.id, OLD.order_id, OLD.amount_minor, OLD.currency, OLD.method, OLD.reference,
        OLD.recorded_by, OLD.occurred_at, OLD.created_at, OLD.idempotency_key,
        OLD.request_fingerprint
      ) THEN
        RAISE EXCEPTION 'Recorded payment details are immutable'
          USING ERRCODE = '23514',
                CONSTRAINT = 'payments_recorded_fields_immutable';
      END IF;

      IF OLD.status <> 'pending'
         OR NEW.status <> 'verified'
         OR OLD.verified_by IS NOT NULL
         OR OLD.verified_at IS NOT NULL
         OR NEW.verified_by IS NULL
         OR NEW.verified_at IS NULL THEN
        RAISE EXCEPTION 'A pending payment may be verified exactly once'
          USING ERRCODE = '23514',
                CONSTRAINT = 'payments_single_verification';
      END IF;

      SELECT total_minor::numeric
        INTO order_total
        FROM orders
       WHERE id = OLD.order_id
       FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'The payment order no longer exists'
          USING ERRCODE = '23503',
                CONSTRAINT = 'payments_order_id_fkey';
      END IF;

      SELECT COALESCE(sum(amount_minor), 0)::numeric
        INTO verified_total
        FROM payments
       WHERE order_id = OLD.order_id
         AND status = 'verified'
         AND id <> OLD.id;

      IF verified_total + NEW.amount_minor::numeric > order_total THEN
        RAISE EXCEPTION 'Verifying this payment would exceed the order total'
          USING ERRCODE = '23514',
                CONSTRAINT = 'payments_verified_total_limit';
      END IF;

      RETURN NEW;
    END;
    $$;

    CREATE FUNCTION enforce_payment_event_insert() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE
      payment_amount BIGINT;
      payment_status VARCHAR(20);
      payment_recorder UUID;
      payment_verifier UUID;
    BEGIN
      SELECT amount_minor, status, recorded_by, verified_by
        INTO payment_amount, payment_status, payment_recorder, payment_verifier
        FROM payments
       WHERE id = NEW.payment_id
       FOR SHARE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment event must reference an existing payment'
          USING ERRCODE = '23503',
                CONSTRAINT = 'payment_events_payment_id_fkey';
      END IF;

      IF NEW.amount_minor <> payment_amount THEN
        RAISE EXCEPTION 'Payment event amount must match the immutable payment amount'
          USING ERRCODE = '23514',
                CONSTRAINT = 'payment_events_amount_matches_payment';
      END IF;

      IF NEW.event_type = 'recorded'
         AND (payment_status <> 'pending' OR NEW.actor_user_id <> payment_recorder) THEN
        RAISE EXCEPTION 'Recorded event attribution does not match the pending payment'
          USING ERRCODE = '23514',
                CONSTRAINT = 'payment_events_recorded_attribution';
      END IF;

      IF NEW.event_type = 'verified'
         AND (payment_status <> 'verified' OR NEW.actor_user_id <> payment_verifier) THEN
        RAISE EXCEPTION 'Verification event attribution does not match the verified payment'
          USING ERRCODE = '23514',
                CONSTRAINT = 'payment_events_verified_attribution';
      END IF;

      RETURN NEW;
    END;
    $$;

    CREATE FUNCTION enforce_payment_history_consistency() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE
      payment_key UUID;
      payment_status VARCHAR(20);
      payment_amount BIGINT;
      payment_recorder UUID;
      payment_verifier UUID;
      recorded_events INTEGER;
      verified_events INTEGER;
    BEGIN
      IF TG_TABLE_NAME = 'payments' THEN
        payment_key := NEW.id;
      ELSE
        payment_key := NEW.payment_id;
      END IF;

      SELECT status, amount_minor, recorded_by, verified_by
        INTO payment_status, payment_amount, payment_recorder, payment_verifier
        FROM payments
       WHERE id = payment_key;

      IF NOT FOUND THEN
        RETURN NULL;
      END IF;

      SELECT count(*) FILTER (
               WHERE event_type = 'recorded'
                 AND amount_minor = payment_amount
                 AND actor_user_id = payment_recorder
             ),
             count(*) FILTER (
               WHERE event_type = 'verified'
                 AND amount_minor = payment_amount
                 AND actor_user_id = payment_verifier
             )
        INTO recorded_events, verified_events
        FROM payment_events
       WHERE payment_id = payment_key;

      IF recorded_events <> 1
         OR (payment_status = 'pending' AND verified_events <> 0)
         OR (payment_status = 'verified' AND verified_events <> 1) THEN
        RAISE EXCEPTION 'Payment state and immutable event history are inconsistent'
          USING ERRCODE = '23514',
                CONSTRAINT = 'payments_history_consistency';
      END IF;

      RETURN NULL;
    END;
    $$;

    CREATE FUNCTION prevent_order_total_change_with_payments() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.total_minor IS DISTINCT FROM OLD.total_minor
         AND EXISTS (SELECT 1 FROM payments WHERE order_id = OLD.id) THEN
        RAISE EXCEPTION 'An order total cannot change after a payment entry is recorded'
          USING ERRCODE = '23514',
                CONSTRAINT = 'orders_total_immutable_after_payment';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER payments_no_delete
      BEFORE DELETE ON payments
      FOR EACH ROW EXECUTE FUNCTION prevent_payment_hard_delete();
    CREATE TRIGGER payments_no_truncate
      BEFORE TRUNCATE ON payments
      FOR EACH STATEMENT EXECUTE FUNCTION prevent_payment_hard_delete();
    CREATE TRIGGER payments_validate_update
      BEFORE UPDATE ON payments
      FOR EACH ROW EXECUTE FUNCTION enforce_payment_update();

    CREATE TRIGGER payment_events_validate_insert
      BEFORE INSERT ON payment_events
      FOR EACH ROW EXECUTE FUNCTION enforce_payment_event_insert();
    CREATE TRIGGER payment_events_no_update
      BEFORE UPDATE ON payment_events
      FOR EACH ROW EXECUTE FUNCTION prevent_payment_history_mutation();
    CREATE TRIGGER payment_events_no_delete
      BEFORE DELETE ON payment_events
      FOR EACH ROW EXECUTE FUNCTION prevent_payment_history_mutation();
    CREATE TRIGGER payment_events_no_truncate
      BEFORE TRUNCATE ON payment_events
      FOR EACH STATEMENT EXECUTE FUNCTION prevent_payment_history_mutation();

    CREATE CONSTRAINT TRIGGER payments_history_consistency
      AFTER INSERT OR UPDATE ON payments
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION enforce_payment_history_consistency();
    CREATE CONSTRAINT TRIGGER payment_events_history_consistency
      AFTER INSERT ON payment_events
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION enforce_payment_history_consistency();

    CREATE TRIGGER orders_payment_total_immutable
      BEFORE UPDATE ON orders
      FOR EACH ROW EXECUTE FUNCTION prevent_order_total_change_with_payments();
  \`);
}

export async function down(pgm) {
  pgm.sql(String.raw\`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM payments) OR EXISTS (SELECT 1 FROM payment_events) THEN
        RAISE EXCEPTION 'Cannot roll back Payment Management while payment history exists';
      END IF;
    END;
    $$;

    DROP TRIGGER IF EXISTS orders_payment_total_immutable ON orders;
    DROP TRIGGER IF EXISTS payment_events_history_consistency ON payment_events;
    DROP TRIGGER IF EXISTS payments_history_consistency ON payments;
    DROP TRIGGER IF EXISTS payment_events_no_truncate ON payment_events;
    DROP TRIGGER IF EXISTS payment_events_no_delete ON payment_events;
    DROP TRIGGER IF EXISTS payment_events_no_update ON payment_events;
    DROP TRIGGER IF EXISTS payment_events_validate_insert ON payment_events;
    DROP TRIGGER IF EXISTS payments_validate_update ON payments;
    DROP TRIGGER IF EXISTS payments_no_truncate ON payments;
    DROP TRIGGER IF EXISTS payments_no_delete ON payments;

    DROP TABLE IF EXISTS payment_events;
    DROP TABLE IF EXISTS payments;

    DROP FUNCTION IF EXISTS prevent_order_total_change_with_payments();
    DROP FUNCTION IF EXISTS enforce_payment_history_consistency();
    DROP FUNCTION IF EXISTS enforce_payment_event_insert();
    DROP FUNCTION IF EXISTS enforce_payment_update();
    DROP FUNCTION IF EXISTS prevent_payment_history_mutation();
    DROP FUNCTION IF EXISTS prevent_payment_hard_delete();
  \`);
}
