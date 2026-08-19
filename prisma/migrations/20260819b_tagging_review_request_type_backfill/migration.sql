-- Talep Türü backfill — 20260819_tagging_review_request_type takip migration'ı.
--
-- upsertTaggingReview()'da Original{Code,Label} snapshot alanları SADECE
-- create yolunda set edilir (tasarım gereği — bilgi bankası veri seti
-- kalıcı bir noktasal-zaman kaydı olsun diye, sonradan asla dokunulmaz).
-- Bu migration'dan ÖNCE var olan HER CaseTaggingReview satırı update
-- yoluna düşer — snapshot bloğuna hiç ulaşmaz — requestTypeOriginalCode/
-- Label kalıcı olarak NULL kalırdı; re-review bile onu doldurmazdı, ve
-- "Doğru" işaretlenen satırlarda export'ta "Doğru Etiket" boş görünürdü.
--
-- Tek seferlik, idempotent backfill: yalnız requestTypeOriginalCode NULL
-- olan (yani bu migration'dan önce oluşmuş) satırları, ilişkili vakanın
-- ŞU ANKİ Case.requestType'ından doldurur. R_REQUEST_TYPE (server/db/
-- caseRepository.js) ile birebir aynı ASCII→TR eşlemesi burada SQL CASE
-- olarak tekrarlanır (yalnızca 5 sabit değer, drift riski yok).

BEGIN TRY

BEGIN TRAN;

UPDATE r
SET
  r.[requestTypeOriginalCode]  = c.[requestType],
  r.[requestTypeOriginalLabel] = CASE c.[requestType]
    WHEN N'Bilgi'   THEN N'Bilgi'
    WHEN N'Oneri'   THEN N'Öneri'
    WHEN N'Talep'   THEN N'Talep'
    WHEN N'Sikayet' THEN N'Şikayet'
    WHEN N'Hata'    THEN N'Hata'
    ELSE c.[requestType]
  END
FROM [dbo].[CaseTaggingReview] r
JOIN [dbo].[Case] c ON c.[id] = r.[caseId]
WHERE r.[requestTypeOriginalCode] IS NULL
  AND c.[requestType] IS NOT NULL
  AND c.[requestType] <> N'';

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
