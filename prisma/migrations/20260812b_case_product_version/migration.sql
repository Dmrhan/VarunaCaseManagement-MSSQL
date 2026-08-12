-- Vakaya "Versiyon No" alanı — serbest metin, açılışta zorunlu değil.
--
-- Case.productVersion — yalnız COMP-UNIVERA'da Çözüldü'ye geçişten önce
-- zorunlu (app-layer kapanış kapısı, transitionStatus). Diğer tenant'ları
-- etkilemez; DB seviyesinde tüm tenant'lar için nullable.
--
-- Additive: NULL başlar → mevcut hiçbir vakada/tenant'ta davranış değişmez.

BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[Case] ADD
  [productVersion] NVARCHAR(50) NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
