-- Örüntü-alarm baseline hot path index'i — dbo.Case (companyId, category, isArchived, createdAt).
--
-- NEDEN: GET /api/analytics/patterns her aktif alarm için server/lib/patternInsight.js
-- içindeki baselineCount (7 günlük createdAt aralığı) + liveTriggerCount sayımlarını
-- CANLI çalıştırıyor. Uygun composite index yokken bu sorgular RANGE-SCAN oluyor,
-- DB bağlantısını saniyelerce tutup connection pool'u (limit 21) boşaltıyordu →
-- yaygın P2024 "Timed out fetching a connection" + genel yavaşlık.
-- Eşitlik sütunları (companyId, category, isArchived) önce, aralık sütunu (createdAt)
-- sona → sorgu SCAN yerine SEEK olur; bağlantı milisaniyede serbest kalır.
--
-- ADDITIVE / geriye-dönük güvenli: yalnızca bir NONCLUSTERED index ekler. Hiçbir
-- tablo/kolon/veri değişmez.
--
-- Idempotent: index prod'da ELLE oluşturuldu (IX_Case_company_category_arch_created).
-- Bu migration onu şemaya resmileştirir; guard sayesinde index zaten varsa NO-OP
-- (tekrar deploy güvenli), yeni/temiz ortamda ise oluşturur. Ad, schema.prisma'daki
-- `map:` ve canlı DB ile birebir aynı olmalı — yoksa Prisma drift görür.

BEGIN TRY

BEGIN TRAN;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE [name] = 'IX_Case_company_category_arch_created'
    AND [object_id] = OBJECT_ID(N'[dbo].[Case]')
)
BEGIN
  CREATE NONCLUSTERED INDEX [IX_Case_company_category_arch_created]
    ON [dbo].[Case] ([companyId], [category], [isArchived], [createdAt]);
END;

COMMIT TRAN;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  ;THROW;
END CATCH
