-- PR-5 — Optional FK for actor display fields
--
-- 2 modele additive nullable FK eklenir. Display string alanları (eski
-- davranış) KORUNUR — backwards-compat. Hem display string hem FK alanı
-- forward-write'larda doldurulur.
--
-- Modeller:
--   - CaseActivity.actorUserId       (User FK; eski `actor` string kalır)
--   - CaseAttachment.uploadedByUserId (User FK; eski `uploadedBy` string kalır)
--
-- Backfill yapılmaz — mevcut satırlar NULL kalır ("legacy/unknown" attribution).
-- Display name'lerden TAHMIN ETME yasak (aynı isimde 2 user olabilir).
-- UI fallback chain: actorUserId varsa canlı User.fullName göster, yoksa
-- display string'i kullan (geçmiş row'lar olduğu gibi gözükür).
--
-- CaseCallLog.callerId KAPSAM DIŞI — PR-1 sonrası User.id formatında
-- yazılıyor ama FK promote etmek mevcut data ile uyumsuz olabilir
-- (ayrı bir migration'da consider edilecek).

BEGIN TRY

BEGIN TRAN;

-- ── CaseActivity.actorUserId ───────────────────────────────
ALTER TABLE [dbo].[CaseActivity]
  ADD [actorUserId] NVARCHAR(450) NULL;

ALTER TABLE [dbo].[CaseActivity]
  ADD CONSTRAINT [CaseActivity_actorUserId_fkey]
  FOREIGN KEY ([actorUserId]) REFERENCES [dbo].[User]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE NONCLUSTERED INDEX [CaseActivity_actorUserId_idx]
  ON [dbo].[CaseActivity]([actorUserId]);

-- ── CaseAttachment.uploadedByUserId ────────────────────────
ALTER TABLE [dbo].[CaseAttachment]
  ADD [uploadedByUserId] NVARCHAR(450) NULL;

ALTER TABLE [dbo].[CaseAttachment]
  ADD CONSTRAINT [CaseAttachment_uploadedByUserId_fkey]
  FOREIGN KEY ([uploadedByUserId]) REFERENCES [dbo].[User]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE NONCLUSTERED INDEX [CaseAttachment_uploadedByUserId_idx]
  ON [dbo].[CaseAttachment]([uploadedByUserId]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
