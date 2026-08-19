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
 * 2026-08-19 fix — PRODUKSİYONDA gerçek hata: büyük export'larda (2100+
 * vaka) "Excel export başarısız (500) — MssqlError code 8003, too many
 * parameters" hatası alındı. Kök neden: aggregates.js'teki 7 aggregate
 * loader'ın TAMAMI (solutionSteps, caseActivity, caseNote, caseFile,
 * caseCall, caseTransfer, YENİ firstAssignment dahil) `caseId: { in:
 * caseIds } }` filtresini TEK sorguda, hiç chunk'lamadan kullanıyordu —
 * MSSQL'in 2100 parametre sınırını (Rapor Studyosu export limiti 20.000
 * satır) kolayca aşıyordu. Bu ÖNCEDEN de var olan, firstAssignment'tan
 * bağımsız bir bug'dı — yeni eklenen kolon sadece kullanıcıyı ilk kez
 * aggregate seçili büyük bir export denemeye itti. Tüm 7 loader artık
 * caseRepository.js'teki aynı chunking deseniyle (findManyChunked,
 * 1000'lik gruplar) çalışıyor.
 *
 * 2026-08-19 fix #2 — code-review bulgusu: transferCase() (caseRepository.js
 * ~5255-5303) kişi değişse bile SADECE assignedTeamId CaseActivity yazıyor,
 * assignedPersonId için HİÇ activity satırı yaratmıyor (kişi değişikliği
 * sadece CaseTransfer.fromPersonId/toPersonId'de kayıtlı). Bu kaynak
 * atlanırsa, oluşturulurken atanmış bir vaka SADECE transferCase ile el
 * değiştirdiğinde firstPersonRawByCase boş kalır, fallback mevcut (yanlış)
 * atananı "ilk atanan" diye raporlar. Fix: CaseActivity + CaseTransfer'dan
 * gelen kişi-değişim olayları caseId bazında zaman damgasına göre
 * birleştirilip en erken olay seçiliyor. Gerçek vakada (UNV-1001754)
 * doğrulandı: mevcut atanan "Fıratcan Günter", gerçek ilk atanan (ilk
 * transferin fromPersonId zinciri) "Ceren Üstkoyuncu" — fix öncesi yanlış
 * (mevcut atananı) raporlardı.
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

// ── Statik — MSSQL 2100 parametre sınırı: 7 aggregate loader'ın TAMAMI
// findManyChunked kullanıyor mu (ham `caseId: { in: caseIds } }` kalmamış mı)?
checkSrc('aggregates.js — findManyChunked() helper tanımlı', 'server/lib/caseReport/aggregates.js',
  /async function findManyChunked\(model, caseIds, \{ where = \{\}, select, orderBy \} = \{\}\)/);
checkSrc('aggregates.js — hiçbir yerde ham chunk\'lanmamış `caseId: { in: caseIds } }` kalmamış', 'server/lib/caseReport/aggregates.js',
  (content) => {
    // findManyChunked'ın kendi tanımındaki `caseId: { in: chunk } }` hariç —
    // o zaten chunk'lanmış (chunk, caseIds değil). Sadece ham `caseIds`
    // referanslı IN filtresi arıyoruz.
    const matches = content.match(/caseId: \{ in: caseIds \}/g) || [];
    return matches.length === 0;
  });
checkSrc('aggregates.js — 9 findManyChunked çağrısı (6 eski loader + firstAssignment\'ın 2 CaseActivity + 1 CaseTransfer sorgusu)', 'server/lib/caseReport/aggregates.js',
  (content) => {
    const calls = content.match(/findManyChunked\(prisma\.\w+, caseIds,/g) || [];
    return calls.length === 9;
  });
checkSrc('aggregates.js — loadFirstAssignmentAggregates Case.id sorgusu da chunk\'lı (inline)', 'server/lib/caseReport/aggregates.js',
  /for \(let i = 0; i < caseIds\.length; i \+= CASE_ID_CHUNK_SIZE\) \{\s*\n\s*const chunk = caseIds\.slice\(i, i \+ CASE_ID_CHUNK_SIZE\);\s*\n\s*currentRows\.push/);
checkSrc('aggregates.js — CaseTransfer de kişi-değişim kaynağı olarak çekiliyor', 'server/lib/caseReport/aggregates.js',
  /findManyChunked\(prisma\.caseTransfer, caseIds, \{\s*\n\s*select: \{ caseId: true, fromPersonId: true, toPersonId: true, transferredAt: true \},/);
checkSrc('aggregates.js — CaseActivity + CaseTransfer olayları zaman damgasına göre birleştirilip en erkeni seçiliyor (takım-sadece/boş olaylar hariç)', 'server/lib/caseReport/aggregates.js',
  (content) => content.includes('const informative = events.filter((e) => e.fromRaw || e.toRaw);')
    && content.includes('if (informative.length === 0) continue;')
    && content.includes('informative.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());')
    && content.includes('firstPersonRawByCase.set(caseId, earliest.fromRaw || earliest.toRaw);'));

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

      // Code-review bulgusu regresyonu — UNV-1001754: transferCase() ile
      // devredilmiş, hiç assignedPersonId CaseActivity'si OLMAYAN gerçek
      // vaka. Mevcut atanan "Fıratcan Günter"; gerçek ilk atanan (ilk
      // transferin fromPersonId'si, null→toPersonId zinciriyle) "Ceren
      // Üstkoyuncu". Fix öncesi bu, yanlışlıkla mevcut atananı raporlardı.
      const TRANSFER_ONLY_CASE_ID = 'cmrg740440i5nnyrgru67at37';
      const transferAgg = await loadFirstAssignmentAggregates(prisma, [TRANSFER_ONLY_CASE_ID]);
      const transferPayload = transferAgg.get(TRANSFER_ONLY_CASE_ID);
      check('Gerçek vaka (UNV-1001754, transferCase-only) — ilk atanan kişi "Ceren Üstkoyuncu" (mevcut "Fıratcan Günter" DEĞİL)',
        transferPayload?.firstAssignedPersonName === 'Ceren Üstkoyuncu');

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

      // MSSQL 2100 parametre sınırı regresyon testi — üretimde alınan
      // gerçek hatanın (Excel export başarısız 500, code 8003) birebir
      // reprodüksiyonu. 2100'ü kesin aşan bir case ID kümesiyle TÜM
      // aggregate loader'lar hatasız tamamlanmalı.
      const {
        loadCaseActivityAggregates, loadCaseNoteAggregates, loadCaseFileAggregates,
        loadCaseCallAggregates, loadCaseTransferAggregates, loadSolutionStepAggregates,
      } = await import('../server/lib/caseReport/aggregates.js');
      const bigCases = await prisma.case.findMany({ where: { companyId: 'COMP-UNIVERA' }, select: { id: true }, take: 3000 });
      const bigIds = bigCases.map((c) => c.id);
      if (bigIds.length > 2100) {
        let allOk = true;
        try {
          await Promise.all([
            loadFirstAssignmentAggregates(prisma, bigIds),
            loadCaseActivityAggregates(prisma, bigIds),
            loadCaseNoteAggregates(prisma, bigIds),
            loadCaseFileAggregates(prisma, bigIds),
            loadCaseCallAggregates(prisma, bigIds),
            loadCaseTransferAggregates(prisma, bigIds),
            loadSolutionStepAggregates(prisma, bigIds),
          ]);
        } catch (e) {
          allOk = false;
          console.log(`  → hata: ${e.message}`);
        }
        check(`2100 parametre sınırı regresyonu — ${bigIds.length} case ID'yle 7 aggregate loader hatasız tamamlandı`, allOk);
      } else {
        console.log(`⚠ COMP-UNIVERA'da 2100'den fazla vaka yok (${bigIds.length}) — 2100 parametre regresyon testi atlandı.`);
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
