export async function up(pgm) {
  pgm.sql(`
    CREATE TABLE orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
      customer_name_snapshot VARCHAR(160) NOT NULL
        CHECK (customer_name_snapshot = btrim(customer_name_snapshot)
          AND length(customer_name_snapshot) BETWEEN 1 AND 160),
      customer_phone_snapshot VARCHAR(40)
        CHECK (customer_phone_snapshot IS NULL OR
          (customer_phone_snapshot = btrim(customer_phone_snapshot)
            AND length(customer_phone_snapshot) BETWEEN 1 AND 40)),
      customer_email_snapshot VARCHAR(254)
        CHECK (customer_email_snapshot IS NULL OR
          (customer_email_snapshot = btrim(customer_email_snapshot)
            AND length(customer_email_snapshot) BETWEEN 3 AND 254)),
      source_channel VARCHAR(20) NOT NULL
        CHECK (source_channel IN ('whatsapp', 'instagram', 'website', 'phone')),
      status VARCHAR(30) NOT NULL DEFAULT 'received'
        CHECK (status IN (
          'received', 'confirmed', 'processing', 'packed', 'dispatched',
          'delivered', 'cancelled', 'failed_delivery', 'fulfilment_hold'
        )),
      fulfilment_location_id UUID NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
      currency CHAR(3) NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
      subtotal_minor BIGINT NOT NULL CHECK (subtotal_minor >= 0),
      discount_minor BIGINT NOT NULL DEFAULT 0
        CHECK (discount_minor >= 0 AND discount_minor <= subtotal_minor),
      delivery_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (delivery_fee_minor >= 0),
      total_minor BIGINT NOT NULL CHECK (total_minor >= 0),
      delivery_address_snapshot VARCHAR(1000)
        CHECK (delivery_address_snapshot IS NULL OR
          (delivery_address_snapshot = btrim(delivery_address_snapshot)
            AND length(delivery_address_snapshot) BETWEEN 1 AND 1000)),
      notes VARCHAR(1000)
        CHECK (notes IS NULL OR (notes = btrim(notes) AND length(notes) BETWEEN 1 AND 1000)),
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT orders_total_matches_components
        CHECK (total_minor::numeric =
          subtotal_minor::numeric - discount_minor::numeric + delivery_fee_minor::numeric)
    );

    CREATE INDEX orders_status_created_idx
      ON orders(status, created_at DESC, id);
    CREATE INDEX orders_customer_created_idx
      ON orders(customer_id, created_at DESC, id);
    CREATE INDEX orders_location_created_idx
      ON orders(fulfilment_location_id, created_at DESC, id);
    CREATE INDEX orders_source_created_idx
      ON orders(source_channel, created_at DESC, id);

    CREATE UNIQUE INDEX product_variants_product_id_id_uidx
      ON product_variants(product_id, id);

    CREATE TABLE order_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
      line_number INTEGER NOT NULL CHECK (line_number > 0),
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      product_variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
      product_name_snapshot VARCHAR(200) NOT NULL
        CHECK (product_name_snapshot = btrim(product_name_snapshot)
          AND length(product_name_snapshot) BETWEEN 1 AND 200),
      variant_name_snapshot VARCHAR(120) NOT NULL
        CHECK (variant_name_snapshot = btrim(variant_name_snapshot)
          AND length(variant_name_snapshot) BETWEEN 1 AND 120),
      sku_snapshot VARCHAR(80)
        CHECK (sku_snapshot IS NULL OR
          (sku_snapshot = btrim(sku_snapshot) AND length(sku_snapshot) BETWEEN 1 AND 80)),
      unit_of_measure_snapshot VARCHAR(40) NOT NULL
        CHECK (unit_of_measure_snapshot = btrim(unit_of_measure_snapshot)
          AND length(unit_of_measure_snapshot) BETWEEN 1 AND 40),
      unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0),
      quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 2147483647),
      discount_minor BIGINT NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
      line_total_minor BIGINT NOT NULL CHECK (line_total_minor >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT order_items_order_line_uq UNIQUE (order_id, line_number),
      CONSTRAINT order_items_product_variant_pair_fk
        FOREIGN KEY (product_id, product_variant_id)
        REFERENCES product_variants(product_id, id) ON DELETE RESTRICT,
      CONSTRAINT order_items_total_matches_components CHECK (
        line_total_minor::numeric =
          unit_price_minor::numeric * quantity::numeric - discount_minor::numeric
        AND discount_minor::numeric <= unit_price_minor::numeric * quantity::numeric
      )
    );

    CREATE INDEX order_items_product_idx ON order_items(product_id);
    CREATE INDEX order_items_variant_idx ON order_items(product_variant_id);

    CREATE FUNCTION prevent_order_hard_delete() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'Order records must be retained for audit history'
        USING ERRCODE = '23514',
              CONSTRAINT = 'orders_hard_delete_prohibited';
    END;
    $$;

    CREATE TRIGGER orders_no_delete
      BEFORE DELETE ON orders
      FOR EACH ROW EXECUTE FUNCTION prevent_order_hard_delete();
    CREATE TRIGGER orders_no_truncate
      BEFORE TRUNCATE ON orders
      FOR EACH STATEMENT EXECUTE FUNCTION prevent_order_hard_delete();

    INSERT INTO permissions(code, description) VALUES
      ('orders.view', 'View order records and their captured customer and product details.'),
      ('orders.create', 'Capture a received order from an approved source channel.'),
      ('orders.update', 'Amend an order while it remains in the received state.')
    ON CONFLICT (code) DO NOTHING;

    -- Order permission definitions are intentionally not assigned to any production role.
  `);
}

export async function down(pgm) {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM orders) THEN
        RAISE EXCEPTION 'Cannot roll back Order Foundation while order records exist';
      END IF;
    END;
    $$;

    DROP TRIGGER IF EXISTS orders_no_truncate ON orders;
    DROP TRIGGER IF EXISTS orders_no_delete ON orders;
    DROP FUNCTION IF EXISTS prevent_order_hard_delete();
    DROP TABLE IF EXISTS order_items;
    DROP TABLE IF EXISTS orders;
    DROP INDEX IF EXISTS product_variants_product_id_id_uidx;

    DELETE FROM role_permissions
     WHERE permission_id IN (
       SELECT id FROM permissions
        WHERE code IN ('orders.view', 'orders.create', 'orders.update')
     );
    DELETE FROM permissions
     WHERE code IN ('orders.view', 'orders.create', 'orders.update');
  `);
}
