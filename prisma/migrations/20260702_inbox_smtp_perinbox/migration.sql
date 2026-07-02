-- FAZ B — Per-inbox SMTP (2026-07-02).
-- Additive + backfill. Mevcut hiçbir inbox satırı SİLİNMEZ/değiştirilmez;
-- yalnız NULL SMTP alanları doldurulur (fallback güvenliği). Fallback yolu
-- (mailProvider tenant-ortak ExternalMailSetting) mevcut haliyle çalışmaya
-- devam eder — smtp* NULL kalırsa oradan gönderim yapılır.
--
-- MSSQL batch parsing notu (2026-07-02 fix): Prisma migration'ı TEK batch
-- olarak çalıştırır. ALTER TABLE ADD COLUMN + SONRAKI UPDATE aynı batch'te
-- parse edilirken kolon henüz "yok" görünüyor → 'Invalid column name'.
-- Çözüm: UPDATE/INSERT'leri EXEC sp_executesql ile dynamic SQL olarak sar
-- → runtime'da parse edilir, o zaman kolon mevcut.

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
--    değişmez. LEFT JOIN — tenant setting yoksa NULL kalır.
--    Dynamic SQL — batch parse timing için.
EXEC sp_executesql N'
UPDATE i
   SET i.smtpHost   = COALESCE(i.smtpHost,   s.smtpHost),
       i.smtpPort   = COALESCE(i.smtpPort,   s.smtpPort),
       i.smtpSecure = COALESCE(i.smtpSecure, s.smtpSecure)
  FROM [dbo].[ExternalMailInbox] i
  LEFT JOIN [dbo].[ExternalMailSetting] s
         ON s.[companyId] = i.[companyId]
 WHERE i.smtpHost IS NULL OR i.smtpPort IS NULL OR i.smtpSecure IS NULL;
';

-- 3) fromAddress backfill — her inbox'un KENDİ address'ini kullan
--    (kullanıcı direktifi: tenant fromAddress'i KOPYALANMAZ).
--    Format: displayName varsa "Display <address>", yoksa çıplak address.
EXEC sp_executesql N'
UPDATE [dbo].[ExternalMailInbox]
   SET [fromAddress] =
     CASE
       WHEN displayName IS NOT NULL AND LEN(LTRIM(RTRIM(displayName))) > 0
         THEN LTRIM(RTRIM(displayName)) + '' <'' + address + ''>''
       ELSE address
     END
 WHERE fromAddress IS NULL;
';

-- 4) FromAlias backfill (Codex P2 round 1) — Mevcut inbox adresleri
--    composer dropdown'da görünsün + validateOutboundFrom kabul etsin.
--    Yeni admin.js route inbox upsert'te ensureForInboxAddress çağırıyor
--    ama BU MIGRATION ÖNCESİ oluşturulan inbox'lar (Multi-Inbox v1 satırları)
--    hiç alias köprüsü almadı → per-inbox SMTP path'i devreye giremez.
--    listActiveWithSettingFallback yalnız FromAlias satırlarını görüyor.
--
--    WHERE NOT EXISTS ile idempotent — mevcut alias'lara DOKUNMAZ (kullanıcı
--    direktifi). isDefault=0 (mevcut default'a dokunma). isActive=1.
--    id: NEWID() 32-char (Prisma cuid() değil ama String @id NVarChar(450)
--    kabul eder; app tarafta okuma sorunsuz).
EXEC sp_executesql N'
INSERT INTO [dbo].[ExternalMailSettingFromAlias] (
  [id], [companyId], [address], [displayName],
  [isDefault], [isActive], [sortOrder], [createdAt], [updatedAt]
)
SELECT
  LEFT(REPLACE(CONVERT(NVARCHAR(36), NEWID()), ''-'', ''''), 32),
  i.[companyId],
  i.[address],
  i.[displayName],
  0,
  1,
  100,
  sysutcdatetime(),
  sysutcdatetime()
FROM [dbo].[ExternalMailInbox] i
WHERE i.[isActive] = 1
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[ExternalMailSettingFromAlias] a
    WHERE a.[companyId] = i.[companyId]
      AND a.[address] = i.[address]
  );
';

COMMIT TRAN;

END TRY

BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
