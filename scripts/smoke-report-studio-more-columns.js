/**
 * Rapor Studyosu'na 6 yeni kolon: Geliş Kanalı, Ürün Grubu, Vaka Sahibi,
 * İlk Atanan Kişi, İlk Atanan Takım, Proje Şifresi.
 *
 * "Proje Şifresi" (AccountProject.code) ilk turda eklenmedi — AccountCompany.
 * externalCustomerCode ("Müşteri Kodu") ile aynı veri sanılmıştı. Kullanıcı
 * ekran görüntüsüyle (Account detay sayfası, Projeler kartı, "99746" kodu)
 * bunun AYRI bir alan olduğunu doğruladı: Müşteri Kodu AccountCompany
 * (müşteri-şirket ilişkisi) seviyesinde, Proje Şifresi ise projenin KENDİ
 * kodu (AccountProject.code) — Case.accountProject join (to-one relation)
 * ile okunuyor, yeni bir aggregate/formatter gerektirmedi.
 *
 * İlk Atanan Kişi/Takım — export-vaka-ilk-atanan-kapatan-temmuz-agustos.mjs
 * script'indeki mantığın rapor pipeline'ına taşınmış hali (yeni bir
 * 'firstAssignment' aggregate ailesi, aggregates.js). Gerçek veride bir
 * iyileştirme yapıldı: orijinal script'te takım için sadece fromValue
 * kullanılıyordu (fromValue boşsa mevcut takıma sessizce düşüyordu); burada
 * kişi tarafıyla TUTARLI şekilde fromValue||toValue + Team id→name
 * çözümlemesi eklendi — gerçek veride (VK-MPBQ07I3) ilk takımın ham ID
 * ("TEAM-MOBIL") olarak yazıldığı, isim çözümlemesi olmadan boş/yanlış
 * sonuç vereceği doğrulandı.
 *
 * Statik + fonksiyonel karma smoke: kayıt/formatter wiring'i statik regex
 * ile, hesaplama mantığı gerçek DB'ye karşı çalıştırılarak doğrulanır.
 *
 * Çalıştır: node scripts/smoke-report-studio-more-columns.js
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

// ── Statik — registry / wiring ──
checkSrc('columnRegistry.js — origin (Geliş Kanalı) kolonu', 'server/lib/caseReport/columnRegistry.js',
  /\{ id: 'origin', +label: 'Geliş Kanalı',[^}]*format: 'caseOrigin' \}/);
checkSrc('columnRegistry.js — productGroup (Ürün Grubu) kolonu', 'server/lib/caseReport/columnRegistry.js',
  /\{ id: 'productGroup', +label: 'Ürün Grubu',/);
checkSrc('columnRegistry.js — createdByName (Vaka Sahibi) kolonu', 'server/lib/caseReport/columnRegistry.js',
  /\{ id: 'createdByName', +label: 'Vaka Sahibi',/);
checkSrc('columnRegistry.js — accountProject.code (Proje Şifresi) kolonu — join source, accountCompany.externalCustomerCode\'dan AYRI', 'server/lib/caseReport/columnRegistry.js',
  /\{ id: 'accountProject\.code', label: 'Proje Şifresi', +category: 'core', type: 'string', source: 'join', joinTable: 'accountProject', joinField: 'code',/);
checkSrc('columnRegistry.js — firstAssignment.personName kolonu (aggregate source)', 'server/lib/caseReport/columnRegistry.js',
  /\{ id: 'firstAssignment\.personName', label: 'İlk Atanan Kişi', +category: 'assignment', type: 'string', source: 'aggregate', aggregateKey: 'firstAssignment', aggregateField: 'firstAssignedPersonName' \}/);
checkSrc('columnRegistry.js — firstAssignment.teamName kolonu (aggregate source)', 'server/lib/caseReport/columnRegistry.js',
  /\{ id: 'firstAssignment\.teamName', +label: 'İlk Atanan Takım', +category: 'assignment', type: 'string', source: 'aggregate', aggregateKey: 'firstAssignment', aggregateField: 'firstAssignedTeamName' \}/);
checkSrc('columnRegistry.js — needsFirstAssignmentAggregates() export edilmiş', 'server/lib/caseReport/columnRegistry.js',
  /export function needsFirstAssignmentAggregates\(columns\)/);
checkSrc('formatters.js — caseOrigin switch dispatch\'e eklendi', 'server/lib/caseReport/formatters.js',
  /case 'caseRequestType':\s*\n\s*case 'caseOrigin':\s*\n\s*case 'callOutcome':/);
checkSrc('buildRows.js — firstAssignment aggregateKey dispatch\'e eklendi', 'server/lib/caseReport/buildRows.js',
  /col\.aggregateKey === 'firstAssignment' \? firstAssignmentAggs/);
checkSrc('reports.js — loadFirstAssignmentAggregates import + orkestrasyon', 'server/routes/reports.js',
  (content) => content.includes('loadFirstAssignmentAggregates')
    && /if \(needsFirstAssignmentAggregates\(columns\)\) \{\s*\n\s*jobs\.push\(loadFirstAssignmentAggregates\(prisma, caseIds\)\.then\(\(m\) => \{ aggregates\.firstAssignment = m; \}\)\);/.test(content));
checkSrc('aggregates.js — loadFirstAssignmentAggregates export edilmiş', 'server/lib/caseReport/aggregates.js',
  /export async function loadFirstAssignmentAggregates\(prisma, caseIds\)/);

// ── Fonksiyonel — formatter gerçekten çalışıyor ──
{
  const { applyFormat } = await import('../server/lib/caseReport/formatters.js');
  check('applyFormat({format:"caseOrigin"}, "Eposta") → "E-posta"',
    applyFormat({ type: 'string', format: 'caseOrigin' }, 'Eposta') === 'E-posta');
  check('applyFormat({format:"caseOrigin"}, "Diger") → "Diğer"',
    applyFormat({ type: 'string', format: 'caseOrigin' }, 'Diger') === 'Diğer');
}

// ── Fonksiyonel — gerçek veriyle aggregate doğrulama ──
{
  const url = process.env.DATABASE_URL;
  if (url) {
    const prisma = new PrismaClient();
    try {
      const { loadFirstAssignmentAggregates } = await import('../server/lib/caseReport/aggregates.js');
      check('loadFirstAssignmentAggregates([]) → boş Map (edge case)',
        (await loadFirstAssignmentAggregates(prisma, [])).size === 0);

      // VK-MPBQ07I3 — gerçek vaka, ilk takım activity'sinde fromValue=null,
      // toValue='TEAM-MOBIL' (ham Team.id). İsim çözümlemesi olmadan bu
      // boş/ham ID olarak kalırdı.
      const KNOWN_CASE_ID = 'cmpbq07v70003le04z39ttuku';
      const agg = await loadFirstAssignmentAggregates(prisma, [KNOWN_CASE_ID]);
      const payload = agg.get(KNOWN_CASE_ID);
      check('Gerçek vaka (VK-MPBQ07I3) — ilk atanan kişi "Burak Demir"',
        payload?.firstAssignedPersonName === 'Burak Demir');
      check('Gerçek vaka (VK-MPBQ07I3) — ilk atanan takım ham ID değil, "Mobil Takımı" (çözümlenmiş)',
        payload?.firstAssignedTeamName === 'Mobil Takımı');

      // accountProject.code — bir projeye bağlı gerçek bir vakayla uçtan
      // uca doğrulama (Case.accountProject join → AccountProject.code).
      const { resolveColumns, buildPrismaSelect } = await import('../server/lib/caseReport/columnRegistry.js');
      const { buildReportRows } = await import('../server/lib/caseReport/buildRows.js');
      const { columns } = resolveColumns(['caseNumber', 'accountProject.code']);
      const select = buildPrismaSelect(columns);
      const c = await prisma.case.findFirst({ where: { accountProjectId: { not: null } }, select });
      if (c) {
        const rows = buildReportRows([c], columns, {});
        check('accountProject.code — projeye bağlı gerçek bir vakada dolu ve DB\'deki kodla eşleşiyor',
          typeof rows[0]?.['accountProject.code'] === 'string' && rows[0]['accountProject.code'].length > 0
          && rows[0]['accountProject.code'] === c.accountProject?.code);
      } else {
        console.log('⚠ Projeye bağlı vaka bulunamadı — bu kontrol atlandı.');
      }
    } finally {
      await prisma.$disconnect();
    }
  } else {
    console.log('⚠ DATABASE_URL yok — gerçek veri kontrolleri atlandı.');
  }
}

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
