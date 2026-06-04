-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "phoneType" TEXT,
ADD COLUMN     "phoneExtension" TEXT;

-- AlterTable
ALTER TABLE "AccountContact" ADD COLUMN     "phoneType" TEXT,
ADD COLUMN     "phoneExtension" TEXT;
