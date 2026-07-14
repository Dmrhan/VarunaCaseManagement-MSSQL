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

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
