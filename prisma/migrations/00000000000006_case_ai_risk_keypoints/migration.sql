-- RUNA AI Faz 3 — Case.aiRiskLevel + Case.aiKeyPoints
--
-- Spec: /tmp/runa-ai-enrichment-plan.md (v2) Faz 3.
-- Mevcut supervisor-summary çıktısındaki riskLevel + keyPoints persist
-- edilmiyordu (sadece transient state); reload'da kayıp. Bu migration
-- iki nullable sütun ekler. Faz 2 commit'inde caseService.update payload'una
-- yazılır; UI Faz 3 commit'inde gösterir.
--
-- Modeller:
--   Case.aiRiskLevel  NVARCHAR(50)   — enum: 'Düşük'|'Orta'|'Yüksek'|'Kritik'
--                                       (string tutulur; mevcut aiPriorityPrediction
--                                       pattern'i ile uyumlu — enum yerine string
--                                       ki migration gerekmesin ileride genişler)
--   Case.aiKeyPoints  NVARCHAR(MAX)  — JSON array<string>; MSSQL'de JSON tip
--                                       yok, customFields aynı pattern
--
-- NULL default → eski Case'ler "—" görür (breaking change yok).
-- Backfill YOK — yeni Analiz Et tıklamasında dolar.
-- Index YOK — bu alanlar filtre/arama için kullanılmaz, sadece okuma.

BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[Case]
  ADD [aiRiskLevel] NVARCHAR(50) NULL;

ALTER TABLE [dbo].[Case]
  ADD [aiKeyPoints] NVARCHAR(MAX) NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
