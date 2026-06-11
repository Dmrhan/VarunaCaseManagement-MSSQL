/**
 * DB-direct smoke'ları sırayla koşar, exit code'larıyla raporlar.
 * API/Supabase gerektirenler (fetch/BASE_URL/SUPABASE_URL kullananlar) atlanır.
 *
 * Kullanım: node scripts/run-smoke-batch.mjs [--only name-fragment]
 * Çıktı: scripts/smoke-batch-results.txt + her script'in son satırları konsola.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

const scripts = fs.readdirSync(path.join(root, 'scripts'))
  .filter((f) => f.startsWith('smoke-') && f.endsWith('.js'))
  .filter((f) => {
    const src = fs.readFileSync(path.join(root, 'scripts', f), 'utf8');
    return !/fetch\(|SUPABASE_URL|localhost:31|BASE_URL/.test(src);
  })
  .filter((f) => !only || f.includes(only));

const results = [];
for (const f of scripts) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--env-file=.env', `scripts/${f}`], {
    cwd: root,
    timeout: 120_000,
    encoding: 'utf8',
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const status = r.error?.code === 'ETIMEDOUT' ? 'TIMEOUT' : r.status === 0 ? 'PASS' : `FAIL(${r.status})`;
  results.push({ f, status, secs, tail: (r.stdout + '\n' + r.stderr).trim().split('\n').slice(-6).join('\n') });
  console.log(`${status.padEnd(9)} ${secs.padStart(4)}s  ${f}`);
}

const failed = results.filter((r) => r.status !== 'PASS');
let report = results.map((r) => `${r.status.padEnd(9)} ${r.f}`).join('\n');
report += `\n---\nPASS: ${results.length - failed.length} / ${results.length}\n`;
for (const r of failed) {
  report += `\n===== ${r.f} (${r.status}) =====\n${r.tail}\n`;
}
fs.writeFileSync(path.join(root, 'scripts', 'smoke-batch-results.txt'), report, 'utf8');
console.log(`\nPASS: ${results.length - failed.length} / ${results.length} — detay: scripts/smoke-batch-results.txt`);
