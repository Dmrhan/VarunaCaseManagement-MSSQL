/**
 * Ops Panosu v2 FAZ 1 — CANLI DOM + API kabul scripti (advisor, 2026-07-05).
 * Spec kabul kriterleri (docs/OPERATIONS_DASHBOARD_V2.md FAZ 1):
 *   A. Filtresiz pano regresyon (yüklenir, KPI'lar dolu)
 *   B. Talep Türü + Kanal kartları TR etiketli görünür
 *   C. Müşteri seç → kartlar accountId-scoped (toplam değişir) → Temizle → eski değer
 *   D. Cross-tenant guard: scope dışı account 403 (API, agent token)
 *   E. Boş dönem: 0'lar, hata YOK
 * Önkoşul: npm run dev + seed auth. env: ACCEPT_BASE_URL, ACCEPT_ACCOUNT_NAME
 * (UI picker'da aranacak vakalı müşteri), ACCEPT_FOREIGN_ACCOUNT_ID (agent
 * scope'u DIŞI account id — 403 testi).
 */
import { chromium } from 'playwright-core';

const BASE = process.env.ACCEPT_BASE_URL ?? 'http://localhost:5273';
const API = process.env.ACCEPT_API_URL ?? 'http://localhost:3101';
const ACCOUNT_NAME = process.env.ACCEPT_ACCOUNT_NAME ?? 'EKŞİLİOGLU';
const FOREIGN_ACCOUNT_ID = process.env.ACCEPT_FOREIGN_ACCOUNT_ID ?? '';

const results = [];
const log = (name, pass, detail) => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? ` [${detail}]` : ''}`);
};

// ── D: API-level cross-tenant guard (UI'dan bağımsız, deterministik) ──
async function apiLogin(email) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test1234!' }),
  });
  return (await r.json()).accessToken;
}

if (FOREIGN_ACCOUNT_ID) {
  // Demo seed kullanıcıları 3 şirkete de bağlı → gerçek 403 için TEK-ŞİRKETLİ
  // geçici kullanıcı (agent'ın passwordHash'i reuse; test sonunda silinir).
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const TEST_EMAIL = 'accept-scope-test@varuna.dev';
  const agent = await prisma.user.findUnique({
    where: { email: 'agent@varuna.dev' },
    select: { passwordHash: true, role: true },
  });
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } }).catch(() => {});
  await prisma.user.create({
    data: {
      email: TEST_EMAIL,
      fullName: 'Accept Scope Test',
      role: 'Agent',
      passwordHash: agent.passwordHash,
      isActive: true,
      companies: { create: [{ companyId: 'COMP-UNIVERA', role: 'Agent', isActive: true }] },
    },
  });
  try {
    const token = await apiLogin(TEST_EMAIL);
    const r = await fetch(`${API}/api/analytics/cases/overview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        from: new Date(Date.now() - 30 * 864e5).toISOString(),
        to: new Date().toISOString(),
        accountId: FOREIGN_ACCOUNT_ID,
      }),
    });
    const j = await r.json().catch(() => ({}));
    log('D1 scope dışı account → 403 account_out_of_scope',
      r.status === 403 && j.error === 'account_out_of_scope', `status=${r.status} error=${j.error}`);
    // 404 dalı da: var olmayan account
    const r2 = await fetch(`${API}/api/analytics/cases/overview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        from: new Date(Date.now() - 30 * 864e5).toISOString(),
        to: new Date().toISOString(),
        accountId: 'yok-boyle-bir-account',
      }),
    });
    log('D2 var olmayan account → 404', r2.status === 404, `status=${r2.status}`);
  } finally {
    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } }).catch(() => {});
    await prisma.$disconnect();
  }
} else {
  log('D1 403 testi atlandı (ACCEPT_FOREIGN_ACCOUNT_ID verilmedi)', false);
}

// ── UI turu ──────────────────────────────────────────────────────────
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
// Kartlar OPERASYON merceğinde — Yönetici/Müşteri lens'lerinde bilinçli gizli.
const opLens = page.locator('button', { hasText: /^Operasyon$/ }).first();
if (await opLens.isVisible().catch(() => false)) {
  await opLens.click();
  await page.waitForTimeout(3000);
}

// A — pano yüklendi + KPI'lar
const kpiText = await page.evaluate(() => document.body.innerText);
log('A1 pano yüklendi (Toplam Vaka KPI görünür)', /Toplam Vaka|Açık Vaka/i.test(kpiText));

// Ölçüm kaynağı: KENDİ kartımız (Talep Türü) — satır değerlerinin toplamı.
// Hem scoping'i hem kart sayılarının tutarlılığını aynı anda doğrular.
const readCardSum = (title) =>
  page.evaluate((t) => {
    const headers = Array.from(document.querySelectorAll('h2'));
    const h = headers.find((x) => x.textContent.trim() === t);
    if (!h) return null;
    let card = h.parentElement;
    for (let i = 0; i < 6 && card && !/\d+\(\d+%\)/.test(card.innerText) && !/Bu dönemde|Veri yok/.test(card.innerText); i++) {
      card = card.parentElement;
    }
    if (!card) return null;
    if (/Bu dönemde vaka oluşturulmamış|Veri yok/.test(card.innerText)) return 0;
    // BarList satır formatı: "464(46%)"
    const matches = Array.from(card.innerText.matchAll(/(\d+)\(\d+%\)/g));
    return matches.reduce((a, m) => a + Number(m[1]), 0);
  }, title);
const readTotal = () => readCardSum('Talep Türü');

const totalBefore = await readTotal();
log('A2 Talep Türü kart toplamı okunabildi', totalBefore !== null && totalBefore > 0, `toplam=${totalBefore}`);

// B — Talep Türü + Kanal kartları TR etiket
const cardsText = await page.evaluate(() => document.body.innerText);
log('B1 Talep Türü kartı görünür', cardsText.includes('Talep Türü'));
log('B2 Kanal kartı görünür', cardsText.includes('Kanal'));
log('B3 TR etiketler (Şikayet/E-posta ASCII değil)',
  !/\bSikayet\b/.test(cardsText) && !/\bEposta\b/.test(cardsText));

// C — müşteri lensi
// Modal bazen ilk tıkta açılmayabiliyor (refetch re-render'ı) — retry'lı aç.
let pickerInput = null;
for (let attempt = 0; attempt < 3 && !pickerInput; attempt++) {
  await page.locator('button:has-text("+ Müşteri seç")').first().click();
  await page.waitForTimeout(2000);
  const candidate = page.locator('.fixed:has-text("Müşteri Ara") input').first();
  if (await candidate.isVisible().catch(() => false)) pickerInput = candidate;
}
if (!pickerInput) {
  log('C0 müşteri picker modalı açılamadı', false);
  await browser.close();
  process.exit(1);
}
const searchInput = pickerInput;
await searchInput.click();
await searchInput.pressSequentially(ACCOUNT_NAME, { delay: 60 });
await page.keyboard.press('Enter');
await page.waitForTimeout(3000);
// picker sonuç satırına tıkla — modal içi text match (satır elementi tipten bağımsız)
const resultRow = page.locator(`.fixed:has-text("Müşteri Ara") >> text=${ACCOUNT_NAME}`).first();
const rowVisible = await resultRow.isVisible().catch(() => false);
log('C1 picker araması sonuç verdi', rowVisible);
if (rowVisible) {
  await resultRow.click();
  await page.waitForTimeout(3500);
  const chipVisible = await page.evaluate(
    (n) => document.body.innerText.includes('Müşteri filtresini temizle') || document.body.innerText.includes(n),
    ACCOUNT_NAME,
  );
  const totalScoped = await readTotal();
  log('C2 müşteri chip görünür + pano scoped', chipVisible && totalScoped !== null,
    `toplam ${totalBefore} → ${totalScoped}`);
  log('C3 scoped toplam < genel toplam',
    totalScoped !== null && totalBefore !== null && totalScoped < totalBefore,
    `${totalScoped} < ${totalBefore}`);
  // Temizle → regresyon
  await page.locator('button[title="Müşteri filtresini temizle"]').first().click();
  await page.waitForTimeout(3500);
  const totalAfterClear = await readTotal();
  log('C4 Temizle → genel toplam geri döndü', totalAfterClear === totalBefore,
    `${totalAfterClear} vs ${totalBefore}`);
}

// E — boş dönem (10 yıl önce 1 günlük aralık)
await page.evaluate(() => window.scrollTo(0, 0));
const dateInputs = page.locator('input[type="date"]');
await dateInputs.nth(0).fill('2015-01-01');
await dateInputs.nth(1).fill('2015-01-02');
await page.waitForTimeout(3500);
const emptyText = await page.evaluate(() => document.body.innerText);
// NOT: AI brief kartı Anthropic kredisi yüzünden hata gösterebilir — o ayrı
// yüzey; yalnız PANO yükleme hatasını ara.
const hasError = /Operasyon panosu yüklenemedi/i.test(emptyText);
log('E1 boş dönem: pano hatası YOK', !hasError);
const totalEmpty = await readTotal();
log('E2 boş dönem: kart 0/boş', totalEmpty === 0, `toplam=${totalEmpty}`);

await browser.close();
const failCount = results.filter((r) => !r).length;
console.log(`\nTOPLAM: ${results.length - failCount}/${results.length} PASS`);
process.exit(failCount ? 1 : 0);
