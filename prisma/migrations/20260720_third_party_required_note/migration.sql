-- U-C (2026-07-20) — 3. Parti Bekleniyor geçişinde tanım-bazlı zorunlu
-- açıklama alanı.
--
-- ThirdParty.requiresNote — bu tanım seçildiğinde "3rdPartyBekleniyor"
-- geçişinde açıklama zorunlu mu (pausesSla/triggersExtendedSla bayrak
-- deseninin ikizi).
--
-- Case.thirdPartyNote — 3. parti bekleme açıklaması. thirdPartyId/
-- thirdPartyName'in aksine statüden çıkınca TEMİZLENMEZ; raporlanabilir
-- kalıcı kayıt (cancellationReason deseni, server/db/caseRepository.js).
--
-- Additive: requiresNote FALSE, thirdPartyNote NULL başlar → davranış
-- hiçbir mevcut vakada/tanımda değişmez.

BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[ThirdParty] ADD
  [requiresNote] BIT NOT NULL CONSTRAINT [DF_ThirdParty_requiresNote] DEFAULT 0;

ALTER TABLE [dbo].[Case] ADD
  [thirdPartyNote] NVARCHAR(MAX) NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
