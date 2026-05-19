-- WR-A1 / PM-01 — Account customerType discriminator (safe scope).
-- ÖNEMLİ: TCKN bu migration'a EKLENMEZ. TCKN ve tcknHash field'ları A2'de
-- privacy design (encrypt/hash/mask) kararı alındıktan sonra ayrı PR'da gelir.
-- Sadece B2B/B2C ayırımı + opsiyonel ticari unvan/sicil no eklenir.

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('Bireysel', 'Kurumsal', 'Kamu', 'Vakıf-STK');

-- AlterTable: mevcut hesaplara default 'Kurumsal' (Corporate) atanır.
ALTER TABLE "Account" ADD COLUMN     "customerType" "CustomerType" NOT NULL DEFAULT 'Kurumsal',
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "registrationNo" TEXT;

-- CreateIndex
CREATE INDEX "Account_customerType_idx" ON "Account"("customerType");
