-- Mail M6.3b Faz 2 — User.signatureHtml (per-agent imza).
--
-- Plan referansı: M6.3b plan §Faz 2.
-- n4b parite (Zendesk/Freshdesk araştırması): per-agent self-service
-- imza; composer fallback chain agent > tenant > none.
--
-- Additive: NULL default. Save öncesi sanitize-html allowlist (M6.1).
-- Backfill yok — yeni agent'lar tenant default'a düşer; eski agent'lar
-- profil sayfasından self-service set eder.

BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[User]
  ADD [signatureHtml] NVARCHAR(Max) NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
