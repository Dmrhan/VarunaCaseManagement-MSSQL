-- Phase D Step 2 completion — müşterisiz vaka için opsiyonel başvuran bilgileri.
-- Hepsi nullable; backfill gerekmez; mevcut davranış değişmez.

ALTER TABLE "Case" ADD COLUMN "customerContactName" TEXT;
ALTER TABLE "Case" ADD COLUMN "customerContactPhone" TEXT;
ALTER TABLE "Case" ADD COLUMN "customerContactEmail" TEXT;
ALTER TABLE "Case" ADD COLUMN "customerCompanyName" TEXT;
