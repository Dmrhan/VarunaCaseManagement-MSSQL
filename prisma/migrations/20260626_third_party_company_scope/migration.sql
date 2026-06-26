-- ThirdParty tablosuna companyId kolonu ekle
ALTER TABLE [ThirdParty] ADD [companyId] NVARCHAR(450) NULL;

-- Eski UNIQUE index'i kaldır (name üzerindeki)
DROP INDEX IF EXISTS [ThirdParty_name_key] ON [ThirdParty];

-- Yeni composite UNIQUE index ekle (name + companyId)
CREATE UNIQUE INDEX [ThirdParty_name_companyId_key] ON [ThirdParty]([name], [companyId]) WHERE [companyId] IS NOT NULL;

-- NULL companyId için unique (geriye dönük compat: global tanımlar)
CREATE UNIQUE INDEX [ThirdParty_name_null_company_key] ON [ThirdParty]([name]) WHERE [companyId] IS NULL;

-- FK constraint ekle
ALTER TABLE [ThirdParty] ADD CONSTRAINT [ThirdParty_companyId_fkey]
  FOREIGN KEY ([companyId]) REFERENCES [Company]([id])
  ON DELETE SET NULL ON UPDATE CASCADE;
