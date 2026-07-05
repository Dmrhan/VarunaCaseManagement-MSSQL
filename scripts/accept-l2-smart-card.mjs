/**
 * L2-Smart-Flow FAZ 1 — CANLI DOM kabul scripti (advisor, 2026-07-05).
 *
 * Kural (R13/R14 dersi): layout/etkileşim işi kod-simülasyonuyla kabul
 * edilmez; gerçek browser'da ölçülür. Önkoşul: npm run dev + seed auth.
 *
 * Senaryolar:
 *  A. UNIVERA (KB aktif) vakası → Detay: kart görünür, boş-durum + Analiz Et
 *     + Elle seç butonları.
 *  B. Elle seç → taxonomy dropdown'ları dolu → 2 alan seç → Kaydet →
 *     chip'ler render + reload sonrası PERSIST + Aktivite'de audit satırı.
 *  C. Tenant kapısı: PARAM (KB kapalı) vakası → kart YOK + Çözüm Adımları'nda
 *     "AI Önerilen Adımlar Al" YOK.
 *  D. UNIVERA'da Çözüm Adımları AI butonu VAR.
 *
 * NOT: "Bilgi Bankası ile Analiz Et" DIŞ sisteme gider — bu script onu
 * ÇAĞIRMAZ (buton varlığı assert edilir); canlı KB testi kullanıcı turunda.
 */
import { chromium } from 'playwright-core';

const BASE = process.env.ACCEPT_BASE_URL ?? 'http://localhost:5273';
const CASE_KB_ON = process.env.ACCEPT_CASE_KB_ON ?? 'UNV-1000058';
const CASE_KB_OFF = process.env.ACCEPT_CASE_KB_OFF ?? 'CASE-2026-10118';

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

async function gotoCase(num, tab) {
  await page.locator('button[title="Vakalar"]').first().click();
  await page.waitForTimeout(2000);
  const s = page.locator('input[placeholder*="ara" i]').first();
  await s.click();
  await s.fill('');
  await s.pressSequentially(num, { delay: 60 });
  await page.waitForTimeout(2500);
  await page.locator(`text=${num}`).first().click();
  await page.waitForTimeout(3000);
  if (tab) {
    // Exact-match: soldaki "Detay →" müşteri linkiyle çakışmasın.
    const t = page.locator('button', { hasText: new RegExp(`^${tab}\\s*\\d*$`) }).first();
    if (await t.isVisible().catch(() => false)) await t.click();
    await page.waitForTimeout(1800);
  }
}

const card = () => page.locator('[data-testid="smart-classification-card"]');

// ── A: UNIVERA — kart görünür, boş durum ─────────────────────────────
await gotoCase(CASE_KB_ON, 'Detay');
const cardVisible = await card().isVisible().catch(() => false);
log('A1 KB-aktif vakada kart görünür', cardVisible);
if (cardVisible) {
  const txt = (await card().innerText()) ?? '';
  const isEmptyState = txt.includes('Henüz sınıflandırılmadı');
  log('A2 boş-durum + akış ipucu', isEmptyState || txt.includes('Platform'),
    isEmptyState ? 'boş-durum' : 'dolu (önceki koşudan)');
  log('A3 Analiz Et butonu var', txt.includes('Bilgi Bankası ile Analiz Et'));
  log('A4 Elle seç / Düzenle yolu var', txt.includes('Elle seç') || txt.includes('Düzenle'));
}

// ── B: Elle seç → kaydet → persist + audit ──────────────────────────
const editBtn = card().locator('button:has-text("Elle seç"), button:has-text("Düzenle")').first();
await editBtn.click();
await page.waitForTimeout(2000);
const selects = card().locator('select');
const selCount = await selects.count();
log('B1 düzenleme: 5 dropdown render', selCount === 5, `select=${selCount}`);
const optCount = await selects.nth(0).locator('option').count();
log('B2 taxonomy listesi dolu (Platform > 1 seçenek)', optCount > 1, `opt=${optCount}`);
// Platform + İş Süreci seç (ilk gerçek seçenek)
const pickFirst = async (i) => {
  const val = await selects.nth(i).locator('option').nth(1).getAttribute('value');
  await selects.nth(i).selectOption(val ?? '');
  return val;
};
const chosenPlatform = await pickFirst(0);
await pickFirst(1);
await card().locator('button:has-text("Kaydet")').click();
await page.waitForTimeout(2500);
let txtAfter = (await card().innerText().catch(() => '')) ?? '';
log('B3 kayıt sonrası chip görünümü', txtAfter.includes('Platform:'), txtAfter.slice(0, 80));
// persist — SPA'da reload dashboard'a döner (route yok); yeniden navigasyon.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await gotoCase(CASE_KB_ON, 'Detay');
txtAfter = (await card().innerText().catch(() => '')) ?? '';
log('B4 reload sonrası PERSIST', txtAfter.includes('Platform:'));
// audit — Aktivite sekmesi
await page.locator('button', { hasText: /^Aktivite\s*\d*$/ }).first().click();
await page.waitForTimeout(1500);
const auditSeen = await page.evaluate(() =>
  document.body.innerText.includes('Akıllı Tanımlar güncellendi'));
log('B5 Aktivite\'de audit satırı', auditSeen);

// ── D: UNIVERA Çözüm Adımları AI butonu VAR ─────────────────────────
await page.locator('button:has-text("Çözüm Adımları")').first().click();
await page.waitForTimeout(1500);
const aiBtnOn = await page.evaluate(() =>
  document.body.innerText.includes('AI Önerilen Adımlar Al'));
log('D1 KB-aktif: AI Önerilen Adımlar butonu VAR', aiBtnOn);

// ── C: PARAM — tenant kapısı ────────────────────────────────────────
await gotoCase(CASE_KB_OFF, 'Detay');
await page.waitForTimeout(1500);
const cardOff = await card().isVisible().catch(() => false);
log('C1 KB-kapalı kiracıda kart GİZLİ', !cardOff);
const stepsTab = page.locator('button:has-text("Çözüm Adımları")').first();
if (await stepsTab.isVisible().catch(() => false)) {
  await stepsTab.click();
  await page.waitForTimeout(1500);
  const aiBtnOff = await page.evaluate(() =>
    document.body.innerText.includes('AI Önerilen Adımlar Al'));
  log('C2 KB-kapalı: AI Önerilen Adımlar butonu YOK', !aiBtnOff);
}

// ── E: FAZ 1.1 — kapanış zorunluluğu tenant kapısı (canlı modal) ─────
// PARAM (KB kapalı): Çöz modalında KB bölümleri YOK + Uygula çözüm notuyla açılır.
// NOT: Uygula'ya BASILMAZ (gerçek kapanış yapılmaz).
const openSolveModal = async () => {
  const cozBtn = page.locator('button:not([disabled])', { hasText: /^Çöz\s*⚠?$/ }).first();
  if (!(await cozBtn.isVisible().catch(() => false))) return false;
  await cozBtn.click();
  await page.waitForTimeout(1500);
  return page.evaluate(() => document.body.innerText.includes('Çözüm Notu'));
};
// (hâlâ PARAM vakasındayız — C bloğundan)
if (await openSolveModal()) {
  const t = await page.evaluate(() => document.body.innerText);
  log('E1 PARAM: Kapanış Bilgileri bölümü YOK', !t.includes('Kapanış Bilgileri (Kök Neden)'));
  log('E2 PARAM: KB önerisi paneli YOK', !t.includes('Bilgi Bankası Önerisi Sor'));
  // çözüm notu yaz → Uygula enabled olmalı (KB zorunluluğu yok)
  const ta = page.locator('textarea').first();
  await ta.fill('Tenant kapısı kabul testi — uygulanmayacak');
  await page.waitForTimeout(600);
  const applyDisabled = await page.locator('button:has-text("Uygula")').first().isDisabled().catch(() => null);
  log('E3 PARAM: Uygula çözüm notuyla AÇIK (KB zorunluluğu uygulanmaz)', applyDisabled === false, `disabled=${applyDisabled}`);
  await page.locator('button:has-text("Vazgeç")').first().click().catch(() => {});
  await page.waitForTimeout(600);
} else {
  log('E1-E3 PARAM çöz modalı açılamadı (stepper Çöz kilitli olabilir)', false);
}
// UNIVERA regresyonu: bölümler VAR
await gotoCase(CASE_KB_ON, null);
if (await openSolveModal()) {
  const t2 = await page.evaluate(() => document.body.innerText);
  log('E4 UNIVERA: Kapanış Bilgileri bölümü VAR', t2.includes('Kapanış Bilgileri (Kök Neden)'));
  log('E5 UNIVERA: KB önerisi paneli VAR', t2.includes('Bilgi Bankası Önerisi Sor'));
  await page.locator('button:has-text("Vazgeç")').first().click().catch(() => {});
} else {
  log('E4-E5 UNIVERA çöz modalı açılamadı', false);
}

await browser.close();
const failCount = results.filter((r) => !r).length;
console.log(`\nTOPLAM: ${results.length - failCount}/${results.length} PASS`);
process.exit(failCount ? 1 : 0);
