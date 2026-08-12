import { prisma } from '../../db/client.js';

/**
 * Esnek SLA politika çözümleyici.
 *
 * Null alanlar wildcard: case'in herhangi bir değeriyle eşleşir.
 * Non-null alanlar kesin eşleşme gerektirir + özgüllük puanına +1 katkı sağlar.
 * Birden fazla eşleşen politika varsa en yüksek puanlı seçilir;
 * eşitlikte en erken oluşturulan (createdAt ASC) önceliklidir.
 *
 * @param {object} ctx
 * @param {string}      ctx.companyId
 * @param {string|null} ctx.productGroup
 * @param {string|null} ctx.categoryName   — case.category
 * @param {string|null} ctx.subCategoryName — case.subCategory
 * @param {string|null} ctx.requestType    — DB ASCII enum
 * @param {string|null} ctx.priority       — Low/Medium/High/Critical
 * @returns {Promise<{responseHours:number,resolutionHours:number}|null>}
 */
export async function resolveSlaPolicy(ctx) {
  const policies = await prisma.sLAPolicy.findMany({
    where: { companyId: ctx.companyId, isActive: true },
  });

  const FIELDS = ['productGroup', 'categoryName', 'subCategoryName', 'requestType', 'priority'];

  const candidates = [];
  for (const p of policies) {
    let match = true;
    let score = 0;
    for (const f of FIELDS) {
      if (p[f] !== null) {
        if (p[f] !== ctx[f]) { match = false; break; }
        score++;
      }
    }
    if (match) candidates.push({ policy: p, score });
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(a.policy.createdAt) - new Date(b.policy.createdAt);
  });

  const best = candidates[0].policy;
  return {
    responseHours: best.responseHours,
    resolutionHours: best.resolutionHours,
    // Uzatılmış SLA v1 — eşleşen satırın uzatılmış TOPLAM süresi (mesai dk,
    // null=tanımsız). Okuma tek noktadan: resolveExtendedTargetMinutes.
    extendedResolutionMin: best.extendedResolutionMin ?? null,
  };
}

/**
 * SLA hedef DAKİKALARI — hedef değerin koddan okunduğu TEK nokta
 * (kullanıcı yapısal tercihi, Faz 0 gözden geçirme 2026-07-13):
 * politika değerleri saat cinsinden yazılır, hesap dakika cinsinden
 * akar (dakika = tek doğruluk kaynağı). Politika şeması değişirse
 * yalnız burası dokunulur.
 */
export function resolveTargetMinutes(slaMatch) {
  if (!slaMatch) return null;
  return {
    responseMin: Math.round(slaMatch.responseHours * 60),
    resolutionMin: Math.round(slaMatch.resolutionHours * 60),
  };
}
