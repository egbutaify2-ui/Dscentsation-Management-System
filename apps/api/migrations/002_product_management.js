export async function up(pgm) {
  pgm.sql(`
    CREATE TABLE product_categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(120) NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 120),
      description TEXT,
      parent_id UUID REFERENCES product_categories(id) ON DELETE RESTRICT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (parent_id IS NULL OR parent_id <> id)
    );
    CREATE INDEX product_categories_parent_idx ON product_categories(parent_id);
    CREATE INDEX product_categories_active_name_idx ON product_categories(is_active, lower(name));

    CREATE FUNCTION prevent_product_category_cycles() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_advisory_xact_lock(73518021);
      IF NEW.parent_id IS NOT NULL AND EXISTS (
        WITH RECURSIVE ancestors(id, parent_id) AS (
          SELECT id, parent_id FROM product_categories WHERE id = NEW.parent_id
          UNION
          SELECT c.id, c.parent_id
            FROM product_categories c
            JOIN ancestors a ON c.id = a.parent_id
        )
        SELECT 1 FROM ancestors WHERE id = NEW.id
      ) THEN
        RAISE EXCEPTION 'Product category hierarchy cannot contain a cycle'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER product_categories_no_cycles
      BEFORE INSERT OR UPDATE OF parent_id ON product_categories
      FOR EACH ROW EXECUTE FUNCTION prevent_product_category_cycles();

    CREATE FUNCTION prevent_product_master_hard_delete() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION '% records must be deactivated or archived, not deleted', TG_TABLE_NAME
        USING ERRCODE = '23514';
    END;
    $$;
    CREATE TRIGGER product_categories_no_delete
      BEFORE DELETE ON product_categories
      FOR EACH ROW EXECUTE FUNCTION prevent_product_master_hard_delete();

    CREATE TABLE products (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      category_id UUID REFERENCES product_categories(id) ON DELETE RESTRICT,
      name VARCHAR(200) NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 200),
      description TEXT,
      internal_code VARCHAR(80),
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX products_name_idx ON products(lower(name));
    CREATE INDEX products_internal_code_idx ON products(lower(internal_code))
      WHERE internal_code IS NOT NULL;
    CREATE INDEX products_category_idx ON products(category_id);
    CREATE INDEX products_status_idx ON products(status);
    CREATE TRIGGER products_no_delete
      BEFORE DELETE ON products
      FOR EACH ROW EXECUTE FUNCTION prevent_product_master_hard_delete();

    CREATE TABLE product_variants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      name VARCHAR(120) NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 120),
      sku VARCHAR(80),
      unit_of_measure VARCHAR(40) NOT NULL
        CHECK (unit_of_measure = btrim(unit_of_measure) AND length(unit_of_measure) BETWEEN 1 AND 40),
      selling_price_minor BIGINT NOT NULL CHECK (selling_price_minor >= 0),
      cost_price_minor BIGINT NOT NULL CHECK (cost_price_minor >= 0),
      currency CHAR(3) NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
      is_active BOOLEAN NOT NULL DEFAULT true,
      is_default BOOLEAN NOT NULL DEFAULT false,
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX product_variants_product_idx ON product_variants(product_id);
    CREATE INDEX product_variants_sku_idx ON product_variants(lower(sku)) WHERE sku IS NOT NULL;
    CREATE INDEX product_variants_active_idx ON product_variants(product_id, is_active);
    CREATE UNIQUE INDEX product_variants_one_default_idx ON product_variants(product_id)
      WHERE is_default = true;
    CREATE TRIGGER product_variants_no_delete
      BEFORE DELETE ON product_variants
      FOR EACH ROW EXECUTE FUNCTION prevent_product_master_hard_delete();

    CREATE FUNCTION assert_product_has_exactly_one_default_variant(target_product_id UUID)
    RETURNS VOID
    LANGUAGE plpgsql AS $$
    DECLARE
      variant_count INTEGER;
      default_variant_count INTEGER;
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM products WHERE id = target_product_id) THEN
        RETURN;
      END IF;

      SELECT count(*), count(*) FILTER (WHERE is_default = true)
        INTO variant_count, default_variant_count
        FROM product_variants
       WHERE product_id = target_product_id;

      IF variant_count = 0 THEN
        RAISE EXCEPTION 'Every product must retain at least one variant'
          USING ERRCODE = '23514';
      END IF;

      IF default_variant_count <> 1 THEN
        RAISE EXCEPTION 'Every product must have exactly one default variant'
          USING ERRCODE = '23514';
      END IF;
    END;
    $$;

    CREATE FUNCTION enforce_product_variant_invariants() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_TABLE_NAME = 'products' THEN
        PERFORM assert_product_has_exactly_one_default_variant(NEW.id);
      ELSE
        IF TG_OP <> 'INSERT' THEN
          PERFORM assert_product_has_exactly_one_default_variant(OLD.product_id);
        END IF;
        IF TG_OP <> 'DELETE' THEN
          PERFORM assert_product_has_exactly_one_default_variant(NEW.product_id);
        END IF;
      END IF;
      RETURN NULL;
    END;
    $$;

    CREATE CONSTRAINT TRIGGER products_require_exactly_one_default
      AFTER INSERT ON products
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION enforce_product_variant_invariants();

    CREATE CONSTRAINT TRIGGER variants_require_exactly_one_default
      AFTER INSERT OR UPDATE OR DELETE ON product_variants
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION enforce_product_variant_invariants();

    INSERT INTO permissions(code, description) VALUES
      ('products.view', 'View manually maintained DMS products, categories and variants.'),
      ('products.create', 'Create a product with its initial variant.'),
      ('products.update', 'Edit product details.'),
      ('products.archive', 'Activate or archive products.'),
      ('products.categories.manage', 'Create, edit and deactivate product categories.'),
      ('products.variants.manage', 'Create, edit and activate or deactivate product variants and prices.')
    ON CONFLICT (code) DO NOTHING;

    INSERT INTO role_permissions(role_id, permission_id)
    SELECT r.id, p.id
      FROM roles r
      CROSS JOIN permissions p
     WHERE r.code = 'OWNER'
       AND p.code IN (
         'products.view', 'products.create', 'products.update', 'products.archive',
         'products.categories.manage', 'products.variants.manage'
       )
    ON CONFLICT DO NOTHING;
  `);
}

export async function down(pgm) {
  pgm.sql(`
    DROP TRIGGER IF EXISTS variants_require_exactly_one_default ON product_variants;
    DROP TRIGGER IF EXISTS products_require_exactly_one_default ON products;
    DROP FUNCTION IF EXISTS enforce_product_variant_invariants();
    DROP FUNCTION IF EXISTS assert_product_has_exactly_one_default_variant(UUID);
    DROP TRIGGER IF EXISTS product_variants_no_delete ON product_variants;
    DROP TABLE IF EXISTS product_variants;
    DROP TRIGGER IF EXISTS products_no_delete ON products;
    DROP TABLE IF EXISTS products;
    DROP TRIGGER IF EXISTS product_categories_no_delete ON product_categories;
    DROP FUNCTION IF EXISTS prevent_product_master_hard_delete();
    DROP TRIGGER IF EXISTS product_categories_no_cycles ON product_categories;
    DROP FUNCTION IF EXISTS prevent_product_category_cycles();
    DROP TABLE IF EXISTS product_categories;
    DELETE FROM role_permissions
     WHERE permission_id IN (SELECT id FROM permissions WHERE code LIKE 'products.%');
    DELETE FROM permissions WHERE code LIKE 'products.%';
  `);
}
