/**
 * smoke-pr2-r9-1-sender-name-chain.js — 2026-07-04
 *
 * PR-2 görsel tur R9.1 — Giden mail "gönderen adı" zinciri:
 *   - Backend: CaseEmail.include.sentBy.fullName + shape.sentByName
 *   - FE type: CaseEmailItem.sentByName: string | null
 *   - Ortak util: src/features/cases/lib/mailSender.ts (TEK kaynak)
 *   - ListPane + Reader: aynı util'i çağırır
 *   - CommunicationTab: useAuth.user.id → iki ListPane + iki Reader instance'ı
 *   - Kural: outbound + notif_dispatch → 'Varuna · Otomatik'
 *            outbound + sentByUserId===currentUserId → 'Siz'
 *            outbound + sentByName → sentByName (agent düz)
 *            outbound + legacy null → from.name || 'Varuna'
 *            inbound: from.name || address.local
 */

import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} — actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
}
function expectTrue(name, cond) { expect(name, !!cond, true); }
function read(p) { return readFileSync(p, 'utf8'); }

const repo = read('server/db/caseEmailRepository.js');
const svc = read('src/services/caseEmailService.ts');
const util = read('src/features/cases/lib/mailSender.ts');
const listPane = read('src/features/cases/components/MailThreadListPane.tsx');
const reader = read('src/features/cases/components/MailThreadReader.tsx');
const tab = read('src/features/cases/components/CommunicationTab.tsx');

console.log('── 1) Backend repository — include + shape ────');
expectTrue('1.1 listForCase include sentBy.fullName',
  /const rows = await prisma\.caseEmail\.findMany\(\{[\s\S]{0,500}include:\s*\{[\s\S]{0,400}sentBy:\s*\{\s*select:\s*\{\s*fullName:\s*true\s*\}\s*\}/.test(repo));
expectTrue('1.2 getById include sentBy.fullName',
  /findUnique\(\{\s*where:\s*\{\s*id\s*\}[\s\S]{0,400}sentBy:\s*\{\s*select:\s*\{\s*fullName:\s*true\s*\}\s*\}/.test(repo));
expectTrue('1.3 shape sentByName ← row.sentBy?.fullName ?? null',
  /sentByName:\s*row\.sentBy\?\.fullName\s*\?\?\s*null/.test(repo));
expectTrue('1.4 Person zinciri YOK (User.fullName ground-truth)',
  !/person:\s*\{\s*select:\s*\{\s*name:\s*true/.test(repo));

console.log('\n── 2) FE type — CaseEmailItem.sentByName ─────');
expectTrue('2.1 sentByName: string | null',
  /sentByName:\s*string\s*\|\s*null/.test(svc));
expectTrue('2.2 sentByUserId hâlâ mevcut',
  /sentByUserId:\s*string\s*\|\s*null/.test(svc));

console.log('\n── 3) Ortak util — mailSender.ts ─────────────');
expectTrue('3.1 computeSenderDisplay export (email, currentUserId)',
  /export function computeSenderDisplay\(\s*email:\s*CaseEmailItem,\s*currentUserId:\s*string\s*\|\s*null,?\s*\):\s*string/.test(util));
expectTrue('3.2 notification_dispatch → "Varuna · Otomatik"',
  /notification_dispatch[\s\S]{0,80}Varuna · Otomatik/.test(util));
expectTrue('3.3 sentByUserId === currentUserId → "Siz"',
  /email\.sentByUserId[\s\S]{0,120}currentUserId[\s\S]{0,120}Siz/.test(util));
expectTrue('3.4 sentByName fallback',
  /email\.sentByName\?\.trim/.test(util));
expectTrue('3.5 legacy alias fallback (from.name || "Varuna")',
  /email\.from\.name\?\.trim[\s\S]{0,120}Varuna/.test(util));

console.log('\n── 4) Davranış simülasyonu ───────────────────');

/** Util eş-davranış — burada saf JS'e port. */
function computeSenderDisplay(email, currentUserId) {
  if (email.direction === 'inbound') {
    const name = email.from.name?.trim();
    if (name) return name;
    return email.from.address.split('@')[0] || email.from.address;
  }
  if (email.source === 'notification_dispatch') return 'Varuna · Otomatik';
  if (email.sentByUserId && currentUserId && email.sentByUserId === currentUserId) return 'Siz';
  const sentByName = email.sentByName?.trim();
  if (sentByName) return sentByName;
  const alias = email.from.name?.trim();
  return alias || 'Varuna';
}

// 4.1 Inbound with name
expect('4.1 Inbound ad var → ad',
  computeSenderDisplay({ direction: 'inbound', from: { name: 'Burçin Başaran', address: 'burcin@x.com' }, source: 'imap_ingest' }, 'u-me'),
  'Burçin Başaran');

// 4.2 Inbound no name → local
expect('4.2 Inbound ad yok → adres local',
  computeSenderDisplay({ direction: 'inbound', from: { name: null, address: 'hulya.ozbey@univera.com.tr' }, source: 'imap_ingest' }, 'u-me'),
  'hulya.ozbey');

// 4.3 Outbound notification_dispatch
expect('4.3 Giden + notification_dispatch → "Varuna · Otomatik"',
  computeSenderDisplay({ direction: 'outbound', source: 'notification_dispatch', from: { name: 'Varuna', address: 'destek@x.com' }, sentByUserId: null, sentByName: null }, 'u-me'),
  'Varuna · Otomatik');

// 4.4 Outbound manual, sentByUserId === current → "Siz"
expect('4.4 Giden + kendi mailim → "Siz"',
  computeSenderDisplay({ direction: 'outbound', source: 'manual_send', from: { name: 'Varuna', address: 'destek@x.com' }, sentByUserId: 'u-me', sentByName: 'Demirhan İşbakan' }, 'u-me'),
  'Siz');

// 4.5 Outbound manual, başka agent → sentByName (agent adı düz)
expect('4.5 Giden + başka agent → agent adı düz',
  computeSenderDisplay({ direction: 'outbound', source: 'manual_send', from: { name: 'Varuna', address: 'destek@x.com' }, sentByUserId: 'u-other', sentByName: 'Ayşe Yılmaz' }, 'u-me'),
  'Ayşe Yılmaz');

// 4.6 Outbound legacy (null sentByUserId + null sentByName) → alias fallback
expect('4.6 Legacy null actor → alias fallback (from.name)',
  computeSenderDisplay({ direction: 'outbound', source: 'manual_send', from: { name: 'Varuna Destek', address: 'destek@x.com' }, sentByUserId: null, sentByName: null }, 'u-me'),
  'Varuna Destek');

// 4.7 Outbound legacy + hem alias hem sentByName null → 'Varuna'
expect('4.7 Legacy + alias yok → "Varuna"',
  computeSenderDisplay({ direction: 'outbound', source: 'manual_send', from: { name: null, address: 'destek@x.com' }, sentByUserId: null, sentByName: null }, 'u-me'),
  'Varuna');

// 4.8 currentUserId null (auth boot) — sentByUserId varsa dahi "Siz" tetiklenmez
expect('4.8 currentUserId=null → "Siz" tetiklenmez, sentByName',
  computeSenderDisplay({ direction: 'outbound', source: 'manual_send', from: { name: 'Varuna', address: 'destek@x.com' }, sentByUserId: 'u-me', sentByName: 'Demirhan İşbakan' }, null),
  'Demirhan İşbakan');

// 4.9 sentByUserId dolu ama sentByName null (silinen user senaryosu) + benim değil → alias
expect('4.9 sentByUserId dolu + sentByName null + benim değil → alias fallback',
  computeSenderDisplay({ direction: 'outbound', source: 'manual_send', from: { name: 'Varuna', address: 'destek@x.com' }, sentByUserId: 'u-deleted', sentByName: null }, 'u-me'),
  'Varuna');

console.log('\n── 5) ListPane — util import + prop ──────────');
expectTrue('5.1 mailSender import',
  /import \{ computeSenderDisplay \} from '\.\.\/lib\/mailSender'/.test(listPane));
expectTrue('5.2 currentUserId?: string | null prop',
  /currentUserId\?:\s*string\s*\|\s*null/.test(listPane));
expectTrue('5.3 computeSenderDisplay çağrısı email + currentUserId',
  /computeSenderDisplay\(e,\s*currentUserId\)/.test(listPane));
expectTrue('5.4 REGRESYON: yerel computeSenderDisplay tanımı KALKMIŞ (util tek kaynak)',
  !/function computeSenderDisplay\(email:\s*CaseEmailItem\)/.test(listPane));
expectTrue('5.5 REGRESYON: eski "Siz · <label>" string üretimi KALKMIŞ (ListPane)',
  !/Siz · \$\{label\}/.test(listPane));

console.log('\n── 6) Reader — util import + prop + header ───');
expectTrue('6.1 mailSender import',
  /import \{ computeSenderDisplay \} from '\.\.\/lib\/mailSender'/.test(reader));
expectTrue('6.2 currentUserId?: string | null prop',
  /currentUserId\?:\s*string\s*\|\s*null/.test(reader));
expectTrue('6.3 Header sender → computeSenderDisplay(email, currentUserId)',
  /computeSenderDisplay\(email,\s*currentUserId\)/.test(reader));
expectTrue('6.4 REGRESYON: header eski (email.from.name || email.from.address) KALKMIŞ',
  !/<span className="font-medium">\{email\.from\.name \|\| email\.from\.address\}<\/span>/.test(reader));
expectTrue('6.5 "ayrıntılar" içinde teknik "Kimden: <ad> <adres>" korundu (teknik ipucu)',
  /Kimden:.*email\.from\.name.*email\.from\.address/.test(reader));

console.log('\n── 7) CommunicationTab — useAuth + prop wiring ─');
expectTrue('7.1 useAuth import',
  /import \{ useAuth \} from '@\/services\/AuthContext'/.test(tab));
expectTrue('7.2 const { user } = useAuth() + currentUserId',
  /const \{ user \} = useAuth\(\)[\s\S]{0,80}const currentUserId\s*=\s*user\?\.id\s*\?\?\s*null/.test(tab));
expectTrue('7.3 ListPane iki instance currentUserId={currentUserId}',
  (tab.match(/currentUserId=\{currentUserId\}/g) ?? []).length >= 4);
// Not: 2 ListPane + 2 Reader = 4 tane currentUserId prop geçişi.

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
