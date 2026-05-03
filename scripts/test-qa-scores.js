/**
 * QA Skorları test script — Faz 1.5 Madde 4.
 *
 * Default: 10 PARAM Cozuldu vakasına sahte (fake) AI skor inject eder
 * — UI demo için. Maliyet 0, hızlı. Farklı agent'lar arasında dağıtılır
 * ki by-agent breakdown anlamlı görünsün.
 *
 * Çalıştırma:
 *   npm run test:qa             # 10 fake skor inject (UI demo)
 *   npm run test:qa -- --real   # gerçek runScoreCase (AI çağrısı, ~$0.003)
 *   npm run test:qa -- --cleanup
 *
 * Production DB'ye karşı çalışır. test:qa-scores temizlik için
 * `--cleanup` kullan.
 */

if (!process.env.DATABASE_URL && typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile('.env'); } catch { /* no-op */ }
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL yok. node --env-file=.env scripts/test-qa-scores.js');
  process.exit(1);
}

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

const COMPANY_ID = 'COMP-PARAM';
const TARGET_COUNT = 10;
const REAL = process.argv.includes('--real');
const CLEANUP_ONLY = process.argv.includes('--cleanup');

// ---- cleanup-only mode ---------------------------------------------------
if (CLEANUP_ONLY) {
  console.log('Cleanup — tüm QA skorlarını sıfırla (PARAM)…');
  const logs = await prisma.qAScoreLog.deleteMany({ where: { companyId: COMPANY_ID } });
  const cases = await prisma.case.updateMany({
    where: { companyId: COMPANY_ID, qaScoredAt: { not: null } },
    data: {
      qaEmpathyScore: null,
      qaClarityScore: null,
      qaSpeedScore: null,
      qaFeedback: null,
      qaScoredAt: null,
    },
  });
  console.log(`  ${logs.count} log + ${cases.count} case sıfırlandı.`);
  await prisma.$disconnect();
  process.exit(0);
}

// ---- main flow -----------------------------------------------------------
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`QA Skor test — mode: ${REAL ? 'REAL (OpenAI)' : 'FAKE (UI demo)'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// Cozuldu + henüz skorlanmamış + materyali zengin vakaları seç
const candidates = await prisma.case.findMany({
  where: { companyId: COMPANY_ID, status: 'Cozuldu', qaScoredAt: null },
  include: {
    notes: { select: { id: true } },
    callLogs: { select: { id: true } },
  },
  take: 50,
});
const ranked = candidates
  .map((c) => ({
    c,
    score: c.notes.length * 2 + c.callLogs.length + (c.resolutionNote ? 3 : 0),
  }))
  .sort((a, b) => b.score - a.score)
  .slice(0, TARGET_COUNT);

if (ranked.length === 0) {
  console.log('Uygun vaka yok (Cozuldu + henüz skorlanmamış).');
  await prisma.$disconnect();
  process.exit(0);
}
console.log(`${ranked.length} vaka seçildi.\n`);

// FAKE mode için varied skorlar — agent'lar arası farklılık görünsün
const FAKE_SCORES = [
  { empathy: 5, clarity: 4, speed: 5, feedback: 'Müşteriye çok iyi yaklaşım, çözüm hızlı ve net.' },
  { empathy: 4, clarity: 5, speed: 4, feedback: 'Açık ve detaylı çözüm, müşteri memnuniyeti yüksek.' },
  { empathy: 4, clarity: 4, speed: 3, feedback: 'İyi yaklaşım, çözüm SLA sınırında kaldı.' },
  { empathy: 3, clarity: 4, speed: 4, feedback: 'Çözüm net ama müşteri ile etkileşim daha sıcak olabilirdi.' },
  { empathy: 5, clarity: 3, speed: 5, feedback: 'Empati mükemmel, çözüm açıklaması biraz daha detaylı yazılabilirdi.' },
  { empathy: 4, clarity: 4, speed: 4, feedback: 'Tüm kriterlerde dengeli performans.' },
  { empathy: 2, clarity: 3, speed: 3, feedback: 'Müşteri sıkıntısı net karşılanamamış, geri dönüş geciktirilmiş.' },
  { empathy: 5, clarity: 5, speed: 5, feedback: 'Mükemmel vaka kapatma — örnek alınabilir.' },
  { empathy: 3, clarity: 3, speed: 2, feedback: 'SLA aşıldı, müşteri birden fazla kez aramak zorunda kaldı.' },
  { empathy: 4, clarity: 5, speed: 3, feedback: 'Çözüm açık ancak yanıt süresi iyileştirilebilir.' },
];

let processed = 0;
let errors = 0;

if (REAL) {
  const { runScoreCase } = await import('../server/cron/qaScoreBatch.js');
  for (const { c } of ranked) {
    process.stdout.write(`  ${c.caseNumber}… `);
    try {
      const r = await runScoreCase(c.id);
      if (r?.scored) {
        processed++;
        console.log(`✓ emp${r.empathy}/cla${r.clarity}/spd${r.speed}`);
      } else if (r?.skipped) {
        console.log(`skip (${r.skipped})`);
      } else if (r?.error) {
        errors++;
        console.log(`ERROR ${r.error}`);
      }
    } catch (e) {
      errors++;
      console.log(`THROW ${e?.message ?? 'unknown'}`);
    }
  }
} else {
  // FAKE mode — DB'ye direkt yaz
  for (let i = 0; i < ranked.length; i++) {
    const { c } = ranked[i];
    const s = FAKE_SCORES[i % FAKE_SCORES.length];
    const now = new Date(Date.now() - Math.floor(Math.random() * 5 * 24 * 60 * 60 * 1000));
    try {
      await prisma.$transaction([
        prisma.case.update({
          where: { id: c.id },
          data: {
            qaEmpathyScore: s.empathy,
            qaClarityScore: s.clarity,
            qaSpeedScore: s.speed,
            qaFeedback: s.feedback,
            qaScoredAt: now,
          },
        }),
        prisma.qAScoreLog.upsert({
          where: { caseId: c.id },
          update: {
            empathy: s.empathy, clarity: s.clarity, speed: s.speed, feedback: s.feedback, scoredAt: now,
          },
          create: {
            caseId: c.id, companyId: COMPANY_ID,
            empathy: s.empathy, clarity: s.clarity, speed: s.speed, feedback: s.feedback,
            scoredAt: now,
          },
        }),
      ]);
      processed++;
      console.log(`  ${c.caseNumber} → emp${s.empathy}/cla${s.clarity}/spd${s.speed}  (${c.assignedPersonName ?? '—'})`);
    } catch (e) {
      errors++;
      console.log(`  ${c.caseNumber}  ERROR ${e?.message ?? 'unknown'}`);
    }
  }
}

console.log(`\nÖzet: ${processed} skorlandı, ${errors} hata.`);
console.log('UI test: supervisor@varuna.dev → QA Skorları sayfası.');
console.log('Temizlik: npm run test:qa -- --cleanup');

await prisma.$disconnect();
