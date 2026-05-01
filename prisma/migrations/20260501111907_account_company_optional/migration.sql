-- DropForeignKey
ALTER TABLE "Account" DROP CONSTRAINT "Account_companyId_fkey";

-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "companyId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
