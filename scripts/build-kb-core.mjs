/**
 * ticket-analiz KB çekirdeğini CSM'e bundle eder (Faz KB).
 *
 * Kaynak: C:\apps\ticket-analiz (src/lib/** — framework-bağımsız TS)
 * Çıktı:  server/kb/kbCore.js (tek dosya, ESM; npm bağımlılıkları external)
 *
 * ticket-analiz tarafında KB lib kodu değişirse yeniden çalıştır:
 *   node scripts/build-kb-core.mjs
 */
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const csmRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kbRoot = process.env.KB_SOURCE_DIR || 'C:/apps/ticket-analiz';

await build({
  entryPoints: [path.join(kbRoot, 'kb-bundle-entry.ts')],
  outfile: path.join(csmRoot, 'server', 'kb', 'kbCore.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external', // npm bağımlılıkları CSM node_modules'tan çözülür
  sourcemap: false,
  logLevel: 'info',
  banner: {
    js: `// OTOMATİK ÜRETİLDİ — elle düzenleme. Kaynak: ${kbRoot}/src/lib
// Yeniden üretmek için: node scripts/build-kb-core.mjs
import { createRequire as __createRequire } from 'node:module';
const require = __createRequire(import.meta.url);`,
  },
});

console.log('kbCore.js üretildi.');
