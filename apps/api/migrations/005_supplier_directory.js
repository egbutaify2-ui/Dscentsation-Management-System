export async function up(pgm) {
  pgm.sql(`
    CREATE SEQUENCE suppliers_supplier_code_seq
      AS BIGINT
      MINVALUE 1
      START WITH 1
      INCREMENT BY 1
      NO CYCLE;

    CREATE TABLE suppliers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      supplier_code VARCHAR(32) NOT NULL UNIQUE
        DEFAULT (
          'SUP-' || CASE
            WHEN nextval('suppliers_supplier_code_seq') < 1000000
              THEN lpad(currval('suppliers_supplier_code_seq')::text, 6, '0')
            ELSE currval('suppliers_supplier_code_seq')::text
          END
        ),
      display_name VARCHAR(200) NOT NULL
        CHECK (
          display_name = btrim(display_name)
          AND length(display_name) BETWEEN 1 AND 200
        ),
      normalized_name VARCHAR(200) NOT NULL
        CHECK (
          normalized_name = lower(normalized_name)
          AND normalized_name = regexp_replace(
            btrim(normalized_name), '[[:space:]]+', ' ', 'g'
          )
          AND length(normalized_name) BETWEEN 1 AND 200
        ),
      status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (supplier_code ~ '^SUP-[0-9]{6,}$')
    );

    CREATE INDEX suppliers_normalized_name_idx
      ON suppliers(normalized_name);
    CREATE INDEX suppliers_status_name_created_idx
      ON suppliers(status, normalized_name, created_at DESC, id);
    CREATE INDEX suppliers_created_at_idx
      ON suppliers(created_at DESC, id);

    CREATE FUNCTION prevent_supplier_hard_delete() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'Supplier records must be deactivated, not deleted'
        USING ERRCODE = '23514',
              CONSTRAINT = 'suppliers_hard_delete_prohibited';
    END;
    $$;

    CREATE TRIGGER suppliers_no_delete
      BEFORE DELETE ON suppliers
      FOR EACH ROW EXECUTE FUNCTION prevent_supplier_hard_delete();

    CREATE FUNCTION prevent_supplier_truncate() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'Supplier records must not be truncated'
        USING ERRCODE = '23514',
              CONSTRAINT = 'suppliers_truncate_prohibited';
    END;
    $$;

    CREATE TRIGGER suppliers_no_truncate
      BEFORE TRUNCATE ON suppliers
      FOR EACH STATEMENT EXECUTE FUNCTION prevent_supplier_truncate();

    CREATE FUNCTION prevent_supplier_code_change() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.supplier_code IS DISTINCT FROM OLD.supplier_code THEN
        RAISE EXCEPTION 'Supplier references are immutable'
          USING ERRCODE = '23514',
                CONSTRAINT = 'suppliers_supplier_code_immutable';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER suppliers_supplier_code_immutable
      BEFORE UPDATE OF supplier_code ON suppliers
      FOR EACH ROW EXECUTE FUNCTION prevent_supplier_code_change();

    INSERT INTO permissions(code, description) VALUES
      ('suppliers.view', 'View and search supplier directory records.'),
      ('suppliers.create', 'Create supplier directory records.'),
      ('suppliers.update', 'Update supplier business names.'),
      ('suppliers.manage_status', 'Activate and deactivate supplier records.')
    ON CONFLICT (code) DO NOTHING;

    -- Supplier permissions are intentionally unassigned to every role.
    -- DMS-DEC-002 remains Pending confirmation.
  `);
}

export async function down(pgm) {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM suppliers) THEN
        RAISE EXCEPTION 'Cannot roll back Supplier Directory while supplier records exist';
      END IF;

      IF EXISTS (
        SELECT 1
          FROM role_permissions rp
          JOIN permissions p ON p.id = rp.permission_id
         WHERE p.code IN (
           'suppliers.view',
           'suppliers.create',
           'suppliers.update',
           'suppliers.manage_status'
         )
      ) THEN
        RAISE EXCEPTION 'Cannot roll back Supplier Directory while supplier permissions are assigned';
      END IF;
    END;
    $$;

    DROP TRIGGER IF EXISTS suppliers_supplier_code_immutable ON suppliers;
    DROP FUNCTION IF EXISTS prevent_supplier_code_change();
    DROP TRIGGER IF EXISTS suppliers_no_truncate ON suppliers;
    DROP FUNCTION IF EXISTS prevent_supplier_truncate();
    DROP TRIGGER IF EXISTS suppliers_no_delete ON suppliers;
    DROP FUNCTION IF EXISTS prevent_supplier_hard_delete();
    DROP TABLE IF EXISTS suppliers;
    DROP SEQUENCE IF EXISTS suppliers_supplier_code_seq;

    DELETE FROM permissions
     WHERE code IN (
       'suppliers.view',
       'suppliers.create',
       'suppliers.update',
       'suppliers.manage_status'
     );
  `);
}
