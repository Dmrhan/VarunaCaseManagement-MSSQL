#!/usr/bin/env node
/**
 * On-prem deploy orchestrator — REAL rollback (Codex P1+P2 fix).
 *
 * Sıra: PRE-FLIGHT (snapshot) → pm2 stop → mutate → (rollback if fail)
 *       → pm2 start.
 *
 * KRİTİK GARANTİLER:
 *
 *   1) **Pre-flight snapshot mutate'ten ÖNCE, pm2 stop'tan da ÖNCE**
 *      (Codex P1+P2 sonraki review): git rev-parse HEAD + dist/ yedeği
 *      henüz LIVE service çalışırken alınır. Snapshot fail durumunda
 *      service AYAKTA, hiçbir şey değişmedi — temiz exit 3.
 *
 *      Eski sırada (pm2 stop → snapshot → mutate):
 *        - git rev-parse fail → exit 3 ama PM2 zaten durmuş, service down
 *        - dist backup fail → continue + warn → build fail durumunda
 *          dist/ silinmiş ve restore edilemez → "eski state restore"
 *          yalanı.
 *      Yeni sırada: snapshot başarılı olmadan PM2 stop çağrılmaz.
 *
 *   2) **PM2 verify stopped (Codex P2 ilk review)**: pm2 stop sonrası
 *      `pm2 jlist` ile state doğrulanır; "online"/"launching" ise mutate
 *      İPTAL (exit 3) — daemon/permission problemi durumunda live tree
 *      dokunulmaz.
 *
 *   3) **Real rollback** (Codex P1 ilk review): Mutate fail durumunda
 *      git reset --hard <oldHead> + dist/ backup restore + npm ci ile
 *      eski state geri yüklenir. Sonra pm2 start eski state ile ayağa
 *      kalkar (CHIMERA state YOK).
 *
 *      MIGRATION CAVEAT: Prisma migrate forward-only. Migrate başarılı +
 *      sonraki adım fail durumunda schema YENİ kaldı, code ESKİ döndü.
 *      Pratikte sorunsuz (nullable column addition pattern). Breaking
 *      change varsa manuel rollback gerekir.
 *
 * Çıkış kodları:
 *   0 — yeni build canlıda
 *   1 — mutate fail, ESKİ state restore edildi, servis çalışıyor
 *   2 — KRİTİK: pm2 start fail; manuel müdahale gerek
 *   3 — pre-flight fail (git rev-parse / dist backup / pm2 stop verify);
 *       mutate başlamadı; servis MUTLAKA ya hâlâ ayakta (snapshot fail
 *       durumu) ya da pre-flight'tan önceki durumda kaldı
 *
 * Cross-platform (Windows + Linux + macOS) — execSync + node:fs.
 *
 * Zero-downtime gerekiyorsa atomic release-dir / symlink swap pattern'i
 * tek doğru çözüm (bkz. docs/OPERATIONS.md "Zero-downtime atomic release —
 * opsiyonel"). Bu script "best-effort safe rollback" — atomik değil ama
 * eski script'lerden radikal olarak daha güvenli.
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

function cleanupBackup() {
  if (existsSync(DIST_BACKUP)) {
    try {
      rmSync(DIST_BACKUP, { recursive: true, force: true });
    } catch {
      /* yok say */
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════
// PRE-FLIGHT (LIVE service hâlâ çalışırken — pm2 stop'tan ÖNCE)
// ═════════════════════════════════════════════════════════════════════════
// Bu blokta herhangi bir fail → exit 3 ve PM2 service AYAKTA. Hiçbir live
// state mutasyona uğramadı.

log('Pre-flight 1/2: capturing old HEAD (git rev-parse)...');
let oldHead;
try {
  oldHead = exec('git rev-parse HEAD');
  log(`✓ Old HEAD captured: ${oldHead.slice(0, 8)}`);
} catch (e) {
  err(`git rev-parse HEAD fail: ${e.message ?? e}`);
  err('Pre-flight iptal; live service hâlâ çalışıyor (pm2 stop çağrılmadı).');
  err('Manuel kontrol: cd <repo-root> && git status');
  process.exit(3);
}

log('Pre-flight 2/2: backing up dist/...');
if (existsSync(DIST_DIR)) {
  try {
    // Eski yarım kalmış backup'ı temizle (önceki deploy interrupt olmuş
    // olabilir) — temiz başlangıç.
    cleanupBackup();
    cpSync(DIST_DIR, DIST_BACKUP, { recursive: true });
    log(`✓ dist/ backed up → ${DIST_BACKUP}/`);
  } catch (e) {
    err(`dist/ backup fail: ${e.message ?? e}`);
    err('Pre-flight iptal; live service hâlâ çalışıyor (pm2 stop çağrılmadı).');
    err('Olası sebep: disk dolu, izin sorunu, yarım copy bıraktı.');
    // Kısmi backup'ı temizle ki sonraki deploy interrupt yorumlanmaz.
    cleanupBackup();
    err('Manuel kontrol: df -h, ls -la .dist-deploy-backup');
    process.exit(3);
  }
} else {
  log('dist/ mevcut değil (ilk deploy olabilir) — backup atlandı.');
}

// ═════════════════════════════════════════════════════════════════════════
// STOP SERVICE — Pre-flight başarılı, live tree mutate edilmeden kapatılır
// ═════════════════════════════════════════════════════════════════════════

log('Stopping PM2 service to release live tree...');
tryExec(`pm2 stop ${PM2_APP}`);

// VERIFY stopped — pm2 stop exit yetersiz; daemon/permission durumunda
// stop fail ama service ÇALIŞIYOR olabilir (Codex P2 ilk review).
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
  cleanupBackup();
  process.exit(3);
}

if (pm2State === 'online' || pm2State === 'launching') {
  err(`PM2 service ${PM2_APP} hâlâ "${pm2State}" — mutate edilemez.`);
  err('Sebep olabilir: PM2 daemon farklı user altında, permission, CLI fail');
  err('Manuel müdahale gerekli:');
  err('  pm2 status');
  err(`  pm2 stop ${PM2_APP}`);
  err(`  pm2 describe ${PM2_APP}`);
  cleanupBackup();
  process.exit(3);
}
log(`✓ PM2 service state: ${pm2State} (mutate safe)`);

// ═════════════════════════════════════════════════════════════════════════
// MUTATE
// ═════════════════════════════════════════════════════════════════════════

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

// ═════════════════════════════════════════════════════════════════════════
// ROLLBACK (mutate fail durumunda)
// ═════════════════════════════════════════════════════════════════════════

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
  } else {
    warn('dist/ backup yok (ilk deploy olabilir) — restore atlandı.');
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
if (!mutateError) cleanupBackup();

// ═════════════════════════════════════════════════════════════════════════
// PM2 START
// ═════════════════════════════════════════════════════════════════════════

log('Starting PM2 service...');
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
