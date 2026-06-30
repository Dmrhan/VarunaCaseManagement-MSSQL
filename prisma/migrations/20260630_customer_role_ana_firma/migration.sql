-- Faz B-temel (2026-06-30) — Müşteri Türü (rol) + AccountProject Ana Firma bağı.
--
-- İhtiyaç (CR): Univera-FMCG iş modeli. Ana firma (Nestlé) ile bayi
-- (1077 Gıda) arasında proje seviyesinde yapısal bağ; çünkü bir bayi
-- aynı anda birden çok ana firmayla çalışır.
--
-- DOKUNULMAYAN (kararla kilitli):
--  - Account.customerType (LEGAL tip — Corporate/Individual...) ve UI
--    label'ı "Müşteri Tipi" AYNEN korunur. Yeni alan EKLENDİ, eski
--    rename YOK.
--
-- Eklenen alanlar:
--  1. Account.customerRole NVarChar(50) NULL — Müşteri Türü (n4b parite,
--     6 değer: Central / Distributor / RegionalOffice / ChannelPartner /
--     International / Stockbar). Nullable; mevcut Account'lar boş kalır.
--  2. AccountProject.anaFirmaAccountId NVarChar(450) NULL — FK Account.
--     Bayinin (accountCompanyId üzerinden) projesi, hangi ana firmaya
--     ait. Sadece customerRole='Central' olan account'lar referans
--     edilebilir (app-layer enforce). Nullable; mevcut projeler boş.
--
-- Index:
--  - Account.customerRole (filter için; admin/import "tip=Central"
--    sorgusu sık)
--  - AccountProject.anaFirmaAccountId (FK lookup + Faz B bülten için)
--
-- FK strategy:
--  - AccountProject.anaFirmaAccountId → Account(id) ON DELETE NO ACTION
--    Sebep: Account → AccountCompany → AccountProject cascade path
--    zaten var. İkinci cascade (Account → AccountProject ana firma
--    yoluyla) MSSQL "multiple cascade paths" hatası verir. NO ACTION
--    + app-layer cleanup (ana firma silinirken bağlı projeleri
--    bulup uyar).
--
-- Additive: breaking change YOK. Mevcut Account/AccountProject CRUD
-- akışı dokunulmadan çalışır.

BEGIN TRY

BEGIN TRAN;

-- ───────────── Account.customerRole ─────────────
ALTER TABLE [dbo].[Account]
  ADD [customerRole] NVARCHAR(50) NULL;

CREATE NONCLUSTERED INDEX [Account_customerRole_idx]
  ON [dbo].[Account]([customerRole]);

-- ───────────── AccountProject.anaFirmaAccountId ─────────────
ALTER TABLE [dbo].[AccountProject]
  ADD [anaFirmaAccountId] NVARCHAR(450) NULL;

CREATE NONCLUSTERED INDEX [AccountProject_anaFirmaAccountId_idx]
  ON [dbo].[AccountProject]([anaFirmaAccountId]);

-- FK NO ACTION (multi-cascade engelleme — bkz. dosya başı not).
ALTER TABLE [dbo].[AccountProject]
  ADD CONSTRAINT [AccountProject_anaFirmaAccountId_fkey]
  FOREIGN KEY ([anaFirmaAccountId]) REFERENCES [dbo].[Account]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
