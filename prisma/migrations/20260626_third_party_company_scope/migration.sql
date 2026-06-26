-- companyId kolonu yoksa ekle (ilk denemede eklenmiş olabilir)
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.ThirdParty') AND name = 'companyId'
)
    ALTER TABLE [dbo].[ThirdParty] ADD [companyId] NVARCHAR(450) NULL;

-- Eski UNIQUE CONSTRAINT varsa kaldır
IF EXISTS (
    SELECT 1 FROM sys.key_constraints
    WHERE name = 'ThirdParty_name_key' AND parent_object_id = OBJECT_ID('dbo.ThirdParty')
)
    ALTER TABLE [dbo].[ThirdParty] DROP CONSTRAINT [ThirdParty_name_key];

-- Eski UNIQUE INDEX varsa kaldır (constraint değil index olarak oluşturulmuşsa)
IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'ThirdParty_name_key' AND object_id = OBJECT_ID('dbo.ThirdParty')
)
    DROP INDEX [ThirdParty_name_key] ON [dbo].[ThirdParty];

-- Yeni composite UNIQUE index yoksa ekle
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'ThirdParty_name_companyId_key' AND object_id = OBJECT_ID('dbo.ThirdParty')
)
    CREATE UNIQUE INDEX [ThirdParty_name_companyId_key] ON [dbo].[ThirdParty]([name], [companyId]);

-- FK constraint yoksa ekle
IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = 'ThirdParty_companyId_fkey' AND parent_object_id = OBJECT_ID('dbo.ThirdParty')
)
    ALTER TABLE [dbo].[ThirdParty] ADD CONSTRAINT [ThirdParty_companyId_fkey]
        FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]);
