#!/usr/bin/env node
/**
 * On-prem deploy orchestrator — REAL rollback (Codex P1+P2 fix).
 *
 * Sıra: pm2 stop → VERIFY stopped → snapshot HEAD+dist/ → mutate steps
 *       → (fail durumda restore HEAD+dist+lock) → pm2 start.
 *
 * KRİTİK GARANTİLER:
 *
 *   1) **PM2 verify stopped (Codex P2)**: `pm2 stop` exit'i tek başına
 *      yeterli değil — daemon problemi / permission / yanlış user
 *      durumlarında stop fail ama service ÇALIŞIYOR olabilir. `pm2 jlist`
 *      ile process state doğrulanır; "online" / "launching" ise mutate
 *      İPTAL — live tree dokunulmaz.
 *
 *   2) **Real rollback (Codex P1)**: Eski script'te mutate fail olunca
 *      `pm2 start` çağrılıyordu ama git pull başarılı olmuş + sonraki
 *      adım fail durumunda checkout YENİ kaynak kodda kalıyordu →
 *      pm2 boot YENİ server kodu + (belki) eski dist/ + (belki) yarım
 *      migrate = chimera state, potansiyel olarak unmigrated DB'ye karşı.
 *
 *      Yeni: deploy başlamadan ÖNCE `git rev-parse HEAD` + dist/ kopyası
 *      alınır. Mutate fail durumunda:
 *        a) `git reset --hard <oldHead>` — kaynak eski revizyona döner
 *        b) `dist/` backup'tan restore edilir
 *        c) `npm ci` tekrar koşulur — eski package-lock'a göre
 *           node_modules eski versiyona getirilir
 *      Sonra pm2 start eski state üzerinden ayağa kalkar.
 *
 *      MIGRATION CAVEAT: Prisma migrate forward-only. Eğer migrate
 *      başarılı olduktan SONRA build/start fail varsa, schema YENİ kaldı
 *      ama code ESKİ döndü. Bu pratikte sorunsuz çünkü migration'lar
 *      nullable column addition pattern'ine uyar (Faz 3 örneği) — eski
 *      Prisma Client yeni schema'da fazla kolonu yok sayar. Eğer code
 *      yeni schema GEREKTİRİYORSA (zorunlu yeni kolon, breaking change)
 *      manuel rollback gerekir; bu durum operator'a uyarı olarak yazılır.
 *
 * Çıkış kodları:
 *   0 — yeni build canlıda
 *   1 — mutate fail, ESKİ state geri yüklendi (git reset + dist restore +
 *       npm ci eski lock), servis çalışıyor; operator log incelemeli
 *   2 — KRİTİK: pm2 start fail; manuel müdahale gerek
 *   3 — pre-flight fail (pm2 still online / git rev-parse fail); mutate
 *       başlamadı, hiçbir şey değişmedi
 *
 * Cross-platform (Windows + Linux + macOS) — execSync + node:fs.
 *
 * Zero-downtime gerekiyorsa atomic release-dir / symlink swap pattern'i
 * tek doğru çözüm (bkz. docs/OPERATIONS.md "Zero-downtime atomic release —
 * opsiyonel"). Bu script "best-effort safe rollback" — atomik değil ama
 * eski script'ten radikal olarak daha güvenli.
 */

import { execSync } from 'node:child_process';
import { cpSync, rmSync, existsSync } from 'node:fs';

const PM2_APP = 'varuna-cm';
const DIST_DIR = 'dist';
const DIST_BACKUP = '.dist-deploy-backup';

const log = (msg) => console.log(`[deploy:onprem] ${msg}`);
const warn = (msg) => console.warn(`[deploy:onprem] ⚠ ${msg}`);
const err = (msg) => console.error(`[deploy:onprem] ✗ ${msg}`);

function run(cmd) {
  log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

function exec(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function tryExec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────
// 0) Servisi durdur + VERIFY (Codex P2)
//    `pm2 stop` exit yetersiz — daemon problemi / permission /
//    yanlış user durumunda stop fail ama service ÇALIŞIYOR
//    olabilir. pm2 jlist ile state doğrulanır.
// ─────────────────────────────────────────────────────────
log('Step 0: stopping PM2 service to release live tree...');
tryExec(`pm2 stop ${PM2_APP}`);

let pm2State = 'unknown';
try {
  const raw = exec('pm2 jlist');
  const list = JSON.parse(raw);
  const app = Array.isArray(list) ? list.find((p) => p?.name === PM2_APP) : null;
  pm2State = app?.pm2_env?.status ?? 'not-found';
} catch (e) {
  err(`pm2 jlist okunamadı — PM2 daemon erişilemiyor olabilir: ${e.message ?? e}`);
  err('Mutate iptal; live tree dokunulmadı.');
  err('Manuel kontrol: pm2 status / pm2 ping / pm2 resurrect');
  process.exit(3);
}

if (pm2State === 'online' || pm2State === 'launching') {
  err(`PM2 service ${PM2_APP} hâlâ "${pm2State}" — mutate edilemez.`);
  err('Sebep olabilir: PM2 daemon farklı user altında, permission, CLI fail');
  err('Manuel müdahale gerekli:');
  err('  pm2 status');
  err(`  pm2 stop ${PM2_APP}`);
  err(`  pm2 describe ${PM2_APP}`);
  process.exit(3);
}
log(`PM2 service state: ${pm2State} (mutate safe)`);

// ─────────────────────────────────────────────────────────
// 1) Rollback context — eski HEAD + dist/ yedeği (Codex P1)
// ─────────────────────────────────────────────────────────
let oldHead;
try {
  oldHead = exec('git rev-parse HEAD');
  log(`Old HEAD captured: ${oldHead.slice(0, 8)}`);
} catch (e) {
  err(`git rev-parse HEAD fail: ${e.message ?? e}`);
  err('Mutate iptal; live tree dokunulmadı.');
  process.exit(3);
}

if (existsSync(DIST_DIR)) {
  try {
    rmSync(DIST_BACKUP, { recursive: true, force: true });
    cpSync(DIST_DIR, DIST_BACKUP, { recursive: true });
    log(`✓ dist/ backed up → ${DIST_BACKUP}/`);
  } catch (e) {
    warn(`dist/ backup fail (rollback'te dist/ restore edilemez): ${e.message ?? e}`);
  }
}

// ─────────────────────────────────────────────────────────
// 2) Mutate steps
// ─────────────────────────────────────────────────────────
let mutateError = null;
try {
  log('Step 1/4: git pull');
  run('git pull');

  log('Step 2/4: npm ci (install dependencies)');
  run('npm ci');

  log('Step 3/4: prisma migrate deploy (schema sync)');
  run('npm run db:migrate:deploy');

  log('Step 4/4: npm run build (frontend + tsc)');
  run('npm run build');
} catch (e) {
  mutateError = e;
  err(`Mutate fail: ${e.message ?? e}`);
}

// ─────────────────────────────────────────────────────────
// 3) Rollback if needed — REAL restore (Codex P1)
// ─────────────────────────────────────────────────────────
if (mutateError) {
  warn('Rolling back to previous state...');

  try {
    run(`git reset --hard ${oldHead}`);
    log(`✓ git reset --hard ${oldHead.slice(0, 8)}`);
  } catch (e) {
    err(`git reset fail: ${e.message ?? e}`);
    err('Kaynak ağacı belirsiz hâlde — pm2 start CHIMERA STATE doğurabilir');
  }

  if (existsSync(DIST_BACKUP)) {
    try {
      rmSync(DIST_DIR, { recursive: true, force: true });
      cpSync(DIST_BACKUP, DIST_DIR, { recursive: true });
      log(`✓ dist/ restored from backup`);
    } catch (e) {
      err(`dist/ restore fail: ${e.message ?? e}`);
    }
  }

  try {
    run('npm ci');
    log('✓ npm ci with restored package-lock');
  } catch (e) {
    err(`npm ci (rollback) fail: ${e.message ?? e}`);
    err('node_modules state belirsiz — manuel inspection gerekli');
  }
}

// Cleanup backup (success case)
if (!mutateError && existsSync(DIST_BACKUP)) {
  try {
    rmSync(DIST_BACKUP, { recursive: true, force: true });
  } catch {
    /* yok say */
  }
}

// ─────────────────────────────────────────────────────────
// 4) PM2 start
// ─────────────────────────────────────────────────────────
log('Step 5: starting PM2 service...');
try {
  run(`pm2 start ${PM2_APP}`);
} catch (e) {
  err(`KRİTİK: pm2 start ${PM2_APP} fail: ${e.message ?? e}`);
  err('Manuel müdahale gerek. Kontrol et:');
  err('  pm2 status');
  err('  pm2 logs varuna-cm');
  err('  pm2 start ecosystem.config.cjs');
  process.exit(2);
}

if (mutateError) {
  warn('═══════════════════════════════════════════════════════');
  warn('Deploy ABORTED — ESKİ state geri yüklendi, servis ÇALIŞIYOR.');
  warn(`Sebep: ${mutateError.message ?? mutateError}`);
  warn('');
  warn('Yapılması gereken:');
  warn('  1. Yukarıdaki mutate hata mesajını incele');
  warn('  2. Sorunu düzelt (git conflict, env, migration vb.)');
  warn('  3. npm run deploy:onprem tekrar koştur');
  warn('');
  warn('NOT: Migration forward-only (Prisma). Eğer migrate başarılı oldu');
  warn('     ve sonraki adım fail varsa, schema YENİ kaldı, code ESKİ');
  warn('     döndü. Pratikte sorunsuz (nullable column addition pattern).');
  warn('     Code yeni schema gerektiriyorsa manuel rollback gerekir.');
  warn('═══════════════════════════════════════════════════════');
  process.exit(1);
}

log('✓ Deploy complete. Yeni build canlıda.');
process.exit(0);
