ALTER TYPE "DeliveryMethod" ADD VALUE IF NOT EXISTS 'yandex_delivery';
ALTER TYPE "DeliveryMethod" ADD VALUE IF NOT EXISTS 'dhl';

ALTER TABLE "orders" ADD COLUMN "delivery_lat" DOUBLE PRECISION;
ALTER TABLE "orders" ADD COLUMN "delivery_lon" DOUBLE PRECISION;
