/**
 * smoke-work-calendar-admin.js — Çalışma Takvimi admin ekranı (Faz 2). 2026-07-14
 * Yapısal guard'lar; DB'ye yazmaz.
 */
import { readFileSync } from 'node:fs';
import { getTrHolidays, TR_HOLIDAY_YEARS } from '../server/lib/sla/trHolidays.js';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n}`); } };

const routes = readFileSync('server/routes/admin.js', 'utf8');
const repo = readFileSync('server/db/adminRepository.js', 'utf8');
const page = readFileSync('src/features/admin/AdminWorkCalendarPage.tsx', 'utf8');
const layout = readFileSync('src/features/admin/AdminLayout.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const svc = readFileSync('src/services/adminService.ts', 'utf8');
const schema = readFileSync('prisma/schema.prisma', 'utf8');
const migration = readFileSync('prisma/migrations/20260714_work_calendar/migration.sql', 'utf8');

// ── 1 · SysAdmin-only ÇİFT kapı (route + FE) ──
const wcBlock = routes.split("router.get('/work-calendar/:companyId'")[1] ?? '';
ok('1 route katmanı: 6 work-calendar endpoint\'inin HEPSİ assertSystemAdmin ile kapılı',
  routes.includes('function assertSystemAdmin(req)')
  && (routes.match(/assertSystemAdmin\(req\);/g) ?? []).length >= 6);
ok('2 FE kapısı: canShowAdminView admin-work-calendar\'ı SystemAdmin dışına kapatır + sayfa içi rol guard',
  app.includes("if (key === 'admin-work-calendar' && user?.role !== 'SystemAdmin') return false;")
  && page.includes("user?.role !== 'SystemAdmin'"));

// ── 2 · Tenant scope + cache invalidation ──
ok('3 her endpoint assertCompanyAdmin scope\'undan geçer (preview hariç — stateless)',
  (wcBlock.match(/assertCompanyAdmin\(req,/g) ?? []).length >= 5);
ok('4 repo her YAZIMDA motor cache\'ini invalidate eder (upsert+addHoliday+removeHoliday+copy)',
  (repo.match(/invalidateWorkCalendarCache\(companyId\)/g) ?? []).length >= 4);

// ── 3 · Upsert alan-alan tuzağı (companySettingsRepo dersi) ──
ok('5 upsert: 6 alanın tamamı koşullu patch listesinde (sessiz yazılmama tuzağı)',
  ['workDays', 'breakStartMin', 'breakEndMin', 'isActive', 'pauseOnCustomerWait', 'effectiveFrom']
    .every((f) => repo.includes(`patch.${f} !== undefined`)));

// ── 4 · Şema/migration parite ──
ok('6 şema ↔ migration parite: pauseOnCustomerWait + effectiveFrom iki tarafta da var',
  schema.includes('pauseOnCustomerWait Boolean @default(false)')
  && schema.includes('effectiveFrom DateTime?')
  && migration.includes('[pauseOnCustomerWait] BIT NOT NULL')
  && migration.includes('[effectiveFrom]   DATETIME2 NULL'));

// ── 5 · Preview stateless (kaydetmeden önizleme; FE'de takvim matematiği YASAK) ──
ok('7 preview endpoint\'i normalizeCalendar+motor kullanır, hiçbir repo yazımı yok',
  routes.includes("router.post('/work-calendar/preview'")
  && routes.includes('addBusinessMinutes(Date.parse(sc.startIso)')
  && !(routes.split("router.post('/work-calendar/preview'")[1] ?? '').slice(0, 1200).includes('workCalendarRepo.'));
ok('8 FE takvim matematiği içermez: sayfada dakika-ekleme/aralık hesabı yok, preview sunucudan',
  page.includes('adminService.workCalendar.preview(')
  && !page.includes('addBusinessMinutes')
  && page.includes('sunucu hesaplar'));

// ── 6 · Ekran bölümleri (onaylı mockup paritesi) ──
ok('9 mockup bölümleri: mesai + öğle arası + net mesai + tatiller + kopyala + duraklatma + kesim + örnek hesap',
  ['Haftalık Mesai Penceresi', 'Öğle Arası (mola)', 'Haftalık net mesai', 'Resmi Tatiller',
    'Kopyala', 'SLA Duraklatma Kuralları', 'Müşteriden yanıt beklenirken SLA dursun',
    'kesim tarihi', 'Örnek Hesaplama'].every((t) => page.includes(t)));
ok('10 nav bağları: AdminLayout view+item (Tanımlar grubu, CalendarDays) + App render',
  layout.includes("'admin-work-calendar'")
  && layout.includes("label: 'Çalışma Takvimi'")
  && app.includes("{view === 'admin-work-calendar' && <AdminWorkCalendarPage />}"));

// ── 7 · Servis kontratı ──
ok('11 adminService.workCalendar: get/save/addHoliday/removeHoliday/copyFrom/preview tam set',
  ['workCalendar: {', 'async get(companyId', 'async save(companyId', 'async addHoliday(',
    'async removeHoliday(', 'async copyFrom(', 'async preview('].every((t) => svc.includes(t)));

ok('12 yerel-ayar bağımsız format (saha bulgusu): sayfada native time/date/month girdisi YOK — 24s TimeSelect + GG.AA.YYYY DateInputTR',
  !/<input[^>]*type="(time|date|month)"/.test(page)
  && page.includes('function TimeSelect(')
  && page.includes('function DateInputTR(')
  && page.includes('placeholder="GG.AA.YYYY"')
  && page.includes('MONTH_NAMES[Number(calMonth.slice(5, 7)) - 1]'));

// ── 8 · TR resmî tatil içe aktarma ──
const tr26 = getTrHolidays(2026);
ok('13 TR tatil üretici: 2026 = 8 sabit + 9 dinî = 17 kayıt; arifeler yarım gün 13:00',
  Array.isArray(tr26) && tr26.length === 17
  && tr26.filter((h) => h.isHalfDay).length === 3 // 28 Ekim + Ramazan arife + Kurban arife
  && tr26.every((h) => !h.isHalfDay || h.halfDayEndMin === 780)
  && tr26.some((h) => h.date === '2026-10-29' && h.name === 'Cumhuriyet Bayramı')
  && tr26.some((h) => h.date === '2026-05-27' && h.name.startsWith('Kurban Bayramı 1')));
ok('14 tablo dışı yıl DÜRÜST ret (uydurma tarih üretilmez) + destekli yıllar sabiti',
  getTrHolidays(2035) === null && TR_HOLIDAY_YEARS.length >= 4);
ok('15 içe aktarma zinciri: repo importTrHolidays (mevcut atlanır + invalidate) + SysAdmin route + FE butonu',
  repo.includes('async importTrHolidays(companyId, year, actor)')
  && routes.includes("'/work-calendar/:companyId/import-tr-holidays'")
  && page.includes('TR tatillerini ekle')
  && page.includes('Diyanet takvimiyle teyit edin'));

ok('16 saha UX: ızgara günü tıklanınca tarih forma dolar + tatil işlemleri takvimi OTOMATİK kaydeder (pasif buton yok)',
  page.includes('onClick={() => setHDate(dateIso)}')
  && page.includes('async function ensureCalendarSaved()')
  && (page.match(/await ensureCalendarSaved\(\)/g) ?? []).length >= 3
  && !page.includes('disabled={!cal}'));

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
