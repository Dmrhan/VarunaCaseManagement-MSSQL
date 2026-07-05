/**
 * Ops Pano v2 FAZ 1 — accountId scope guard (TEK KAYNAK).
 *
 * Codex R1 P1 (PR #417) sonrası buraya çıkarıldı: guard önce analytics.js
 * içindeydi; AI uçları (operations-brief / insights / report) aynı
 * overviewBody'yi tükettiği için guard'sız accountId AI snapshot'ında
 * SESSİZCE YOK SAYILIYOR ve RUNA müşteri-daraltılmış ekrana TÜM kapsam
 * yorumu üretiyordu. Artık analytics + ai route'ları bu modülü paylaşır.
 *
 * Kural (Aylık Bülten guard deseni): account'un bağlı olduğu şirketlerden
 * EN AZ BİRİ kullanıcının scope'unda olmalı; aksi halde cross-tenant erişim
 * engellenir. Dönüş: { ok:true } | { ok:false, status, body }.
 */
import { prisma } from '../db/client.js';

export async function checkAccountInScope(accountId, scope) {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      companyId: true, // legacy ana companyId
      companies: { select: { companyId: true } },
    },
  });
  if (!account) {
    return { ok: false, status: 404, body: { error: 'account_not_found' } };
  }
  const accountCompanyIds = [
    account.companyId,
    ...account.companies.map((ac) => ac.companyId),
  ].filter(Boolean);
  const intersection = accountCompanyIds.filter((cid) => scope.companyIds.includes(cid));
  if (intersection.length === 0) {
    return { ok: false, status: 403, body: { error: 'account_out_of_scope' } };
  }
  return { ok: true };
}
