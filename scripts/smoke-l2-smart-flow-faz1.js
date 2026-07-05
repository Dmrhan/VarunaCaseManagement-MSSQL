/**
 * smoke-l2-smart-flow-faz1.js — 2026-07-05
 *
 * L2-Smart-Flow FAZ 1: Akıllı Tanımlar kartı (Case Detail) + backend
 * smart-classification endpoint'i. Yapısal assert + builder davranış
 * simülasyonu. (Canlı DOM kabulü ayrı: scripts/accept-l2-smart-card.mjs)
 */
import { readFileSync } from 'node:fs';
import { buildSmartTicketOpeningMerge } from '../server/db/caseRepository.js';
import { classifyKbFailure, pickKbFailure } from '../server/lib/externalKbClient.js';

let pass = 0;
let fail = 0;
const expectTrue = (name, cond) => {
  if (cond) { pass += 1; console.log(`PASS — ${name}`); }
  else { fail += 1; console.log(`FAIL — ${name}`); }
};

const card = readFileSync('src/features/cases/components/SmartClassificationCard.tsx', 'utf8');
const detail = readFileSync('src/features/cases/CaseDetailPage.tsx', 'utf8');
const steps = readFileSync('src/features/cases/CaseSolutionStepsPanel.tsx', 'utf8');
const routes = readFileSync('server/routes/cases.js', 'utf8');
const service = readFileSync('src/services/caseService.ts', 'utf8');

console.log('── 1) Backend endpoint + builder ──');
expectTrue('1.1 PATCH /:id/smart-classification route var',
  /router\.patch\(\s*'\/:id\/smart-classification'/.test(routes));
expectTrue('1.2 route assertCaseResourcePolicy(case, update) kullanıyor',
  /smart-classification'[\s\S]{0,400}assertCaseResourcePolicy\(req, \{ resourceKey: 'case', action: 'update' \}/.test(routes));
expectTrue('1.3 audit actionType SmartClassificationUpdate',
  readFileSync('server/db/caseRepository.js', 'utf8').includes("actionType: 'SmartClassificationUpdate'"));

console.log('── 2) Builder davranış simülasyonu ──');
const prev = {
  customFields: {
    dynamicX: { keep: true },
    smartTicket: {
      platform: 'OLD_PLAT',
      platformLabel: 'Eski Platform',
      impact: 'OLD_IMPACT',
      impactLabel: 'Eski Etki',
      closure: { rootCauseGroup: 'RC1', version: 1 },
      aiDrafts: { note: 'dur' },
    },
  },
};
const merged = buildSmartTicketOpeningMerge(prev, {
  fields: {
    platform: { code: 'NEW_PLAT', label: 'Yeni Platform' },
    businessProcess: { code: 'BP1', label: 'Süreç 1' },
    operationType: { code: null },
    affectedObject: {},
    impact: { code: '' },
  },
  classificationSuggestion: {
    appliedFields: ['platform', 'bogus'],
    perField: {
      platform: { matchedBy: 'label', confidence: 0.7, suggestedCode: 'NEW_PLAT' },
      hacker: { matchedBy: 'x' },
    },
    unmatched: [{ taxonomyType: 'impact', rawValue: 'Bilinmeyen' }, { nope: 1 }],
  },
  appliedMapping: {
    source: 'businessProcess',
    category: 'Genel Destek',
    subCategory: 'Uygulama',
    requestType: 'Incident',
    trace: { category: 'businessProcess', subCategory: 'fallback', requestType: 'businessProcess' },
  },
});
const st = merged.smartTicket;
expectTrue('2.1 diğer customFields dalı korunur', merged.dynamicX?.keep === true);
expectTrue('2.2 closure alt-dalı AYNEN korunur', st.closure?.rootCauseGroup === 'RC1');
expectTrue('2.3 aiDrafts alt-dalı korunur', st.aiDrafts?.note === 'dur');
expectTrue('2.4 dolu alan ezildi (platform)', st.platform === 'NEW_PLAT' && st.platformLabel === 'Yeni Platform');
expectTrue('2.5 yeni alan set edildi (businessProcess)', st.businessProcess === 'BP1' && st.businessProcessLabel === 'Süreç 1');
expectTrue('2.6 boş gelen alan SİLİNDİ (impact code+label)', !('impact' in st) && !('impactLabel' in st));
expectTrue('2.7 suggestion perField allowlist (hacker düştü, platform kaldı)',
  st.classificationSuggestion.perField.platform?.suggestedCode === 'NEW_PLAT'
  && !('hacker' in st.classificationSuggestion.perField));
expectTrue('2.8 appliedFields allowlist (bogus düştü)',
  st.classificationSuggestion.appliedFields.length === 1
  && st.classificationSuggestion.appliedFields[0] === 'platform');
expectTrue('2.9 unmatched bounded (obj olmayan düştü)',
  st.classificationSuggestion.unmatched.length === 1);
expectTrue('2.10 appliedMapping + trace obje paritesi',
  st.appliedMapping.category === 'Genel Destek' && st.appliedMapping.trace.requestType === 'businessProcess');
expectTrue('2.11 classificationUpdatedAt stamp', typeof st.classificationUpdatedAt === 'string');
let threw = false;
try { buildSmartTicketOpeningMerge(prev, { yok: 1 }); } catch { threw = true; }
expectTrue('2.12 fields yoksa 400 fırlatır', threw);

console.log('── 3) FE kart — 3 durum + tenant kapısı ──');
expectTrue('3.1 kart dosyası var + testid', card.includes('data-testid="smart-classification-card"'));
expectTrue('3.2 boş-durum akış ipucu (öz-açıklayıcı ekran)',
  card.includes('önce Açıklama'));
expectTrue('3.3 tenant kapısı: KB kapalı + veri yok → null',
  card.includes('if (!kbEnabled && !hasData) return null'));
expectTrue('3.4 KB kapalı + veri var → buton yok (kbEnabled && canEdit koşulu)',
  /kbEnabled && canEdit &&/.test(card));
expectTrue('3.5 ezme kuralı: önerisi olan alan ezilir',
  card.includes('if (s?.code) next[f.key] = s.code'));
expectTrue('3.6 rozet: KB önerisi vs elle seçildi',
  card.includes("'elle seçildi'") && card.includes('KB önerisi'));
expectTrue('3.7 açıklama <5 karakter guard',
  card.includes('description.length < 5'));
expectTrue('3.8 elle seçim yolu (KB erişilemezse tıkanma yok)',
  card.includes('Elle seç'));

console.log('── 4) CaseDetailPage entegrasyonu ──');
expectTrue('4.1 kart Devir Notu altında render (SmartClassificationCard)',
  detail.includes('<SmartClassificationCard'));
expectTrue('4.2 kbEnabled settings-status ile yükleniyor',
  detail.includes('externalKbService') && detail.includes('settingsStatus'));
expectTrue('4.3 SmartTicketMetaSection hideOpening (kapanış-only)',
  detail.includes('<SmartTicketMetaSection item={item} hideOpening />'));
expectTrue('4.4 hideOpening açılış chip\'lerini gizler',
  detail.includes('hideOpening ? [] : openingFields.filter'));
expectTrue('4.5 kapanış-only başlık',
  detail.includes("'Kapanış Etiketleri'"));
expectTrue('4.6 authz field-state kapısı korunur (smartTicketMeta)',
  /canShowField\('smartTicketMeta'\)[\s\S]{0,200}<SmartClassificationCard/.test(detail));

console.log('── 5) Çözüm Adımları AI buton kapısı ──');
expectTrue('5.1 panel kbEnabled prop alıyor', steps.includes('kbEnabled?: boolean | null'));
expectTrue('5.2 buton yalnız kbEnabled !== false iken',
  /kbEnabled !== false && \(\s*<Button/.test(steps));
expectTrue('5.3 CaseDetailPage panele kbEnabled geçiyor',
  /<CaseSolutionStepsPanel\s+item=\{item\}\s+kbEnabled=\{kbEnabled\}/.test(detail));

console.log('── 6) Servis katmanı ──');
expectTrue('6.1 caseService.updateSmartClassification (mutation caseService\'te)',
  /caseService = \{[\s\S]*updateSmartClassification/.test(service));
expectTrue('6.2 UpdateSmartClassificationRequest tipi',
  service.includes('interface UpdateSmartClassificationRequest'));

console.log('── 7) KB hata sınıflandırması (R1) ──');
// Gerçek olay reprosu: Anthropic kredi hatası upstream data içinde.
const quotaWrapped = {
  ok: false,
  error: { code: 'external_kb_http_error', message: 'Dış API HTTP 500', status: 500 },
  data: { error: { message: '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}', status: 500 } },
};
expectTrue('7.1 kredi hatası → kb_quota_exceeded', classifyKbFailure(quotaWrapped).code === 'kb_quota_exceeded');
expectTrue('7.2 kota mesajı eylem içerir (elle seçim + yönetici)',
  /elle seçim/.test(classifyKbFailure(quotaWrapped).message) && /yönetici/.test(classifyKbFailure(quotaWrapped).message));
expectTrue('7.3 timeout → kb_timeout (504)',
  classifyKbFailure({ error: { code: 'external_kb_timeout' } }).code === 'kb_timeout'
  && classifyKbFailure({ error: { code: 'external_kb_timeout' } }).status === 504);
expectTrue('7.4 network → kb_unreachable',
  classifyKbFailure({ error: { code: 'external_kb_network_error' } }).code === 'kb_unreachable');
expectTrue('7.5 bilinmeyen → external_kb_failed (mevcut davranış)',
  classifyKbFailure({ error: { code: 'external_kb_http_error' }, data: { x: 1 } }).code === 'external_kb_failed');
expectTrue('7.6 upstream ham mesajı kullanıcı mesajına SIZMAZ',
  !classifyKbFailure(quotaWrapped).message.includes('Anthropic'));
expectTrue('7.7 rate limit de kota sınıfına düşer',
  classifyKbFailure({ error: { message: 'HTTP 429 rate_limit_error' } }).code === 'kb_quota_exceeded');
expectTrue('7.8 pickKbFailure en spesifik sınıfı seçer (v2 kota + fallback jenerik)',
  pickKbFailure({ error: { code: 'external_kb_http_error' }, data: { generic: 1 } }, quotaWrapped).code === 'kb_quota_exceeded');
expectTrue('7.9 pickKbFailure hepsi jenerikse jenerik döner',
  pickKbFailure({ error: { code: 'external_kb_http_error' } }, null).code === 'external_kb_failed');

console.log('── 8) Codex R1 fix\'leri ──');
const repo = readFileSync('server/db/caseRepository.js', 'utf8');
expectTrue('8.1 requestType M_REQUEST allowlist ile Case kolonuna yazılır',
  repo.includes('categoryUpdate.requestType = M_REQUEST[mapping.requestType.trim()]'));
expectTrue('8.2 taxonomy cache ŞİRKETE bağlı (taxCompanyRef)',
  card.includes('taxCompanyRef.current === item.companyId'));
expectTrue('8.3 vaka değişiminde kart state reset (caseIdRef)',
  card.includes('caseIdRef.current !== item.id') && /caseIdRef[\s\S]{0,200}setValues\(readStoredValues\(item\)\)/.test(card));
expectTrue('8.4 mutation sonrası invalidateCaseDetail (WR-H2 paritesi)',
  /updateSmartClassification[\s\S]{0,600}invalidateCaseDetail\(caseId\)/.test(service));

console.log('── 9) FAZ 1.1 — kapanış zorunluluğu tenant kapısı ──');
const stp = readFileSync('src/features/cases/StatusTransitionPanel.tsx', 'utf8');
expectTrue('9.1 panel kbEnabled settings-status ile yüklüyor',
  stp.includes('externalKbService') && stp.includes('settingsStatus'));
expectTrue('9.2 kbAnalysisPending kapıya bağlı (kbEnabled !== false)',
  /kbAnalysisPending =\s*kbEnabled !== false &&/.test(stp));
expectTrue('9.3 KB öneri paneli KB kapalıyken gizli',
  /\{kbEnabled !== false && \(\s*<KbClosureSuggestionPanel/.test(stp));
expectTrue('9.4 Kapanış Bilgileri bölümü KB kapalıyken gizli',
  /\{kbEnabled !== false && \(\s*<div className="rounded-md border border-brand-100/.test(stp));
expectTrue('9.5 backend guard tenant-farkında (externalKbSetting enabled kontrolü)',
  /SMART_TICKET_CLOSURE_REQUIRED[\s\S]{0,700}externalKbSetting[\s\S]{0,200}enabled === true/.test(repo));

console.log('── 10) Codex R2 fix\'leri ──');
expectTrue('10.1 analyze stale-response guard (reqId + targetCaseId)',
  card.includes('analyzeReqIdRef.current || caseIdRef.current !== targetCaseId'));
expectTrue('10.2 boş seçimde appliedMapping GÖNDERİLMEZ',
  /hasAnySelection[\s\S]{0,80}if \(hasAnySelection\)/.test(card) || card.includes('if (hasAnySelection) {'));

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
