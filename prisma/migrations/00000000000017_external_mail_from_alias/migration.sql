-- Mail M5-extension — ExternalMailSettingFromAlias (K1 per-company çoklu
-- gönderen adresi alias'ları) + mevcut tek fromAddress backfill.
--
-- Plan referansı: docs/M6-email-in-case-plan.md Bölüm 4.4.
-- Additive: breaking change yok. M6.2 composer dropdown'u bu listeden
-- beslenir. Mevcut send akışları (notification dispatch vs.) eski
-- fromAddress'i okumaya devam eder; alias listesi ilk default ile o
-- değeri zaten yansıtır.

BEGIN TRY

BEGIN TRAN;

-- ───────────── ExternalMailSettingFromAlias ─────────────
CREATE TABLE [dbo].[ExternalMailSettingFromAlias] (
  [id]                    NVARCHAR(450) NOT NULL,
  [companyId]             NVARCHAR(450) NOT NULL,
  [externalMailSettingId] NVARCHAR(450) NULL,
  [address]               NVARCHAR(450) NOT NULL,
  [displayName]           NVARCHAR(Max) NULL,
  [isDefault]             BIT NOT NULL CONSTRAINT [DF_EMSFromAlias_isDefault] DEFAULT 0,
  [isActive]              BIT NOT NULL CONSTRAINT [DF_EMSFromAlias_isActive] DEFAULT 1,
  [sortOrder]             INT NOT NULL CONSTRAINT [DF_EMSFromAlias_sortOrder] DEFAULT 100,
  [createdByUserId]       NVARCHAR(450) NULL,
  [updatedByUserId]       NVARCHAR(450) NULL,
  [createdAt]             DATETIME2 NOT NULL CONSTRAINT [DF_EMSFromAlias_createdAt] DEFAULT sysutcdatetime(),
  [updatedAt]             DATETIME2 NOT NULL,
  CONSTRAINT [ExternalMailSettingFromAlias_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- Unique: aynı tenant'ta aynı adres bir kez. address NVARCHAR(Max)
-- olduğu için index için hash kullanılır (MSSQL key length limit 900B);
-- application-layer normalize zaten trim+lowercase karşılaştırma yapar.
CREATE UNIQUE NONCLUSTERED INDEX [EMSFromAlias_companyId_address_key]
  ON [dbo].[ExternalMailSettingFromAlias]([companyId], [address]);

CREATE NONCLUSTERED INDEX [EMSFromAlias_companyId_isActive_idx]
  ON [dbo].[ExternalMailSettingFromAlias]([companyId], [isActive]);
CREATE NONCLUSTERED INDEX [EMSFromAlias_companyId_isDefault_idx]
  ON [dbo].[ExternalMailSettingFromAlias]([companyId], [isDefault]);
CREATE NONCLUSTERED INDEX [EMSFromAlias_externalMailSettingId_idx]
  ON [dbo].[ExternalMailSettingFromAlias]([externalMailSettingId]);

ALTER TABLE [dbo].[ExternalMailSettingFromAlias]
  ADD CONSTRAINT [EMSFromAlias_companyId_fkey]
  FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id])
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- MSSQL multi-cascade engelleme: Company → ExternalMailSetting → FromAlias
-- ve Company → FromAlias iki cascade path olur. FromAlias.companyId zaten
-- ana scope; setting FK NO ACTION yapılır (setting silinirse alias
-- companyId üzerinden hala scope'lu kalır; uygulama katmanı cleanup için
-- ayrı operasyon gerekir).
ALTER TABLE [dbo].[ExternalMailSettingFromAlias]
  ADD CONSTRAINT [EMSFromAlias_externalMailSettingId_fkey]
  FOREIGN KEY ([externalMailSettingId]) REFERENCES [dbo].[ExternalMailSetting]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ───────────── BACKFILL ─────────────
-- Mevcut ExternalMailSetting.fromAddress dolu her tenant için bir alias
-- satırı oluştur (isDefault=true, isActive=true). Boş/null tenant'lar
-- atlanır.
INSERT INTO [dbo].[ExternalMailSettingFromAlias]
  ([id], [companyId], [externalMailSettingId], [address], [displayName],
   [isDefault], [isActive], [sortOrder], [createdByUserId], [updatedAt])
SELECT
  LOWER(CONVERT(NVARCHAR(36), NEWID())),
  s.[companyId],
  s.[id],
  s.[fromAddress],
  NULL, -- displayName backfill yok; admin sonra düzeltir
  1,    -- isDefault
  1,    -- isActive
  10,   -- sortOrder: ilk
  NULL, -- createdByUserId backfill için sistem
  sysutcdatetime()
FROM [dbo].[ExternalMailSetting] s
WHERE s.[fromAddress] IS NOT NULL
  AND LTRIM(RTRIM(s.[fromAddress])) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[ExternalMailSettingFromAlias] a
    WHERE a.[companyId] = s.[companyId] AND a.[address] = s.[fromAddress]
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
