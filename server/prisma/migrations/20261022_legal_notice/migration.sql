CREATE TABLE "legal_notices" (
  "id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legal_notices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "legal_notices_store_id_user_id_version_key" ON "legal_notices"("store_id", "user_id", "version");
ALTER TABLE "legal_notices" ADD CONSTRAINT "legal_notices_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "legal_notices" ADD CONSTRAINT "legal_notices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD COLUMN "personal_data_consent_at" TIMESTAMP(3), ADD COLUMN "terms_accepted_at" TIMESTAMP(3), ADD COLUMN "legal_version" TEXT;
