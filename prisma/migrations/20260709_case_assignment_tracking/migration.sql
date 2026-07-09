-- Atama/devir sonrası statü otomasyonu + atama-takip alanları (2026-07-09).
-- Additive + nullable. Hiçbir mevcut satır silinmez/değiştirilmez;
-- backfill YOK (kasıtlı — eski kayıtlarda assignedAt/pickedUpAt NULL
-- kalır, yalnız bu migration'dan sonraki atama/devir olayları doldurur).
--
-- DİKKAT: Bu dosya sadece şema değişikliğini tanımlar; bu oturumda hiçbir
-- veritabanına UYGULANMADI (çalıştırılmadı). Uygulamadan önce hedef
-- ortamda (özellikle canlıya bağlı olabilecek bir veritabanında) bu
-- migration'ın çalıştırılması ayrı, bilinçli bir onay/işlem gerektirir.

BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[Case]
  ADD [assignedAt] DATETIME2 NULL,
      [pickedUpAt] DATETIME2 NULL;

ALTER TABLE [dbo].[CaseTransfer]
  ADD [pickedUpAt] DATETIME2 NULL;

CREATE INDEX [Case_companyId_pickedUpAt_assignedAt_idx]
  ON [dbo].[Case] ([companyId], [pickedUpAt], [assignedAt]);

COMMIT TRAN;

END TRY

BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
