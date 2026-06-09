-- WR-KB-v2 — ticket-analiz API v1 yeni uçları.
--
-- Additive: mevcut ExternalKbSetting satırları default değer alır;
-- runtime davranışı bozulmaz.
--
-- Yeni kolonlar:
--   categorizeV2EndpointPath → "/api/v1/categorize-v2" (doc §6 — 6 alan
--     açılış sınıflandırma, KB kullanmaz, ~60sn)
--   suggestCloseEndpointPath → "/api/v1/suggest-close" (doc §7 — 4 alan
--     kapanış önerisi)

ALTER TABLE "ExternalKbSetting"
    ADD COLUMN "categorizeV2EndpointPath" TEXT NOT NULL DEFAULT '/api/v1/categorize-v2';

ALTER TABLE "ExternalKbSetting"
    ADD COLUMN "suggestCloseEndpointPath" TEXT NOT NULL DEFAULT '/api/v1/suggest-close';
