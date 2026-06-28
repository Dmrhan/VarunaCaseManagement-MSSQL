-- Mail M6.3b Faz 3 — CaseEmailTemplate (agent composer "Mail Şablonu" dropdown).
--
-- Plan referansı: M6.3b plan §Faz 3.
-- n4b parite + endüstri araştırması (Zendesk macros, Freshdesk canned
-- responses, Gmail templates).
--
-- NotificationTemplate'ten AYRI model: rule-driven dispatch vs agent
-- self-service taslaklar. Per-tenant scope; admin only create v1.
--
-- Additive: yeni tablo + 1 FK Company → caseEmailTemplates. Mevcut data
-- etkilenmez; backfill yok.

BEGIN TRY

BEGIN TRAN;

CREATE TABLE [dbo].[CaseEmailTemplate] (
  [id]               NVARCHAR(450) NOT NULL CONSTRAINT [PK_CaseEmailTemplate] PRIMARY KEY,
  [companyId]        NVARCHAR(450) NOT NULL,
  [name]             NVARCHAR(255) NOT NULL,
  [category]         NVARCHAR(100) NULL,
  [subject]          NVARCHAR(MAX) NULL,
  [bodyHtml]         NVARCHAR(MAX) NOT NULL,
  [variables]        NVARCHAR(MAX) NOT NULL,
  [isActive]         BIT NOT NULL CONSTRAINT [DF_CaseEmailTemplate_isActive] DEFAULT 1,
  [createdAt]        DATETIME2 NOT NULL CONSTRAINT [DF_CaseEmailTemplate_createdAt] DEFAULT sysutcdatetime(),
  [updatedAt]        DATETIME2 NOT NULL,
  [createdByUserId]  NVARCHAR(450) NULL,
  [updatedByUserId]  NVARCHAR(450) NULL,
  CONSTRAINT [FK_CaseEmailTemplate_Company]
    FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id])
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- Per-tenant ad unique (dropdown aynı adlı template iki kez göstermesin).
CREATE UNIQUE INDEX [UQ_CaseEmailTemplate_companyId_name]
  ON [dbo].[CaseEmailTemplate]([companyId], [name]);

-- Aktif template listesi için scope-aware index.
CREATE INDEX [IX_CaseEmailTemplate_companyId_isActive]
  ON [dbo].[CaseEmailTemplate]([companyId], [isActive]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
