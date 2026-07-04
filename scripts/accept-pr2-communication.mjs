/**
 * PR-2 İletişim — CANLI DOM kabul scripti (advisor, 2026-07-04).
 *
 * Neden var: R13/R14 zincirinde üç layout regresyonu kod-simülasyonu smoke'lardan
 * geçti ama gerçek render'da patladı (0px liste → kesilen gövde → sınıfsız
 * sarmalayıcı). Bu script gerçek browser'da ölçer; layout'a dokunan HER teslimde
 * KOŞULMASI ve raporda GERÇEK çıktısının yer alması ZORUNLUDUR.
 *
 * Önkoşul: npm run dev ayakta (Vite :5273 + API :3101) + seed auth kullanıcıları
 * (prisma/seedAuth.ts — sysadmin@varuna.dev) + playwright-core devDependency +
 * yerel Google Chrome.
 *
 * Kullanım: node scripts/accept-pr2-communication.mjs
 *   env: ACCEPT_CASE_MULTI (default UNV-1000058) — çok mesajlı + uzun gövdeli vaka
 *        ACCEPT_CASE_SINGLE (default UNV-1000111) — tek mesajlı vaka
 * Çıkış: FAIL varsa exit 1 (CI/rapor gate).
 */
import { chromium } from 'playwright-core';

const BASE = process.env.ACCEPT_BASE_URL ?? 'http://localhost:5273';
const CASE_MULTI = process.env.ACCEPT_CASE_MULTI ?? 'UNV-1000058';
const CASE_SINGLE = process.env.ACCEPT_CASE_SINGLE ?? 'UNV-1000111';
const MIN_READING_PX = 280; // A7 — okuma alanı deneyim eşiği (R14.2 kararı)

const results = [];
const log = (name, pass, detail) => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? ` [${detail}]` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
page.setDefaultTimeout(25000);

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.fill('input[type="email"]', 'sysadmin@varuna.dev');
await page.fill('input[type="password"]', 'Test1234!');
await page.click('button[type="submit"]');
await page.waitForSelector('button[title="Vakalar"]', { timeout: 30000 });

async function gotoCase(num) {
  await page.locator('button[title="Vakalar"]').first().click();
  await page.waitForTimeout(2000);
  const s = page.locator('input[placeholder*="ara" i]').first();
  await s.click();
  await s.fill('');
  await s.pressSequentially(num, { delay: 60 });
  await page.waitForTimeout(2500);
  await page.locator(`text=${num}`).first().click();
  await page.waitForTimeout(3000);
  const t = page.locator('button:has-text("İletişim")').first();
  if (await t.isVisible().catch(() => false)) await t.click();
  await page.waitForTimeout(2500);
}

// Görünür in-tab drag divider (fs overlay'dekini saymaz)
const dividerVisible = () =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="separator"][title*="Sürükle"]')).some((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 50 && r.height > 0 && !e.closest('[aria-label="Mail thread (genişletilmiş)"]');
    }),
  );

const pageScrolls = () =>
  page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 5);

// prose'un scroll-atası (okuma alanı) — {ch, sh} ya da null
const readingArea = () =>
  page.evaluate(() => {
    let el = document.querySelector('.prose');
    while (el && el !== document.body) {
      const st = getComputedStyle(el);
      if (/(auto|scroll)/.test(st.overflowY)) {
        return { ch: el.clientHeight, sh: el.scrollHeight };
      }
      el = el.parentElement;
    }
    return null;
  });

// ── A: çok mesajlı vaka ─────────────────────────────────────────────
await gotoCase(CASE_MULTI);
// R14.2 M1 — Otomatik açılış GERİ: en yeni mail seçili + reader açık.
// (A1/A1b eski katlı-başlangıç kontrolleri anlamsız, YENİ assertion'lar.)
log('A1 açılış: sayfa scroll yok', !(await pageScrolls()));
const autoOpen = await page.evaluate(() => {
  // Auto-select sonrası reader header'ı görünür olmalı ("ayrıntılar" toggle
  // reader body içi; içerik başlığı h3 truncate)
  const readerH3 = document.querySelector('h3.truncate');
  const hasReader = !!readerH3 && readerH3.offsetHeight > 0;
  // En yeni satır selected (border-l-4 / bg-brand-50 gibi)
  const selectedRow = document.querySelector('li button[class*="brand-"]');
  return { hasReader, hasSelected: !!selectedRow };
});
log('A1b açılış: en yeni mail auto-select + reader açık', autoOpen.hasReader && autoOpen.hasSelected,
  JSON.stringify(autoOpen));

// en uzun gövdeli maili bul: her satırı dener, en büyük scrollHeight'ı seçer yerine
// pratik: "merhaba" satırı (bilinen uzun disclaimer'lı) yoksa ilk inbound
const longRow = page.locator('li button:has-text("merhaba")').first();
if (await longRow.isVisible().catch(() => false)) await longRow.click();
else await page.locator('li button').filter({ hasText: /Tem|:\d\d/ }).first().click();
await page.waitForTimeout(1800);

const ra = await readingArea();
log('A2 okuma alanı scroll-atası var', !!ra);
log(
  `A7 okuma alanı >= ${MIN_READING_PX}px (deneyim eşiği)`,
  !!ra && ra.ch >= MIN_READING_PX,
  ra ? `${ra.ch}px (içerik ${ra.sh}px)` : 'yok',
);
if (ra && ra.sh > ra.ch + 5) {
  const scrolled = await page.evaluate(() => {
    let el = document.querySelector('.prose');
    while (el && el !== document.body) {
      const st = getComputedStyle(el);
      if (/(auto|scroll)/.test(st.overflowY)) {
        el.scrollTop = 400;
        return el.scrollTop > 200;
      }
      el = el.parentElement;
    }
    return false;
  });
  log('A6 iç scroll gerçekten kayıyor', scrolled);
}
log('A4 seçim sonrası sayfa scroll yok', !(await pageScrolls()));
const quickInView = await page.evaluate(() => {
  const q = Array.from(document.querySelectorAll('button')).find((b) =>
    /Hızlı yanıt/.test(b.textContent || ''),
  );
  if (!q) return false;
  const r = q.getBoundingClientRect();
  return r.top < window.innerHeight && r.height > 0;
});
log('A3 hızlı-yanıt viewport içinde', quickInView);
log('A5 divider (çok mesaj, cap) görünür', await dividerVisible());
// A8 — liste seçili modda en fazla ~3 satır yüksekliği kaplar (R14.2 kararı)
// R14.2 (2026-07-04) — `hdr` selector'ı textContent inheritance nedeniyle
// DOM order'da ilk (en dış) div'e düşüyordu (paneH 607/615 saçma değer);
// [data-mail-list-header] ile gerçek ListPane header'ı yakalanır → pane =
// ListPane root (gerçek 174px, 3 tam satır).
const listRows = await page.evaluate(() => {
  const hdr = document.querySelector('[data-mail-list-header]');
  if (!hdr) return null;
  const pane = hdr.parentElement;
  const rows = pane.querySelectorAll('li button');
  let visible = 0;
  const paneR = pane.getBoundingClientRect();
  rows.forEach((r) => {
    const b = r.getBoundingClientRect();
    if (b.top >= paneR.top - 2 && b.bottom <= paneR.bottom + 2) visible += 1;
  });
  return { total: rows.length, fullyVisible: visible, paneH: Math.round(paneR.height) };
});
log(
  'A8 seçili modda liste kompakt (<=3 tam satır ya da <=%25)',
  !!listRows && listRows.fullyVisible <= 3,
  listRows ? JSON.stringify(listRows) : 'ölçülemedi',
);

// ── B: tek mesajlı vaka ─────────────────────────────────────────────
await gotoCase(CASE_SINGLE);
await page.locator('li button').filter({ hasText: /Tem|:\d\d/ }).first().click();
await page.waitForTimeout(1500);
log('B1 tek mesaj: divider YOK', !(await dividerVisible()));
const raSingle = await readingArea();
log('B2 tek mesaj: gövde geniş', !!raSingle && raSingle.ch > 300, raSingle ? `${raSingle.ch}px` : 'yok');
log('B3 tek mesaj: sayfa scroll yok', !(await pageScrolls()));

// ── C: komşu sekme regresyonu ───────────────────────────────────────
await page.locator('button:has-text("Aktivite")').first().click();
await page.waitForTimeout(1200);
log('C1 Aktivite sekmesi render', await page.evaluate(() => document.body.innerText.length > 500));

await browser.close();
const fail = results.filter((r) => !r).length;
console.log(`\nTOPLAM: ${results.length - fail}/${results.length} PASS`);
process.exit(fail ? 1 : 0);
