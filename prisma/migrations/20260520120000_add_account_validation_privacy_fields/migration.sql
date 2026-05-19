-- WR-A2 / PM-01 — Validation + Privacy fields.
-- Decision Sprint #1 (TCKN HMAC + last4), #2 (phone normalize, no DB unique), #3 (VKN @unique korunur).
-- Plain TCKN ASLA bu migration ile eklenmez; sadece hash + last4.
-- Pepper env (TCKN_HASH_PEPPER) yoksa write path 400 fail; bu migration pepper-agnostic.

-- AlterTable: Account
ALTER TABLE "Account" ADD COLUMN "phoneE164" TEXT;
ALTER TABLE "Account" ADD COLUMN "tcknHash" TEXT;
ALTER TABLE "Account" ADD COLUMN "tcknLast4" TEXT;

-- AlterTable: AccountContact
ALTER TABLE "AccountContact" ADD COLUMN "phoneE164" TEXT;

-- CreateIndex: Account.phoneE164 (search, NOT unique — paylaşılan call center)
CREATE INDEX "Account_phoneE164_idx" ON "Account"("phoneE164");

-- CreateIndex: Account.tcknHash (global unique — duplicate Bireysel önleme)
CREATE UNIQUE INDEX "Account_tcknHash_key" ON "Account"("tcknHash");

-- CreateIndex: AccountContact.phoneE164 (search, NOT unique)
CREATE INDEX "AccountContact_phoneE164_idx" ON "AccountContact"("phoneE164");
