-- SLAPolicy: taxonomy alanları nullable yapılır + priority alanı eklenir.
-- Case: slaResponseMetAt ve slaResolutionStartedAt alanları eklenir.
-- Mevcut SLAPolicy satırlarında NULL olmayan alanlar korunur (breaking change yok).

-- ─── SLAPolicy: productGroup nullable ───────────────────────────────────────
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.SLAPolicy') AND name = 'productGroup'
      AND is_nullable = 0
)
    ALTER TABLE [dbo].[SLAPolicy] ALTER COLUMN [productGroup] NVARCHAR(200) NULL;

-- ─── SLAPolicy: categoryName nullable ────────────────────────────────────────
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.SLAPolicy') AND name = 'categoryName'
      AND is_nullable = 0
)
    ALTER TABLE [dbo].[SLAPolicy] ALTER COLUMN [categoryName] NVARCHAR(255) NULL;

-- ─── SLAPolicy: subCategoryName nullable ─────────────────────────────────────
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.SLAPolicy') AND name = 'subCategoryName'
      AND is_nullable = 0
)
    ALTER TABLE [dbo].[SLAPolicy] ALTER COLUMN [subCategoryName] NVARCHAR(255) NULL;

-- ─── SLAPolicy: requestType nullable ─────────────────────────────────────────
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.SLAPolicy') AND name = 'requestType'
      AND is_nullable = 0
)
    ALTER TABLE [dbo].[SLAPolicy] ALTER COLUMN [requestType] NVARCHAR(50) NULL;

-- ─── SLAPolicy: priority alanı ekle ─────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.SLAPolicy') AND name = 'priority'
)
    ALTER TABLE [dbo].[SLAPolicy] ADD [priority] NVARCHAR(50) NULL;

-- ─── Eski composite unique index kaldır (nullable alanlar içerdiğinden geçersiz) ─
IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'SLAPolicy_companyId_productGroup_categoryName_subCategoryName_requestType_key'
      AND object_id = OBJECT_ID('dbo.SLAPolicy')
)
    DROP INDEX [SLAPolicy_companyId_productGroup_categoryName_subCategoryName_requestType_key]
        ON [dbo].[SLAPolicy];

-- ─── Yeni companyId index ekle (wildcard resolver için yeterli) ──────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'SLAPolicy_companyId_idx' AND object_id = OBJECT_ID('dbo.SLAPolicy')
)
    CREATE NONCLUSTERED INDEX [SLAPolicy_companyId_idx]
        ON [dbo].[SLAPolicy]([companyId]);

-- ─── Case: slaResponseMetAt ──────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.Case') AND name = 'slaResponseMetAt'
)
    ALTER TABLE [dbo].[Case] ADD [slaResponseMetAt] DATETIME2 NULL;

-- ─── Case: slaResolutionStartedAt ────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.Case') AND name = 'slaResolutionStartedAt'
)
    ALTER TABLE [dbo].[Case] ADD [slaResolutionStartedAt] DATETIME2 NULL;
