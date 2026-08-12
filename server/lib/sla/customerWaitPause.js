/**
 * customerWaitPause.js — müşteri-bekleme SLA duraklatması (Faz 3b, 2026-07-14).
 *
 * K-F kararı: bugün sayaç müşteri beklerken DURMAZ; ama SysAdmin,
 * Çalışma Takvimi ekranındaki toggle ile şirket bazında açabilir.
 * Bu modül toggle'ın GERÇEK etkisi — iki saf-ish yardımcı üretir,
 * yazımı çağıran yapar (tx-dostu: patch döner, update etmez).
 *
 * Kurallar:
 *  - Başlat: toggle açık + vaka terminal değil + 3rdPartyBekleniyor değil
 *    + hâlihazırda başlamamış → slaCustomerWaitStartedAt = now.
 *  - Kapat: başlamışsa → geçen süre (takvim kapısı açıksa İŞ-dakikası,
 *    değilse duvar-dk) sayaçlara eklenir, slaResolutionDueAt ötelenir
 *    (yalnız çözüm SLA'sı — K-F #2: yanıt SLA'sı duraklamadan etkilenmez),
 *    damga temizlenir.
 *  - Çakışma: 3rd-party pause öncelikli — 3rdPartyBekleniyor'a girişte
 *    çağıran ÖNCE closeCustomerWaitPatch uygular (çifte sayım imkânsız).
 */
import {
  getEffectiveCalendar,
  businessMinutesBetween,
  addBusinessMinutes,
  getSlaPauseRules,
} from './businessTime.js';

/**
 * Aktif müşteri-bekleme duraklamasını kapatan patch; aktif değilse null.
 * row: { companyId, slaCustomerWaitStartedAt, slaResolutionDueAt,
 *        slaPausedDurationMin, slaCustomerWaitMin }
 */
export async function closeCustomerWaitPatch(row, nowMs = Date.now()) {
  if (!row?.slaCustomerWaitStartedAt) return null;
  const fromMs = new Date(row.slaCustomerWaitStartedAt).getTime();
  const cal = await getEffectiveCalendar(row.companyId, nowMs);
  const biz = cal ? businessMinutesBetween(fromMs, nowMs, cal) : null;
  const waitedMin = biz != null ? biz : Math.max(0, Math.round((nowMs - fromMs) / 60000));
  const patch = {
    slaCustomerWaitStartedAt: null,
    slaCustomerWaitMin: (row.slaCustomerWaitMin ?? 0) + waitedMin,
    slaPausedDurationMin: (row.slaPausedDurationMin ?? 0) + waitedMin,
  };
  if (row.slaResolutionDueAt) {
    const dueMs = new Date(row.slaResolutionDueAt).getTime();
    const shifted = cal ? addBusinessMinutes(dueMs, waitedMin, cal) : null;
    patch.slaResolutionDueAt = new Date(shifted != null ? shifted : dueMs + waitedMin * 60000);
  }
  return patch;
}

/**
 * Duraklama BAŞLATMA patch'i; koşullar tutmuyorsa null.
 * row: { companyId, status, slaCustomerWaitStartedAt }
 * status SAKLANAN değerdir ('ThirdPartyWaiting', 'Cozuldu'...).
 */
export async function startCustomerWaitPatch(row, nowMs = Date.now()) {
  if (!row || row.slaCustomerWaitStartedAt) return null; // zaten aktif
  if (row.status === 'Cozuldu' || row.status === 'IptalEdildi') return null;
  if (row.status === 'ThirdPartyWaiting') return null; // 3rd-party öncelikli
  const rules = await getSlaPauseRules(row.companyId);
  if (!rules.pauseOnCustomerWait) return null; // toggle kapalı (default)
  return { slaCustomerWaitStartedAt: new Date(nowMs) };
}
