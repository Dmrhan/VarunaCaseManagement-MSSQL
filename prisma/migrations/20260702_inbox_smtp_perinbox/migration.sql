-- FAZ B — Per-inbox SMTP (2026-07-02).
-- Additive + backfill. Mevcut hiçbir inbox satırı SİLİNMEZ/değiştirilmez;
-- yalnız NULL SMTP alanları doldurulur (fallback güvenliği). Fallback yolu
-- (mailProvider tenant-ortak ExternalMailSetting) mevcut haliyle çalışmaya
-- devam eder — smtp* NULL kalırsa oradan gönderim yapılır.

BEGIN TRY

BEGIN TRAN;

-- 1) Additive nullable kolonlar
ALTER TABLE [dbo].[ExternalMailInbox]
  ADD [smtpHost]    NVARCHAR(Max) NULL,
      [smtpPort]    INT           NULL,
      [smtpSecure]  BIT           NULL,
      [fromAddress] NVARCHAR(Max) NULL;

-- 2) BACKFILL: mevcut inbox'lara tenant-ortak SMTP config'ini kopyala.
--    Sadece NULL alanları doldur; hiçbir satır silinmez, mevcut değerler
--    değişmez. LEFT JOIN — tenant setting yoksa NULL kalır (fallback yolu
--    mailProvider'da devrede).
UPDATE i
   SET i.smtpHost   = COALESCE(i.smtpHost,   s.smtpHost),
       i.smtpPort   = COALESCE(i.smtpPort,   s.smtpPort),
       i.smtpSecure = COALESCE(i.smtpSecure, s.smtpSecure)
  FROM [dbo].[ExternalMailInbox] i
  LEFT JOIN [dbo].[ExternalMailSetting] s
         ON s.[companyId] = i.[companyId]
 WHERE i.smtpHost IS NULL OR i.smtpPort IS NULL OR i.smtpSecure IS NULL;

-- 3) fromAddress backfill — her inbox'un KENDİ address'ini kullan
--    (kullanıcı direktifi: tenant fromAddress'i KOPYALANMAZ).
--    Format: displayName varsa "Display <address>", yoksa çıplak address.
UPDATE [dbo].[ExternalMailInbox]
   SET [fromAddress] =
     CASE
       WHEN displayName IS NOT NULL AND LEN(LTRIM(RTRIM(displayName))) > 0
         THEN LTRIM(RTRIM(displayName)) + ' <' + address + '>'
       ELSE address
     END
 WHERE fromAddress IS NULL;

COMMIT TRAN;

END TRY

BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
