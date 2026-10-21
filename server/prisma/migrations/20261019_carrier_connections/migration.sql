ALTER TABLE "orders" ADD COLUMN "delivery_city_code" INTEGER;

CREATE TABLE "shipments" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "carrier" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'creating',
  "request_uuid" TEXT,
  "external_uuid" TEXT,
  "tracking_number" TEXT,
  "origin_point" TEXT,
  "tariff_code" INTEGER,
  "tariff_name" TEXT,
  "price_amount" INTEGER,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "shipments_order_id_key" ON "shipments"("order_id");
CREATE INDEX "shipments_store_id_idx" ON "shipments"("store_id");
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
