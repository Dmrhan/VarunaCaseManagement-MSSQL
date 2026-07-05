/**
 * smoke-l2-smart-flow-faz1.js — 2026-07-05
 *
 * L2-Smart-Flow FAZ 1: Akıllı Tanımlar kartı (Case Detail) + backend
 * smart-classification endpoint'i. Yapısal assert + builder davranış
 * simülasyonu. (Canlı DOM kabulü ayrı: scripts/accept-l2-smart-card.mjs)
 */
import { readFileSync } from 'node:fs';
import { buildSmartTicketOpeningMerge } from '../server/db/caseRepository.js';

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

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
