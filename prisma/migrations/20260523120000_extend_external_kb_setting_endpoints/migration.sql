-- WR-KB3 — Extend ExternalKbSetting with new endpoint paths + defaults for
-- EnRoute KB / AI external service console. Additive only; existing rows
-- pick up new defaults at column-add time (Postgres behavior with NOT NULL
-- + DEFAULT).

ALTER TABLE "ExternalKbSetting"
  ADD COLUMN "healthEndpointPath"     TEXT NOT NULL DEFAULT '/api/v1/health',
  ADD COLUMN "statsEndpointPath"      TEXT NOT NULL DEFAULT '/api/v1/stats',
  ADD COLUMN "categorizeEndpointPath" TEXT NOT NULL DEFAULT '/api/v1/categorize',
  ADD COLUMN "analyzeEndpointPath"    TEXT NOT NULL DEFAULT '/api/v1/analyze',
  ADD COLUMN "defaultStrictness"      TEXT NOT NULL DEFAULT 'lenient',
  ADD COLUMN "defaultRerank"          BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "defaultVerify"          BOOLEAN NOT NULL DEFAULT true;

-- ask/search default'larını yeni full path'lere çevir. Mevcut tenant satırları
-- önceki "/ask" / "/search" değerleriyle taşınıyor; bu UPDATE eski default'a
-- bağlı kalanları yeni full path'e geçirir (override etmiş tenant varsa zaten
-- farklı bir değerdir, onlar etkilenmez).
UPDATE "ExternalKbSetting"
   SET "askEndpointPath" = '/api/v1/kb/ask'
 WHERE "askEndpointPath" = '/ask';
UPDATE "ExternalKbSetting"
   SET "searchEndpointPath" = '/api/v1/kb/search'
 WHERE "searchEndpointPath" = '/search';

-- timeoutMs ve defaultTopK için varsayılan değişikliği yalnızca yeni satırlar
-- için anlamlı; mevcut satırlardaki 15000/5 olduğu gibi kalır (UPDATE yok —
-- tenant ayarını gözden geçirmek admin işi).
ALTER TABLE "ExternalKbSetting"
  ALTER COLUMN "timeoutMs"   SET DEFAULT 30000,
  ALTER COLUMN "defaultTopK" SET DEFAULT 8,
  ALTER COLUMN "askEndpointPath"    SET DEFAULT '/api/v1/kb/ask',
  ALTER COLUMN "searchEndpointPath" SET DEFAULT '/api/v1/kb/search';
