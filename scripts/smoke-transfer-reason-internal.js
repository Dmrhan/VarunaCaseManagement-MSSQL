/**
 * Aktarım Gerekçesi listesine "İç Aktarım" (internal_transfer) seçeneği eklendi.
 *
 * Bu kod, tarihsel nedenlerle 6 AYRI yerde birbirinin kopyası olarak
 * tutuluyor — yeni bir gerekçe eklemek hepsinin güncellenmesini gerektiriyor,
 * unutulan bir kopya sessizce tutarsızlık yaratır (ör. reasonLabel null
 * döner, AI bu kodu hiç önermez, veya ekranda bu seçenek hiç görünmez).
 * Bu smoke test tam olarak bunu (bir kopyanın unutulmasını) yakalamak için
 * var — 6 kaynağın da AYNI kod kümesine sahip olduğunu doğrular.
 *
 *   1. src/services/aiService.ts          — TransferReasonCode TS union
 *   2. src/features/cases/components/TransferModal.tsx — REASON_CHIPS (Vaka Aktar modal'ı)
 *   3. src/features/cases/QuickCaseModal.tsx — TRANSFER_REASON_CHIPS (Hızlı Vaka modal'ı)
 *   4. server/db/caseRepository.js         — TRANSFER_REASON_LABEL (activity log + reasonLabel API alanı)
 *   5. server/lib/transferAi.js            — REASON_LABEL (AI devir notu bağlamı)
 *   6. server/routes/ai.js                 — reasonCodeEnum (AI öneri şeması — AI bu kodu ÖNERE bilir)
 *
 * Statik smoke: DB'ye dokunmaz, kaynak kodda beklenen desenlerin varlığını
 * ve 6 kaynak arasındaki kod-kümesi TUTARLILIĞINI kontrol eder.
 *
 * Çalıştır: node scripts/smoke-transfer-reason-internal.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
function check(label, ok) {
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}
function read(filePath) {
  return readFileSync(path.resolve(root, filePath), 'utf8');
}

const SOURCES = [
  {
    label: 'aiService.ts — TransferReasonCode union',
    file: 'src/services/aiService.ts',
    extract: (c) => {
      const m = c.match(/export type TransferReasonCode =\s*([\s\S]*?);/);
      return m ? [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]) : [];
    },
  },
  {
    label: 'TransferModal.tsx — REASON_CHIPS',
    file: 'src/features/cases/components/TransferModal.tsx',
    extract: (c) => {
      const m = c.match(/const REASON_CHIPS: ReasonChip\[\] = \[([\s\S]*?)\];/);
      return m ? [...m[1].matchAll(/code: '(\w+)'/g)].map((x) => x[1]) : [];
    },
  },
  {
    label: 'QuickCaseModal.tsx — TRANSFER_REASON_CHIPS',
    file: 'src/features/cases/QuickCaseModal.tsx',
    extract: (c) => {
      const m = c.match(/const TRANSFER_REASON_CHIPS: TransferReasonChip\[\] = \[([\s\S]*?)\];/);
      return m ? [...m[1].matchAll(/code: '(\w+)'/g)].map((x) => x[1]) : [];
    },
  },
  {
    label: 'caseRepository.js — TRANSFER_REASON_LABEL',
    file: 'server/db/caseRepository.js',
    extract: (c) => {
      const m = c.match(/const TRANSFER_REASON_LABEL = \{([\s\S]*?)\};/);
      return m ? [...m[1].matchAll(/(\w+): '/g)].map((x) => x[1]) : [];
    },
  },
  {
    label: 'transferAi.js — REASON_LABEL',
    file: 'server/lib/transferAi.js',
    extract: (c) => {
      const m = c.match(/const REASON_LABEL = \{([\s\S]*?)\};/);
      return m ? [...m[1].matchAll(/(\w+): '/g)].map((x) => x[1]) : [];
    },
  },
  {
    label: 'ai.js — reasonCodeEnum (AI öneri şeması)',
    file: 'server/routes/ai.js',
    extract: (c) => {
      const m = c.match(/const reasonCodeEnum = \[([\s\S]*?)\];/);
      return m ? [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]) : [];
    },
  },
];

const extracted = SOURCES.map((s) => ({ ...s, codes: s.extract(read(s.file)) }));

for (const s of extracted) {
  check(`${s.label} — 'internal_transfer' içeriyor`, s.codes.includes('internal_transfer'));
}

// 6 kaynak da AYNI kod kümesine (sırasız) sahip olmalı — biri unutulursa burada yakalanır.
const sets = extracted.map((s) => [...s.codes].sort().join(','));
const allSame = sets.every((s) => s === sets[0]);
check('6 kaynağın hepsi AYNI reasonCode kümesine sahip (drift yok)', allSame);
if (!allSame) {
  for (const s of extracted) console.log(`  - ${s.label}: [${[...s.codes].sort().join(', ')}]`);
}

check('TransferModal.tsx — "İç Aktarım" etiketi doğru', /\{ code: 'internal_transfer', label: 'İç Aktarım' \}/.test(read('src/features/cases/components/TransferModal.tsx')));
check('QuickCaseModal.tsx — "İç Aktarım" etiketi doğru', /\{ code: 'internal_transfer', label: 'İç Aktarım' \}/.test(read('src/features/cases/QuickCaseModal.tsx')));
check('caseRepository.js — "İç Aktarım" etiketi doğru', /internal_transfer: 'İç Aktarım'/.test(read('server/db/caseRepository.js')));
check('transferAi.js — "İç Aktarım" etiketi doğru', /internal_transfer: 'İç Aktarım'/.test(read('server/lib/transferAi.js')));

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
