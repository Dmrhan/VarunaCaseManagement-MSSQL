-- Mail M6.2a — ExternalMailSetting.signatureHtml (per-tenant default imza).
--
-- Plan referansı: docs/M6-email-in-case-plan.md Bölüm 4.4 + Bölüm 7.4
-- (HTML imza).
--
-- Additive: breaking change yok, backfill yok. M6.2b composer gövdeye
-- otomatik append eder; agent silebilir. Per-agent override M6.3'te.

BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[ExternalMailSetting]
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
