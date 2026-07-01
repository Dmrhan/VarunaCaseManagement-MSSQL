-- PR-1: caseNumber firma-prefix + per-tenant sıralı bigint (motor PR-2'de).
--
-- 3 additive değişiklik + Univera seed:
--   1. Company.caseNumberPrefix NVARCHAR(4) NULL @unique
--   2. Case.caseSeq BIGINT NULL + composite @@unique (companyId, caseSeq)
--   3. Yeni tablo CaseNumberCounter (companyId PK, lastAssignedNumber BigInt)
--   4. Univera → 'UNV' seed (idempotent — WHERE caseNumberPrefix IS NULL)
--
-- Additive: mevcut Case + Company rows dokunulmaz; legacy VK-* vakalar
-- caseSeq NULL kalır (composite unique NULL toleranslı SQL Server'da).
-- Motor değişimi (Date.now kaldırma) PR-2'de.

BEGIN TRY

BEGIN TRAN;

-- 1) Company.caseNumberPrefix — 2-4 harf, tenant-unique. Nullable (bu PR),
--    PR-2 canlıya çıkmadan tüm firmalara set edilecek (deploy gate).
ALTER TABLE [dbo].[Company]
  ADD [caseNumberPrefix] NVARCHAR(4) NULL;

-- Filtered unique — NULL değerler indexe girmez, birden fazla NULL prefix'li
-- firma sorun değil (deploy gate öncesi).
CREATE UNIQUE INDEX [Company_caseNumberPrefix_key]
  ON [dbo].[Company] ([caseNumberPrefix])
  WHERE [caseNumberPrefix] IS NOT NULL;

-- 2) Case.caseSeq — per-tenant sıralı numara (BigInt).
ALTER TABLE [dbo].[Case]
  ADD [caseSeq] BIGINT NULL;

-- Composite unique — (companyId, caseSeq); NULL caseSeq legacy VK-* satırlar
-- SQL Server default davranışında NULL != NULL, çakışma yok.
CREATE UNIQUE INDEX [Case_companyId_caseSeq_key]
  ON [dbo].[Case] ([companyId], [caseSeq])
  WHERE [caseSeq] IS NOT NULL;

-- 3) CaseNumberCounter — per-tenant sayaç. Lazy-init: ilk vakada
--    INSERT lastAssignedNumber=1000000 (o vaka bu numarayı alır),
--    sonraki her vakada UPDATE lastAssignedNumber+=1.
CREATE TABLE [dbo].[CaseNumberCounter] (
  [companyId]          NVARCHAR(450) NOT NULL,
  [lastAssignedNumber] BIGINT        NOT NULL,
  [updatedAt]          DATETIME2     NOT NULL DEFAULT sysutcdatetime(),
  CONSTRAINT [CaseNumberCounter_pkey] PRIMARY KEY ([companyId]),
  CONSTRAINT [CaseNumberCounter_companyId_fkey]
    FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id])
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- 4) Univera → 'UNV' seed. Idempotent: NULL prefix'li Univera'ya set.
--    Diğer firmalar UI/admin tarafından set edilecek (PR-1 UI hazır).
UPDATE [dbo].[Company]
   SET [caseNumberPrefix] = 'UNV'
 WHERE [caseNumberPrefix] IS NULL
   AND [name] = 'UNIVERA';

COMMIT TRAN;

END TRY

BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
