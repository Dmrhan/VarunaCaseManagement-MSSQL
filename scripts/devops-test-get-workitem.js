#!/usr/bin/env node
/**
 * PR-D1 — TFS connectivity test script.
 *
 * Çalıştır:
 *   npm run devops:test:get
 *   (veya: node --env-file=.env scripts/devops-test-get-workitem.js)
 *
 * Yapar:
 *  1. `.env` config sağlığını kontrol et (TFS_BASE_URL, TFS_PAT,
 *     TFS_API_VERSION, TFS_TEST_WORKITEM_ID).
 *  2. `devopsClient.getWorkItem(TFS_TEST_WORKITEM_ID)` çağır.
 *  3. **HAM `fields` nesnesinin TAMAMINI** yazdır (alan filtreleme YOK —
 *     custom alanların gerçek reference adlarını keşfetmek için).
 *  4. Hedef 16 alan → reference adı eşleme tablosu yazdır (FIELD_MAP).
 *     Custom alanlar henüz null ise "⚠ PR-D1'de doldurulacak" işareti.
 *  5. Connectivity raporu özeti: erişim/auth/api-version + latency.
 *
 * Hatalar net:
 *  - tfs_base_url_missing / tfs_pat_missing → .env eksik
 *  - tfs_auth_error → PAT yanlış/expired
 *  - tfs_not_found → workitem id yok
 *  - tfs_timeout / tfs_network_error → ağ/firewall
 *
 * PAT log'a YAZILMAZ — devopsClient.maskPat kullanılır.
 *
 * Spec: docs/DEVOPS_INTEGRATION.md PR-D1 §8.
 */

import { devopsClient, FIELD_MAP, maskPat, diag } from '../server/lib/devopsClient.js';

const log = (msg) => console.log(msg);
const head = (msg) => console.log(`\n══ ${msg} ${'═'.repeat(Math.max(0, 60 - msg.length))}`);

// ─────────────────────────────────────────────────────────
// 1) Config sağlığı
// ─────────────────────────────────────────────────────────
head('Step 1 — .env config check');
const d = diag();
if (!d.ok) {
  console.error(`✗ Config error: [${d.error.code}] ${d.error.message}`);
  console.error('  → .env dosyanı kontrol et (TFS_BASE_URL, TFS_PAT).');
  console.error('  → .env.example dosyasına referans alabilirsin.');
  process.exit(1);
}
log(`✓ TFS_BASE_URL    : ${d.baseUrl}`);
log(`✓ TFS_PAT         : ${d.patMasked}   (gerçek değer asla log'a yazılmaz)`);
log(`✓ TFS_API_VERSION : ${d.apiVersion}`);
log(`✓ TFS_TIMEOUT_MS  : ${d.timeoutMs}`);

const testId = process.env.TFS_TEST_WORKITEM_ID;
if (!testId) {
  console.error('\n✗ TFS_TEST_WORKITEM_ID .env içinde tanımlı değil.');
  console.error('  → Canlı bir work item id ekle (örn. 324813).');
  process.exit(1);
}
log(`✓ TFS_TEST_WORKITEM_ID: ${testId}`);

// ─────────────────────────────────────────────────────────
// 2) getWorkItem çağrısı
// ─────────────────────────────────────────────────────────
head(`Step 2 — getWorkItem(${testId})`);
const t0 = Date.now();
const result = await devopsClient.getWorkItem(Number.parseInt(testId, 10));
const totalMs = Date.now() - t0;

if (!result.ok) {
  console.error(`\n✗ TFS çağrısı BAŞARISIZ`);
  console.error(`  code     : ${result.error.code}`);
  console.error(`  status   : ${result.error.status ?? '-'}`);
  console.error(`  message  : ${result.error.message}`);
  console.error(`  latency  : ${result.meta?.latencyMs} ms`);
  console.error(`  apiVersion: ${result.meta?.apiVersion}`);
  if (result.error.code === 'tfs_auth_error') {
    console.error('\n  → PAT yanlış/expired olabilir. Yenile veya kapsamı kontrol et:');
    console.error('     Profile → Personal Access Tokens → Work Items (Read)+ izni var mı?');
  }
  if (result.error.code === 'tfs_not_found') {
    console.error('\n  → TFS_TEST_WORKITEM_ID canlı bir id mi? Browser\'da aç ve kontrol et.');
  }
  if (result.error.code === 'tfs_network_error' || result.error.code === 'tfs_timeout') {
    console.error('\n  → Varuna sunucusu unitfs.univera.com.tr\'e erişebiliyor mu?');
    console.error('     Firewall whitelist: tcp/443 outbound');
  }
  process.exit(1);
}

log(`✓ HTTP 200 OK · latency ${result.meta.latencyMs} ms · apiVersion ${result.meta.apiVersion}`);
log(`✓ Toplam süre: ${totalMs} ms`);

const raw = result.data.raw;
const normalized = result.data.normalized;

// ─────────────────────────────────────────────────────────
// 3) HAM fields tam dökümü — custom alan adı keşfi için
// ─────────────────────────────────────────────────────────
head('Step 3 — HAM fields tam dökümü (custom alan adı keşfi)');
log(`Work Item ID: ${raw.id}`);
log(`URL: ${raw._links?.html?.href ?? '<yok>'}`);
log(`Toplam alan sayısı: ${Object.keys(raw.fields ?? {}).length}`);
log('');
log('Alan referans adı → değer (alfabetik sıralı):');
log('─'.repeat(80));
const fields = raw.fields ?? {};
const sortedKeys = Object.keys(fields).sort();
for (const key of sortedKeys) {
  const value = fields[key];
  let display;
  if (value === null || value === undefined) {
    display = '<null>';
  } else if (typeof value === 'object') {
    // AssignedTo / CreatedBy gibi identity field — displayName + uniqueName
    if (value.displayName || value.uniqueName) {
      display = `${value.displayName ?? '?'} <${value.uniqueName ?? '?'}>`;
    } else {
      display = JSON.stringify(value);
    }
  } else {
    const s = String(value);
    display = s.length > 100 ? s.slice(0, 100) + '…' : s;
  }
  log(`  ${key.padEnd(50)} = ${display}`);
}

// ─────────────────────────────────────────────────────────
// 4) Hedef 16 alan → reference adı eşleme tablosu
// ─────────────────────────────────────────────────────────
head('Step 4 — Hedef 16 alan → TFS reference adı (FIELD_MAP)');
log('Hedef alan       | TFS reference         | Tip      | Değer (normalize)');
log('─'.repeat(120));
const displayFields = [
  ['id',             FIELD_MAP.id,              'standart', normalized.id],
  ['state',          FIELD_MAP.state,           'standart', normalized.state],
  ['project',        FIELD_MAP.project,         'standart', normalized.project],
  ['type',           FIELD_MAP.type,            'standart', normalized.type],
  ['title',          FIELD_MAP.title,           'standart', normalized.title],
  ['assignee',       FIELD_MAP.assignee,        'standart', normalized.assignee],
  ['createdDate',    FIELD_MAP.createdDate,     'standart', normalized.createdDate],
  ['resolvedDate',   FIELD_MAP.resolvedDate,    'standart', normalized.resolvedDate],
  ['closedDate',     FIELD_MAP.closedDate,      'standart', normalized.closedDate],
  ['rootCause',      FIELD_MAP.rootCause,       'best-guess', normalized.rootCause],
  ['foundIn',        FIELD_MAP.foundIn,         'best-guess', normalized.foundIn],
  ['packageType',    FIELD_MAP.packageType,     'CUSTOM',     normalized.packageType],
  ['projectLayer',   FIELD_MAP.projectLayer,    'CUSTOM',     normalized.projectLayer],
  ['extraField4',    FIELD_MAP.extraField4,     'CUSTOM',     normalized.extraField4],
  ['foundInRelease', FIELD_MAP.foundInRelease,  'CUSTOM',     normalized.foundInRelease],
  ['bugGroup',       FIELD_MAP.bugGroup,        'CUSTOM',     normalized.bugGroup],
];
for (const [display, ref, type, val] of displayFields) {
  const refStr = ref || '⚠ PR-D1\'de doldurulacak';
  const valStr = val === null || val === undefined
    ? '<null>'
    : typeof val === 'object'
      ? JSON.stringify(val)
      : String(val);
  const valDisplay = valStr.length > 40 ? valStr.slice(0, 40) + '…' : valStr;
  log(`  ${display.padEnd(15)} | ${refStr.padEnd(35)} | ${type.padEnd(10)} | ${valDisplay}`);
}

// ─────────────────────────────────────────────────────────
// 5) Custom alan adı tahmin yardımı — fields'tan custom-looking olanları işaretle
// ─────────────────────────────────────────────────────────
head('Step 5 — Custom alan adı tahmin yardımcısı');
log('Standart alanlar (System.*, Microsoft.VSTS.*) dışındaki referanslar muhtemelen org-özel');
log('custom alanlardır. Aşağıdaki listeden PR-D1 FIELD_MAP güncellemesini yap:');
log('');
const customKeys = sortedKeys.filter((k) =>
  !k.startsWith('System.') &&
  !k.startsWith('Microsoft.VSTS.') &&
  !k.startsWith('WEF.'));
if (customKeys.length === 0) {
  log('  (custom-looking alan bulunamadı — tüm alanlar standart prefix\'li.)');
} else {
  for (const k of customKeys) {
    const val = fields[k];
    const valStr = val === null || val === undefined
      ? '<null>'
      : typeof val === 'object'
        ? JSON.stringify(val).slice(0, 60)
        : String(val).slice(0, 60);
    log(`  ${k.padEnd(50)} = ${valStr}`);
  }
}

// ─────────────────────────────────────────────────────────
// 6) Connectivity raporu özeti
// ─────────────────────────────────────────────────────────
head('Step 6 — Connectivity raporu');
log(`Erişim       : ✓ TFS REST API erişilebilir`);
log(`Auth         : ✓ Basic + PAT çalışıyor (HTTP 200)`);
log(`api-version  : ${result.meta.apiVersion}`);
log(`Latency      : ${result.meta.latencyMs} ms`);
log(`Test ID      : ${testId}`);
log(`Mask PAT     : ${maskPat(process.env.TFS_PAT)}`);
log('');
log('Sonraki adım: yukarıdaki "Custom alan adı tahmin" listesinden gerçek');
log('reference adlarını al ve server/lib/devopsClient.js FIELD_MAP\'i güncelle.');
log('Sonra PR-D2 (link/unlink + DB) başlatılır.');
log('');
process.exit(0);
