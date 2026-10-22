ALTER TABLE "products" ADD COLUMN "gender" TEXT;
ALTER TABLE "products" ADD COLUMN "material" TEXT;
ALTER TABLE "products" ADD COLUMN "measurements" TEXT;
ALTER TABLE "products" ADD COLUMN "defect_images" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "products" ADD COLUMN "video_url" TEXT;
ALTER TABLE "products" ADD COLUMN "channel_post_id" INTEGER;
ALTER TABLE "products" ADD COLUMN "channel_post_chat" TEXT;
ALTER TABLE "products" ADD COLUMN "channel_post_at" TIMESTAMP(3);
ALTER TABLE "products" ADD COLUMN "channel_post_error" TEXT;

CREATE TABLE "product_subscriptions" (
  "id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "new_arrivals" BOOLEAN NOT NULL DEFAULT false,
  "price_drops" BOOLEAN NOT NULL DEFAULT false,
  "category_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "brands" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sizes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "product_subscriptions_store_id_user_id_key" ON "product_subscriptions"("store_id", "user_id");
CREATE INDEX "product_subscriptions_store_id_new_arrivals_price_drops_idx" ON "product_subscriptions"("store_id", "new_arrivals", "price_drops");
ALTER TABLE "product_subscriptions" ADD CONSTRAINT "product_subscriptions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_subscriptions" ADD CONSTRAINT "product_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
