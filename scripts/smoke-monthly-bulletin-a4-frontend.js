/**
 * smoke-monthly-bulletin-a4-frontend.js — A4b frontend (service + page + router).
 *
 * KAPSAM (static):
 *   - bulletinService.ts — getMonthlyBulletin export'lu + tip tanımları
 *   - MonthlyBulletinPage.tsx — 8 blok mevcut
 *   - 4-kova durum + tip + kategori + SLA + kanal + öncelik + firma + özet
 *   - Help/explainability — her blok kendini açıklayan hint
 *   - Empty state (vaka yok / müşteri seçilmedi)
 *   - Print-friendly (printable-report class + report-no-print)
 *   - A5: PDF (window.print) + Excel (xlsx lazy import; 8 sheet)
 *   - Router: view tipi + App.tsx mount + sidebar link
 *   - Yetki: CSM + Supervisor + Admin + SystemAdmin
 *
 * KAPSAM DIŞI (gerçek browser test):
 *   - Modal render, recharts grafikler, print görsel review
 */

import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} — actual=${actual} expected=${expected}`); }
}
function read(p) { return readFileSync(p, 'utf8'); }

// ─── 1) bulletinService ────────────────────────────────────────────
const svc = read('src/services/bulletinService.ts');

console.log('── 1) bulletinService ────────────────────────────');
expect('1.1 getMonthlyBulletin export\'lu',
  /async getMonthlyBulletin\(/.test(svc), true);
expect('1.2 POST /api/analytics/monthly-bulletin endpoint',
  /'\/api\/analytics\/monthly-bulletin'/.test(svc), true);
expect('1.3 BulletinPayload type',
  /export interface BulletinPayload /.test(svc), true);
expect('1.4 byStatus4 + byRequestType + byOrigin tipi',
  /byStatus4: BulletinBucketRow\[\]/.test(svc)
    && /byRequestType: BulletinBucketRow\[\]/.test(svc)
    && /byOrigin: BulletinBucketRow\[\]/.test(svc), true);
expect('1.5 perAccountCompany + totals tipleri',
  /perAccountCompany: BulletinByAccountCompanyRow\[\]/.test(svc)
    && /totals: BulletinTotals/.test(svc), true);

// ─── 2) MonthlyBulletinPage ────────────────────────────────────────
const page = read('src/features/reports/MonthlyBulletinPage.tsx');

console.log('\n── 2) MonthlyBulletinPage — 8 blok ──────────────');
expect('2.1 component export\'lu',
  /export function MonthlyBulletinPage/.test(page), true);
expect('2.2 1. Özet KPI (Toplam Vaka + Çözülen + Ort. Çözüm + SLA Uyum)',
  /title="Genel Özet"/.test(page), true);
expect('2.3 2. Firma Dağılımı (tek-şirketliyse gizli)',
  /title="Firma Dağılımı"/.test(page) && /showCompanyBreakdown/.test(page), true);
expect('2.4 3. Durum 4-kova (Açık/Üstlenildi/Bekletiliyor/Kapalı)',
  /title="Durum"/.test(page) && /byStatus4/.test(page), true);
expect('2.5 4. Talep Türü (Bilgi/Talep/Hata/Şikayet)',
  /title="Talep Türü"/.test(page) && /byRequestType/.test(page), true);
expect('2.6 5. Kategori',
  /title="Kategori"/.test(page) && /byCategory/.test(page), true);
expect('2.7 6. SLA Uyum (response + resolution ayrı)',
  /title="SLA Uyum"/.test(page) && /slaResponseCompliancePct/.test(page)
    && /slaResolutionCompliancePct/.test(page), true);
expect('2.8 7. Kanal',
  /title="Kanal"/.test(page) && /byOrigin/.test(page), true);
expect('2.9 8. Öncelik',
  /title="Öncelik"/.test(page) && /byPriority/.test(page), true);

console.log('\n── 3) Help / Explainability standardı ────────────');
expect('3.1 Her blok kendini açıklayan hint mevcut',
  (page.match(/hint="/g) ?? []).length >= 8, true);
expect('3.2 Üst banner "agent ismi / iç not içermez" privacy notu',
  /sadece aggregate sayımlar/i.test(page) || /agent isim/i.test(page), true);
expect('3.3 Empty state — müşteri seçilmedi',
  /müşteri ve dönem seç/i.test(page), true);
expect('3.4 Empty state — vaka yok (boş dönem)',
  /Bu dönemde vaka yok/.test(page), true);

console.log('\n── 4) recharts grafikler ─────────────────────────');
expect('4.1 BarChart import',
  /import \{[\s\S]{0,300}BarChart,[\s\S]{0,300}\} from 'recharts'/.test(page), true);
expect('4.2 PieChart import',
  /PieChart,[\s\S]{0,200}from 'recharts'|from 'recharts'[\s\S]{0,300}PieChart/.test(page), true);
expect('4.3 BucketBarChart + BucketDonut helpers',
  /function BucketBarChart\(/.test(page) && /function BucketDonut\(/.test(page), true);
expect('4.4 ResponsiveContainer (print uyumlu)',
  /ResponsiveContainer/.test(page), true);

console.log('\n── 5) Print-friendly (PDF window.print) ──────────');
expect('5.1 printable-report class',
  /className="bulletin-report printable-report/.test(page), true);
expect('5.2 report-no-print (controls gizlemek için)',
  /report-no-print/.test(page), true);
expect('5.3 PDF butonu — window.print',
  /window\.print\(\)/.test(page), true);

console.log('\n── 6) Excel export (A5) ──────────────────────────');
expect('6.1 xlsx lazy import (bundle\'a girmesin)',
  /await import\('xlsx'\)/.test(page), true);
expect('6.2 exportExcel fonksiyonu',
  /async function exportExcel\(data: BulletinPayload, accountName: string\)/.test(page), true);
expect('6.3 8 ayrı sheet — sheet ismeleri mevcut',
  /'Özet'/.test(page)
    && /'Firma Dağılımı'/.test(page)
    && /'Durum'/.test(page)
    && /'Tip'/.test(page)
    && /'Kategori'/.test(page)
    && /'Kanal'/.test(page)
    && /'Öncelik'/.test(page)
    && /'Vaka Tipi'/.test(page), true);

// ─── 7) Router entegrasyonu (App.tsx) ──────────────────────────────
const app = read('src/App.tsx');

console.log('\n── 7) Router entegrasyonu ────────────────────────');
expect('7.1 MonthlyBulletinPage import',
  /import \{ MonthlyBulletinPage \}/.test(app), true);
expect('7.2 View tipinde \'monthly-bulletin\'',
  /'monthly-bulletin'/.test(app), true);
expect('7.3 view === monthly-bulletin render',
  /view === 'monthly-bulletin' && <MonthlyBulletinPage \/>/.test(app), true);
expect('7.4 Sidebar nav item',
  /Aylık Bülten/.test(app), true);
expect('7.5 Yetki — CSM + Supervisor + Admin + SystemAdmin görür',
  /showMonthlyBulletin[\s\S]{0,300}'CSM', 'Supervisor', 'Admin', 'SystemAdmin'/.test(app), true);
expect('7.6 FileText icon import',
  /FileText,/.test(app), true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
