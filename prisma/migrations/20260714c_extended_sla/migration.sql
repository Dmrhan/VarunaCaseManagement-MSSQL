-- Uzatılmış SLA v1 (2026-07-14) — yazılım geliştirme devri katmanı.
--
-- U-A: hedef uzatma rejimi (duraklatma DEĞİL) — sözleşmedeki "Yazılım
-- Geliştirme Çözüm Süresi" TOPLAM değeri, MESAİ DAKİKASI olarak
-- SLAPolicy satırına yazılır (1.830/3.480/12.480; tam saate bölünmediği
-- için dk kolonu). null = o satırda uzatma tanımsız (fail-safe kapalı).
--
-- U-B: tetik İKİ PARÇALI ve tanım bazında konfigüre — ThirdParty'ye
-- "uzatılmış süre uygular" + "ek şart: DevOps kaydı bulunmalı" bayrakları
-- (pausesSla davranış-bayrağı deseninin ikizi; tanım ADI kural değildir).
--
-- Case audit: hangi hedefin neden uygulandığı vaka üzerinde damgalanır.
--
-- Additive: yeni kolonlar nullable/default'lu; bayraklar FALSE, süreler
-- NULL başlar → davranış hiçbir vakada değişmez. Aktivasyon ayrı adım
-- (sıra kilidi: deploy → takvim kesimi → re-stamp → uzatılmış SLA kesimi).

BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[SLAPolicy] ADD
  [extendedResolutionMin] INT NULL;

ALTER TABLE [dbo].[ThirdParty] ADD
  [triggersExtendedSla]           BIT NOT NULL CONSTRAINT [DF_ThirdParty_triggersExtendedSla] DEFAULT 0,
  [extendedSlaRequiresDevopsLink] BIT NOT NULL CONSTRAINT [DF_ThirdParty_extSlaReqDevops] DEFAULT 1;

ALTER TABLE [dbo].[Case] ADD
  [slaTargetSource]        NVARCHAR(20) NULL,
  [slaResolutionTargetMin] INT NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
