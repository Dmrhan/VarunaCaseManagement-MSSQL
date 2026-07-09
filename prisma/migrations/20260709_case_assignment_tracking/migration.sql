-- Atama/devir sonrası statü otomasyonu + atama-takip alanları (2026-07-09).
-- Additive + nullable. Hiçbir mevcut satır silinmez/değiştirilmez;
-- backfill YOK (kasıtlı — eski kayıtlarda assignedAt/pickedUpAt NULL
-- kalır, yalnız bu migration'dan sonraki atama/devir olayları doldurur).
--
-- CREATE INDEX BİLEREK bu migration'a DAHİL EDİLMEDİ — canlı/büyük bir
-- tabloda index oluşturma işlemi kilitlenmeye yol açabilir (ONLINE=ON
-- desteklenmeyebilir). Yeni alanları kullanan bir sorgu gerçekten
-- gerektirdiğinde, düşük trafikli bir zamanda ayrı bir migration'la
-- eklenmeli.

BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[Case]
  ADD [assignedAt] DATETIME2 NULL,
      [pickedUpAt] DATETIME2 NULL;

ALTER TABLE [dbo].[CaseTransfer]
  ADD [pickedUpAt] DATETIME2 NULL;

COMMIT TRAN;

END TRY

BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
