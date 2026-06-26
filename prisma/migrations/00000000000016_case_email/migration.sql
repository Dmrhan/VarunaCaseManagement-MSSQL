-- Mail M6.1 — CaseEmail + CaseEmailAttachment + Case K4 alanları.
--
-- Plan referansı: docs/M6-email-in-case-plan.md Bölüm 4.5.
-- Additive: breaking change yok, backfill yok (eski not-olarak-mail
-- kayıtları olduğu yerde kalır; M6.1 sonrası gelen mail CaseEmail'a yazılır).

BEGIN TRY

BEGIN TRAN;

-- ───────────────────────── CaseEmail ─────────────────────────
CREATE TABLE [dbo].[CaseEmail] (
  [id]            NVARCHAR(450) NOT NULL,
  [caseId]        NVARCHAR(450) NOT NULL,
  [companyId]     NVARCHAR(450) NOT NULL,
  [direction]     NVARCHAR(20) NOT NULL,
  [source]        NVARCHAR(50) NOT NULL,
  [fromAddress]   NVARCHAR(320) NOT NULL,
  [fromName]      NVARCHAR(Max) NULL,
  [toAddresses]   NVARCHAR(Max) NOT NULL,
  [ccAddresses]   NVARCHAR(Max) NULL,
  [bccAddresses]  NVARCHAR(Max) NULL,
  [subject]       NVARCHAR(Max) NOT NULL,
  [bodyHtml]      NVARCHAR(Max) NOT NULL,
  [bodyText]      NVARCHAR(Max) NULL,
  [messageId]     NVARCHAR(998) NULL,
  [inReplyTo]     NVARCHAR(998) NULL,
  [refs]          NVARCHAR(Max) NULL,
  [dispatchId]    NVARCHAR(450) NULL,
  [visibility]    NVARCHAR(50) NOT NULL CONSTRAINT [DF_CaseEmail_visibility] DEFAULT 'Customer',
  [sentByUserId]  NVARCHAR(450) NULL,
  [rawSize]       INT NULL,
  [headersJson]   NVARCHAR(Max) NULL,
  [sentAt]        DATETIME2 NULL,
  [receivedAt]    DATETIME2 NULL,
  [createdAt]     DATETIME2 NOT NULL CONSTRAINT [DF_CaseEmail_createdAt] DEFAULT sysutcdatetime(),
  [updatedAt]     DATETIME2 NOT NULL,
  CONSTRAINT [CaseEmail_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE UNIQUE NONCLUSTERED INDEX [CaseEmail_companyId_messageId_key]
  ON [dbo].[CaseEmail]([companyId], [messageId])
  WHERE [messageId] IS NOT NULL;

CREATE NONCLUSTERED INDEX [CaseEmail_caseId_sentAt_idx]
  ON [dbo].[CaseEmail]([caseId], [sentAt]);
CREATE NONCLUSTERED INDEX [CaseEmail_caseId_receivedAt_idx]
  ON [dbo].[CaseEmail]([caseId], [receivedAt]);
CREATE NONCLUSTERED INDEX [CaseEmail_caseId_createdAt_idx]
  ON [dbo].[CaseEmail]([caseId], [createdAt]);
CREATE NONCLUSTERED INDEX [CaseEmail_companyId_direction_idx]
  ON [dbo].[CaseEmail]([companyId], [direction]);
CREATE NONCLUSTERED INDEX [CaseEmail_dispatchId_idx]
  ON [dbo].[CaseEmail]([dispatchId]);

ALTER TABLE [dbo].[CaseEmail]
  ADD CONSTRAINT [CaseEmail_caseId_fkey]
  FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id])
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE [dbo].[CaseEmail]
  ADD CONSTRAINT [CaseEmail_companyId_fkey]
  FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[CaseEmail]
  ADD CONSTRAINT [CaseEmail_sentByUserId_fkey]
  FOREIGN KEY ([sentByUserId]) REFERENCES [dbo].[User]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[CaseEmail]
  ADD CONSTRAINT [CaseEmail_dispatchId_fkey]
  FOREIGN KEY ([dispatchId]) REFERENCES [dbo].[NotificationDispatch]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ──────────────────────── CaseEmailAttachment ────────────────────────
CREATE TABLE [dbo].[CaseEmailAttachment] (
  [id]         NVARCHAR(450) NOT NULL,
  [emailId]    NVARCHAR(450) NOT NULL,
  [storageKey] NVARCHAR(Max) NOT NULL,
  [fileName]   NVARCHAR(Max) NOT NULL,
  [mimeType]   NVARCHAR(255) NOT NULL,
  [fileSize]   INT NOT NULL,
  [contentId]  NVARCHAR(Max) NULL,
  [isInline]   BIT NOT NULL CONSTRAINT [DF_CaseEmailAttachment_isInline] DEFAULT 0,
  [createdAt]  DATETIME2 NOT NULL CONSTRAINT [DF_CaseEmailAttachment_createdAt] DEFAULT sysutcdatetime(),
  CONSTRAINT [CaseEmailAttachment_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE NONCLUSTERED INDEX [CaseEmailAttachment_emailId_idx]
  ON [dbo].[CaseEmailAttachment]([emailId]);

ALTER TABLE [dbo].[CaseEmailAttachment]
  ADD CONSTRAINT [CaseEmailAttachment_emailId_fkey]
  FOREIGN KEY ([emailId]) REFERENCES [dbo].[CaseEmail]([id])
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- ──────────────────────── Case K4 alanları ────────────────────────
ALTER TABLE [dbo].[Case] ADD
  [lastEmailInboundAt]   DATETIME2 NULL,
  [lastEmailOutboundAt]  DATETIME2 NULL,
  [pendingCustomerReply] BIT NOT NULL CONSTRAINT [DF_Case_pendingCustomerReply] DEFAULT 0;

CREATE NONCLUSTERED INDEX [Case_companyId_pendingCustomerReply_idx]
  ON [dbo].[Case]([companyId], [pendingCustomerReply]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
