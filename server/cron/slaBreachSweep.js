import { prisma } from '../db/client.js';

/**
 * SLA ihlali taraması — her 5 dakikada bir çalışır.
 *
 * slaResolutionDueAt geçmiş, vaka açık ve slaViolation henüz false olan
 * kayıtları toplu olarak ihlali işaretler. Idempotent: zaten işaretli
 * satırlar atlanır.
 */
export async function runSlaBreachSweep() {
  const now = new Date();

  const { count } = await prisma.case.updateMany({
    where: {
      slaViolation: false,
      slaResolutionDueAt: { lt: now, not: null },
      status: { notIn: ['Cozuldu', 'IptalEdildi'] },
      // 2026-07-06 — arşivli vaka SLA ihlali İŞARETLENMEZ (arşivdeki 441
      // "Açık" temizlik vakası sweep'te ihlal damgalanıp sayaçları şişirmesin)
      isArchived: false,
    },
    data: { slaViolation: true },
  });

  return { marked: count, at: now.toISOString() };
}
