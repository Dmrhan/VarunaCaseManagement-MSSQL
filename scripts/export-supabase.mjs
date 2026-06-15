/**
 * Supabase → lokal export (Faz 7, adım 1/2).
 *
 * Kurumsal ağda Postgres portları kapalı, farklı ağda ise MSSQL erişilemiyor —
 * bu yüzden aktarım iki adıma bölündü. Bu script Supabase erişimi olan ağda
 * çalıştırılır ve her şeyi diske indirir:
 *
 *   data/supabase-export/tables/<Tablo>.json   — public şema tabloları (ham satırlar)
 *   data/supabase-export/auth-users.json       — auth.users (id, email, bcrypt hash)
 *   data/supabase-export/manifest.json         — sayımlar + zaman damgası
 *   STORAGE_ROOT/cases/...                     — case-attachments bucket dosyaları
 *
 * Adım 2: scripts/import-supabase-export.mjs (MSSQL erişimi olan ağda).
 *
 * Çalıştırma: node --env-file=.env scripts/export-supabase.mjs [--skip-files]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_FILES = process.argv.includes('--skip-files');

const PG_URL = process.env.SUPABASE_DIRECT_URL;
if (!PG_URL) {
  console.error('SUPABASE_DIRECT_URL env gerekli.');
  process.exit(1);
}

const exportDir = path.join(root, 'data', 'supabase-export');
const tablesDir = path.join(exportDir, 'tables');
fs.mkdirSync(tablesDir, { recursive: true });

const pgClient = new pg.Client({ connectionString: PG_URL, ssl: { rejectUnauthorized: false } });
await pgClient.connect();

// Tablo listesi public şemadan dinamik alınır (yeni/eksik model sürprizi olmasın)
const tables = (
  await pgClient.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       AND table_name NOT LIKE '\\_prisma%' ESCAPE '\\'
     ORDER BY table_name`,
  )
).rows.map((r) => r.table_name);

console.log(`Kaynak: ${PG_URL.replace(/:\/\/[^@]*@/, '://***@').slice(0, 70)}`);
console.log(`Tablolar: ${tables.length}\n`);

const manifest = { exportedAt: new Date().toISOString(), tables: {}, authUsers: 0, files: { count: 0, bytes: 0, failed: 0 } };

for (const t of tables) {
  const res = await pgClient.query(`SELECT * FROM "${t}"`);
  fs.writeFileSync(path.join(tablesDir, `${t}.json`), JSON.stringify(res.rows));
  manifest.tables[t] = res.rows.length;
  console.log(`  ✓ ${t.padEnd(26)} ${String(res.rows.length).padStart(7)} satır`);
}

// auth.users — bcrypt hash'ler local auth ile uyumlu (şifreler korunur)
const auth = await pgClient.query(
  'SELECT id::text AS id, email, encrypted_password FROM auth.users',
);
fs.writeFileSync(path.join(exportDir, 'auth-users.json'), JSON.stringify(auth.rows));
manifest.authUsers = auth.rows.length;
console.log(`  ✓ ${'auth.users'.padEnd(26)} ${String(auth.rows.length).padStart(7)} kullanıcı (şifre hash'leriyle)`);

// Storage dosyaları → doğrudan STORAGE_ROOT (nihai yerleri; fileUrl path'leri aynı)
if (!SKIP_FILES) {
  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_URL || !SB_KEY) {
    console.warn('⚠ SUPABASE_URL / SERVICE_ROLE_KEY yok — dosyalar atlandı.');
  } else {
    const storageRoot = path.resolve(process.env.STORAGE_ROOT || path.join(root, 'data', 'attachments'));
    const objects = await pgClient.query(
      `SELECT name, (metadata->>'size')::bigint AS size
       FROM storage.objects WHERE bucket_id = 'case-attachments' ORDER BY name`,
    );
    const totalMb = objects.rows.reduce((a, o) => a + Number(o.size ?? 0), 0) / 1024 / 1024;
    console.log(`\nDosyalar: ${objects.rows.length} obje (~${totalMb.toFixed(1)} MB) → ${storageRoot}`);
    for (const { name, size } of objects.rows) {
      try {
        const url = `${SB_URL}/storage/v1/object/case-attachments/${name.split('/').map(encodeURIComponent).join('/')}`;
        // Yeni format anahtarlar (sb_secret_...) JWT değil — `apikey` header'ı
        // gerekir; eski JWT service_role ile de uyumlu olsun diye ikisi birden.
        const r = await fetch(url, { headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}` } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        const abs = path.join(storageRoot, name);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, buf);
        manifest.files.count++;
        manifest.files.bytes += Number(size ?? buf.length);
      } catch (e) {
        manifest.files.failed++;
        console.warn(`  ✗ ${name}: ${e.message}`);
      }
    }
    console.log(`  ✓ ${manifest.files.count} dosya indirildi${manifest.files.failed ? `, ${manifest.files.failed} HATA` : ''}`);
  }
}

fs.writeFileSync(path.join(exportDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
await pgClient.end();

const totalRows = Object.values(manifest.tables).reduce((a, b) => a + b, 0);
console.log(`\n✅ Export tamamlandı: ${totalRows} satır, ${manifest.authUsers} auth kullanıcısı, ${manifest.files.count} dosya.`);
console.log(`   Çıktı: ${exportDir}`);
console.log('   Sonraki adım (kurumsal ağda): node --env-file=.env scripts/import-supabase-export.mjs --dry');
