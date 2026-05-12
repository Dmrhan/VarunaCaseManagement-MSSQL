-- AlterEnum
ALTER TYPE "CaseHistoryActionType" ADD VALUE 'NoteReplyAdded';

-- AlterTable: CaseNote — Reply/Thread (max 1 derinlik)
ALTER TABLE "CaseNote" ADD COLUMN "parentNoteId" TEXT;
ALTER TABLE "CaseNote" ADD COLUMN "replyCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "CaseNote_parentNoteId_idx" ON "CaseNote"("parentNoteId");

-- AddForeignKey
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_parentNoteId_fkey" FOREIGN KEY ("parentNoteId") REFERENCES "CaseNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
