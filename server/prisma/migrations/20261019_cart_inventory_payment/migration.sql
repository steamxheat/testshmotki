CREATE TABLE "product_variants" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "product_id" TEXT NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "size" TEXT NOT NULL,
  "stock_quantity" INTEGER NOT NULL DEFAULT 1,
  "reserved_quantity" INTEGER NOT NULL DEFAULT 0,
  "sold_quantity" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "product_variants_stock_check" CHECK ("stock_quantity" >= 0 AND "reserved_quantity" >= 0 AND "sold_quantity" >= 0 AND "reserved_quantity" + "sold_quantity" <= "stock_quantity")
);
CREATE UNIQUE INDEX "product_variants_product_id_size_key" ON "product_variants"("product_id", "size");

INSERT INTO "product_variants" ("id", "product_id", "size", "stock_quantity", "reserved_quantity", "sold_quantity")
SELECT 'legacy_' || "id", "id", COALESCE(NULLIF("size", ''), 'Единый размер'), 1,
  CASE WHEN "status" = 'reserved' THEN 1 ELSE 0 END,
  CASE WHEN "status" = 'sold' THEN 1 ELSE 0 END
FROM "products";

ALTER TABLE "orders" ADD COLUMN "delivery_point" TEXT;
ALTER TABLE "orders" ADD COLUMN "delivery_tariff" TEXT;
ALTER TABLE "orders" ADD COLUMN "delivery_price_amount" INTEGER;
ALTER TABLE "orders" ADD COLUMN "receipt_filename" TEXT;
ALTER TABLE "orders" ADD COLUMN "receipt_submitted_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "payment_confirmed_at" TIMESTAMP(3);

CREATE TABLE "order_items" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "order_id" TEXT NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "product_id" TEXT NOT NULL REFERENCES "products"("id"),
  "variant_id" TEXT NOT NULL REFERENCES "product_variants"("id"),
  "title_snapshot" TEXT NOT NULL,
  "size_snapshot" TEXT NOT NULL,
  "price_amount_snapshot" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL,
  CONSTRAINT "order_items_quantity_check" CHECK ("quantity" > 0)
);
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

INSERT INTO "order_items" ("id", "order_id", "product_id", "variant_id", "title_snapshot", "size_snapshot", "price_amount_snapshot", "quantity")
SELECT 'legacy_' || o."id", o."id", o."product_id", 'legacy_' || o."product_id", o."product_title_snapshot",
  v."size", o."price_amount_snapshot", 1
FROM "orders" o JOIN "product_variants" v ON v."id" = 'legacy_' || o."product_id";
