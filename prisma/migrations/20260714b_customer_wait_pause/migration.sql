-- SLA iş-saati Faz 3b — müşteri-bekleme duraklatma alanları.
--
-- WorkCalendar.pauseOnCustomerWait toggle'ı (K-F parametrik karar) açıkken:
-- ajan müşteriye yanıt verince çözüm sayacı durur (slaCustomerWaitStartedAt
-- damgalanır), müşteri dönünce duraklama kapanır ve slaResolutionDueAt
-- geçen süre kadar (takvimli şirkette İŞ-dakikası) ötelenir.
--
-- 3rd-party duraklatmasından (slaPausedAt) AYRI alan: iki kaynak çakışırsa
-- 3rd-party öncelikli — 3rdPartyBekleniyor'a girişte müşteri-bekleme
-- kapatılır (çifte sayım sınıf olarak imkânsız).
--
-- Additive: nullable kolon + default'lu INT; davranış yalnız toggle açık
-- şirketlerde değişir (bugün hepsi kapalı — K-F: default durmasın).

BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[Case] ADD
  [slaCustomerWaitStartedAt] DATETIME2 NULL,
  [slaCustomerWaitMin]       INT NOT NULL CONSTRAINT [DF_Case_slaCustomerWaitMin] DEFAULT 0;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
