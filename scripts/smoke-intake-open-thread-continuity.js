/**
 * smoke-intake-open-thread-continuity.js — mükerrer vaka zinciri fix'i. 2026-07-16
 *
 * Saha olayı (UNV-1003100 + UNV-1002191 aileleri): kapalı vakanın konu
 * token'ıyla devam eden müşteri thread'inde HER cevap yeni K3 vakası
 * doğuruyordu (bir thread → 5 vaka). İki kök neden:
 *  (1) token terminal vakaya çıkınca header threading atlanıyordu,
 *  (2) header eşleşmesi "en yeni kayıt" seçip terminal vakaya çıkabiliyordu.
 *
 * Bu smoke iki kuralı da yapısal olarak kilitler; DB'ye yazmaz.
 */
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n}`); } };
const src = readFileSync('server/lib/inboundMailIntake.js', 'utf8');

// ── 1 · Gate düzeltmesi: token-terminal yolunda header threading atlanmaz ──
ok('1 eski gate kaldırıldı: header threading subjectTokenResolvedCase bayrağına bağlı DEĞİL',
  !src.includes('subjectTokenResolvedCase'));
ok('2 fix niyeti belgeli: token terminal K3 yoluna düştüğünde header\'a DA bakılır',
  src.includes('token terminal')
  && src.includes('zincirde açık vaka varsa')
  && src.includes('UNV-1003100'));

// ── 2 · Seçim kuralı: AÇIK vaka öncelikli ──
ok('3 findFirst→findMany: eşleşmeler vaka durumu + vaka tenant\'ıyla birlikte çekilir',
  src.includes('const matchedEmails = await prisma.caseEmail.findMany({')
  && src.includes("case: { select: { id: true, status: true, caseNumber: true, isArchived: true, companyId: true } }"));
ok('4 açık-öncelikli seçim: terminal olmayan + arşivsiz vaka önce; yoksa en yeni (K3 korunur)',
  src.includes('!TERMINAL_FOR_PICK.has(m.case.status) && !m.case.isArchived')
  && src.includes('?? tenantScoped[0] ?? null'));
ok('4b tenant guard (Codex #542 P2): vakası bu tenant\'ta olmayan eşleşme SEÇİMDEN ÖNCE elenir (fail-closed)',
  src.includes('m.case.companyId === companyId')
  && src.includes('const tenantScoped = matchedEmails.filter('));
ok('5 K3 davranışı DEĞİŞMEDİ: terminal + k3Enabled → yeni vaka yolu duruyor',
  src.includes("const k3Enabled = (process.env.M6_K3_NEW_TICKET_ON_TERMINAL ?? 'true') !== 'false'")
  && src.split('TERMINAL_STATUSES_DB').length >= 3);

// ── 3 · Guard'lar korunuyor ──
ok('6 tenant kapsamı: header araması companyId scoped',
  src.includes('where: { companyId, messageId: { in: headerIds } }'));
ok('7 açık vakaya append yolu: appendInbound + dedupe + iç-adres döngü guard\'ı aynen',
  src.includes('caseEmailRepository.appendInbound')
  && src.includes('replyFromInternal = await isInternalAddress(parsed.from.email, companyId)'));

// ── 4 · Saha senaryoları (fixture — seçim fonksiyonunun saf simülasyonu) ──
// Kod içindeki seçim kuralının birebir kopyası üzerinde iki gerçek aile:
const TERMINAL = new Set(['Cozuldu', 'IptalEdildi']);
const pick = (matches) =>
  matches.find((m) => m.case && !TERMINAL.has(m.case.status) && !m.case.isArchived) ?? matches[0] ?? null;

// Aile 1 — 16.07 sabahı, 07:51 maili: In-Reply-To → 1003342 (AÇIK).
// Eski kural bu noktaya hiç gelmiyordu (gate); yeni kuralda append hedefi 1003342.
const fam1 = [
  { case: { caseNumber: 'UNV-1003342', status: 'Acik', isArchived: false } }, // en yeni eşleşme
];
ok('8 Aile-1 senaryosu: zincir cevabı AÇIK devam vakasına gider (yeni vaka DOĞMAZ)',
  pick(fam1)?.case.caseNumber === 'UNV-1003342');

// Aile 2 — 16.07 08:33 maili (UNV-1003406 doğuran): References 8 halka;
// en yeni eşleşme 1002839 (TERMINAL), zincirde 1002792 + 1002315 AÇIK.
const fam2 = [
  { case: { caseNumber: 'UNV-1002839', status: 'Cozuldu', isArchived: false } },  // en yeni — eski kural BUNU seçerdi
  { case: { caseNumber: 'UNV-1002792', status: 'Acik', isArchived: false } },
  { case: { caseNumber: 'UNV-1002315', status: 'Acik', isArchived: false } },
  { case: { caseNumber: 'UNV-1002191', status: 'Cozuldu', isArchived: false } },
];
ok('9 Aile-2 senaryosu: en yeni eşleşme terminal olsa da AÇIK zincir vakası seçilir',
  pick(fam2)?.case.caseNumber === 'UNV-1002792');

// Tümü terminal → en yeni seçilir → K3 yeni vaka (tasarım korunur)
const allTerm = [
  { case: { caseNumber: 'UNV-A', status: 'Cozuldu', isArchived: false } },
  { case: { caseNumber: 'UNV-B', status: 'IptalEdildi', isArchived: false } },
];
ok('10 tüm zincir terminalse: en yeni eşleşme → K3 yeni vaka davranışı aynen',
  pick(allTerm)?.case.caseNumber === 'UNV-A');

// Arşivli açık vaka atlanır
const arch = [
  { case: { caseNumber: 'UNV-ARCH', status: 'Acik', isArchived: true } },
  { case: { caseNumber: 'UNV-OPEN', status: 'Incelemede', isArchived: false } },
];
ok('11 arşivli vaka append hedefi OLMAZ (arşiv yazma guard\'ı ile tutarlı)',
  pick(arch)?.case.caseNumber === 'UNV-OPEN');

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
