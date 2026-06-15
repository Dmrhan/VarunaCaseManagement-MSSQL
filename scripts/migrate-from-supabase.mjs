/**
 * Supabase (Postgres) → MSSQL veri aktarımı (Faz 7).
 *
 * Modlar:
 *   --dry            (default) hiçbir şey yazmaz; kaynak/hedef sayım raporu
 *   --execute        gerçek aktarım (hedefte ilgili tablolar BOŞ olmalı ya da --wipe)
 *   --wipe           aktarımdan önce hedef MSSQL'deki uygulama verisini temizler
 *   --skip-files     dosya eklerini (Supabase Storage) atla
 *
 * Dönüşümler:
 *   - Enum kolonları: Postgres TR @map değerleri → ASCII identifier
 *     (scripts/schema-postgres-original.prisma'dan otomatik üretilir)
 *   - Json kolonları: obje → string (client.js json köprüsü halleder)
 *   - User.passwordHash: auth.users.encrypted_password (bcrypt — uyumlu!)
 *   - ID'ler aynen korunur.
 *
 * Gerekli env: SUPABASE_DIRECT_URL (postgres), DATABASE_URL (mssql/prisma),
 *              dosyalar için SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *
 * Çalıştırma: node --env-file=.env scripts/migrate-from-supabase.mjs [--execute --wipe]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { prisma as bridgedPrisma } from '../server/db/client.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const WIPE = args.includes('--wipe');
const SKIP_FILES = args.includes('--skip-files');

const PG_URL = process.env.SUPABASE_DIRECT_URL;
if (!PG_URL) {
  console.error('SUPABASE_DIRECT_URL env gerekli (Supabase Postgres direct/5432 bağlantısı).');
  process.exit(1);
}

// ─── Eski Postgres şemasından enum eşleme tabloları üret ──────────────────
// enumValueMap: enumName -> { dbValue(TR) -> identifier(ASCII) }
// columnEnum:   Model -> { column -> enumName }

const oldSchema = fs.readFileSync(path.join(root, 'scripts', 'schema-postgres-original.prisma'), 'utf8').replace(/\r\n/g, '\n');

const enumValueMap = {};
for (const m of oldSchema.matchAll(/^enum\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
  const [, name, body] = m;
  const map = {};
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    const mm = line.match(/^(\w+)(?:\s+@map\("([^"]+)"\))?/);
    if (!mm) continue;
    const [, ident, mapped] = mm;
    map[mapped ?? ident] = ident; // dbValue -> identifier
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
// Self-FK'lar (CaseNote.parentNoteId, TaxonomyDef.parentId, CaseLink.linkedCaseId,
// CategoryDef.parentId?) iki geçişte yazılır: önce kolon null, sonra update.

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

// İki geçiş gerektiren self/forward referanslar: ilk geçişte null bırak, sonda doldur.
const DEFERRED_COLUMNS = {
  CaseNote: ['parentNoteId'],
  TaxonomyDef: ['parentId'],
  CategoryDef: ['parentId'],
};

const pgClient = new pg.Client({ connectionString: PG_URL, ssl: { rejectUnauthorized: false } });
await pgClient.connect();

const rawPrisma = new PrismaClient(); // sayım/temizlik için (json köprüsüz)

const lcFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

async function pgCount(table) {
  try {
    const r = await pgClient.query(`SELECT COUNT(*)::int AS n FROM "${table}"`);
    return r.rows[0].n;
  } catch {
    return null; // tablo kaynakta yok (yeni eklenen model)
  }
}

// ─── DRY RUN raporu ───────────────────────────────────────────────────────

console.log('Kaynak: Supabase Postgres —', PG_URL.replace(/:\/\/[^@]*@/, '://***@').slice(0, 80));
console.log('Hedef : MSSQL —', (process.env.DATABASE_URL ?? '').replace(/password=[^;]*/i, 'password=***').slice(0, 80));
console.log('Mod   :', EXECUTE ? `EXECUTE${WIPE ? ' + WIPE' : ''}` : 'DRY RUN');
console.log('');

const report = [];
let totalSource = 0;
for (const t of TABLE_ORDER) {
  const src = await pgCount(t);
  const dst = await rawPrisma[lcFirst(t)].count();
  if (src) totalSource += src;
  report.push({ table: t, source: src ?? '—', target: dst });
}
const authUsers = (await pgClient.query('SELECT COUNT(*)::int AS n FROM auth.users')).rows[0].n;
const storageObjects = await pgClient.query(
  `SELECT COUNT(*)::int AS n, COALESCE(SUM((metadata->>'size')::bigint),0)::bigint AS bytes
   FROM storage.objects WHERE bucket_id = 'case-attachments'`,
).then((r) => r.rows[0]).catch(() => ({ n: 0, bytes: 0 }));

console.log('Tablo'.padEnd(28), 'Kaynak(PG)'.padStart(10), 'Hedef(MSSQL)'.padStart(13));
for (const r of report) {
  console.log(r.table.padEnd(28), String(r.source).padStart(10), String(r.target).padStart(13));
}
console.log('-'.repeat(53));
console.log('Toplam kaynak satır:', totalSource);
console.log('auth.users (şifre hash kaynağı):', authUsers);
console.log(`Storage case-attachments: ${storageObjects.n} dosya, ${(Number(storageObjects.bytes) / 1024 / 1024).toFixed(1)} MB`);

if (!EXECUTE) {
  console.log('\nDRY RUN bitti — gerçek aktarım için: --execute --wipe');
  await pgClient.end();
  await rawPrisma.$disconnect();
  await bridgedPrisma.$disconnect();
  process.exit(0);
}

// ─── WIPE (hedef uygulama verisini temizle) ───────────────────────────────

if (WIPE) {
  console.log('\nHedef MSSQL uygulama verisi temizleniyor (ters sırada)...');
  for (const t of [...TABLE_ORDER].reverse()) {
    // self-FK'lar silmeyi engellemesin
    if (DEFERRED_COLUMNS[t]) {
      for (const col of DEFERRED_COLUMNS[t]) {
        await rawPrisma[lcFirst(t)].updateMany({ data: { [col]: null } });
      }
    }
    if (t === 'CaseLink') await rawPrisma.caseLink.deleteMany();
    const n = await rawPrisma[lcFirst(t)].deleteMany();
    if (n.count > 0) console.log(`  - ${t}: ${n.count} silindi`);
  }
}

// ─── Satır dönüştürücü ────────────────────────────────────────────────────

function transformRow(table, row) {
  const out = { ...row };
  const enums = columnEnum[table] ?? {};
  for (const [col, enumName] of Object.entries(enums)) {
    const v = out[col];
    if (v == null) continue;
    const mapped = enumValueMap[enumName][v];
    if (mapped === undefined) {
      throw new Error(`${table}.${col}: bilinmeyen enum değeri "${v}" (${enumName})`);
    }
    out[col] = mapped;
  }
  return out;
}

// ─── Aktarım ──────────────────────────────────────────────────────────────

const BATCH = 200;
console.log('\nAktarım başlıyor...');

// auth.users → passwordHash haritası
const authRows = await pgClient.query(
  'SELECT id::text AS id, email, encrypted_password FROM auth.users',
);
const pwById = new Map(authRows.rows.map((r) => [r.id, r.encrypted_password]));

const deferredFixups = []; // { table, id, data }

for (const table of TABLE_ORDER) {
  const src = await pgCount(table);
  if (src === null || src === 0) continue;

  const res = await pgClient.query(`SELECT * FROM "${table}"`);
  const deferredCols = DEFERRED_COLUMNS[table] ?? [];
  let written = 0;

  for (let i = 0; i < res.rows.length; i += BATCH) {
    const batch = res.rows.slice(i, i + BATCH).map((row) => {
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

// ─── Dosya ekleri (Supabase Storage → STORAGE_ROOT) ──────────────────────

if (!SKIP_FILES) {
  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_URL || !SB_KEY) {
    console.warn('\n⚠ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY yok — dosya ekleri ATLANDI.');
    console.warn('  Sonradan çalıştırmak için aynı script: --execute yerine --files-only desteklenmez;');
    console.warn('  key gelince scripts/migrate-supabase-files.mjs kullanılacak (ayrı adım).');
  } else {
    const storageRoot = path.resolve(process.env.STORAGE_ROOT || path.join(root, 'data', 'attachments'));
    const objects = await pgClient.query(
      `SELECT name FROM storage.objects WHERE bucket_id = 'case-attachments' ORDER BY name`,
    );
    console.log(`\nDosya ekleri indiriliyor: ${objects.rows.length} obje → ${storageRoot}`);
    let okCount = 0;
    let failCount = 0;
    for (const { name } of objects.rows) {
      try {
        const r = await fetch(`${SB_URL}/storage/v1/object/case-attachments/${encodeURIComponent(name).replace(/%2F/g, '/')}`, {
          headers: { authorization: `Bearer ${SB_KEY}` },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        const abs = path.join(storageRoot, name);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, buf);
        okCount++;
      } catch (e) {
        failCount++;
        console.warn(`  ✗ ${name}: ${e.message}`);
      }
    }
    console.log(`  ✓ ${okCount} dosya indirildi${failCount ? `, ${failCount} HATA` : ''}`);
  }
}

await pgClient.end();
await rawPrisma.$disconnect();
await bridgedPrisma.$disconnect();
console.log('\n✅ Aktarım tamamlandı.');
