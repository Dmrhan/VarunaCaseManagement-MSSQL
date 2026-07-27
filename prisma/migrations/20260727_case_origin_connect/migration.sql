-- CaseOrigin 'Connect' değeri (2026-07-27) — Varuna↔Connect entegrasyonu,
-- POST /api/connect/tickets create akışı (server/db/connectResolver.js::
-- createConnectCase, server/routes/connectApi.js).
--
-- NEDEN GEREKLİ: Case.origin Prisma şemasında native enum DEĞİL (MSSQL
-- connector enum desteklemiyor) — `String @db.NVarChar(50) // enum:CaseOrigin`
-- yorumlu bir alan. Uygulama katmanında bu yalnızca server/db/enumMap.js
-- (M_ORIGIN) + prisma/enum-values.json ile "belge/validation" seviyesinde
-- tutuluyor GİBİ görünüyor, ama DB'de gerçek bir CHECK constraint (CK_Case_origin,
-- bkz. prisma/migrations/00000000000000_init/migration.sql) 5 sabit değere
-- kilitliyor. Bu yüzden yalnız enumMap.js/enum-values.json güncellemesi
-- YETERSİZ — constraint güncellenmeden 'Connect' ile INSERT/UPDATE MSSQL
-- error 547 (CHECK constraint violation) ile reddedilir. Bu migration bunu
-- düzeltir.
--
-- Additive/geriye-dönük güvenli: mevcut 5 değer (Telefon/Eposta/Web/Chatbot/
-- Diger) AYNEN korunur — yalnızca 'Connect' ek değer olarak izin verilir.
-- Mevcut satırlar/davranış hiç değişmez.

BEGIN TRY

BEGIN TRAN;

IF EXISTS (
  SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Case_origin'
)
BEGIN
  ALTER TABLE [dbo].[Case] DROP CONSTRAINT [CK_Case_origin];
END;

ALTER TABLE [dbo].[Case] ADD CONSTRAINT [CK_Case_origin]
  CHECK (
    [origin] = N'Connect'
    OR [origin] = N'Diger'
    OR [origin] = N'Chatbot'
    OR [origin] = N'Web'
    OR [origin] = N'Eposta'
    OR [origin] = N'Telefon'
  );

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
