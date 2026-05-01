-- Manuel rename migration: data korunur (DROP/CREATE değil).
-- Prisma'nın varsayılan migrate'i bu rename'i drop+create olarak görüyor;
-- biz veriyi yitirmemek için ALTER TABLE RENAME kullanıyoruz.

ALTER TABLE "EvrakType" RENAME TO "DocumentType";

-- Index'ler (varsa) Postgres'te tabloyla beraber otomatik rename olur.
-- Ama tablo @id @unique için generate edilen index isimleri tabloya bağlı:
ALTER INDEX "EvrakType_pkey" RENAME TO "DocumentType_pkey";
ALTER INDEX "EvrakType_name_key" RENAME TO "DocumentType_name_key";
