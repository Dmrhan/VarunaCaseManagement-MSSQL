/**
 * Rapor Studyosu'na "Proje" filtresi eklendi.
 *
 * Analiz sonucu: AccountProject.name Univera'nın bayi/distribütör modelinde
 * genelde ana firma/marka adı olarak kullanılıyor — ör. "Brisa" adı 428
 * farklı bayi hesabında AYRI proje kaydı olarak geçiyor. Bu yüzden filtre
 * accountProjectName üzerinden TAM eşleşme yapıyor (contains değil —
 * "Nestle" araması yanlışlıkla "Nestle Waters"/"Nestle Profesyonel"i de
 * eşleştirmesin diye) ve dropdown, serbest metin değil (benzersiz değer
 * sayısı gerçek veride ~140-200, dropdown için uygun ölçek).
 *
 * Dropdown'ı besleyen yeni /project-options endpoint'i `groupBy` kullanıyor,
 * `findMany({distinct})` DEĞİL — Prisma'nın MSSQL connector'ında distinct
 * bellek-içi post-processing yapıp `take` sınırı uygulamıyor
 * (lookups.js/case-creators'ta bulunan aynı sınıf hata; burada baştan
 * groupBy ile önlendi).
 *
 * Statik + fonksiyonel karma smoke: wiring statik regex ile, filtre mantığı
 * gerçek DB'ye karşı çalıştırılarak doğrulanır.
 *
 * Çalıştır: node scripts/smoke-report-studio-project-filter.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
function check(label, ok) {
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}
function checkSrc(label, filePath, predicate) {
  const content = readFileSync(path.resolve(root, filePath), 'utf8');
  const ok = predicate instanceof RegExp ? predicate.test(content) : predicate(content);
  check(label, ok);
}

// ── Statik — wiring ──
checkSrc('buildWhere.js — accountProjectName TAM eşleşme filtresi (contains değil)', 'server/lib/caseReport/buildWhere.js',
  /if \(typeof f\.accountProjectName === 'string' && f\.accountProjectName\.trim\(\)\) \{\s*\n\s*where\.accountProjectName = f\.accountProjectName\.trim\(\);\s*\n\s*\}/);
checkSrc('reports.js — GET /cases/project-options route tanımlı', 'server/routes/reports.js',
  /router\.get\('\/cases\/project-options', async \(req, res\) => \{/);
checkSrc('reports.js — project-options groupBy kullanıyor (findMany distinct DEĞİL)', 'server/routes/reports.js',
  (content) => {
    const start = content.indexOf("router.get('/cases/project-options'");
    const end = content.indexOf('\nrouter.', start + 1);
    const body = content.slice(start, end === -1 ? undefined : end);
    return /prisma\.case\.groupBy\(\{\s*\n\s*by: \['accountProjectName'\],/.test(body)
      && !/findMany\([\s\S]{0,120}distinct/.test(body);
  });
checkSrc('reportService.ts — accountProjectName ReportFilters\'a eklendi', 'src/services/reportService.ts',
  /accountProjectName\?: string;/);
checkSrc('reportService.ts — listProjectOptions() export edilmiş', 'src/services/reportService.ts',
  /async listProjectOptions\(\): Promise<string\[\] \| undefined> \{/);
checkSrc('CaseReportStudioPage.tsx — projectOptions state + "Proje" filtre alanı eklendi', 'src/features/reports/CaseReportStudioPage.tsx',
  (content) => content.includes('const [projectOptions, setProjectOptions] = useState<string[]>([]);')
    && content.includes('void reportService.listProjectOptions().then((res) => {')
    && /<Field label="Proje">/.test(content));

// ── Fonksiyonel — gerçek DB'ye karşı ──
{
  const url = process.env.DATABASE_URL;
  if (url) {
    const prisma = new PrismaClient();
    try {
      const { buildReportWhere } = await import('../server/lib/caseReport/buildWhere.js');
      const allowed = ['COMP-UNIVERA'];

      const { where: whereEmpty } = buildReportWhere({}, allowed);
      check('accountProjectName gönderilmezse where\'e hiç eklenmiyor',
        !('accountProjectName' in whereEmpty));

      const { where } = buildReportWhere({ accountProjectName: 'Brisa' }, allowed);
      const count = await prisma.case.count({ where });
      const rawCount = await prisma.case.count({
        where: { companyId: { in: allowed }, accountProjectName: 'Brisa' },
      });
      check(`buildReportWhere ile filtrelenen sayım (${count}) doğrudan sorguyla eşleşiyor (${rawCount})`,
        count > 0 && count === rawCount);

      const rows = await prisma.case.groupBy({
        by: ['accountProjectName'],
        where: { companyId: { in: allowed }, accountProjectName: { not: null } },
      });
      const names = rows.map((r) => r.accountProjectName).filter(Boolean);
      check(`/project-options mantığı gerçek veride makul sayıda benzersiz değer döndürüyor (${names.length}, dropdown için uygun ölçek < 1000)`,
        names.length > 0 && names.length < 1000);
    } finally {
      await prisma.$disconnect();
    }
  } else {
    console.log('⚠ DATABASE_URL yok — gerçek veri kontrolleri atlandı.');
  }
}

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
