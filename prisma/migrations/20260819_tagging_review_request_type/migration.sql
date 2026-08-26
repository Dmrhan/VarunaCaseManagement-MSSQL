-- Vaka Etiket Doğrulama Ekranı'na Talep Türü doğrulaması eklendi.
--
-- Diğer 9 etiketten farklı: kaynağı Case.customFields.smartTicket JSON'ı
-- DEĞİL, doğrudan Case.requestType kolonu; geçerli seçenekleri TaxonomyDef
-- DEĞİL, sabit 5 değerlik enum (Bilgi/Öneri/Talep/Şikayet/Hata). Kolon
-- ailesi aynı desende (prefix'siz), Original/Verdict/Corrected anlamı aynı.
--
-- Additive: NULL başlar → mevcut hiçbir vakada/review kaydında davranış
-- değişmez.

BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[CaseTaggingReview] ADD
  [requestTypeOriginalCode] NVARCHAR(255) NULL,
  [requestTypeOriginalLabel] NVARCHAR(MAX) NULL,
  [requestTypeVerdict] NVARCHAR(50) NULL,
  [requestTypeCorrectedCode] NVARCHAR(255) NULL,
  [requestTypeCorrectedLabel] NVARCHAR(MAX) NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
