-- PR-3 (Pattern Triage AI hypothesis) — PatternAlert + aiHypothesis cache.
--
-- 2 nullable kolon: aiHypothesis (JSON string) + aiHypothesisAt (TTL).
-- LAZY üretim: kart açılışında veya "AI hipotezi" tıklandığında üretilir,
-- saklanır. Cache TTL: aiHypothesisAt < now-24h ise stale → yeniden üretilir.
--
-- Additive: breaking change yok. Mevcut PatternAlert akışı (active list,
-- dismiss, link-cases, notify-team, status) aynen çalışır.

BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[PatternAlert]
  ADD [aiHypothesis] NVARCHAR(Max) NULL,
      [aiHypothesisAt] DATETIME2 NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
