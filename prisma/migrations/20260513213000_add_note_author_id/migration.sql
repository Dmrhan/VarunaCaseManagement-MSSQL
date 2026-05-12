-- AlterTable: CaseNote — authorId opsiyonel User.id referansı
-- Reaksiyon/yanıt bildirimleri için gerekir; eski notlarda NULL kalır.
ALTER TABLE "CaseNote" ADD COLUMN "authorId" TEXT;
