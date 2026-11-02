export async function up(pgm) {
  pgm.sql(`
    CREATE TABLE expense_categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code VARCHAR(40) NOT NULL UNIQUE
        CHECK (code = btrim(code) AND length(code) BETWEEN 1 AND 40),
      name VARCHAR(100) NOT NULL
        CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 100),
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX expense_categories_name_ci_uidx
      ON expense_categories(lower(name));
    CREATE INDEX expense_categories_active_name_idx
      ON expense_categories(is_active, lower(name), id);

    CREATE FUNCTION prevent_expense_master_hard_delete() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION '% records cannot be hard-deleted', TG_TABLE_NAME
        USING ERRCODE = '23514',
              CONSTRAINT = TG_TABLE_NAME || '_hard_delete_prohibited';
    END;
    $$;

    CREATE FUNCTION prevent_expense_master_truncate() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION '% records cannot be truncated', TG_TABLE_NAME
        USING ERRCODE = '23514';
    END;
    $$;

    CREATE TRIGGER expense_categories_no_delete
      BEFORE DELETE ON expense_categories
      FOR EACH ROW EXECUTE FUNCTION prevent_expense_master_hard_delete();
    CREATE TRIGGER expense_categories_no_truncate
      BEFORE TRUNCATE ON expense_categories
      FOR EACH STATEMENT EXECUTE FUNCTION prevent_expense_master_truncate();

    CREATE TABLE expenses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status = 'draft'),
      current_revision_id UUID NOT NULL,
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX expenses_status_created_idx
      ON expenses(status, created_at DESC, id);

    CREATE TABLE expense_revisions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE RESTRICT,
      revision_number INTEGER NOT NULL CHECK (revision_number > 0),
      category_id UUID NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
      description TEXT NOT NULL
        CHECK (length(btrim(description)) BETWEEN 1 AND 5000),
      amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
      currency CHAR(3) NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
      incurred_on DATE NOT NULL,
      payee_name VARCHAR(200) NOT NULL
        CHECK (payee_name = btrim(payee_name) AND length(payee_name) BETWEEN 1 AND 200),
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT expense_revisions_expense_revision_uq UNIQUE (expense_id, revision_number),
      CONSTRAINT expense_revisions_expense_id_id_uq UNIQUE (expense_id, id)
    );

    CREATE INDEX expense_revisions_expense_created_idx
      ON expense_revisions(expense_id, revision_number);
    CREATE INDEX expense_revisions_category_idx
      ON expense_revisions(category_id);
    CREATE INDEX expense_revisions_incurred_on_idx
      ON expense_revisions(incurred_on DESC);

    ALTER TABLE expenses
      ADD CONSTRAINT expenses_current_revision_fk
      FOREIGN KEY (id, current_revision_id)
      REFERENCES expense_revisions(expense_id, id)
      DEFERRABLE INITIALLY DEFERRED;

    CREATE FUNCTION enforce_expense_revision_insert() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE
      parent_status VARCHAR(20);
      category_active BOOLEAN;
      expected_revision INTEGER;
    BEGIN
      SELECT status
        INTO parent_status
        FROM expenses
       WHERE id = NEW.expense_id
       FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Expense revision must belong to an existing expense'
          USING ERRCODE = '23503',
                CONSTRAINT = 'expense_revisions_expense_id_fkey';
      END IF;

      IF parent_status <> 'draft' THEN
        RAISE EXCEPTION 'Only draft expenses may receive a new revision'
          USING ERRCODE = '23514',
                CONSTRAINT = 'expense_revisions_draft_only';
      END IF;

      SELECT is_active
        INTO category_active
        FROM expense_categories
       WHERE id = NEW.category_id
       FOR SHARE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Expense category does not exist'
          USING ERRCODE = '23503',
                CONSTRAINT = 'expense_revisions_category_id_fkey';
      END IF;

      IF category_active IS NOT TRUE THEN
        RAISE EXCEPTION 'Inactive expense categories cannot be used for new revisions'
          USING ERRCODE = '23514',
                CONSTRAINT = 'expense_revisions_active_category_required';
      END IF;

      SELECT COALESCE(max(revision_number), 0) + 1
        INTO expected_revision
        FROM expense_revisions
       WHERE expense_id = NEW.expense_id;

      IF NEW.revision_number <> expected_revision THEN
        RAISE EXCEPTION 'Expense revision numbers must be created sequentially'
          USING ERRCODE = '23514',
                CONSTRAINT = 'expense_revisions_sequential_number';
      END IF;

      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER expense_revisions_validate_insert
      BEFORE INSERT ON expense_revisions
      FOR EACH ROW EXECUTE FUNCTION enforce_expense_revision_insert();

    CREATE FUNCTION prevent_expense_revision_mutation() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'Expense revisions are immutable; create a new revision instead'
        USING ERRCODE = '23514',
              CONSTRAINT = 'expense_revisions_immutable';
    END;
    $$;

    CREATE TRIGGER expense_revisions_no_update
      BEFORE UPDATE ON expense_revisions
      FOR EACH ROW EXECUTE FUNCTION prevent_expense_revision_mutation();
    CREATE TRIGGER expense_revisions_no_delete
      BEFORE DELETE ON expense_revisions
      FOR EACH ROW EXECUTE FUNCTION prevent_expense_revision_mutation();
    CREATE TRIGGER expense_revisions_no_truncate
      BEFORE TRUNCATE ON expense_revisions
      FOR EACH STATEMENT EXECUTE FUNCTION prevent_expense_revision_mutation();

    CREATE TRIGGER expenses_no_delete
      BEFORE DELETE ON expenses
      FOR EACH ROW EXECUTE FUNCTION prevent_expense_master_hard_delete();
    CREATE TRIGGER expenses_no_truncate
      BEFORE TRUNCATE ON expenses
      FOR EACH STATEMENT EXECUTE FUNCTION prevent_expense_master_truncate();

    INSERT INTO permissions(code, description) VALUES
      ('expense_categories.view', 'View expense categories.'),
      ('expense_categories.manage', 'Create, update, activate and deactivate expense categories.'),
      ('expenses.view', 'View expense drafts and their revision history.'),
      ('expenses.create', 'Create expense drafts.'),
      ('expenses.update', 'Create new revisions of expense drafts.')
    ON CONFLICT (code) DO NOTHING;

    -- Expense permissions are definitions only. DMS-DEC-002 remains pending confirmation.
    -- Do not add role_permissions assignments in this migration.
  `);
}

export async function down(pgm) {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM expenses) THEN
        RAISE EXCEPTION 'Cannot roll back Expense Foundation while expense records exist';
      END IF;
      IF EXISTS (SELECT 1 FROM expense_categories) THEN
        RAISE EXCEPTION 'Cannot roll back Expense Foundation while expense categories exist';
      END IF;
    END;
    $$;

    ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_current_revision_fk;
    DROP TRIGGER IF EXISTS expense_revisions_no_truncate ON expense_revisions;
    DROP TRIGGER IF EXISTS expense_revisions_no_delete ON expense_revisions;
    DROP TRIGGER IF EXISTS expense_revisions_no_update ON expense_revisions;
    DROP TRIGGER IF EXISTS expense_revisions_validate_insert ON expense_revisions;
    DROP FUNCTION IF EXISTS prevent_expense_revision_mutation();
    DROP FUNCTION IF EXISTS enforce_expense_revision_insert();
    DROP TABLE IF EXISTS expense_revisions;

    DROP TRIGGER IF EXISTS expenses_no_truncate ON expenses;
    DROP TRIGGER IF EXISTS expenses_no_delete ON expenses;
    DROP TABLE IF EXISTS expenses;

    DROP TRIGGER IF EXISTS expense_categories_no_truncate ON expense_categories;
    DROP TRIGGER IF EXISTS expense_categories_no_delete ON expense_categories;
    DROP TABLE IF EXISTS expense_categories;
    DROP FUNCTION IF EXISTS prevent_expense_master_truncate();
    DROP FUNCTION IF EXISTS prevent_expense_master_hard_delete();

    DELETE FROM role_permissions
     WHERE permission_id IN (
       SELECT id FROM permissions
        WHERE code IN (
          'expense_categories.view', 'expense_categories.manage',
          'expenses.view', 'expenses.create', 'expenses.update'
        )
     );
    DELETE FROM permissions
     WHERE code IN (
       'expense_categories.view', 'expense_categories.manage',
       'expenses.view', 'expenses.create', 'expenses.update'
     );
  `);
}
