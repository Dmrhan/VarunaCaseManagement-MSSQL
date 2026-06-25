-- Mail M4 — NotificationDispatch.providerMessageId
--
-- mailProvider.sendMail başarısı sonrası SMTP Message-ID'si saklanır.
-- Round-trip threading için: müşteri yanıt e-postasında In-Reply-To/
-- References bu Message-ID'ye işaret eder; M3 IMAP inbound geldiğinde
-- vakaya iliştirme yolu (M2 subject token yanı sıra) bu header üzerinden
-- de mümkün olacak.
--
-- Migration: additive nullable, backfill yok, breaking change yok.

BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[NotificationDispatch]
  ADD [providerMessageId] NVARCHAR(MAX) NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
