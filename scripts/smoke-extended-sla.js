/**
 * smoke-extended-sla.js — Uzatılmış SLA v1 Faz 1 (şema + motor). 2026-07-14
 * Fonksiyonel (tetik koşulu, patch üretimi, tek-yön/idempotentlik, U-F ihlal
 * yeniden değerlendirmesi) + yapısal (fail-safe default'lar, resolver köprüsü).
 * DB'ye yazmaz; buildExtendedSlaPatch takvimsiz yolda (cal=null→duvar) test edilir.
 */
import { readFileSync } from 'node:fs';
import {
  resolveExtendedTargetMinutes,
  extendedSlaTriggerMet,
  buildExtendedSlaPatch,
} from '../server/lib/sla/extendedSla.js';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n}`); } };
const rd = (p) => readFileSync(p, 'utf8');

// ── 1 · resolveExtendedTargetMinutes: TEK okuma noktası + fail-safe ──
ok('1 uzatılmış hedef: pozitif Int dk döner; null/0/negatif/eksik → null (fail-safe)',
  resolveExtendedTargetMinutes({ extendedResolutionMin: 1830 }) === 1830
  && resolveExtendedTargetMinutes({ extendedResolutionMin: null }) === null
  && resolveExtendedTargetMinutes({ extendedResolutionMin: 0 }) === null
  && resolveExtendedTargetMinutes({}) === null
  && resolveExtendedTargetMinutes(null) === null);

// ── 2 · İki parçalı tetik (U-B) ──
ok('2 tetik: bayrak kapalı → false (DevOps olsa bile)',
  extendedSlaTriggerMet({ triggersExtendedSla: false }, 3) === false
  && extendedSlaTriggerMet(null, 3) === false);
ok('3 tetik: bayrak açık + DevOps-şartı açık → yalnız devopsCount>0 iken true',
  extendedSlaTriggerMet({ triggersExtendedSla: true, extendedSlaRequiresDevopsLink: true }, 0) === false
  && extendedSlaTriggerMet({ triggersExtendedSla: true, extendedSlaRequiresDevopsLink: true }, 1) === true);
ok('4 tetik: DevOps-şartı KAPALI → devir tek başına yeter (U-B esnekliği)',
  extendedSlaTriggerMet({ triggersExtendedSla: true, extendedSlaRequiresDevopsLink: false }, 0) === true);
ok('4b tetik FAIL-CLOSED (Codex #540 P2): alan kısmi satırda EKSİKSE şema default\'u (true) geçerli — DevOps\'suz uzatma sızmaz',
  extendedSlaTriggerMet({ triggersExtendedSla: true }, 0) === false
  && extendedSlaTriggerMet({ triggersExtendedSla: true }, 2) === true);

// ── 3 · buildExtendedSlaPatch: guard zinciri ──
const NOW = Date.UTC(2026, 6, 14, 9, 0);
const baseRow = {
  companyId: 'COMP-SMOKE-YOK', // takvim kaydı yok → duvar-dk yolu (getEffectiveCalendar null)
  status: 'ThirdPartyWaiting',
  createdAt: new Date(NOW - 6 * 60 * 60000), // 6 saat önce açılmış
  slaResolutionDueAt: new Date(NOW), // standart hedef tam şimdi doluyor
  slaResolutionTargetMin: 360,
  slaTargetSource: 'standard',
  slaPausedDurationMin: 0,
  slaViolation: false,
  resolvedAt: null,
};
const p1 = await buildExtendedSlaPatch({ ...baseRow }, 1830, 'Yazılım Bakım Ekibinde + DevOps #1', NOW);
ok('5 patch: due sıfırdan (açılış+1830dk duvar), kaynak=extended, hedef damgalı — TEK data objesi',
  p1 !== null
  && p1.data.slaResolutionDueAt.getTime() === new Date(baseRow.createdAt).getTime() + 1830 * 60000
  && p1.data.slaTargetSource === 'extended'
  && p1.data.slaResolutionTargetMin === 1830);
ok('6 atomiklik sözleşmesi: geçmiş kaydı patch\'le BİRLİKTE döner (CaseActivity kısmi şekli)',
  p1.historyEntry.actionType === 'FieldUpdate'
  && p1.historyEntry.fieldName === 'slaResolutionTargetMin'
  && p1.historyEntry.fromValue === '360 dk' && p1.historyEntry.toValue === '1830 dk'
  && p1.historyEntry.action.includes('Yazılım Bakım Ekibinde'));
ok('7 tek yön / idempotent: kaynak zaten extended → null (geri daraltma YOK, U-E)',
  (await buildExtendedSlaPatch({ ...baseRow, slaTargetSource: 'extended' }, 1830, 'x', NOW)) === null);
ok('8 terminal guard: Cozuldu/IptalEdildi → null',
  (await buildExtendedSlaPatch({ ...baseRow, status: 'Cozuldu' }, 1830, 'x', NOW)) === null
  && (await buildExtendedSlaPatch({ ...baseRow, status: 'IptalEdildi' }, 1830, 'x', NOW)) === null);
ok('9 fail-safe: uzatılmış süre tanımsız (null) → null (tetik oluşsa bile davranış değişmez)',
  (await buildExtendedSlaPatch({ ...baseRow }, null, 'x', NOW)) === null);

// ── 4 · U-F ihlal yeniden değerlendirmesi ──
const violRow = { ...baseRow, slaViolation: true, slaResolutionDueAt: new Date(NOW - 60 * 60000) };
const p2 = await buildExtendedSlaPatch(violRow, 1830, 'x', NOW);
ok('10 U-F: ihlalli vaka, yeni hedef henüz dolmadıysa bayrak AYNI patch içinde geri çekilir',
  p2 !== null && p2.data.slaViolation === false);
const wayLate = { ...baseRow, slaViolation: true, createdAt: new Date(NOW - 3000 * 60000) }; // 3000dk önce
const p3 = await buildExtendedSlaPatch(wayLate, 1830, 'x', NOW);
ok('11 U-F simetrisi: uzatılmış hedef BİLE geçilmişse kırmızı haklı olarak kalır (bayrağa dokunulmaz)',
  p3 !== null && !('slaViolation' in p3.data));

// ── 5 · Duraklama etkileşimi: sıfırdan türetme çifte sayımı imkânsız kılar ──
const pausedRow = { ...baseRow, slaPausedDurationMin: 120 };
const p4 = await buildExtendedSlaPatch(pausedRow, 1830, 'x', NOW);
ok('12 birikmiş duraklama hedefin üstüne eklenir (açılış+1830+120 dk) — artımlı öteleme YOK',
  p4 !== null
  && p4.data.slaResolutionDueAt.getTime() === new Date(baseRow.createdAt).getTime() + (1830 + 120) * 60000);

// ── 6 · Yapısal: şema fail-safe + resolver köprüsü + dakika kararı ──
const schema = rd('prisma/schema.prisma');
ok('13 şema: bayraklar default FALSE/1, süre kolonu DAKİKA ve nullable (fail-safe)',
  schema.includes('triggersExtendedSla          Boolean @default(false)')
  && schema.includes('extendedSlaRequiresDevopsLink Boolean @default(true)')
  && schema.includes('extendedResolutionMin Int?')
  && schema.includes('slaTargetSource        String? @db.NVarChar(20)')
  && schema.includes('slaResolutionTargetMin Int?'));
const resolver = rd('server/lib/sla/slaPolicyResolver.js');
ok('14 resolver köprüsü: eşleşen satırın extendedResolutionMin değeri slaMatch ile taşınır',
  resolver.includes('extendedResolutionMin: best.extendedResolutionMin ?? null'));
const migration = rd('prisma/migrations/20260714c_extended_sla/migration.sql');
ok('15 migration: additive + TRY/TRAN + DF default\'lar (MSSQL deseni)',
  migration.includes('BEGIN TRY') && migration.includes('ROLLBACK TRAN')
  && migration.includes('DF_ThirdParty_triggersExtendedSla')
  && migration.includes('[extendedResolutionMin] INT NULL'));

// ── 7 · Faz 2: olay bağlama (yapısal) ──
const repo = rd('server/db/caseRepository.js');
ok('16 transitionStatus 3P girişi: tp select bayrakları çeker + tetik değerlendirilir',
  repo.includes('triggersExtendedSla: true,')
  && repo.includes('extendedSlaRequiresDevopsLink: true,')
  && repo.includes('if (extendedSlaTriggerMet(tp, readDevopsArray(prev.customFields).length))'));
ok('17 atomiklik (kabul şartı 3): patch data + history AYNI transitionStatus update\'inde',
  repo.includes('slaTargetSource: extendedPatch.data.slaTargetSource')
  && repo.includes('...extendedPatch.historyEntry,')
  && repo.includes('nextResolutionDueAt = extendedPatch.data.slaResolutionDueAt;'));
ok('18 cwClose etkileşimi: patch GÜNCEL duraklama toplamını görür (çifte sayım imkânsız)',
  repo.includes('{ ...prev, slaPausedDurationMin: nextPausedDurationMin }'));
ok('19 linkDevops sonrası re-eval: vaka bayraklı 3P\'deyken link koşulu tamamlarsa uzatır (kendi içinde atomik)',
  repo.includes("row?.status === 'ThirdPartyWaiting' && row.thirdPartyId && row.slaTargetSource !== 'extended'")
  && repo.includes('DevOps #${workItemId}`'));
ok('20 U-E: unlinkDevops + 3P çıkışı NO-OP — geri daraltma çağrısı YOK',
  !repo.slice(repo.indexOf('async unlinkDevops'), repo.indexOf('async unlinkDevops') + 3000).includes('buildExtendedSlaPatch'));
ok('21 hedef güncel politikadan (tek kaynak): re-eval resolveSlaPolicy ile açılış boyutlarını yeniden çözer',
  (repo.match(/const extMatch = await resolveSlaPolicy\(/g) ?? []).length === 2);

// ── 8 · Faz 3: UI (yapısal — mevcut ekran diline sadakat) ──
const tpPage = rd('src/features/admin/AdminThirdPartyPage.tsx');
ok('22 3.Parti modalı: iki anahtar mevcut checkbox desenleriyle; ikincisi birinciye bağlı (disabled+soluk)',
  tpPage.includes('Uzatılmış çözüm süresi uygular')
  && tpPage.includes('Ek şart: vakada DevOps kaydı bulunmalı')
  && tpPage.includes('disabled={!form.triggersExtendedSla}'));
const slaPage = rd('src/features/admin/AdminSlaPage.tsx');
ok('23 SLA Kuralları: dk alanı + iş-günü karşılığı + liste kolonu + bayat "5-tuple" metni düzeltildi',
  slaPage.includes('label="Uzatılmış Çözüm (dk)"')
  && slaPage.includes('iş günü (8,5 sa/gün)')
  && slaPage.includes('<Th align="right">Uzatılmış</Th>')
  && !slaPage.includes('5-tuple'));
const detail = rd('src/features/cases/CaseDetailPage.tsx');
ok('24 vaka detayı: uzatılmış rozet + uygulanan hedef yalnız slaTargetSource=extended iken',
  detail.includes("item.slaTargetSource === 'extended'")
  && detail.includes('Uzatılmış SLA — Yazılım Geliştirme devri'));
const adminRepo = rd('server/db/adminRepository.js');
ok('25 BE CRUD fail-safe: 3.Parti bayrak default\'ları + SLAPolicy dk normalize (pozitif Int | null)',
  adminRepo.includes('triggersExtendedSla: input.triggersExtendedSla === true')
  && adminRepo.includes('extendedSlaRequiresDevopsLink: input.extendedSlaRequiresDevopsLink !== false')
  && adminRepo.split('Number.isInteger(safeInput.extendedResolutionMin)').length >= 2
  && adminRepo.includes("if ('extendedResolutionMin' in dbPatch)"));

// ── 9 · Uygulama içi Yardım içerikleri güncel ──
const help = rd('src/features/admin/helpContents.ts');
ok('26 SLA yardımı: 6 boyut + en-özgül-kazanır + Uzatılmış Çözüm bölümü; bayat "5\'li" ve YANLIŞ "varsayılan SLA" ipucu temizlendi',
  help.includes('6 boyutlu eşleşme — en özgül kural kazanır')
  && help.includes("heading: 'Uzatılmış Çözüm (yazılım geliştirme devri)'")
  && help.includes('varsayılan süre YOKTUR')
  && !help.includes("5'li kombinasyon")
  && !help.includes('Priority bazlı varsayılan SLA'));
ok('27 3.Parti yardımı: duraklatma tanım-bazlı anlatılıyor + uzatılmış anahtarlar bölümü var',
  help.includes('"Beklenirken SLA dursun" anahtarı belirler')
  && help.includes("heading: 'Uzatılmış çözüm süresi (yazılım geliştirme devri)'"));
ok('28 Çalışma Takvimi yardımı: WORK_CALENDAR_HELP tanımlı + sayfaya HelpDrawer bağlı (overlayOnly)',
  help.includes('export const WORK_CALENDAR_HELP')
  && rd('src/features/admin/AdminWorkCalendarPage.tsx').includes('WORK_CALENDAR_HELP')
  && rd('src/features/admin/AdminWorkCalendarPage.tsx').includes('overlayOnly'));

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
