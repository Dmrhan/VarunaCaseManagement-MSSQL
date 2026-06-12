/**
 * Lokal Supabase export'unu MSSQL'e aktarır (Faz 7, adım 2/2).
 *
 * Kaynak: data/supabase-export/ (scripts/export-supabase.mjs çıktısı)
 * Hedef:  DATABASE_URL'deki MSSQL (kurumsal ağda erişilebilir olmalı)
 *
 * Modlar:
 *   --dry      (default) hiçbir şey yazmaz; export/hedef sayım raporu
 *   --execute  gerçek aktarım
 *   --wipe     aktarımdan önce hedefteki mevcut uygulama verisini siler (demo temizliği)
 *
 * Dönüşümler:
 *   - Enum kolonları TR → ASCII (scripts/schema-postgres-original.prisma'dan)
 *   - Json kolonları: export'taki objeler client.js json köprüsüyle string'e döner
 *   - User.passwordHash: auth-users.json'daki bcrypt hash'ler (şifreler korunur)
 *   - Self-FK kolonları (CaseNote.parentNoteId, TaxonomyDef/CategoryDef.parentId)
 *     iki geçişte bağlanır
 *   - Aktarım sonrası ExternalKbSetting in-process KB'ye yönlendirilir
 *
 * Çalıştırma: node --env-file=.env scripts/import-supabase-export.mjs [--execute --wipe]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { prisma as bridgedPrisma } from '../server/db/client.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const WIPE = args.includes('--wipe');

const exportDir = path.join(root, 'data', 'supabase-export');
const manifest = JSON.parse(fs.readFileSync(path.join(exportDir, 'manifest.json'), 'utf8'));

// ─── Enum eşleme tabloları (orijinal Postgres şemasından) ─────────────────

const oldSchema = fs
  .readFileSync(path.join(root, 'scripts', 'schema-postgres-original.prisma'), 'utf8')
  .replace(/\r\n/g, '\n');

const enumValueMap = {};
for (const m of oldSchema.matchAll(/^enum\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
  const [, name, body] = m;
  const map = {};
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    const mm = line.match(/^(\w+)(?:\s+@map\("([^"]+)"\))?/);
    if (!mm) continue;
    map[mm[2] ?? mm[1]] = mm[1];
  }
  enumValueMap[name] = map;
}

const columnEnum = {};
{
  let model = null;
  for (const line of oldSchema.split('\n')) {
    const mo = line.match(/^model\s+(\w+)\s*\{/);
    if (mo) { model = mo[1]; columnEnum[model] = {}; continue; }
    if (/^\}/.test(line)) { model = null; continue; }
    if (!model) continue;
    const fm = line.match(/^\s{2}(\w+)\s+(\w+)\??(\s|$)/);
    if (fm && enumValueMap[fm[2]]) columnEnum[model][fm[1]] = fm[2];
  }
}

// ─── Aktarım sırası (FK bağımlılıklarına göre) ────────────────────────────

const TABLE_ORDER = [
  'Company', 'CompanySettings', 'ExternalKbSetting',
  'User', 'Person', 'Team', 'UserCompany',
  'ThirdParty', 'DocumentType', 'CategoryDef', 'OfferedSolutionDef',
  'ProductGroup', 'Product', 'Package', 'PackageItem',
  'SLAPolicy', 'ChecklistTemplate', 'FieldDefinition', 'TaxonomyDef',
  'Account', 'AccountCompany', 'AccountProject', 'AccountProduct', 'AccountContact', 'Address',
  'ResolutionApprovalPolicy',
  'Case',
  'CaseActivity', 'CaseNote', 'CaseNoteReaction', 'CaseAttachment', 'CaseCallLog',
  'CaseOfferedSolution', 'CaseApproval', 'CaseResolutionApproval', 'CaseReminder',
  'CaseMention', 'CaseWatcher', 'CaseTransfer', 'CaseLink', 'CaseNotification',
  'CaseSolutionStep', 'AISuggestion',
  'KnowledgeSource', 'QAScoreLog', 'PatternAlert', 'AIUsageLog',
  'MetricQueryAudit', 'ImportJob', 'ImportJobRow',
  'NotificationTemplate', 'NotificationRule', 'NotificationDispatch',
  'ActionItem',
];

const DEFERRED_COLUMNS = {
  CaseNote: ['parentNoteId'],
  TaxonomyDef: ['parentId'],
  CategoryDef: ['parentId'],
};

const rawPrisma = new PrismaClient();
const lcFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

function readTable(t) {
  const p = path.join(exportDir, 'tables', `${t}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

// ─── Rapor ────────────────────────────────────────────────────────────────

console.log(`Export: ${manifest.exportedAt} (${exportDir})`);
console.log(`Mod   : ${EXECUTE ? `EXECUTE${WIPE ? ' + WIPE' : ''}` : 'DRY RUN'}\n`);
console.log('Tablo'.padEnd(28), 'Export'.padStart(8), 'Hedef(MSSQL)'.padStart(13));
let totalSource = 0;
for (const t of TABLE_ORDER) {
  const src = manifest.tables[t] ?? '—';
  const dst = await rawPrisma[lcFirst(t)].count();
  if (typeof src === 'number') totalSource += src;
  console.log(t.padEnd(28), String(src).padStart(8), String(dst).padStart(13));
}
console.log('-'.repeat(53));
console.log('Toplam export satırı:', totalSource, '| auth.users:', manifest.authUsers, '| dosya:', manifest.files.count);

if (!EXECUTE) {
  console.log('\nDRY RUN bitti — gerçek aktarım: --execute --wipe');
  await rawPrisma.$disconnect();
  await bridgedPrisma.$disconnect();
  process.exit(0);
}

// ─── WIPE ─────────────────────────────────────────────────────────────────

if (WIPE) {
  console.log('\nHedefteki mevcut uygulama verisi siliniyor (ters sırada)...');
  for (const t of [...TABLE_ORDER].reverse()) {
    if (DEFERRED_COLUMNS[t]) {
      for (const col of DEFERRED_COLUMNS[t]) {
        await rawPrisma[lcFirst(t)].updateMany({ data: { [col]: null } });
      }
    }
    const n = await rawPrisma[lcFirst(t)].deleteMany();
    if (n.count > 0) console.log(`  - ${t}: ${n.count}`);
  }
}

// ─── Dönüştür + yaz ───────────────────────────────────────────────────────

function transformRow(table, row) {
  const out = { ...row };
  for (const [col, enumName] of Object.entries(columnEnum[table] ?? {})) {
    const v = out[col];
    if (v == null) continue;
    const mapped = enumValueMap[enumName][v];
    if (mapped === undefined) throw new Error(`${table}.${col}: bilinmeyen enum değeri "${v}"`);
    out[col] = mapped;
  }
  return out;
}

const authUsers = JSON.parse(fs.readFileSync(path.join(exportDir, 'auth-users.json'), 'utf8'));
const pwById = new Map(authUsers.map((u) => [u.id, u.encrypted_password]));

const BATCH = 500;
const deferredFixups = [];
console.log('\nAktarım başlıyor...');

for (const table of TABLE_ORDER) {
  const rows = readTable(table);
  if (!rows || rows.length === 0) continue;
  const deferredCols = DEFERRED_COLUMNS[table] ?? [];
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map((row) => {
      const t = transformRow(table, row);
      for (const col of deferredCols) {
        if (t[col] != null) {
          deferredFixups.push({ table, id: t.id, data: { [col]: t[col] } });
          t[col] = null;
        }
      }
      if (table === 'User') {
        const hash = pwById.get(t.id) ?? null;
        t.passwordHash = hash && hash.length > 0 ? hash : null;
        t.mustChangePassword = false;
        t.passwordUpdatedAt = hash ? new Date() : null;
      }
      return t;
    });
    await bridgedPrisma[lcFirst(table)].createMany({ data: batch });
    written += batch.length;
  }
  console.log(`  ✓ ${table}: ${written}`);
}

if (deferredFixups.length > 0) {
  console.log(`  … self-referans düzeltmeleri: ${deferredFixups.length}`);
  for (const f of deferredFixups) {
    await bridgedPrisma[lcFirst(f.table)].update({ where: { id: f.id }, data: f.data });
  }
}

// ─── Aktarım sonrası: ExternalKbSetting'i in-process KB'ye çevir ──────────

const kbUpdated = await rawPrisma.externalKbSetting.updateMany({
  data: {
    enabled: true,
    providerName: 'Varuna KB (in-process)',
    baseUrl: `http://127.0.0.1:${process.env.PORT ?? 3101}`,
    authType: 'bearerToken',
    apiKeySecretName: 'EXTERNAL_KB_API_KEY',
    timeoutMs: 180000,
  },
});
console.log(`  ✓ ExternalKbSetting in-process KB'ye yönlendirildi (${kbUpdated.count} satır)`);

await rawPrisma.$disconnect();
await bridgedPrisma.$disconnect();
console.log('\n✅ Import tamamlandı. Kontroller: login (eski şifrelerle), vaka listesi, dosya indirme, KB.');
