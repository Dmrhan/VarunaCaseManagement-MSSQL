#!/usr/bin/env node
/**
 * On-prem deploy orchestrator — rollback-safe.
 *
 * Sıra: pm2 stop → git pull → npm ci → migrate deploy → build → pm2 start.
 *
 * KRİTİK GARANTİ (Codex review P2):
 *   Herhangi bir mutate adımı fail olursa (git conflict, npm ci hata,
 *   migration crash, build fail vb.), pm2 start MUTLAKA çağrılır
 *   (try/catch + finally pattern). Eski build üzerinden servis ayağa
 *   kalkar — production kalıcı down kalmaz. Eski script'te `&&` zinciri
 *   stop → mutate FAIL → start ÇAĞRILMAZ pattern'i ile servis
 *   manuel müdahale gerektiren stopped state'inde kalıyordu.
 *
 * Çıkış kodları:
 *   0 — tüm adımlar başarılı, yeni build canlıda
 *   1 — mutate adımı fail, eski build geri yüklendi (rollback) → operator
 *       logları incelemeli ama servis ÇALIŞIYOR
 *   2 — KRİTİK: pm2 start fail → manuel müdahale gerek; servis DOWN
 *
 * Cross-platform (Windows + Linux + macOS) — execSync üzerinden çalışır.
 *
 * Doc:
 *   - docs/IIS_DEPLOY.md §6.a
 *   - docs/OPERATIONS.md "On-Prem (PM2) Deploy"
 *   - docs/ONPREM_INSTALL.md §7
 */

import { execSync } from 'node:child_process';

const PM2_APP = 'varuna-cm';

const log = (msg) => console.log(`[deploy:onprem] ${msg}`);
const warn = (msg) => console.warn(`[deploy:onprem] ⚠ ${msg}`);
const err = (msg) => console.error(`[deploy:onprem] ✗ ${msg}`);

function run(cmd, { silent = false } = {}) {
  if (!silent) log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

function tryRun(cmd) {
  try {
    run(cmd, { silent: true });
    return true;
  } catch (e) {
    return false;
  }
}

// ─────────────────────────────────────────────────────────
// 1) Servisi durdur — live tree mutate edilmeden ÖNCE
//    pm2 stop yoksa (process bulunamadıysa) warning, devam et;
//    deploy sırasında fail eden bir önceki deploy'dan kalan
//    "stopped" state olabilir.
// ─────────────────────────────────────────────────────────
log('Step 0: stopping PM2 service to release live tree...');
if (!tryRun(`pm2 stop ${PM2_APP}`)) {
  warn(`pm2 stop ${PM2_APP} fail (yok sayıldı — process zaten down olabilir)`);
}

// ─────────────────────────────────────────────────────────
// 2) Mutate adımları — herhangi biri fail ederse rollback
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
  warn('Rolling back: starting PM2 with PREVIOUS build...');
}

// ─────────────────────────────────────────────────────────
// 3) HER DURUMDA servisi başlat — rollback safety
//    Mutate başarılı → yeni build canlıda
//    Mutate fail → eski build canlıda (dist/, node_modules
//      mutate öncesi haliyle değilse atomik değil — operator
//      uyarısı: investigate logs)
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
  warn('Deploy ABORTED — servis ESKİ build ile geri yüklendi.');
  warn(`Sebep: ${mutateError.message ?? mutateError}`);
  warn('Yapılması gereken:');
  warn('  1. Yukarıdaki hata mesajını incele');
  warn('  2. Sorunu düzelt (git conflict, env, migration vb.)');
  warn('  3. npm run deploy:onprem tekrar koştur');
  warn('═══════════════════════════════════════════════════════');
  process.exit(1);
}

log('✓ Deploy complete. Yeni build canlıda.');
process.exit(0);
