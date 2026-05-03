-- CreateEnum
CREATE TYPE "SnoozeReason" AS ENUM ('customer_will_call', 'waiting_3rd_party', 'reminder');

-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "snoozeReason" "SnoozeReason",
ADD COLUMN     "snoozeUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Case_snoozeUntil_idx" ON "Case"("snoozeUntil");
