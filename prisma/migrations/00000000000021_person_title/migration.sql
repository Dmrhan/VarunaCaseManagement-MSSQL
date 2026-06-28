-- Compose-Signature F1 — Person.title (additive).
--
-- Kişinin iş unvanı. Şirket imza şablonundaki {{agent.title}} placeholder'ı
-- buradan render edilir. NULL default → mevcut Person satırları etkilenmez;
-- backfill yok.

BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[Person]
  ADD [title] NVARCHAR(255) NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
