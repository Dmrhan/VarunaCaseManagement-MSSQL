-- AlterTable
ALTER TABLE "AccountCompany" ADD COLUMN     "allowCustomerNotifications" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "preferredResponseChannel" TEXT,
ADD COLUMN     "responseEmail" TEXT,
ADD COLUMN     "responsePhone" TEXT;

-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "communicationChannelOverride" TEXT;
