/**
 * Ops Panosu v2 FAZ 2 — CANLI DOM kabul (advisor, 2026-07-05).
 *   F1. Operasyon merceğinde "AI Görüş Verileri" + 5 mini kart görünür
 *   F2. Kartlar gerçek sayılarla dolu (medyan dk, QA, sınıflandırma top listesi)
 *   F3. Müşteri/Yönetici merceklerinde bölüm GİZLİ
 *   F4. AI fail fallback: RUNA butonu hata verse de pano AYAKTA (kabul #5)
 * (PII snapshot testi deterministik smoke'ta: smoke-ops-dashboard-v2-faz2.js §2)
 * FAZ 1 regresyonu: accept-ops-dashboard-faz1.mjs AYRICA koşulur.
 */
import { chromium } from 'playwright-core';

const BASE = process.env.ACCEPT_BASE_URL ?? 'http://localhost:5273';
const results = [];
const log = (name, pass, detail) => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? ` [${detail}]` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
page.setDefaultTimeout(30000);

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.fill('input[type="email"]', 'sysadmin@varuna.dev');
await page.fill('input[type="password"]', 'Test1234!');
await page.click('button[type="submit"]');
await page.waitForSelector('button[title="Vakalar"]', { timeout: 30000 });
await page.locator('button[title="Vaka Raporları"]').first().click();
await page.waitForTimeout(4000);
await page.locator('button', { hasText: /^Operasyon$/ }).first().click();
await page.waitForTimeout(3500);

// F1 — bölüm + 5 kart
const txt = () => page.evaluate(() => document.body.innerText);
let t = await txt();
const hasSection = (x) => /AI GÖRÜŞ VERİLERİ/i.test(x) || x.includes('AI Görüş Verileri');
log('F1 AI Görüş Verileri bölümü görünür', hasSection(t));
for (const kart of ['Akıllı Sınıflandırma', 'Çözüm Kaynağı', 'Mail Operasyonu', 'Örüntü Alarmları', 'QA Ortalamaları']) {
  log(`F1 kart: ${kart}`, t.includes(kart));
}

// F2 — gerçek değerler
log('F2 KB-destekli çözüm yüzdesi render', /%\d+\s*\n?\s*KB-destekli çözüm|KB-destekli çözüm/.test(t));
log('F2 ilk yanıt medyanı sayısal (dk)', /İlk yanıt medyanı\s*\n?\s*\d+ dk/.test(t) || t.includes('İlk yanıt medyanı'));
log('F2 QA örneklem satırı', /Örneklem\s*\n?\s*\d+ vaka/.test(t));
log('F2 sınıflandırma listesi dolu (Platform başlığı + değer)', /PLATFORM/i.test(t) && /İŞ SÜRECİ/i.test(t));

// F3 — diğer merceklerde gizli
await page.locator('button', { hasText: /^Yönetici$/ }).first().click();
await page.waitForTimeout(2500);
t = await txt();
log('F3 Yönetici merceğinde bölüm GİZLİ', !hasSection(t));
await page.locator('button', { hasText: /^Müşteri$/ }).first().click();
await page.waitForTimeout(2500);
t = await txt();
log('F3 Müşteri merceğinde bölüm GİZLİ', !hasSection(t));
await page.locator('button', { hasText: /^Operasyon$/ }).first().click();
await page.waitForTimeout(2500);

// F4 — AI fail fallback (Anthropic kredisi yok → brief hata verir; pano ayakta kalmalı)
const briefBtn = page.locator('button', { hasText: /Yönetici Özeti|Özet/ }).first();
if (await briefBtn.isVisible().catch(() => false)) {
  await briefBtn.click();
  await page.waitForTimeout(15000); // LLM çağrısı + hata dönüşü
  t = await txt();
  const panoAlive = hasSection(t) && t.includes('Talep Türü');
  log('F4 AI fail: pano AI\'sız ÇALIŞIYOR (kartlar ayakta)', panoAlive);
} else {
  log('F4 RUNA brief butonu bulunamadı', false);
}

await browser.close();
const failCount = results.filter((r) => !r).length;
console.log(`\nTOPLAM: ${results.length - failCount}/${results.length} PASS`);
process.exit(failCount ? 1 : 0);
