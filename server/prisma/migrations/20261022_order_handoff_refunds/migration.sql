ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'sent';

ALTER TABLE "orders"
  ADD COLUMN "refund_amount" INTEGER,
  ADD COLUMN "refund_confirmed_at" TIMESTAMP(3),
  ADD COLUMN "refund_reference" TEXT;

CREATE TABLE "bot_notifications" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "telegram_id" BIGINT NOT NULL,
  "body" TEXT NOT NULL,
  "button_text" TEXT,
  "button_path" TEXT,
  "store_slug" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_until" TIMESTAMP(3),
  "sent_at" TIMESTAMP(3),
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "bot_notifications_sent_at_next_attempt_at_idx" ON "bot_notifications"("sent_at", "next_attempt_at");
