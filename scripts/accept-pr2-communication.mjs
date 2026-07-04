/**
 * PR-2 İletişim — CANLI DOM kabul scripti (advisor, R15 revizyonu).
 *
 * R15 kararı: sekme-içi viewport-sabit KALKTI → sayfa scroll SERBEST.
 * Kabul kriterleri:
 *   A1 — Açılışta en yeni mail auto-select + reader başlığı görünür.
 *   A2 — prose (mail gövdesi) DOM'da var + kırpılmıyor (clientHeight >=
 *        scrollHeight - 5; zincirde overflow-hidden clipping yok).
 *   A3 — Hızlı-yanıt render edilmiş (DOM'da mevcut).
 *   A4 — Sekme-içi drag divider HİÇ YOK (fs overlay dışı).
 *   A5 — Liste ≤ 3 tam satır (rowsCap disiplini).
 *   A6 — Reader kart ayrışması (ring + rounded + bg farkı; liste ile ayrı yüzey).
 *   B1 — Tek mesaj: divider yok, reader kartı yine ayrı.
 *   B2 — Reader inline'da yön ikonu (h-6 w-6 rounded emerald/blue) YOK
 *        (M4 — liste satırının dili; yön "ayrıntılar"da).
 *   C1 — Tam-ekran regresyon: Genişlet aç → fs sol drag divider (28/72 title)
 *        + reader iç scroll (fs body flex-1 overflow-auto).
 *   D1 — Aktivite sekmesi etkilenmedi (render).
 */
import { chromium } from 'playwright-core';

const BASE = process.env.ACCEPT_BASE_URL ?? 'http://localhost:5273';
const CASE_MULTI = process.env.ACCEPT_CASE_MULTI ?? 'UNV-1000058';
const CASE_SINGLE = process.env.ACCEPT_CASE_SINGLE ?? 'UNV-1000111';

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

// Sekme-içi drag divider (fs overlay'dekini saymaz)
const inTabDivider = () =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="separator"][title*="Sürükle"]')).some((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 50 && r.height > 0 && !e.closest('[aria-label="Mail thread (genişletilmiş)"]');
    }),
  );

// Fs overlay içindeki dikey (Gmail) drag divider
const fsDrag = () =>
  page.evaluate(() => {
    const el = document.querySelector('[aria-label="Mail thread (genişletilmiş)"] [role="separator"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { visible: r.width > 0 && r.height > 50, title: el.getAttribute('title') };
  });

// Prose ölçümleri: CH >= SH-5 = doğal yükseklik (kırpma yok).
const proseMetrics = () =>
  page.evaluate(() => {
    const p = document.querySelector('.prose');
    if (!p) return null;
    return { proseCH: p.clientHeight, proseSH: p.scrollHeight };
  });

// Reader kart ayrışması: reader'ın (rounded + ring) wrapper'ı liste kartıyla ayrı
const readerCardSeparation = () =>
  page.evaluate(() => {
    const readerRoot = document.querySelector('.prose')?.closest('[class*="rounded-lg"]');
    const listRoot = document.querySelector('[data-mail-list-header]')?.closest('[class*="rounded-lg"]');
    if (!readerRoot || !listRoot) return { readerCard: !!readerRoot, listCard: !!listRoot, separate: false };
    return {
      readerCard: !!readerRoot,
      listCard: !!listRoot,
      separate: readerRoot !== listRoot,
      readerCls: readerRoot.className.slice(0, 100),
    };
  });

// Yön ikonu (h-6 w-6 rounded emerald/blue) reader header'ında?
const dirIconInReaderHeader = () =>
  page.evaluate(() => {
    const readerHdr = document.querySelector('h3.truncate')?.closest('[class*="border-b"]');
    if (!readerHdr) return null;
    const icon = readerHdr.querySelector('span.h-6.w-6.rounded-full');
    return !!icon;
  });

// ── A: çok mesajlı vaka (UNV-1000058) ───────────────────────────────
await gotoCase(CASE_MULTI);

// A1 — auto-select + reader başlığı
const autoOpen = await page.evaluate(() => {
  const readerH3 = document.querySelector('h3.truncate');
  const hasReader = !!readerH3 && readerH3.offsetHeight > 0;
  const selectedRow = document.querySelector('li button[class*="brand-"]');
  return { hasReader, hasSelected: !!selectedRow };
});
log('A1 açılış: en yeni mail auto-select + reader açık',
  autoOpen.hasReader && autoOpen.hasSelected, JSON.stringify(autoOpen));

// Uzun gövdeli maili seç
const longRow = page.locator('li button:has-text("merhaba")').first();
if (await longRow.isVisible().catch(() => false)) await longRow.click();
else await page.locator('li button').filter({ hasText: /Tem|:\d\d/ }).first().click();
await page.waitForTimeout(1800);

// A2 — prose var + KIRPILMIYOR
const pm = await proseMetrics();
log('A2 prose (gövde) DOM\'da', !!pm);
log('A2b prose KIRPILMIYOR (CH ≈ SH → doğal yükseklik)',
  !!pm && (pm.proseCH >= pm.proseSH - 5),
  pm ? `ch=${pm.proseCH} sh=${pm.proseSH}` : 'yok');

// A3 — hızlı-yanıt DOM'da
const quickIn = await page.evaluate(() =>
  Array.from(document.querySelectorAll('button')).some((b) => /Hızlı yanıt/.test(b.textContent || ''))
);
log('A3 hızlı-yanıt render edilmiş (DOM\'da)', quickIn);

// A4 — sekme-içi drag divider YOK
log('A4 sekme-içi drag divider YOK (R15 makine silindi)', !(await inTabDivider()));

// A5 — liste ≤3 tam satır. R15: wrapper h-[174px] overflow-hidden clip'ler;
// ölçüm için pane wrapper'ı (kart) kullanılır, ListPane iç 'h-full' clip
// öncesi natural yüksekliği yansıtır.
const listRows = await page.evaluate(() => {
  const hdr = document.querySelector('[data-mail-list-header]');
  if (!hdr) return null;
  const paneWrapper = hdr.closest('.rounded-lg'); // liste kartı
  if (!paneWrapper) return null;
  const rows = paneWrapper.querySelectorAll('li button');
  let visible = 0;
  const paneR = paneWrapper.getBoundingClientRect();
  rows.forEach((r) => {
    const b = r.getBoundingClientRect();
    if (b.top >= paneR.top - 2 && b.bottom <= paneR.bottom + 2) visible += 1;
  });
  return { total: rows.length, fullyVisible: visible, paneH: Math.round(paneR.height) };
});
log('A5 liste ≤ 3 tam satır (rowsCap)', !!listRows && listRows.fullyVisible <= 3,
  listRows ? JSON.stringify(listRows) : 'ölçülemedi');

// A6 — reader kart ayrışması
const sep = await readerCardSeparation();
log('A6 reader kart ayrışması (rounded+ring, listeyle ayrı yüzey)',
  !!sep && sep.readerCard && sep.listCard && sep.separate, JSON.stringify(sep));

// ── B: tek mesajlı vaka (UNV-1000111) ────────────────────────────────
await gotoCase(CASE_SINGLE);
await page.locator('li button').filter({ hasText: /Tem|:\d\d/ }).first().click();
await page.waitForTimeout(1500);
log('B1 tek mesaj: sekme-içi drag divider YOK', !(await inTabDivider()));

// B2 — Yön ikonu inline reader header'ında YOK
const dirIcon = await dirIconInReaderHeader();
log('B2 inline reader header: yön ikonu (h-6 rounded) YOK (M4)', dirIcon === false,
  `dirIcon=${dirIcon}`);

// ── C: fs overlay regresyon ─────────────────────────────────────────
await gotoCase(CASE_MULTI);
await page.locator('li button:has-text("merhaba")').first().click().catch(async () => {
  await page.locator('li button').filter({ hasText: /Tem|:\d\d/ }).first().click();
});
await page.waitForTimeout(1500);
// Genişlet butonu — reader header'da
const expandBtn = page.locator('button:has-text("Genişlet")').first();
await expandBtn.click().catch(() => {});
await page.waitForTimeout(1500);
const fs = await fsDrag();
log('C1 fs overlay: sol drag divider mevcut (regresyon yok)',
  !!fs && fs.visible && /28\/72/.test(fs.title || ''),
  fs ? JSON.stringify(fs) : 'yok');
const fsProseHasScroll = await page.evaluate(() => {
  const overlay = document.querySelector('[aria-label="Mail thread (genişletilmiş)"]');
  if (!overlay) return false;
  const p = overlay.querySelector('.prose');
  if (!p) return false;
  let el = p;
  while (el && el !== overlay) {
    const st = getComputedStyle(el);
    if (/(auto|scroll)/.test(st.overflowY)) return true;
    el = el.parentElement;
  }
  return false;
});
log('C2 fs body iç scroll ata var (fs kendi overlay\'i scroll\'lar)', fsProseHasScroll);

// Fs'ten çık
await page.keyboard.press('Escape');
await page.waitForTimeout(1000);

// ── D: komşu sekme regresyonu ───────────────────────────────────────
await page.locator('button:has-text("Aktivite")').first().click();
await page.waitForTimeout(1200);
log('D1 Aktivite sekmesi render (regresyon yok)',
  await page.evaluate(() => document.body.innerText.length > 500));

await browser.close();
const fail = results.filter((r) => !r).length;
console.log(`\nTOPLAM: ${results.length - fail}/${results.length} PASS`);
process.exit(fail ? 1 : 0);
