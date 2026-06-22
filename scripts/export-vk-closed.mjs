// VK ile baslayan KAPALI vakalar (Cozuldu+IptalEdildi), kapanis >= 10.06.2026.
// Bos kategori alanlarini vakanin kendi customFields'indaki KAYITLI KB onerisinden
// doldurur (kod->label veya ham metin), "(KB)" isaretiyle. DB'YE YAZMAZ — salt Excel.
import { PrismaClient } from '@prisma/client';
import XLSX from 'xlsx';
import path from 'node:path';
import os from 'node:os';

const prisma = new PrismaClient();
const SINCE = new Date('2026-06-10T00:00:00');
const STATUS_TR = { Cozuldu: 'Çözüldü', IptalEdildi: 'İptal Edildi' };
const fmt = (d) => d ? new Date(d).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

// Taksonomi kod -> label haritasi (suggestedCode'u okunur etikete cevirmek icin)
const tax = await prisma.taxonomyDef.findMany({ select: { code: true, label: true } });
const codeToLabel = new Map();
for (const t of tax) if (!codeToLabel.has(t.code)) codeToLabel.set(t.code, t.label);

// Kolon basligi -> [label anahtari, oneri alan adi, kapanis mi]
const OPEN = [
  ['Platform','platformLabel','platform',false],
  ['İş Süreci','businessProcessLabel','businessProcess',false],
  ['İşlem Tipi','operationTypeLabel','operationType',false],
  ['Etkilenen Nesne','affectedObjectLabel','affectedObject',false],
  ['Etki','impactLabel','impact',false],
];
const CLOSE = [
  ['Kök Neden Grubu','rootCauseGroupLabel','rootCauseGroup',true],
  ['Kök Neden Detayı','rootCauseDetailLabel','rootCauseDetail',true],
  ['Çözüm Tipi','resolutionTypeLabel','resolutionType',true],
  ['Kalıcı Önlem','permanentPreventionLabel','permanentPrevention',true],
];
const FIELDS = [...OPEN, ...CLOSE];

// Bir alan icin kayitli KB onerisinden deger uret
function fromSuggestion(st, fieldName, isClose) {
  const sug = isClose ? st?.closure?.closureSuggestion : st?.classificationSuggestion;
  if (!sug) return null;
  const code = sug?.perField?.[fieldName]?.suggestedCode;
  if (code && codeToLabel.has(code)) return { val: codeToLabel.get(code), kind: 'kod' };
  const um = (sug?.unmatched || []).find((u) => u?.taxonomyType === fieldName);
  if (um?.rawValue) return { val: String(um.rawValue), kind: 'ham' };
  if (code) return { val: code, kind: 'kod' };
  return null;
}

const all = await prisma.case.findMany({
  where: { caseNumber: { startsWith: 'VK' }, status: { in: ['Cozuldu', 'IptalEdildi'] } },
  select: { caseNumber: true, title: true, status: true, companyName: true, accountName: true,
    priority: true, assignedPersonName: true, createdAt: true, resolvedAt: true, updatedAt: true,
    resolutionNote: true, customFields: true },
  orderBy: [{ resolvedAt: 'desc' }],
});
const filtered = all.map((c) => ({ ...c, closedAt: c.resolvedAt ?? c.updatedAt }))
  .filter((c) => c.closedAt && new Date(c.closedAt) >= SINCE);

let kbFilled = 0, stillEmpty = 0, fullyEmptyCases = 0;
const rows = filtered.map((c) => {
  let st = {}; try { const cf = c.customFields ? JSON.parse(c.customFields) : {}; if (cf?.smartTicket && typeof cf.smartTicket === 'object') st = cf.smartTicket; } catch {}
  const cl = st.closure ?? {};
  const row = { 'Vaka No': c.caseNumber, 'Başlık': c.title, 'Durum': STATUS_TR[c.status] ?? c.status,
    'Şirket': c.companyName, 'Müşteri': c.accountName ?? '', 'Öncelik': c.priority ?? '',
    'Atanan Kişi': c.assignedPersonName ?? '', 'Açılış': fmt(c.createdAt), 'Kapanış': fmt(c.closedAt) };
  const filledHere = [], emptyHere = [];
  for (const [hdr, labelKey, fieldName, isClose] of FIELDS) {
    const src = isClose ? cl : st;
    let v = src?.[labelKey];
    if (v) { row[hdr] = v; continue; }
    const sug = fromSuggestion(st, fieldName, isClose);
    if (sug) { row[hdr] = `${sug.val} (KB)`; filledHere.push(hdr); kbFilled++; }
    else { row[hdr] = ''; emptyHere.push(hdr); stillEmpty++; }
  }
  if (emptyHere.length === FIELDS.length) fullyEmptyCases++;
  row['Çözüm Notu'] = (c.resolutionNote ?? '').replace(/\s+/g, ' ').slice(0, 1000);
  row['Doldurma Notu'] = [
    filledHere.length ? `KB önerisinden: ${filledHere.join(', ')}` : '',
    emptyHere.length ? `Boş kaldı: ${emptyHere.join(', ')}` : '',
  ].filter(Boolean).join(' | ');
  return row;
});

const ws = XLSX.utils.json_to_sheet(rows);
ws['!cols'] = Object.keys(rows[0] ?? {x:1}).map((k) => ({ wch: k === 'Başlık' || k.includes('Not') ? 45 : k === 'Müşteri' ? 26 : 17 }));
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'VK Kapali Vakalar');
const out = path.join(os.homedir(), 'Desktop', 'VK-kapali-vakalar-dolduruldu.xlsx');
XLSX.writeFile(wb, out);
await prisma.$disconnect();

console.log(`Vaka sayisi: ${filtered.length}`);
console.log(`KB onerisinden doldurulan hucre: ${kbFilled}`);
console.log(`Hala bos kalan hucre: ${stillEmpty}`);
console.log(`Hicbir Smart Ticket verisi olmayan (tamamen bos) vaka: ${fullyEmptyCases}`);
console.log(`\nExcel: ${out}`);
