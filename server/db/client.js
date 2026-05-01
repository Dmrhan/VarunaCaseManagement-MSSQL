import { PrismaClient } from '@prisma/client';

/**
 * Prisma client singleton.
 *
 * MSSQL geçişinde bu dosya değişmez. Sadece schema.prisma'da
 * `provider = "sqlserver"` ve DATABASE_URL güncellenir.
 *
 * Vercel serverless cold-start'larında her function instance için
 * yeni bir PrismaClient olur — global cache ile aynı isteğin
 * sonraki sorgularında reuse edilir. Local dev'de --watch restart'larında
 * leak engelleme: globalThis üzerinde sakla.
 */

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma;
}
