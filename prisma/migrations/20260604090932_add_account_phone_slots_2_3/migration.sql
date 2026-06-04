-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "phone2" TEXT,
ADD COLUMN     "phone2E164" TEXT,
ADD COLUMN     "phone2Extension" TEXT,
ADD COLUMN     "phone2Type" TEXT,
ADD COLUMN     "phone3" TEXT,
ADD COLUMN     "phone3E164" TEXT,
ADD COLUMN     "phone3Extension" TEXT,
ADD COLUMN     "phone3Type" TEXT,
ADD COLUMN     "primaryPhoneSlot" INTEGER;

-- CreateIndex
CREATE INDEX "Account_phone2E164_idx" ON "Account"("phone2E164");

-- CreateIndex
CREATE INDEX "Account_phone3E164_idx" ON "Account"("phone3E164");
