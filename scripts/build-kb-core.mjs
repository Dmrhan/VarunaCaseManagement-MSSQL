/**
 * KB çekirdeğini CSM'e bundle eder (Faz KB).
 *
 * Kaynak: server/kb/src/lib/** — framework-bağımsız TS (repo-içi, vendored).
 *         Eskiden C:/apps/ticket-analiz idi; kaynak artık bu repoda tutuluyor.
 * Çıktı:  server/kb/kbCore.js (tek dosya, ESM; npm bağımlılıkları external)
 *
 * KB lib kodu (server/kb/src/lib) değişirse yeniden çalıştır:
 *   node scripts/build-kb-core.mjs
 */
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const csmRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kbRoot = process.env.KB_SOURCE_DIR || path.join(csmRoot, 'server', 'kb');

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
    js: `// OTOMATİK ÜRETİLDİ — elle düzenlemeyin. Kaynak: server/kb/src/lib (repo-içi)
// Yeniden üretmek için: node scripts/build-kb-core.mjs
import { createRequire as __createRequire } from 'node:module';
const require = __createRequire(import.meta.url);`,
  },
});

console.log('kbCore.js üretildi.');
