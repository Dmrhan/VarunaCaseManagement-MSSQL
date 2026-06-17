-- PR-3 — Admin taxonomy audit fields (createdByUserId, updatedByUserId)
--
-- 6 admin model'e additive nullable FK eklenir. Mevcut satırlar NULL kalır
-- (= "legacy/unknown attribution"). Backfill yapılmaz — display name'lerden
-- TAHMIN ETME (aynı isimde 2 user olabilir).
--
-- Etkilenen modeller:
--   - Team
--   - CategoryDef
--   - SLAPolicy
--   - FieldDefinition
--   - TaxonomyDef
--   - ChecklistTemplate
--
-- FK action ON DELETE NO ACTION — User silinince audit history kaybolmasın;
-- referans NULL'a düşmeden korunur (constraint violation potansiyeli; UI
-- "Silinmiş kullanıcı" gösterir).

BEGIN TRY

BEGIN TRAN;

-- ── Team ────────────────────────────────────────────────────
ALTER TABLE [dbo].[Team]
  ADD [createdByUserId] NVARCHAR(450) NULL,
      [updatedByUserId] NVARCHAR(450) NULL;

ALTER TABLE [dbo].[Team]
  ADD CONSTRAINT [Team_createdByUserId_fkey]
  FOREIGN KEY ([createdByUserId]) REFERENCES [dbo].[User]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[Team]
  ADD CONSTRAINT [Team_updatedByUserId_fkey]
  FOREIGN KEY ([updatedByUserId]) REFERENCES [dbo].[User]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ── CategoryDef ─────────────────────────────────────────────
ALTER TABLE [dbo].[CategoryDef]
  ADD [createdByUserId] NVARCHAR(450) NULL,
      [updatedByUserId] NVARCHAR(450) NULL;

ALTER TABLE [dbo].[CategoryDef]
  ADD CONSTRAINT [CategoryDef_createdByUserId_fkey]
  FOREIGN KEY ([createdByUserId]) REFERENCES [dbo].[User]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[CategoryDef]
  ADD CONSTRAINT [CategoryDef_updatedByUserId_fkey]
  FOREIGN KEY ([updatedByUserId]) REFERENCES [dbo].[User]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ── SLAPolicy ───────────────────────────────────────────────
ALTER TABLE [dbo].[SLAPolicy]
  ADD [createdByUserId] NVARCHAR(450) NULL,
      [updatedByUserId] NVARCHAR(450) NULL;

ALTER TABLE [dbo].[SLAPolicy]
  ADD CONSTRAINT [SLAPolicy_createdByUserId_fkey]
  FOREIGN KEY ([createdByUserId]) REFERENCES [dbo].[User]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[SLAPolicy]
  ADD CONSTRAINT [SLAPolicy_updatedByUserId_fkey]
  FOREIGN KEY ([updatedByUserId]) REFERENCES [dbo].[User]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ── FieldDefinition ─────────────────────────────────────────
ALTER TABLE [dbo].[FieldDefinition]
  ADD [createdByUserId] NVARCHAR(450) NULL,
      [updatedByUserId] NVARCHAR(450) NULL;

ALTER TABLE [dbo].[FieldDefinition]
  ADD CONSTRAINT [FieldDefinition_createdByUserId_fkey]
  FOREIGN KEY ([createdByUserId]) REFERENCES [dbo].[User]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[FieldDefinition]
  ADD CONSTRAINT [FieldDefinition_updatedByUserId_fkey]
  FOREIGN KEY ([updatedByUserId]) REFERENCES [dbo].[User]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ── TaxonomyDef ─────────────────────────────────────────────
ALTER TABLE [dbo].[TaxonomyDef]
  ADD [createdByUserId] NVARCHAR(450) NULL,
      [updatedByUserId] NVARCHAR(450) NULL;

ALTER TABLE [dbo].[TaxonomyDef]
  ADD CONSTRAINT [TaxonomyDef_createdByUserId_fkey]
  FOREIGN KEY ([createdByUserId]) REFERENCES [dbo].[User]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[TaxonomyDef]
  ADD CONSTRAINT [TaxonomyDef_updatedByUserId_fkey]
  FOREIGN KEY ([updatedByUserId]) REFERENCES [dbo].[User]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ── ChecklistTemplate ───────────────────────────────────────
ALTER TABLE [dbo].[ChecklistTemplate]
  ADD [createdByUserId] NVARCHAR(450) NULL,
      [updatedByUserId] NVARCHAR(450) NULL;

ALTER TABLE [dbo].[ChecklistTemplate]
  ADD CONSTRAINT [ChecklistTemplate_createdByUserId_fkey]
  FOREIGN KEY ([createdByUserId]) REFERENCES [dbo].[User]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[ChecklistTemplate]
  ADD CONSTRAINT [ChecklistTemplate_updatedByUserId_fkey]
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
