-- Authorization Management persistence foundation.
--
-- Additive table only. No runtime enforcement is wired by this migration.
-- Stores tenant-scoped policy rows for:
--   - menu visibility
--   - resource CRUD/action permissions
--   - field visibility/editability/mandatory/masking
--   - row-level security filter DSL
--
-- JSON fields are NVARCHAR(MAX) for MSSQL provider compatibility.

BEGIN TRY

BEGIN TRAN;

CREATE TABLE [dbo].[AuthorizationPolicy] (
  [id]              NVARCHAR(450) NOT NULL,
  [companyId]       NVARCHAR(450) NOT NULL,
  [target]          NVARCHAR(50)  NOT NULL,
  [principalType]   NVARCHAR(50)  NOT NULL,
  [principalKey]    NVARCHAR(450) NOT NULL,
  [effect]          NVARCHAR(20)  NOT NULL,
  [menuKey]         NVARCHAR(150) NULL,
  [viewKey]         NVARCHAR(150) NULL,
  [resourceKey]     NVARCHAR(150) NULL,
  [action]          NVARCHAR(50)  NULL,
  [scope]           NVARCHAR(100) NULL,
  [fieldKey]        NVARCHAR(150) NULL,
  [filterJson]      NVARCHAR(MAX) NULL,
  [priority]        INT           NOT NULL CONSTRAINT [AuthorizationPolicy_priority_df] DEFAULT 100,
  [isActive]        BIT           NOT NULL CONSTRAINT [AuthorizationPolicy_isActive_df] DEFAULT 1,
  [notes]           NVARCHAR(MAX) NULL,
  [createdByUserId] NVARCHAR(450) NULL,
  [updatedByUserId] NVARCHAR(450) NULL,
  [createdAt]       DATETIME2     NOT NULL CONSTRAINT [AuthorizationPolicy_createdAt_df] DEFAULT sysutcdatetime(),
  [updatedAt]       DATETIME2     NOT NULL,
  CONSTRAINT [AuthorizationPolicy_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE NONCLUSTERED INDEX [AuthorizationPolicy_companyId_target_isActive_idx]
  ON [dbo].[AuthorizationPolicy]([companyId], [target], [isActive]);

CREATE NONCLUSTERED INDEX [AuthorizationPolicy_companyId_principalType_principalKey_idx]
  ON [dbo].[AuthorizationPolicy]([companyId], [principalType], [principalKey]);

CREATE NONCLUSTERED INDEX [AuthorizationPolicy_companyId_resourceKey_action_idx]
  ON [dbo].[AuthorizationPolicy]([companyId], [resourceKey], [action]);

CREATE NONCLUSTERED INDEX [AuthorizationPolicy_companyId_scope_fieldKey_idx]
  ON [dbo].[AuthorizationPolicy]([companyId], [scope], [fieldKey]);

CREATE NONCLUSTERED INDEX [AuthorizationPolicy_companyId_menuKey_idx]
  ON [dbo].[AuthorizationPolicy]([companyId], [menuKey]);

ALTER TABLE [dbo].[AuthorizationPolicy]
  ADD CONSTRAINT [AuthorizationPolicy_companyId_fkey]
  FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id])
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE [dbo].[AuthorizationPolicy]
  ADD CONSTRAINT [AuthorizationPolicy_createdByUserId_fkey]
  FOREIGN KEY ([createdByUserId]) REFERENCES [dbo].[User]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[AuthorizationPolicy]
  ADD CONSTRAINT [AuthorizationPolicy_updatedByUserId_fkey]
  FOREIGN KEY ([updatedByUserId]) REFERENCES [dbo].[User]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
