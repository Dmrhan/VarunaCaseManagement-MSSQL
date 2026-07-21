/**
 * SLA İzleme — resolveSlaDashboardCreatedRange() saf fonksiyon testi.
 * DB/Prisma YOK — gerçek production kodunu doğrudan import edip çağırır.
 *
 * Odak: createdFrom/createdTo verilince year/month'un EZİLMESİ (override,
 * AND değil) ve TR gün sınırının (UTC+3, DST yok) doğru hesaplanması —
 * kabul kriteri: "sınırdaki vakalar doğru tarafta kalır".
 *
 * Çalıştır: node scripts/test-sla-dashboard-date-range.mjs
 */
import { resolveSlaDashboardCreatedRange } from '../server/lib/slaDashboardDateRange.js';

let pass = 0;
let fail = 0;

function assertEqual(label, actual, expected) {
  const norm = (v) =>
    v === null || v === undefined
      ? v
      : { gte: v.gte ? v.gte.toISOString() : undefined, lt: v.lt ? v.lt.toISOString() : undefined };
  const a = JSON.stringify(norm(actual));
  const e = JSON.stringify(norm(expected));
  const ok = a === e;
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) {
    pass += 1;
  } else {
    fail += 1;
    console.log(`   beklenen: ${e}\n   gelen:    ${a}`);
  }
}

// 1) Hiçbir şey verilmemiş → tüm-zamanlar (null)
assertEqual(
  'yıl/ay/aralık yok → null (tüm-zamanlar)',
  resolveSlaDashboardCreatedRange({}),
  null,
);

// 2) Sadece yıl → mevcut davranış korunur (TR gece yarısı, UTC+3)
assertEqual(
  'yalnız yıl=2026 → 2026-01-01 00:00 TR .. 2027-01-01 00:00 TR',
  resolveSlaDashboardCreatedRange({ year: 2026 }),
  { gte: new Date('2025-12-31T21:00:00.000Z'), lt: new Date('2026-12-31T21:00:00.000Z') },
);

// 3) Yıl + ay → o ayın TR sınırları
assertEqual(
  'yıl=2026, ay=7 (Temmuz) → 2026-07-01 TR .. 2026-08-01 TR',
  resolveSlaDashboardCreatedRange({ year: 2026, month: 7 }),
  { gte: new Date('2026-06-30T21:00:00.000Z'), lt: new Date('2026-07-31T21:00:00.000Z') },
);

// 4) createdFrom/createdTo verilince YIL/AY EZİLİR (override, AND değil)
assertEqual(
  'createdFrom+createdTo verilince year/month tamamen yok sayılır',
  resolveSlaDashboardCreatedRange({ year: 2020, month: 1, createdFrom: '2026-07-10', createdTo: '2026-07-15' }),
  { gte: new Date('2026-07-09T21:00:00.000Z'), lt: new Date('2026-07-15T21:00:00.000Z') },
);

// 5) Sadece createdFrom (createdTo yok) → alt sınır var, üst sınır yok
assertEqual(
  'yalnız createdFrom=2026-07-10 → gte var, lt yok',
  resolveSlaDashboardCreatedRange({ createdFrom: '2026-07-10' }),
  { gte: new Date('2026-07-09T21:00:00.000Z') },
);

// 6) Sadece createdTo — gün SONUNA kadar dahil (ertesi günün TR gece yarısı, exclusive)
assertEqual(
  'yalnız createdTo=2026-07-15 → lt = 2026-07-16 00:00 TR (gün sonu dahil)',
  resolveSlaDashboardCreatedRange({ createdTo: '2026-07-15' }),
  { lt: new Date('2026-07-15T21:00:00.000Z') },
);

// 7) Ay sonunu geçen createdTo — Date.UTC gün taşmasını doğru bir sonraki aya taşımalı
assertEqual(
  'createdTo=2026-07-31 (ayın son günü) → lt doğru şekilde 2026-08-01 TR gece yarısına taşar',
  resolveSlaDashboardCreatedRange({ createdTo: '2026-07-31' }),
  { lt: new Date('2026-07-31T21:00:00.000Z') },
);

// 8) Geçersiz createdFrom/createdTo string'leri (savunma) → year/month'a düşer
assertEqual(
  'geçersiz createdFrom/createdTo string → year/month fallback',
  resolveSlaDashboardCreatedRange({ year: 2026, month: 7, createdFrom: 'gecersiz', createdTo: '' }),
  { gte: new Date('2026-06-30T21:00:00.000Z'), lt: new Date('2026-07-31T21:00:00.000Z') },
);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
