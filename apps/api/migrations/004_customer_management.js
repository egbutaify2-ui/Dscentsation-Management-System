export async function up(pgm) {
  pgm.sql(`
    CREATE TABLE customers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      full_name VARCHAR(160) NOT NULL
        CHECK (full_name = btrim(full_name) AND length(full_name) BETWEEN 1 AND 160),
      phone VARCHAR(40)
        CHECK (phone IS NULL OR (phone = btrim(phone) AND length(phone) BETWEEN 1 AND 40)),
      email VARCHAR(254)
        CHECK (email IS NULL OR (email = btrim(email) AND length(email) BETWEEN 3 AND 254)),
      notes VARCHAR(1000)
        CHECK (notes IS NULL OR (notes = btrim(notes) AND length(notes) BETWEEN 1 AND 1000)),
      status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX customers_status_name_created_idx
      ON customers(status, lower(full_name), created_at DESC, id);
    CREATE INDEX customers_phone_idx ON customers(phone) WHERE phone IS NOT NULL;
    CREATE INDEX customers_email_lower_idx ON customers(lower(email)) WHERE email IS NOT NULL;

    CREATE FUNCTION prevent_customer_hard_delete() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'Customer records must be archived, not deleted'
        USING ERRCODE = '23514',
              CONSTRAINT = 'customers_hard_delete_prohibited';
    END;
    $$;

    CREATE TRIGGER customers_no_delete
      BEFORE DELETE ON customers
      FOR EACH ROW EXECUTE FUNCTION prevent_customer_hard_delete();

    INSERT INTO permissions(code, description) VALUES
      ('customers.view', 'View customer profiles and search customer records.'),
      ('customers.create', 'Create customer profiles.'),
      ('customers.update', 'Edit customer profile fields.'),
      ('customers.archive', 'Archive customer profiles without deleting history.')
    ON CONFLICT (code) DO NOTHING;

    -- Customer permissions are intentionally not assigned to any role.
    -- DMS-DEC-002 remains pending confirmation.
  `);
}

export async function down(pgm) {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM customers) THEN
        RAISE EXCEPTION 'Cannot roll back Customer Management while customer records still exist';
      END IF;
    END;
    $$;

    DROP TRIGGER IF EXISTS customers_no_delete ON customers;
    DROP FUNCTION IF EXISTS prevent_customer_hard_delete();
    DROP TABLE IF EXISTS customers;

    DELETE FROM role_permissions
     WHERE permission_id IN (
       SELECT id FROM permissions
        WHERE code IN ('customers.view', 'customers.create', 'customers.update', 'customers.archive')
     );
    DELETE FROM permissions
     WHERE code IN ('customers.view', 'customers.create', 'customers.update', 'customers.archive');
  `);
}
