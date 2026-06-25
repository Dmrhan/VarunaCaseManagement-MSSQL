-- Mail M5 — Per-tenant SMTP/IMAP integration ayarları (ExternalMailSetting).
--
-- Tek satır per company (companyId UNIQUE). mailProvider.sendMail
-- per-tenant config kullanırken (opts.companyId verildi) önce bu tabloya
-- bakar; satır yoksa process.env.SMTP_* fallback (M1 backward-compat).
-- enabled=false ise entegrasyon kapalı (env'e DÜŞMEZ — ExternalDevOpsSetting
-- ile aynı semantik).
--
-- Secret şifrelemesi: AES-256-GCM (server/lib/secretCipher.js;
-- DEVOPS_PAT_ENC_KEY reuse). Plain SMTP password DB'de ASLA saklanmaz.
--
-- Migration: additive, breaking change yok, backfill yok.

BEGIN TRY

BEGIN TRAN;

CREATE TABLE [dbo].[ExternalMailSetting] (
  [id]               NVARCHAR(450) NOT NULL,
  [companyId]        NVARCHAR(450) NOT NULL,
  [enabled]          BIT NOT NULL CONSTRAINT [DF_ExternalMailSetting_enabled] DEFAULT 0,
  [fromAddress]      NVARCHAR(MAX) NULL,
  [inboundAddress]   NVARCHAR(MAX) NULL,
  [smtpHost]         NVARCHAR(MAX) NULL,
  [smtpPort]         INT NULL,
  [smtpSecure]       BIT NOT NULL CONSTRAINT [DF_ExternalMailSetting_smtpSecure] DEFAULT 0,
  [imapHost]         NVARCHAR(MAX) NULL,
  [imapPort]         INT NULL,
  [authMode]         NVARCHAR(50) NOT NULL CONSTRAINT [DF_ExternalMailSetting_authMode] DEFAULT 'password',
  [secretCiphertext] NVARCHAR(MAX) NULL,
  [secretIv]         NVARCHAR(MAX) NULL,
  [secretAuthTag]    NVARCHAR(MAX) NULL,
  [secretSetAt]      DATETIME2 NULL,
  [username]         NVARCHAR(256) NULL,
  [createdByUserId]  NVARCHAR(450) NULL,
  [updatedByUserId]  NVARCHAR(450) NULL,
  [createdAt]        DATETIME2 NOT NULL CONSTRAINT [DF_ExternalMailSetting_createdAt] DEFAULT sysutcdatetime(),
  [updatedAt]        DATETIME2 NOT NULL,
  CONSTRAINT [ExternalMailSetting_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE UNIQUE NONCLUSTERED INDEX [ExternalMailSetting_companyId_key]
  ON [dbo].[ExternalMailSetting]([companyId]);

CREATE NONCLUSTERED INDEX [ExternalMailSetting_companyId_enabled_idx]
  ON [dbo].[ExternalMailSetting]([companyId], [enabled]);

ALTER TABLE [dbo].[ExternalMailSetting]
  ADD CONSTRAINT [ExternalMailSetting_companyId_fkey]
  FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id])
  ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
