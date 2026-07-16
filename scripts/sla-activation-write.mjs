/**
 * sla-activation-write.mjs — SLA iş-saati aktivasyonu YAZIM adımı. 2026-07-16
 *
 * Kullanıcı onayı ("tüm verilere uygulayalım" + "gerekli veri girişlerini yap")
 * ile koşulur. Tek oturumda üç adım — İDEMPOTENT (yarıda kesilirse yeniden
 * koşulabilir; due'lar sabit alanlardan sıfırdan türetildiği için ikinci
 * koşum aynı sonucu üretir):
 *
 *   1) YEDEK: etkilenecek tüm vakaların SLA alanları timestamp'li JSON'a
 *      (geri dönüş sigortası + n4b yan-yana kanıtının ham verisi).
 *   2) RE-STAMP: Univera arşivsiz TÜM SLA'lı vakalar (kapalı dahil —
 *      kullanıcı kararı 2026-07-16) iş-saati hedefine yeniden damgalanır.
 *      Hedef dakika, mevcut damgadan geri türetilir (politika yeniden
 *      EŞLENMEZ — vakanın açılış günkü taahhüdü korunur). İhlal bayrağı
 *      yalnız GERİ ÇEKİLİR (K-E) — false→true yazımı sweep'in işi.
 *      Son 10 dk içinde güncellenen vakalar o turda atlanır (canlı
 *      trafikle çakışmama — TOCTOU deseni).
 *   3) UZATILMIŞ RETROAKTİF: bakımda bekleyen + DevOps kayıtlı adaylar
 *      buildExtendedSlaPatch ile uzatılmış hedefe çekilir (history dahil).
 *      Aday sayısı beklentiden (37) çok saparsa YAZMADAN durur
 *      (kabul şartı 4).
 *
 * Çıktı: adım adım sayılar + yedek dosya yolu. --step ile tek adım koşulabilir
 * (örn. --step=restamp).
 */
import { writeFileSync } from 'node:fs';
import { prisma } from '../server/db/client.js';
import { loadWorkCalendar, addBusinessMinutes } from '../server/lib/sla/businessTime.js';
import { resolveSlaPolicy } from '../server/lib/sla/slaPolicyResolver.js';
import { resolveExtendedTargetMinutes, buildExtendedSlaPatch } from '../server/lib/sla/extendedSla.js';

const COMPANY = 'COMP-UNIVERA';
const MIN = 60000;
const EXPECTED_EXT_CANDIDATES = 37;
const stepArg = process.argv.find((a) => a.startsWith('--step='))?.slice(7) ?? 'all';

const cal = await loadWorkCalendar(COMPANY);
if (!cal) { console.error('Univera takvimi yüklenemedi — durduruldu.'); process.exit(1); }

// ── 1 · YEDEK ────────────────────────────────────────────────────────
const affected = await prisma.case.findMany({
  where: { companyId: COMPANY, isArchived: false, slaResolutionDueAt: { not: null } },
  select: {
    id: true, caseNumber: true, status: true, createdAt: true, resolvedAt: true, updatedAt: true,
    priority: true, requestType: true, category: true, subCategory: true, productGroup: true,
    slaResponseDueAt: true, slaResolutionDueAt: true, slaViolation: true,
    slaPausedAt: true, slaPausedDurationMin: true, slaTargetSource: true,
    slaResolutionTargetMin: true, customFields: true, thirdPartyId: true,
  },
});
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = `/tmp/sla-activation-backup-${stamp}.json`;
writeFileSync(backupPath, JSON.stringify(
  affected.map(({ customFields, ...r }) => r), null, 1,
));
console.log(`[1/3] YEDEK: ${affected.length} vaka → ${backupPath}`);

// ── 2 · RE-STAMP ─────────────────────────────────────────────────────
if (stepArg === 'all' || stepArg === 'restamp') {
  const nowMs = Date.now();
  const SKIP_RECENT_MS = 10 * 60000;
  let written = 0, skippedRecent = 0, skippedGuard = 0, retracted = 0, unchanged = 0;
  for (const c of affected) {
    if (nowMs - new Date(c.updatedAt).getTime() < SKIP_RECENT_MS) { skippedRecent += 1; continue; }
    const created = new Date(c.createdAt).getTime();
    const pausedMin = c.slaPausedDurationMin ?? 0;
    const respDue = c.slaResponseDueAt ? new Date(c.slaResponseDueAt).getTime() : null;
    const resoDue = new Date(c.slaResolutionDueAt).getTime();
    const respTarget = respDue != null ? Math.max(0, Math.round((respDue - created) / MIN)) : null;
    const resoTarget = Math.max(0, Math.round((resoDue - created) / MIN) - pausedMin);
    const newResp = respTarget != null ? addBusinessMinutes(created, respTarget, cal) : null;
    const newReso = addBusinessMinutes(created, resoTarget + pausedMin, cal);
    if (newReso == null || (respTarget != null && newResp == null)) { skippedGuard += 1; continue; }

    const data = {};
    if (Math.abs(newReso - resoDue) >= MIN) data.slaResolutionDueAt = new Date(newReso);
    if (newResp != null && respDue != null && Math.abs(newResp - respDue) >= MIN) data.slaResponseDueAt = new Date(newResp);
    // K-E — ihlal yalnız GERİ çekilir: yeni hedefe göre gecikmemişse false.
    if (c.slaViolation) {
      const ref = c.resolvedAt ? new Date(c.resolvedAt).getTime() : nowMs;
      if (ref <= newReso) { data.slaViolation = false; retracted += 1; }
    }
    if (Object.keys(data).length === 0) { unchanged += 1; continue; }
    await prisma.case.update({ where: { id: c.id }, data });
    written += 1;
  }
  console.log(`[2/3] RE-STAMP: yazılan=${written}, değişmeyen=${unchanged}, ihlal-geri-çekilen=${retracted}, son-10dk-atlanan=${skippedRecent}, guard-atlanan=${skippedGuard}`);
  if (skippedRecent > 0) console.log('      ↳ atlananlar için script biraz sonra yeniden koşulabilir (idempotent).');
}

// ── 3 · UZATILMIŞ RETROAKTİF ────────────────────────────────────────
if (stepArg === 'all' || stepArg === 'extended') {
  const ybe = await prisma.thirdParty.findFirst({
    where: { name: 'Yazılım Bakım Ekibinde', companyId: COMPANY, isActive: true },
    select: { id: true, name: true, triggersExtendedSla: true, extendedSlaRequiresDevopsLink: true },
  });
  if (!ybe?.triggersExtendedSla) { console.error('[3/3] YBE bayrağı kapalı — retroaktif atlandı.'); process.exit(1); }

  const hasDevops = (cf) => {
    if (!cf) return false;
    try { const o = typeof cf === 'string' ? JSON.parse(cf) : cf; return Array.isArray(o?.devops) && o.devops.length > 0; }
    catch { return false; }
  };
  const candidates = affected.filter((c) =>
    c.status === 'ThirdPartyWaiting'
    && c.thirdPartyId === ybe.id
    && c.slaTargetSource !== 'extended'
    && (!ybe.extendedSlaRequiresDevopsLink || hasDevops(c.customFields)),
  );
  console.log(`[3/3] UZATILMIŞ adaylar: ${candidates.length} (beklenti ~${EXPECTED_EXT_CANDIDATES})`);
  if (Math.abs(candidates.length - EXPECTED_EXT_CANDIDATES) > 10) {
    console.error('      ⛔ SAPMA BÜYÜK — yazım durduruldu (kabul şartı 4). Listeyi inceleyin.');
    process.exit(2);
  }
  let extWritten = 0, extSkipped = 0;
  for (const c of candidates) {
    const match = await resolveSlaPolicy({
      companyId: COMPANY,
      productGroup: c.productGroup ?? null,
      categoryName: c.category ?? null,
      subCategoryName: c.subCategory ?? null,
      requestType: c.requestType ?? null,
      priority: c.priority ?? null,
    });
    const extMin = resolveExtendedTargetMinutes(match);
    // Re-stamp adım 2'de due değişmiş olabilir — güncel satırı çek (patch
    // güncel duraklama/due üzerinden sıfırdan türetir; idempotent).
    const fresh = await prisma.case.findUnique({ where: { id: c.id } });
    const patch = await buildExtendedSlaPatch(fresh, extMin, `${ybe.name} (retroaktif aktivasyon)`);
    if (!patch) { extSkipped += 1; continue; }
    await prisma.case.update({
      where: { id: c.id },
      data: {
        ...patch.data,
        history: {
          create: [{
            companyId: COMPANY,
            ...patch.historyEntry,
            actor: 'system:sla-activation',
            actorUserId: null,
          }],
        },
      },
    });
    extWritten += 1;
  }
  console.log(`      yazılan=${extWritten}, atlanan(uygunsuz/uzatılmış-zaten)=${extSkipped}`);
}

console.log('\nAKTİVASYON TAMAM. Yedek:', backupPath);
process.exit(0);
