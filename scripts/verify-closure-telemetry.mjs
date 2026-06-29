/**
 * verify-closure-telemetry.mjs — GERÇEK Smart Ticket kapanışı entegrasyon testi.
 *
 * Çalıştır:  node --env-file=.env scripts/verify-closure-telemetry.mjs
 *
 * Canlı DB + canlı External KB gerektirir. Throwaway bir test case oluşturur,
 * GERÇEK KB önerisi alır, GERÇEK frontend helper'ı (esbuild ile derlenir) +
 * GERÇEK backend buildSmartTicketClosureMerge'i çalıştırır, customFields'a
 * persist eder, geri okur, 4 noktayı doğrular ve test case'i siler.
 *
 * Doğrulanan:
 *   1) closure.rootCauseGroup* eski alanlar + opening korunur
 *   2) closure.closureSuggestion.confidence (eski rapor kolonu) bozulmaz
 *   3) closure.closureSuggestion.aiSuggested.resolutionSeen = AI'nın gördüğü metin
 *   4) closure.closureSuggestion.humanApplied.perField.*.changedFromAi doğru
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import * as esbuild from 'esbuild';
import { prisma } from '../server/db/client.js';
import { buildSmartTicketClosureMerge } from '../server/db/caseRepository.js';
import { externalKbClient } from '../server/lib/externalKbClient.js';
import { externalKbSettingRepo } from '../server/db/externalKbSettingRepository.js';

const COMPANY = 'COMP-UNIVERA';
const TAX_TYPES = ['rootCauseGroup', 'rootCauseDetail', 'resolutionType', 'permanentPrevention'];
let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d = '') => { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); };

// route ile birebir aynı label normalize + eşleştirme
const normalizeLabel = (t) => typeof t !== 'string' ? '' : t.normalize('NFC').toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u')
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const matchByLabel = (list, raw) => { if (!raw) return null; const t = normalizeLabel(raw); if (!t) return null; return list.find((x) => normalizeLabel(x.label) === t) ?? null; };

// 1) GERÇEK frontend helper'ı esbuild ile derle (type import strip → saf ESM)
const tsSrc = readFileSync(new URL('../src/services/closureTelemetry.ts', import.meta.url), 'utf8');
const { code } = await esbuild.transform(tsSrc, { loader: 'ts', format: 'esm' });
const tmpHelper = new URL('./.closureTelemetry.compiled.mjs', import.meta.url);
writeFileSync(tmpHelper, code);
const { buildClosureSuggestionTelemetry } = await import(tmpHelper.href);

let testId = null;
try {
  // 2) Şablon: gerçek bir Smart Ticket case'in opening yapısı
  const rows = await prisma.case.findMany({ where: { companyId: COMPANY }, orderBy: { createdAt: 'desc' }, take: 200 });
  const tmpl = rows.find((r) => r.customFields?.smartTicket && typeof r.customFields.smartTicket === 'object');
  if (!tmpl) throw new Error('Şablon Smart Ticket case bulunamadı (son 200 UNIVERA vakası).');
  const opening = { ...tmpl.customFields.smartTicket };
  delete opening.closure;
  const openingKeys = Object.keys(opening);

  // 3) Throwaway test case
  const caseNumber = `TEST-TELEMETRY-${Date.now()}`;
  const created = await prisma.case.create({
    data: {
      caseNumber,
      title: '[TEST] closure telemetry doğrulama (otomatik silinir)',
      description: tmpl.description || 'Test açıklaması — closure telemetry doğrulama.',
      caseType: tmpl.caseType, priority: tmpl.priority, origin: tmpl.origin, requestType: tmpl.requestType,
      companyId: COMPANY, companyName: tmpl.companyName, category: tmpl.category, subCategory: tmpl.subCategory,
      customFields: { smartTicket: opening },
    },
  });
  testId = created.id;
  console.log(`\n✓ Test case oluşturuldu: ${caseNumber} (opening alanları: ${openingKeys.join(', ')})`);

  // 4) Aktif kapanış taksonomileri (route'un loadActiveClosureTaxonomies'i ile aynı)
  const taxRows = await prisma.taxonomyDef.findMany({
    where: { companyId: COMPANY, isActive: true, taxonomyType: { in: TAX_TYPES } },
    select: { taxonomyType: true, code: true, label: true },
  });
  const tax = { rootCauseGroup: [], rootCauseDetail: [], resolutionType: [], permanentPrevention: [] };
  for (const r of taxRows) tax[r.taxonomyType].push(r);

  // 5) KB önerisi — canlı KB'yi dene; on-prem KB bu ortamdan erişilemezse
  //    GERÇEK taksonomi değerlerinden sentetik-ama-gerçekçi öneri üret.
  //    (Doğrulanan şey telemetry YAPISI; AI etiketlerinin canlı olması şart değil.)
  const setting = await externalKbSettingRepo.getByCompany(COMPANY);
  const resolution =
    'Mükellefin e-belge gönderim ayarındaki entegratör parametresi hatalıydı; ilgili parametre düzeltildi ve test gönderimi başarılı oldu. Tekrarı önlemek için kontrol/validasyon eklenmesi önerildi.';
  let kb, kbSource;
  try {
    if (!setting?.enabled) throw new Error('KB disabled');
    const kbRaw = await externalKbClient.suggestClose(setting, { description: created.description, resolution });
    if (kbRaw && kbRaw.ok === false) throw new Error('ok:false ' + (kbRaw.error?.code ?? ''));
    kb = kbRaw?.data && typeof kbRaw.data === 'object' ? kbRaw.data : kbRaw;
    kbSource = 'CANLI KB';
  } catch (e) {
    kb = {
      kok_neden_grubu: tax.rootCauseGroup[0]?.label,
      kok_neden_detayi: tax.rootCauseDetail[0]?.label,
      cozum_tipi: tax.resolutionType[0]?.label,
      kalici_onlem: tax.permanentPrevention[0]?.label,
      confidence: 0.82, reason: 'sentetik (KB offline: ' + (e.message ?? e) + ')', modelUsed: 'synthetic-fallback',
    };
    kbSource = 'SENTETİK (on-prem KB erişilemedi)';
  }
  console.log(`✓ Öneri [${kbSource}]: grup="${kb.kok_neden_grubu}" · tip="${kb.cozum_tipi}" · conf=${kb.confidence}`);

  // 6) route gibi taksonomiye eşle + meta.resolutionSeen = resolution
  const suggestions = {};
  const unmatched = [];
  const addM = (key, raw) => {
    const m = matchByLabel(tax[key], raw);
    if (m) suggestions[key] = { code: m.code, label: m.label, matchedBy: 'label' };
    else if (raw) unmatched.push({ taxonomyType: key, rawValue: raw });
  };
  addM('rootCauseGroup', kb.kok_neden_grubu);
  addM('rootCauseDetail', kb.kok_neden_detayi);
  addM('resolutionType', kb.cozum_tipi);
  addM('permanentPrevention', kb.kalici_onlem);
  const suggestion = {
    companyId: COMPANY, suggestions, unmatched, source: 'external_kb',
    meta: {
      usedEndpoint: 'suggest-close',
      resolutionSeen: resolution, // ← route'un meta'ya yazdığı alan
      ...(typeof kb.confidence === 'number' ? { confidence: kb.confidence } : {}),
      ...(typeof kb.reason === 'string' ? { reason: kb.reason } : {}),
      ...(typeof kb.modelUsed === 'string' ? { modelUsed: kb.modelUsed } : {}),
    },
  };

  // 6) İnsan final seçimi: resolutionType'ı AI'dan FARKLI bir koda çevir
  //    (changedFromAi=true bekle), diğerlerini AI önerisiyle bırak (false bekle).
  const altRt = tax.resolutionType.find((x) => x.code !== suggestions.resolutionType?.code) ?? tax.resolutionType[0];
  const applied = {
    rootCauseGroup: suggestions.rootCauseGroup && { code: suggestions.rootCauseGroup.code, label: suggestions.rootCauseGroup.label },
    rootCauseDetail: suggestions.rootCauseDetail && { code: suggestions.rootCauseDetail.code, label: suggestions.rootCauseDetail.label },
    resolutionType: altRt && { code: altRt.code, label: altRt.label },
    permanentPrevention: suggestions.permanentPrevention && { code: suggestions.permanentPrevention.code, label: suggestions.permanentPrevention.label },
  };

  // 7) GERÇEK helper → telemetry
  const tele = buildClosureSuggestionTelemetry({
    suggestion,
    suggestedAt: new Date(Date.now() - 5000).toISOString(),
    applied,
  });

  // 8) Frontend closurePayload (label'lar + telemetry)
  const closurePayload = {
    rootCauseGroup: applied.rootCauseGroup?.code, rootCauseGroupLabel: applied.rootCauseGroup?.label,
    rootCauseDetail: applied.rootCauseDetail?.code, rootCauseDetailLabel: applied.rootCauseDetail?.label,
    resolutionType: applied.resolutionType?.code, resolutionTypeLabel: applied.resolutionType?.label,
    permanentPrevention: applied.permanentPrevention?.code, permanentPreventionLabel: applied.permanentPrevention?.label,
    closureSuggestion: tele,
  };

  // 9) GERÇEK backend merge + persist (yan etki yok: history/notification YOK)
  const merged = buildSmartTicketClosureMerge(created, closurePayload);
  await prisma.case.update({
    where: { id: testId },
    data: { status: 'Cozuldu', resolvedAt: new Date(), resolutionNote: resolution, customFields: merged },
  });

  // 10) READ-BACK + doğrulama
  const back = await prisma.case.findUnique({ where: { id: testId }, select: { customFields: true } });
  const st = back.customFields.smartTicket;
  const cl = st.closure;
  const cs = cl.closureSuggestion;
  console.log('\n── DOĞRULAMA ───────────────────────────────────────────');

  // (1) Eski alanlar + opening korunuyor mu
  const oldFieldsOk = cl.rootCauseGroup === applied.rootCauseGroup?.code &&
    cl.rootCauseGroupLabel === applied.rootCauseGroup?.label &&
    cl.resolutionType === applied.resolutionType?.code;
  oldFieldsOk ? ok('1a) closure.rootCauseGroup* eski alanlar duruyor', `${cl.rootCauseGroup} / ${cl.rootCauseGroupLabel}`)
    : bad('1a) eski closure alanları bozuk', JSON.stringify({ g: cl.rootCauseGroup, l: cl.rootCauseGroupLabel }));
  const openingOk = openingKeys.every((k) => JSON.stringify(st[k]) === JSON.stringify(opening[k]));
  openingOk ? ok('1b) opening alanları (platform/businessProcess…) AYNEN korundu')
    : bad('1b) opening alanları değişmiş');

  // (2) Backward-compat confidence
  if (typeof cs.confidence === 'number') ok('2) closureSuggestion.confidence eski raporu kırmıyor', `${cs.confidence}`);
  else if (typeof kb.confidence !== 'number') ok('2) (KB confidence dönmedi → alan beklenmiyor, eski davranış korunur)');
  else bad('2) confidence kök alanı kayıp (rapor kolonu kırılır)');

  // (3) resolutionSeen
  cs.aiSuggested?.resolutionSeen === resolution
    ? ok('3) aiSuggested.resolutionSeen = AI\'nın gördüğü metin (override)', `"${cs.aiSuggested.resolutionSeen.slice(0, 48)}…"`)
    : bad('3) resolutionSeen yanlış/eksik', String(cs.aiSuggested?.resolutionSeen).slice(0, 60));
  cs.aiSuggested?.promptVersion === 'closure-v1'
    ? ok('3b) aiSuggested.promptVersion = closure-v1') : bad('3b) promptVersion eksik');

  // (4) changedFromAi — her alan için beklenen ile karşılaştır
  let cfOk = true;
  const lines = [];
  for (const key of TAX_TYPES) {
    const hp = cs.humanApplied?.perField?.[key];
    if (!hp) continue;
    const expected = suggestions[key]?.code !== applied[key]?.code;
    if (hp.changedFromAi !== expected) { cfOk = false; }
    lines.push(`${key}: changedFromAi=${hp.changedFromAi} (beklenen ${expected})`);
  }
  cfOk ? ok('4) humanApplied.perField.*.changedFromAi doğru', lines.join(' · '))
    : bad('4) changedFromAi yanlış', lines.join(' · '));
  // resolutionType DEĞİŞTİRİLDİ → mutlaka true olmalı
  cs.humanApplied?.perField?.resolutionType?.changedFromAi === true
    ? ok('4b) değiştirilen alan (resolutionType) changedFromAi=true')
    : bad('4b) değiştirilen alan true değil');

  console.log('\n── persist edilen closureSuggestion (özet) ──');
  console.log(JSON.stringify({
    confidence: cs.confidence, modelUsed: cs.modelUsed,
    appliedFields: cs.appliedFields,
    aiSuggested: { resolutionSeen: cs.aiSuggested?.resolutionSeen?.slice(0, 40) + '…', promptVersion: cs.aiSuggested?.promptVersion, perFieldKeys: Object.keys(cs.aiSuggested?.perField ?? {}) },
    humanApplied: cs.humanApplied,
  }, null, 2));
} catch (e) {
  bad('HATA', e?.message ?? String(e));
} finally {
  if (testId) {
    await prisma.case.delete({ where: { id: testId } })
      .then(() => console.log('\n✓ cleanup: test case silindi'))
      .catch((e) => console.log('\n⚠ cleanup başarısız (manuel sil):', testId, e.message));
  }
  try { rmSync(tmpHelper); } catch { /* ignore */ }
  console.log(`\n── SONUÇ ───────────────────────────────────────────────\nPASS=${pass}  FAIL=${fail}`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}
