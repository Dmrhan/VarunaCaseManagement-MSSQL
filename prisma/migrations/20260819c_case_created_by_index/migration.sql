-- "Vaka Sahibi" filtresi (GET /api/lookups/case-creators) — Case.createdByUserId
-- üzerinde hiç index yoktu; groupBy([companyId, createdByUserId]) bu index
-- olmadan da çalışır ama tam tablo taraması yapar. Composite index eşitlik
-- sütunlarını (companyId, createdByUserId) kapsar → GROUP BY SEEK'e döner.
--
-- WITH (ONLINE = ON) — Enterprise Edition (bu sunucuda mevcut, doğrulandı);
-- Case büyük ve canlı bir tablo, ONLINE=ON index oluşturma sırasında
-- eşzamanlı okuma/yazmaları bloklamaz (bkz. 20260709_case_assignment_tracking
-- migration'ındaki aynı endişe — orada index'ten bilerek kaçınılmıştı).
--
-- Idempotent: IF NOT EXISTS guard'ı, ad Prisma'nın varsayılan adlandırmasıyla
-- (Case_companyId_createdByUserId_idx) birebir aynı — schema.prisma'daki
-- (map: olmayan) @@index([companyId, createdByUserId]) ile eşleşir.

BEGIN TRY

BEGIN TRAN;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE [name] = 'Case_companyId_createdByUserId_idx'
    AND [object_id] = OBJECT_ID(N'[dbo].[Case]')
)
BEGIN
  CREATE NONCLUSTERED INDEX [Case_companyId_createdByUserId_idx]
    ON [dbo].[Case] ([companyId], [createdByUserId])
    WITH (ONLINE = ON);
END;

COMMIT TRAN;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  ;THROW;
END CATCH
