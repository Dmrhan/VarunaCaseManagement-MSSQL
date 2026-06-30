-- Mail Multi-Inbox (Faz A) — ExternalMailInbox tablosu + mevcut tek
-- inboundAddress backfill.
--
-- İhtiyaç: Bir tenant artık birden fazla mail adresinden gelen vakaları
-- AYRI takımlara yönlendirebilir (örn. yazilimdestek@ → Yazılım Takımı,
-- satis@ → Satış Takımı). Her inbox AYRI IMAP hesabı.
--
-- Backward compat: ExternalMailSetting.inboundAddress alanı KORUNUR.
-- Backfill yapılır — eski tek-inbox tenant'lar otomatik bir adet 'default'
-- inbox kaydı ile çalışmaya devam eder. M5-ext FromAlias migration
-- deseninin (00000000000017) birebir aynısı.
--
-- Additive: breaking change yok. A2 (IMAP polling refactor) bu tablodan
-- okuyacak; eski ExternalMailSetting tek-row polling kodu A2'de değişir
-- ama bu migration tek başına shippable.

BEGIN TRY

BEGIN TRAN;

-- ───────────── ExternalMailInbox tablosu ─────────────
CREATE TABLE [dbo].[ExternalMailInbox] (
  [id]               NVARCHAR(450) NOT NULL,
  [companyId]        NVARCHAR(450) NOT NULL,
  [address]          NVARCHAR(450) NOT NULL,
  [displayName]      NVARCHAR(Max) NULL,
  [imapHost]         NVARCHAR(Max) NULL,
  [imapPort]         INT NULL,
  [imapSecure]       BIT NOT NULL CONSTRAINT [DF_EMInbox_imapSecure] DEFAULT 1,
  [username]         NVARCHAR(256) NULL,
  [secretCiphertext] NVARCHAR(Max) NULL,
  [secretIv]         NVARCHAR(Max) NULL,
  [secretAuthTag]    NVARCHAR(Max) NULL,
  [secretSetAt]      DATETIME2 NULL,
  [assignedTeamId]   NVARCHAR(450) NULL,
  [enabled]          BIT NOT NULL CONSTRAINT [DF_EMInbox_enabled] DEFAULT 0,
  [isActive]         BIT NOT NULL CONSTRAINT [DF_EMInbox_isActive] DEFAULT 1,
  [sortOrder]        INT NOT NULL CONSTRAINT [DF_EMInbox_sortOrder] DEFAULT 100,
  [createdByUserId]  NVARCHAR(450) NULL,
  [updatedByUserId]  NVARCHAR(450) NULL,
  [createdAt]        DATETIME2 NOT NULL CONSTRAINT [DF_EMInbox_createdAt] DEFAULT sysutcdatetime(),
  [updatedAt]        DATETIME2 NOT NULL,
  CONSTRAINT [ExternalMailInbox_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- Per-tenant adres unique. address NVARCHAR(450) → index key length OK.
CREATE UNIQUE NONCLUSTERED INDEX [EMInbox_companyId_address_key]
  ON [dbo].[ExternalMailInbox]([companyId], [address]);

CREATE NONCLUSTERED INDEX [EMInbox_companyId_enabled_idx]
  ON [dbo].[ExternalMailInbox]([companyId], [enabled]);
CREATE NONCLUSTERED INDEX [EMInbox_companyId_isActive_idx]
  ON [dbo].[ExternalMailInbox]([companyId], [isActive]);
CREATE NONCLUSTERED INDEX [EMInbox_assignedTeamId_idx]
  ON [dbo].[ExternalMailInbox]([assignedTeamId]);

-- Company cascade — tenant silinirse inbox'lar da gitsin.
ALTER TABLE [dbo].[ExternalMailInbox]
  ADD CONSTRAINT [EMInbox_companyId_fkey]
  FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id])
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- Team FK — NO ACTION (MSSQL multi-cascade engelleme: Company → Team ve
-- Company → ExternalMailInbox iki cascade path olur). Team silinirse
-- inbox.assignedTeamId NULL'a düşürülmez; app katmanı cleanup ister.
ALTER TABLE [dbo].[ExternalMailInbox]
  ADD CONSTRAINT [EMInbox_assignedTeamId_fkey]
  FOREIGN KEY ([assignedTeamId]) REFERENCES [dbo].[Team]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ───────────── BACKFILL ─────────────
-- Mevcut ExternalMailSetting.inboundAddress dolu her tenant için bir
-- inbox satırı oluştur. Credentials (imapHost/Port + username + secret)
-- parent ExternalMailSetting'ten kopyalanır — eski polling akışı yeni
-- model üzerinden de aynen çalışsın.
--
-- Notlar:
--   * assignedTeamId NULL → eski "global havuz" davranışı korunur
--     (vaka oluşur ama belirli takıma atanmaz; A3'te admin sonradan
--     takım atayabilir)
--   * enabled=ExternalMailSetting.enabled — eski polling toggle aynen
--   * displayName='Varsayılan' — admin sonra düzeltebilir
--   * Idempotent: aynı (companyId, address) varsa atla
INSERT INTO [dbo].[ExternalMailInbox]
  ([id], [companyId], [address], [displayName],
   [imapHost], [imapPort], [imapSecure], [username],
   [secretCiphertext], [secretIv], [secretAuthTag], [secretSetAt],
   [assignedTeamId], [enabled], [isActive], [sortOrder],
   [createdByUserId], [updatedAt])
SELECT
  LOWER(CONVERT(NVARCHAR(36), NEWID())),
  s.[companyId],
  s.[inboundAddress],
  N'Varsayılan',
  s.[imapHost],
  s.[imapPort],
  1, -- imapSecure default true (eski IMAP zaten SSL/TLS varsayar)
  s.[username],
  s.[secretCiphertext],
  s.[secretIv],
  s.[secretAuthTag],
  s.[secretSetAt],
  NULL,         -- assignedTeamId: havuz (admin sonra atayabilir)
  s.[enabled],  -- mevcut polling toggle aynen
  1,            -- isActive
  10,           -- sortOrder: ilk
  NULL,         -- createdByUserId: sistem backfill
  sysutcdatetime()
FROM [dbo].[ExternalMailSetting] s
WHERE s.[inboundAddress] IS NOT NULL
  AND LTRIM(RTRIM(s.[inboundAddress])) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[ExternalMailInbox] i
    WHERE i.[companyId] = s.[companyId] AND i.[address] = s.[inboundAddress]
  );

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
