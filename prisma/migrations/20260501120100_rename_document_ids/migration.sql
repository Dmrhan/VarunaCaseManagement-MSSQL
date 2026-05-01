-- DocumentType satır ID'lerini EVRAK-* önekinden DOC-* önekine taşı.
-- Tablo rename'inden sonra ID'lerin de yeni naming'e uyması için.
UPDATE "DocumentType"
SET "id" = REPLACE("id", 'EVRAK-', 'DOC-')
WHERE "id" LIKE 'EVRAK-%';
