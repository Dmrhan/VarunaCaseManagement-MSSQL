-- DevOps Faz 2.1 follow-up — Basic auth username alanı.
--
-- Sorun: on-prem TFS Basic auth'u "user:secret" (base64) bekliyor; boş
-- kullanıcı + PAT senaryosu 401 dönüyor. PAT-tabanlı cloud Azure DevOps
-- ":pat" ile çalışır (kullanıcı adı boş), ama on-prem TFS kullanıcı
-- adı + parola (veya kullanıcı adı + PAT) bekliyor.
--
-- Çözüm: `username` NVarChar(256) NULLABLE ekle. Username SECRET DEĞİL —
-- plain saklanır (PAT/parola hâlâ AES-256-GCM şifreli kalır). Username
-- log'a basılmaz (auth header inşası sırasında gerekli, başka bir
-- yerde gözükmez).
--
-- Migration: additive, backfill yok, breaking change yok.

BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[ExternalDevOpsSetting]
  ADD [username] NVARCHAR(256) NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
