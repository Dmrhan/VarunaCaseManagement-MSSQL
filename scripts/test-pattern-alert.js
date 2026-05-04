/**
 * Pattern alert test script — Faz 1.5 Madde 5.
 *
 * 5 test vaka yarat (kategori "TEST-PATTERN", COMP-PARAM, createdAt=NOW),
 * runPatternDetect()'i doğrudan çağır, sonucu logla, cleanup yap.
 *
 * Çalıştırma:
 *   npm run test:pattern              # default: cleanup yapar
 *   npm run test:pattern -- --keep    # UI'da görmek için: alarm + vaka kalır
 *   npm run test:pattern -- --cleanup # önceden bırakılan test datasını sil
 *
 * Production DB'ye karşı çalışır (DATABASE_URL .env'den yüklenir).
 * --keep mode: test vakaları DB'de kalır → supervisor login + sidebar'da
 * "Örüntü Alarmları" → kart görünür. Sonra `--cleanup` veya tekrar
 * `npm run test:pattern` ile temizle.
 */

// Node 20.6+ otomatik .env load fallback (eğer --env-file kullanılmadıysa)
if (!process.env.DATABASE_URL && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* no-op */
  }
}
if (!process.env.DATABASE_URL) {
  console.error(
    '❌ DATABASE_URL yok.\n' +
      '   Çalıştırma: node --env-file=.env scripts/test-pattern-alert.js',
  );
  process.exit(1);
}

const { PrismaClient } = await import('@prisma/client');
const { runPatternDetect } = await import('../server/cron/patternDetect.js');

const prisma = new PrismaClient();

const TEST_CATEGORY = 'TEST-PATTERN';
const TEST_COMPANY_ID = 'COMP-PARAM';
const TEST_CASE_COUNT = 5;

const KEEP = process.argv.includes('--keep') || process.env.KEEP === '1';
const CLEANUP_ONLY = process.argv.includes('--cleanup');

let createdCaseIds = [];
let createdAlertIds = [];

// --cleanup modu: vaka yaratma ve cron çağırma — sadece eski TEST-PATTERN
// kayıtlarını sil ve çık.
if (CLEANUP_ONLY) {
  console.log('Cleanup-only mode — TEST-PATTERN datalarını siliyorum…');
  const a = await prisma.patternAlert.deleteMany({
    where: { companyId: TEST_COMPANY_ID, category: TEST_CATEGORY },
  });
  const c = await prisma.case.deleteMany({
    where: { companyId: TEST_COMPANY_ID, category: TEST_CATEGORY },
  });
  console.log(`  ${a.count} alarm + ${c.count} vaka silindi.`);
  await prisma.$disconnect();
  process.exit(0);
}

try {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Pattern alert test — Faz 1.5 Madde 5');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 1) Vaka şablonu için mevcut bir vaka örneği al (zorunlu alanları doldurmak için)
  const sample = await prisma.case.findFirst({
    where: { companyId: TEST_COMPANY_ID },
    select: {
      companyName: true,
      accountId: true,
      accountName: true,
      caseType: true,
      priority: true,
      origin: true,
      requestType: true,
      subCategory: true,
    },
  });
  if (!sample) {
    console.error(`❌ ${TEST_COMPANY_ID} için referans vaka bulunamadı — seed çalıştırılmış mı?`);
    process.exit(1);
  }

  // 2) 5 test vakası yarat — createdAt = şu an (cron 60dk window'unda)
  console.log(`\n[1/3] ${TEST_CASE_COUNT} test vakası yaratılıyor (kategori="${TEST_CATEGORY}")…`);
  const stamp = Date.now();
  for (let i = 0; i < TEST_CASE_COUNT; i++) {
    const c = await prisma.case.create({
      data: {
        caseNumber: `TEST-PATTERN-${stamp}-${i}`,
        title: `Pattern test vaka ${i + 1}/${TEST_CASE_COUNT}`,
        description: 'auto-created by scripts/test-pattern-alert.js',
        caseType: sample.caseType,
        priority: sample.priority,
        origin: sample.origin,
        companyId: TEST_COMPANY_ID,
        companyName: sample.companyName,
        accountId: sample.accountId,
        accountName: sample.accountName,
        category: TEST_CATEGORY,
        subCategory: sample.subCategory,
        requestType: sample.requestType,
        slaViolation: false,
        slaPausedDurationMin: 0,
        slaThirdPartyWaitMin: 0,
        aiGeneratedFlag: false,
      },
    });
    createdCaseIds.push(c.id);
  }
  console.log(`    ✓ ${createdCaseIds.length} vaka yaratıldı`);

  // 3) Detection cron'u doğrudan çağır
  console.log(`\n[2/3] runPatternDetect() çağrılıyor…`);
  const result = await runPatternDetect();
  console.log('    sonuç:', JSON.stringify(result, null, 2));

  // 4) Yazılan alarm DB'de gerçekten var mı kontrol et
  const alert = await prisma.patternAlert.findFirst({
    where: {
      companyId: TEST_COMPANY_ID,
      category: TEST_CATEGORY,
      status: 'active',
    },
    orderBy: { detectedAt: 'desc' },
  });
  if (alert) {
    createdAlertIds.push(alert.id);
    console.log(`\n    ✓ Alarm DB'de:`);
    console.log(`      id:         ${alert.id}`);
    console.log(`      caseCount:  ${alert.caseCount}`);
    console.log(`      windowMin:  ${alert.windowMinutes}`);
    console.log(`      detectedAt: ${alert.detectedAt.toISOString()}`);
    console.log(`      caseIds:    ${alert.caseIds.length} adet`);
  } else {
    console.warn(`\n    ⚠ Alarm bulunamadı — beklenmeyen.`);
  }
} catch (err) {
  console.error('\n❌ Test hatası:', err);
  process.exitCode = 1;
} finally {
  // 5) Cleanup — test vakalarını ve alarm(lar)ını sil
  if (KEEP) {
    console.log(`\n[3/3] Cleanup atlandı (--keep) — alarm + vakalar DB'de kaldı.`);
    console.log(`    UI test: supervisor@varuna.dev login → sidebar "Örüntü Alarmları"`);
    console.log(`    Temizleme: npm run test:pattern -- --cleanup`);
  } else {
    console.log(`\n[3/3] Cleanup…`);
    if (createdAlertIds.length > 0) {
      const r = await prisma.patternAlert.deleteMany({ where: { id: { in: createdAlertIds } } });
      console.log(`    ✓ ${r.count} alarm silindi`);
    }
    const leftover = await prisma.patternAlert.deleteMany({
      where: { companyId: TEST_COMPANY_ID, category: TEST_CATEGORY },
    });
    if (leftover.count > 0) {
      console.log(`    ✓ ${leftover.count} ek artık alarm silindi (kategori bazlı)`);
    }
    if (createdCaseIds.length > 0) {
      const r = await prisma.case.deleteMany({ where: { id: { in: createdCaseIds } } });
      console.log(`    ✓ ${r.count} test vakası silindi`);
    }
  }
  await prisma.$disconnect();
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}
