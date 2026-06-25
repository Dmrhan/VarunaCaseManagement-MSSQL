-- Mail M2.3 — Öğrenilen gönderen→müşteri eşlemesi (LearnedSenderAccount).
--
-- Manuel linkAccount sırasında insan onaylı eşleme oluşur.
-- Sonraki inbound mail'de aynı gönderen otomatik tanınır (kişisel adres)
-- veya önerilir (rol adres).
--
-- @@unique([companyId, senderEmail]) — bir şirkette bir gönderen bir
-- account'a bağlı (yeni manuel link OVERWRITE eder; self-correction).
--
-- Migration: additive, breaking change yok, backfill yok.

BEGIN TRY

BEGIN TRAN;

CREATE TABLE [dbo].[LearnedSenderAccount] (
  [id]              NVARCHAR(450) NOT NULL,
  [companyId]       NVARCHAR(450) NOT NULL,
  [senderEmail]     NVARCHAR(320) NOT NULL,
  [accountId]       NVARCHAR(450) NOT NULL,
  [isRoleAddress]   BIT NOT NULL CONSTRAINT [DF_LearnedSenderAccount_isRoleAddress] DEFAULT 0,
  [source]          NVARCHAR(50) NOT NULL CONSTRAINT [DF_LearnedSenderAccount_source] DEFAULT 'manual_link',
  [createdByUserId] NVARCHAR(450) NULL,
  [createdAt]       DATETIME2 NOT NULL CONSTRAINT [DF_LearnedSenderAccount_createdAt] DEFAULT sysutcdatetime(),
  [updatedAt]       DATETIME2 NOT NULL,
  CONSTRAINT [LearnedSenderAccount_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE UNIQUE NONCLUSTERED INDEX [LearnedSenderAccount_companyId_senderEmail_key]
  ON [dbo].[LearnedSenderAccount]([companyId], [senderEmail]);

CREATE NONCLUSTERED INDEX [LearnedSenderAccount_companyId_idx]
  ON [dbo].[LearnedSenderAccount]([companyId]);

CREATE NONCLUSTERED INDEX [LearnedSenderAccount_accountId_idx]
  ON [dbo].[LearnedSenderAccount]([accountId]);

ALTER TABLE [dbo].[LearnedSenderAccount]
  ADD CONSTRAINT [LearnedSenderAccount_companyId_fkey]
  FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[LearnedSenderAccount]
  ADD CONSTRAINT [LearnedSenderAccount_accountId_fkey]
  FOREIGN KEY ([accountId]) REFERENCES [dbo].[Account]([id])
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
