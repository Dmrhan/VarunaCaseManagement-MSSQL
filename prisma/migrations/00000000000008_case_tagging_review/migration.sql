-- Vaka Etiket Doğrulama Ekranı — CaseTaggingReview tablosu
--
-- Supervisor/Admin/SystemAdmin'in her vaka için açılış/kapanış etiket
-- kontrolünü (Doğru/Yanlış/Belirsiz) kaydettiği audit tablosu. caseId
-- @unique → tek vaka tek kayıt (upsert pattern, QAScoreLog ile aynı desen).
-- Case CASCADE → vaka silinirse review kaydı da silinir.

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[CaseTaggingReview] (
    [id]             NVARCHAR(450) NOT NULL,
    [caseId]         NVARCHAR(450) NOT NULL,
    [companyId]      NVARCHAR(450) NOT NULL,
    [openingVerdict] NVARCHAR(50),
    [closingVerdict] NVARCHAR(50),
    [note]           NVARCHAR(MAX),
    [reviewerId]     NVARCHAR(450),
    [reviewerName]   NVARCHAR(MAX),
    [reviewedAt]     DATETIME2,
    [createdAt]      DATETIME2     NOT NULL CONSTRAINT [CaseTaggingReview_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt]      DATETIME2     NOT NULL,
    CONSTRAINT [CaseTaggingReview_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- Unique: caseId — tek vaka tek review kaydı (upsert hedefi)
CREATE UNIQUE NONCLUSTERED INDEX [CaseTaggingReview_caseId_key]
    ON [dbo].[CaseTaggingReview]([caseId]);

-- Tenant-scoped liste sorguları
CREATE NONCLUSTERED INDEX [CaseTaggingReview_companyId_idx]
    ON [dbo].[CaseTaggingReview]([companyId]);

-- AddForeignKey
ALTER TABLE [dbo].[CaseTaggingReview]
    ADD CONSTRAINT [CaseTaggingReview_caseId_fkey]
    FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id])
    ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
