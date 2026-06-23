-- PR-SD — Case soft archive (SystemAdmin-only UI temizliği)
--
-- Hard delete YOK. Arşivli vaka tüm child kayıtlarıyla intact kalır,
-- sadece list/detay default exclude'la gizlenir. status enum dokunulmaz.
--
-- Additive, NULL-safe, breaking change yok:
--   - isArchived BIT NOT NULL DEFAULT 0 (mevcut row'lar 0 — eski davranış)
--   - archivedAt DATETIME2 NULL
--   - archivedByUserId NVARCHAR(450) NULL + FK User (audit, JOIN için)
--   - archiveReason NVARCHAR(MAX) NULL
--   - Index [companyId, isArchived] — list default exclude hot path

BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[Case]
  ADD [isArchived] BIT NOT NULL CONSTRAINT [DF_Case_isArchived] DEFAULT 0;

ALTER TABLE [dbo].[Case]
  ADD [archivedAt] DATETIME2 NULL;

ALTER TABLE [dbo].[Case]
  ADD [archivedByUserId] NVARCHAR(450) NULL;

ALTER TABLE [dbo].[Case]
  ADD [archiveReason] NVARCHAR(MAX) NULL;

ALTER TABLE [dbo].[Case]
  ADD CONSTRAINT [Case_archivedByUserId_fkey]
  FOREIGN KEY ([archivedByUserId]) REFERENCES [dbo].[User]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE NONCLUSTERED INDEX [Case_companyId_isArchived_idx]
  ON [dbo].[Case]([companyId], [isArchived]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
