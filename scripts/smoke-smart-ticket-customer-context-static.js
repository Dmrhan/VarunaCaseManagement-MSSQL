/**
 * smoke-smart-ticket-customer-context-static.js
 *
 * Smart Ticket — Customer Context Banner + Drawer (Faz 1) kaynak-seviye
 * static smoke. Runtime fetch yapmaz; salt dosya kaynaklarını regex ile
 * doğrular.
 *
 * Kapsam:
 *   1) Banner sadece form.accountId set olunca render edilir
 *   2) AccountOpenCasesPanel render edilmiyor + tip de silinmiş
 *   3) Drawer default tab "Geçmiş Çözümler" (resolved)
 *   4) Drawer sıralaması: Geçmiş Çözümler → Açık Vakalar → Sinyaller
 *   5) parseClosureFromCustomFields defansif (string/object/invalid JSON)
 *   6) labelOrCode + computeBannerRiskState helpers var
 *   7) findByAccount({ statusIn: ['Çözüldü'] }) kullanılıyor (closed fetch)
 *   8) Backend / Prisma / API endpoint dosyaları bu PR'da değişmedi
 *   9) Stage 2 (CaseSolutionStepsPanel) ve Stage 3 (closure/transfer) layout
 *      component'lerinin kaynakları değişmedi (touch-check)
 *  10) AccountSearchPicker değişmedi
 *
 * Çalıştır:
 *   node scripts/smoke-smart-ticket-customer-context-static.js
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }
function expect(name, actual, expected) {
  if (actual === expected || JSON.stringify(actual) === JSON.stringify(expected)) ok(name);
  else bad(name, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// ─────────────────────────────────────────────────────────────────
// 1) Banner: kaynak + conditional render
// ─────────────────────────────────────────────────────────────────
console.log('── 1) CustomerContextBanner ──────────────────────────────');
{
  const banner = read('src/features/smart-ticket/CustomerContextBanner.tsx');
  expect('1.1 STATE_META: clear/watch/critical 3 state',
    /clear:\s*\{[\s\S]+?watch:\s*\{[\s\S]+?critical:\s*\{/.test(banner), true);
  expect('1.2 Props: openCount/resolvedCount/riskState/hasDuplicate',
    /openCount:\s*number;[\s\S]{0,200}resolvedCount:\s*number;[\s\S]{0,200}riskState:\s*CustomerContextRiskState;[\s\S]{0,200}hasDuplicate:\s*boolean/.test(banner), true);
  expect('1.3 Render: button + onOpenDrawer',
    /<button[\s\S]{0,500}onClick=\{onOpenDrawer\}/.test(banner), true);

  const page = read('src/features/smart-ticket/SmartTicketNewPage.tsx');
  expect('1.4 Banner sadece form.accountId varsa render',
    /\{form\.accountId && \(\s*<CustomerContextBanner/.test(page), true);
  expect('1.5 CustomerContextBanner import',
    /import \{ CustomerContextBanner \} from '\.\/CustomerContextBanner'/.test(page), true);
}

// ─────────────────────────────────────────────────────────────────
// 2) AccountOpenCasesPanel kaldırıldı (render + function)
// ─────────────────────────────────────────────────────────────────
console.log('\n── 2) AccountOpenCasesPanel removed ──────────────────────');
{
  const page = read('src/features/smart-ticket/SmartTicketNewPage.tsx');
  expect('2.1 Sol panelde <AccountOpenCasesPanel /> JSX YOK',
    /<AccountOpenCasesPanel/.test(page), false);
  expect('2.2 function AccountOpenCasesPanel(...) tanımı YOK',
    /function AccountOpenCasesPanel\(/.test(page), false);
}

// ─────────────────────────────────────────────────────────────────
// 3) Drawer default tab "Geçmiş Çözümler" (resolved)
// ─────────────────────────────────────────────────────────────────
console.log('\n── 3) Drawer default tab "Geçmiş Çözümler" ───────────────');
{
  const drawer = read('src/features/smart-ticket/CustomerContextDrawer.tsx');
  expect('3.1 useState<TabKey>("resolved") default',
    /useState<TabKey>\('resolved'\)/.test(drawer), true);
  expect('3.2 TAB_META.resolved.label === "Geçmiş Çözümler"',
    /resolved:\s*\{\s*label:\s*'Geçmiş Çözümler'/.test(drawer), true);
}

// ─────────────────────────────────────────────────────────────────
// 4) Drawer tab sıralaması: resolved → open → signals
// ─────────────────────────────────────────────────────────────────
console.log('\n── 4) Tab sıralaması ─────────────────────────────────────');
{
  const drawer = read('src/features/smart-ticket/CustomerContextDrawer.tsx');
  // TAB_META Record literal sırası: ilk anahtarın resolved olduğu kanıt
  expect('4.1 TAB_META ilk anahtar resolved',
    /TAB_META:[\s\S]{0,80}\{\s*resolved:/.test(drawer), true);
  expect('4.2 TabKey type sıralaması',
    /type TabKey = 'resolved' \| 'open' \| 'signals'/.test(drawer), true);
}

// ─────────────────────────────────────────────────────────────────
// 5) parseClosureFromCustomFields defansif (string/object/invalid)
// ─────────────────────────────────────────────────────────────────
console.log('\n── 5) Parser defansif kapsam ─────────────────────────────');
{
  const helper = read('src/features/smart-ticket/customerHistory.ts');
  expect('5.1 null/undefined erken return',
    /if \(customFields == null\) return null;/.test(helper), true);
  expect('5.2 string + try/catch JSON.parse',
    /typeof customFields === 'string'[\s\S]{0,300}JSON\.parse\(trimmed\)/.test(helper), true);
  expect('5.3 catch → return null (UI kırılmaz)',
    /catch[\s\S]{0,80}return null;/.test(helper), true);
  expect('5.4 object branch (zaten parsed olabilir)',
    /typeof customFields === 'object' && !Array\.isArray\(customFields\)/.test(helper), true);
  expect('5.5 closure path: smartTicket.closure',
    /obj\.smartTicket[\s\S]{0,200}smartTicket\.closure/.test(helper), true);
  expect('5.6 hasAny check: bos summary -> null doner',
    /const hasAny =[\s\S]{0,400}return hasAny \? summary : null;/.test(helper), true);
}

// ─────────────────────────────────────────────────────────────────
// 6) labelOrCode + computeBannerRiskState helpers
// ─────────────────────────────────────────────────────────────────
console.log('\n── 6) Helpers ────────────────────────────────────────────');
{
  const helper = read('src/features/smart-ticket/customerHistory.ts');
  expect('6.1 labelOrCode export',
    /export function labelOrCode\(label\?: string, code\?: string\): string \| undefined/.test(helper), true);
  expect('6.2 computeBannerRiskState export',
    /export function computeBannerRiskState\(/.test(helper), true);
  expect('6.3 CustomerContextRiskState union',
    /export type CustomerContextRiskState = 'clear' \| 'watch' \| 'critical'/.test(helper), true);
}

// ─────────────────────────────────────────────────────────────────
// 7) Closed-history fetch: findByAccount({ statusIn: ['Çözüldü'] })
// ─────────────────────────────────────────────────────────────────
console.log('\n── 7) Closed fetch ───────────────────────────────────────');
{
  const drawer = read('src/features/smart-ticket/CustomerContextDrawer.tsx');
  const page = read('src/features/smart-ticket/SmartTicketNewPage.tsx');
  expect('7.1 Drawer findByAccount({ statusIn: ["Çözüldü"] })',
    /caseService\s*\.findByAccount\(accountId,\s*\{ statusIn: \['Çözüldü'\] \}\)/.test(drawer), true);
  expect('7.2 SmartTicketNewPage resolvedCount fetch (banner-side)',
    /findByAccount\(targetAccountId,\s*\{ statusIn: \['Çözüldü'\] \}\)/.test(page), true);
}

// ─────────────────────────────────────────────────────────────────
// 8) Backend / Prisma touch-check: bu PR'da değişmemeli
// ─────────────────────────────────────────────────────────────────
console.log('\n── 8) Backend / Prisma touch-check ───────────────────────');
{
  let baseRef = 'origin/dev';
  try {
    execSync(`git rev-parse --verify ${baseRef}`, { cwd: REPO_ROOT, stdio: 'ignore' });
  } catch {
    try {
      execSync(`git rev-parse --verify dev`, { cwd: REPO_ROOT, stdio: 'ignore' });
      baseRef = 'dev';
    } catch {
      baseRef = 'HEAD~1';
    }
  }

  let diff = '';
  try {
    diff = execSync(`git diff --name-only ${baseRef}...HEAD`, { cwd: REPO_ROOT, encoding: 'utf8' });
  } catch {
    diff = execSync(`git diff --name-only HEAD~1...HEAD`, { cwd: REPO_ROOT, encoding: 'utf8' });
  }
  const changedFiles = diff.split('\n').map((s) => s.trim()).filter(Boolean);

  const forbiddenPrefixes = [
    'server/',
    'prisma/',
    'api/',
  ];
  const touched = changedFiles.filter((f) =>
    forbiddenPrefixes.some((p) => f.startsWith(p)),
  );
  expect('8.1 Backend/Prisma/api dosyaları değişmemiş',
    touched.length === 0, true);
  if (touched.length > 0) {
    console.log('    Forbidden touched files:', touched.join(', '));
  }
}

// ─────────────────────────────────────────────────────────────────
// 9) Stage 2 / Stage 3 layout dosyaları değişmedi
// ─────────────────────────────────────────────────────────────────
console.log('\n── 9) Stage 2/3 layout touch-check ───────────────────────');
{
  let baseRef = 'origin/dev';
  try {
    execSync(`git rev-parse --verify ${baseRef}`, { cwd: REPO_ROOT, stdio: 'ignore' });
  } catch {
    try {
      execSync(`git rev-parse --verify dev`, { cwd: REPO_ROOT, stdio: 'ignore' });
      baseRef = 'dev';
    } catch {
      baseRef = 'HEAD~1';
    }
  }
  let diff = '';
  try {
    diff = execSync(`git diff --name-only ${baseRef}...HEAD`, { cwd: REPO_ROOT, encoding: 'utf8' });
  } catch {
    diff = execSync(`git diff --name-only HEAD~1...HEAD`, { cwd: REPO_ROOT, encoding: 'utf8' });
  }
  const changedFiles = diff.split('\n').map((s) => s.trim()).filter(Boolean);

  const stage23 = [
    'src/features/cases/CaseSolutionStepsPanel.tsx',
    'src/features/smart-ticket/SmartTicketTransferPanel.tsx',
    'src/features/smart-ticket/SmartTicketClosurePanel.tsx',
    'src/features/accounts/AccountSearchPicker.tsx',
  ];
  for (const f of stage23) {
    const exists = existsSync(path.join(REPO_ROOT, f));
    if (!exists) {
      ok(`9.x ${f} skip — yok`);
      continue;
    }
    expect(`9.x ${f} değişmedi`, changedFiles.includes(f), false);
  }
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
