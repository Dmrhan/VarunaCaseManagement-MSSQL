-- DevOps Faz 2.1 — Per-tenant TFS entegrasyon ayarları (ExternalDevOpsSetting).
--
-- Tek satır per company (companyId UNIQUE). devopsClient.getConfig() önce
-- bu tabloya bakar; satır yoksa process.env.TFS_* fallback (backward-compat
-- MVP). enabled=false ise entegrasyon kapalı; env'e DÜŞMEZ.
--
-- PAT şifrelemesi: AES-256-GCM (server/lib/secretCipher.js).
-- patCiphertext / patIv / patAuthTag base64; patSetAt rotation tracking.
-- Plain PAT DB'de ASLA saklanmaz.
--
-- Migration: additive, breaking change yok, backfill yok.

BEGIN TRY

BEGIN TRAN;

CREATE TABLE [dbo].[ExternalDevOpsSetting] (
  [id]               NVARCHAR(450) NOT NULL,
  [companyId]        NVARCHAR(450) NOT NULL,
  [enabled]          BIT NOT NULL CONSTRAINT [DF_ExternalDevOpsSetting_enabled] DEFAULT 0,
  [baseUrl]          NVARCHAR(MAX) NULL,
  [apiVersion]       NVARCHAR(50) NULL,
  [timeoutMs]        INT NOT NULL CONSTRAINT [DF_ExternalDevOpsSetting_timeoutMs] DEFAULT 15000,
  [patCiphertext]    NVARCHAR(MAX) NULL,
  [patIv]            NVARCHAR(MAX) NULL,
  [patAuthTag]       NVARCHAR(MAX) NULL,
  [patSetAt]         DATETIME2 NULL,
  [createdByUserId]  NVARCHAR(450) NULL,
  [updatedByUserId]  NVARCHAR(450) NULL,
  [createdAt]        DATETIME2 NOT NULL CONSTRAINT [DF_ExternalDevOpsSetting_createdAt] DEFAULT sysutcdatetime(),
  [updatedAt]        DATETIME2 NOT NULL,
  CONSTRAINT [ExternalDevOpsSetting_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE UNIQUE NONCLUSTERED INDEX [ExternalDevOpsSetting_companyId_key]
  ON [dbo].[ExternalDevOpsSetting]([companyId]);

CREATE NONCLUSTERED INDEX [ExternalDevOpsSetting_companyId_enabled_idx]
  ON [dbo].[ExternalDevOpsSetting]([companyId], [enabled]);

ALTER TABLE [dbo].[ExternalDevOpsSetting]
  ADD CONSTRAINT [ExternalDevOpsSetting_companyId_fkey]
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
