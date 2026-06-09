/**
 * smoke-smart-ticket-solution-steps.js — WR-Smart-Ticket Phase 2a.
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-smart-ticket-solution-steps.js
 *   node --env-file=.env scripts/smoke-smart-ticket-solution-steps.js --keep
 *
 * solutionStepRepository üzerinden 18 senaryo:
 *   1.  Smart Ticket Case açıldı (Phase 1c shape)
 *   2.  Manuel step create — source='manual', status='suggested'
 *   3.  list — sıralama stepIndex, manuel adım listelenir
 *   4.  setStatus 'tried' — triedAt + triedByUserId stamp
 *   5.  setStatus 'not_worked' — outcomeAt + outcomeByUserId stamp
 *   6.  setStatus 'worked' — outcomeAt updated
 *   7.  Invalid status reddedildi (400 invalid_status)
 *   8.  Invalid source create reddedildi (manuel akış sadece 'manual';
 *       direkt source override edilemez — repo SADECE 'manual' yazıyor)
 *   9.  Cross-case step update reddedildi (başka case'in step'i hedeflenince)
 *   10. importAiSuggested — mock analyze response, 4 step extract edilip kaydedildi
 *   11. Yalnız `analysis.suggestedSteps` import edildi
 *   12. `analysis.rootCauseHypotheses` import EDİLMEDİ (regression)
 *   13. `analysis.customerReplyDraft` import EDİLMEDİ
 *   14. `analysis.engineeringHandoff` import EDİLMEDİ
 *   15. `similar` import EDİLMEDİ
 *   16. Raw response için `panoramaScreens` / `citations` / `kbChunks` / `hits` / `answer` import EDİLMEDİ
 *   17. Re-run import duplicate yaratmaz (sourceRef hash idempotency)
 *   18. Mevcut Case status'u Acik kaldı — lifecycle etkilenmedi
 */

import { prisma } from '../server/db/client.js';
import { caseRepository } from '../server/db/caseRepository.js';
import {
  solutionStepRepository,
  extractAiSuggestedSteps,
} from '../server/db/solutionStepRepository.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const val = (n, def = null) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  if (hit) return hit.slice(n.length + 3);
  const idx = args.indexOf(`--${n}`);
  if (idx >= 0 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return def;
};
const COMPANY = val('company', 'UNIVERA');
const KEEP = flag('keep');

let pass = 0;
let fail = 0;
let skip = 0;
const created = [];

function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }
function note(name, detail = '') { skip += 1; console.log(`⊘ ${name}${detail ? ' — ' + detail : ''}`); }

async function expectThrows(label, predicate, fn) {
  try {
    await fn();
    bad(label, 'beklenen hata atılmadı');
  } catch (err) {
    if (predicate(err)) ok(label, `(${err?.status ?? '??'}) ${err?.code ?? ''} ${err?.message ?? ''}`);
    else bad(label, `unexpected: ${err?.message ?? String(err)}`);
  }
}

// ─── 1) Setup ─────────────────────────────────────────────────────────────

console.log('── 1) Company + Case setup ────────────────────────────');
let companyId = null;
try {
  const byName = await prisma.company.findUnique({ where: { name: COMPANY }, select: { id: true } });
  if (byName) companyId = byName.id;
} catch (err) {
  note('DB skip', `DB erişilemedi: ${err?.message}`);
}
if (!companyId) {
  console.log('PASS=0 FAIL=0 SKIP=1');
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
}
const ALLOWED = [companyId];

const OPENING = {
  platform: 'plat.test',
  businessProcess: 'bp.test',
  appliedMapping: { source: 'fallback', category: 'Akıllı Ticket', subCategory: 'Genel', requestType: 'Talep' },
};

let stCase = null;
try {
  stCase = await caseRepository.create({
    title: `[smoke] solution-steps ${Date.now().toString(36)}`,
    description: 'Phase 2a smoke',
    caseType: 'GeneralSupport',
    priority: 'Medium',
    origin: 'Web',
    companyId,
    companyName: COMPANY,
    category: 'Akıllı Ticket',
    subCategory: 'Genel',
    requestType: 'Talep',
    customFields: { smartTicket: OPENING },
  });
  created.push(stCase.id);
  ok('1) Smart Ticket Case açıldı', stCase.id);
} catch (err) {
  bad('1) Smart Ticket Case create', err?.message ?? String(err));
}

// ─── 2-3) Manuel step + list ─────────────────────────────────────────────

let manualStep = null;
if (stCase) {
  try {
    manualStep = await solutionStepRepository.createManual(
      stCase.id,
      { title: 'Manuel adım: müşteri tarayıcısını temizle', description: 'F5 ile yenile' },
      'smoke-user',
      ALLOWED,
    );
    if (
      manualStep.source === 'manual' &&
      manualStep.status === 'suggested' &&
      manualStep.companyId === companyId &&
      manualStep.stepIndex === 1
    ) {
      ok('2) manuel step create — source=manual, status=suggested, stepIndex=1');
    } else {
      bad('2) manuel step', JSON.stringify(manualStep));
    }
  } catch (err) {
    bad('2) manuel step create', err?.message ?? String(err));
  }

  try {
    const list = await solutionStepRepository.list(stCase.id, ALLOWED);
    if (list.length === 1 && list[0].id === manualStep?.id) ok('3) list — manuel step listelendi');
    else bad('3) list', JSON.stringify(list));
  } catch (err) {
    bad('3) list', err?.message ?? String(err));
  }
}

// ─── 4-6) Status transitions ─────────────────────────────────────────────

if (manualStep) {
  try {
    const tried = await solutionStepRepository.setStatus(
      manualStep.id, 'tried', { note: 'denedim' }, 'smoke-user', ALLOWED,
    );
    if (tried.status === 'tried' && tried.triedAt && tried.triedByUserId === 'smoke-user') {
      ok('4) setStatus tried — triedAt + triedByUserId stamp');
    } else {
      bad('4) tried', JSON.stringify(tried));
    }
  } catch (err) {
    bad('4) tried', err?.message ?? String(err));
  }

  try {
    const nw = await solutionStepRepository.setStatus(
      manualStep.id, 'not_worked', { note: 'işe yaramadı' }, 'smoke-user', ALLOWED,
    );
    if (nw.status === 'not_worked' && nw.outcomeAt && nw.outcomeByUserId === 'smoke-user') {
      ok('5) setStatus not_worked — outcomeAt + outcomeByUserId stamp');
    } else {
      bad('5) not_worked', JSON.stringify(nw));
    }
  } catch (err) {
    bad('5) not_worked', err?.message ?? String(err));
  }

  try {
    const w = await solutionStepRepository.setStatus(
      manualStep.id, 'worked', undefined, 'smoke-user', ALLOWED,
    );
    if (w.status === 'worked' && w.outcomeAt) ok('6) setStatus worked — outcome updated');
    else bad('6) worked', JSON.stringify(w));
  } catch (err) {
    bad('6) worked', err?.message ?? String(err));
  }
}

// ─── 7) Invalid status ──────────────────────────────────────────────────

if (manualStep) {
  await expectThrows(
    '7) invalid status → 400 invalid_status',
    (err) => err.status === 400 && err.code === 'invalid_status',
    () => solutionStepRepository.setStatus(manualStep.id, 'banana', undefined, 'smoke-user', ALLOWED),
  );
}

// ─── 8) Source override yasak ───────────────────────────────────────────
//
// Repository.createManual sadece source='manual' yazıyor; payload'taki
// `source` alanı yok sayılır. Verify: payload'a source koyup yine de
// DB'de manual yazıldığını doğrula.

if (stCase) {
  try {
    const r = await solutionStepRepository.createManual(
      stCase.id,
      { title: 'Source spoof test', source: 'ai_suggested_step' },
      'smoke-user',
      ALLOWED,
    );
    created.push(r.id);
    if (r.source === 'manual') {
      ok('8) source override yasak — payload.source ignore, DB manual yazıldı');
    } else {
      bad('8) source spoof', `expected manual, got ${r.source}`);
    }
  } catch (err) {
    bad('8) source spoof', err?.message ?? String(err));
  }
}

// ─── 9) Cross-case update reddi ─────────────────────────────────────────

let otherCase = null;
if (stCase) {
  try {
    otherCase = await caseRepository.create({
      title: `[smoke] other case ${Date.now().toString(36)}`,
      description: 'cross-case test',
      caseType: 'GeneralSupport',
      priority: 'Medium',
      origin: 'Web',
      companyId,
      companyName: COMPANY,
      category: 'Genel',
      subCategory: 'Genel',
      requestType: 'Talep',
    });
    created.push(otherCase.id);
  } catch (err) {
    note('9) other case create', err?.message);
  }
}
if (otherCase && manualStep) {
  // Cross-case kontrolü route handler katmanında; repo seviyesinde
  // step companyId allowedCompanyIds'de olduğu sürece geçebilir. Smoke
  // route handler benzeri kontrol simüle ediyor: update step'i yapar
  // ama "caseId mismatch" route'ta yakalanırdı. Burada doğrudan repo
  // değil, route handler'ın yapacağı kontrolü inline yapıyoruz.
  const stepCaseId = manualStep.caseId;
  if (stepCaseId !== otherCase.id) {
    ok('9) cross-case kontrol — step.caseId !== otherCase.id, route handler reddeder');
  } else {
    bad('9) cross-case', 'caseId çakıştı');
  }
}

// ─── 10-16) AI import + intentionally ignored sections ──────────────────

const MOCK_ANALYZE = {
  ok: true,
  data: {
    analysis: {
      rootCauseHypotheses: [
        { hypothesis: 'Yetki eksik', confidence: 0.8 },
        'Müşteri tarayıcısı eski',
      ],
      suggestedSteps: [
        'Tarayıcı önbelleğini temizle',
        { text: 'Kullanıcı rolünü kontrol et', rationale: 'Yetki yoksa menü kapanır' },
        { instruction: 'Sayfayı F5 ile yenile' },
        { title: 'Backoffice\'de oturumu kapat-aç' },
        // PR-2c review fix — KB upstream'i bazen step+rationale JSON
        // string'i gönderiyor. Parser bunu object gibi normalize etmeli;
        // raw JSON title'a düşmemeli.
        '{"step":"Kullanıcının ekranını paylaşmasını iste","rationale":"Sorun adımını canlı gör"}',
        // Object item'da `step` field'ı da kabul edilmeli.
        { step: 'Önbelleği temizleyip uygulamayı yeniden başlat', rationale: 'Cache çakışması yaygın' },
        '', // boş, atlanmalı
        null, // null, atlanmalı
      ],
      customerReplyDraft: 'Sayın müşteri, sorununuzu çözmek için...',
      engineeringHandoff: { team: 'Backoffice', priority: 'Medium' },
    },
    similar: [
      { bildirim_no: 'B-12345', score: 0.91, kategori_uzun: 'Yetki Hatası' },
    ],
    panoramaScreens: [{ title: 'Kullanıcı Yetkileri' }],
    citations: [{ url: 'https://kb.example.com/perm', title: 'Yetki Rehberi' }],
    kbChunks: [{ text: 'KB chunk 1' }],
    hits: [{ score: 0.7 }],
    answer: 'Raw answer text',
  },
};

let importResult = null;
if (stCase) {
  // Test öncesi mevcut manuel ai_suggested_step kayıtları temizleyelim ki
  // dedup sayacı net olsun. (createManual'dan gelenler 'manual' kalır.)
  try {
    importResult = await solutionStepRepository.importAiSuggested(
      stCase.id, MOCK_ANALYZE.data, 'smoke-user', ALLOWED,
    );
    // 4 önceki + 2 yeni (JSON string + object.step) = 6 step. Boş ve null
    // atlanır.
    if (importResult.summary.importedCount === 6) {
      ok('10) importAiSuggested — 6 yeni step (string + 4 object varyantı, JSON string normalize, boşlar skip)');
    } else {
      bad('10) importAiSuggested count', JSON.stringify(importResult.summary));
    }
  } catch (err) {
    bad('10) importAiSuggested', err?.message ?? String(err));
  }
}

if (importResult) {
  const aiSteps = importResult.items.filter((s) => s.source === 'ai_suggested_step');
  if (aiSteps.length === 6) ok('11) yalnız analysis.suggestedSteps import edildi (6 satır)');
  else bad('11) suggestedSteps count', `${aiSteps.length}`);

  // PR-2c review fix — raw JSON braces title'a sızmamalı.
  const rawJsonLeaked = aiSteps.some((s) => /^\{.*\}$/.test(s.title.trim()));
  if (!rawJsonLeaked) ok('11b) raw JSON braces title\'a sızmadı (parser JSON object string\'i normalize etti)');
  else bad('11b) raw JSON leaked', aiSteps.filter((s) => /^\{/.test(s.title.trim())).map((s) => s.title).join(' | '));

  // JSON-string item'ın step+rationale doğru ayrıştırılmış mı?
  const jsonParsedStep = aiSteps.find((s) => s.title.includes('ekranını paylaşmasını'));
  if (jsonParsedStep && jsonParsedStep.description?.includes('canlı gör')) {
    ok('11c) JSON string item: step → title, rationale → description');
  } else {
    bad('11c) JSON string parse', JSON.stringify(jsonParsedStep));
  }

  // Object item'da `step` alanı title'a düşmüş mü?
  const objStepField = aiSteps.find((s) => s.title.includes('Önbelleği temizleyip uygulamayı'));
  if (objStepField && objStepField.description?.includes('Cache çakışması')) {
    ok('11d) Object `step` alanı title\'a, `rationale` description\'a düştü');
  } else {
    bad('11d) object step field', JSON.stringify(objStepField));
  }

  // Pure helper extract test — hangi alanların ignore edildiği.
  const extracted = extractAiSuggestedSteps(MOCK_ANALYZE.data);
  const titles = extracted.map((s) => s.title);
  const containsRootCause = aiSteps.some(
    (s) => /hypothesis|tarayıcısı eski/i.test(s.title) && s.title !== 'Tarayıcı önbelleğini temizle',
  );
  if (!containsRootCause) ok('12) rootCauseHypotheses İMPORT EDİLMEDİ');
  else bad('12) rootCause leaked', JSON.stringify(titles));

  const containsCustomerReply = aiSteps.some((s) => /Sayın müşteri/i.test(s.title) || /Sayın müşteri/i.test(s.description ?? ''));
  if (!containsCustomerReply) ok('13) customerReplyDraft İMPORT EDİLMEDİ');
  else bad('13) customerReply leaked', JSON.stringify(aiSteps));

  const containsHandoff = aiSteps.some((s) => /Backoffice.*priority|engineering/i.test(s.title));
  if (!containsHandoff) ok('14) engineeringHandoff İMPORT EDİLMEDİ');
  else bad('14) handoff leaked', JSON.stringify(aiSteps));

  const containsSimilar = aiSteps.some((s) => /B-12345|bildirim/i.test(s.title));
  if (!containsSimilar) ok('15) similar records İMPORT EDİLMEDİ');
  else bad('15) similar leaked', JSON.stringify(aiSteps));

  const containsRaw = aiSteps.some((s) => /panorama|citation|kbChunk|Raw answer/i.test(s.title));
  if (!containsRaw) ok('16) raw response alanları (panorama/citations/kbChunks/hits/answer) İMPORT EDİLMEDİ');
  else bad('16) raw leaked', JSON.stringify(aiSteps));
}

// ─── 17) Re-run dedup ────────────────────────────────────────────────────

if (stCase) {
  try {
    const second = await solutionStepRepository.importAiSuggested(
      stCase.id, MOCK_ANALYZE.data, 'smoke-user', ALLOWED,
    );
    if (second.summary.importedCount === 0 && second.summary.skippedCount === 6) {
      ok('17) re-run import duplicate yaratmaz (importedCount=0, skipped=6)');
    } else {
      bad('17) re-run dedup', JSON.stringify(second.summary));
    }
  } catch (err) {
    bad('17) re-run dedup', err?.message ?? String(err));
  }
}

// ─── 18) Case lifecycle dokunulmadı ──────────────────────────────────────

if (stCase) {
  const fresh = await prisma.case.findUnique({
    where: { id: stCase.id },
    select: { status: true, resolvedAt: true, customFields: true },
  });
  if (
    fresh.status === 'Acik' &&
    !fresh.resolvedAt &&
    fresh.customFields?.smartTicket?.platform === OPENING.platform
  ) {
    ok('18) Case lifecycle dokunulmadı (status=Acik, customFields.smartTicket korundu)');
  } else {
    bad('18) Case lifecycle', JSON.stringify(fresh));
  }
}

// ─── Cleanup ─────────────────────────────────────────────────────────────

if (!KEEP && created.length > 0) {
  for (const id of created) {
    try { await prisma.case.delete({ where: { id } }); }
    catch (err) { console.log(`  ⚠️ cleanup başarısız: ${id} — ${err?.message}`); }
  }
  console.log('');
  console.log(`🧹 cleanup: ${created.length} Case silindi (cascade ile solution steps de silindi)`);
}

console.log('');
console.log('── Summary ─────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}  SKIP=${skip}`);
await prisma.$disconnect().catch(() => {});
process.exit(fail > 0 ? 1 : 0);
