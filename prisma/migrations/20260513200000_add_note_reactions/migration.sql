-- CreateTable: CaseNoteReaction — bir nota emoji reaksiyonu (top-level veya reply).
CREATE TABLE "CaseNoteReaction" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseNoteReaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CaseNoteReaction_noteId_userId_emoji_key" ON "CaseNoteReaction"("noteId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "CaseNoteReaction_noteId_idx" ON "CaseNoteReaction"("noteId");

-- CreateIndex
CREATE INDEX "CaseNoteReaction_userId_idx" ON "CaseNoteReaction"("userId");

-- CreateIndex
CREATE INDEX "CaseNoteReaction_companyId_idx" ON "CaseNoteReaction"("companyId");

-- AddForeignKey
ALTER TABLE "CaseNoteReaction" ADD CONSTRAINT "CaseNoteReaction_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "CaseNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
