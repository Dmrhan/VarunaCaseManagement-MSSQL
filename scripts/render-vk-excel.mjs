// JSON cache'ten (vk-kb-fill-results.json) Excel'i yeniden uretir — KB cagrisi YOK.
// Dosya kilitliyse otomatik alternatif isim dener.
import { PrismaClient } from '@prisma/client';
import XLSX from 'xlsx';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const prisma = new PrismaClient();
const SINCE = new Date('2026-06-10T00:00:00');
const STATUS_TR = { Cozuldu: 'Çözüldü', IptalEdildi: 'İptal Edildi' };
const fmt = (d) => d ? new Date(d).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const OPEN_COLS = [['Platform','platformLabel','platform'],['İş Süreci','businessProcessLabel','businessProcess'],['İşlem Tipi','operationTypeLabel','operationType'],['Etkilenen Nesne','affectedObjectLabel','affectedObject'],['Etki','impactLabel','impact']];
const CLOSE_COLS = [['Kök Neden Grubu','rootCauseGroupLabel','rootCauseGroup'],['Kök Neden Detayı','rootCauseDetailLabel','rootCauseDetail'],['Çözüm Tipi','resolutionTypeLabel','resolutionType'],['Kalıcı Önlem','permanentPreventionLabel','permanentPrevention']];

const cache = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts', 'vk-kb-fill-results.json'), 'utf8'));
const byId = new Map(cache.map((r) => [r.caseId, r]));

const all = await prisma.case.findMany({
  where: { caseNumber: { startsWith: 'VK' }, status: { in: ['Cozuldu', 'IptalEdildi'] } },
  select: { id: true, caseNumber: true, title: true, description: true, status: true, companyName: true, accountName: true,
    priority: true, assignedPersonName: true, createdAt: true, resolvedAt: true, updatedAt: true,
    resolutionNote: true, customFields: true },
  orderBy: [{ resolvedAt: 'desc' }],
});
const cases = all.map((c) => ({ ...c, closedAt: c.resolvedAt ?? c.updatedAt }))
  .filter((c) => c.closedAt && new Date(c.closedAt) >= SINCE);

let filledCells = 0, stillEmptyCells = 0;
const rows = cases.map((c) => {
  let st = {}; try { const cf = c.customFields ? JSON.parse(c.customFields) : {}; if (cf?.smartTicket && typeof cf.smartTicket === 'object') st = cf.smartTicket; } catch {}
  const cl = st.closure ?? {};
  const rec = byId.get(c.id) ?? { open: {}, close: {}, notes: [] };
  const row = { 'Vaka No': c.caseNumber, 'Başlık': c.title,
    'Sorun Açıklaması': (c.description ?? '').replace(/\s+/g, ' ').slice(0, 32000),
    'Durum': STATUS_TR[c.status] ?? c.status,
    'Şirket': c.companyName, 'Müşteri': c.accountName ?? '', 'Öncelik': c.priority ?? '',
    'Atanan Kişi': c.assignedPersonName ?? '', 'Açılış': fmt(c.createdAt), 'Kapanış': fmt(c.closedAt) };
  const filled = [], empty = [];
  for (const [hdr, lk, field] of OPEN_COLS) {
    const f = rec.open?.[field];
    if (f?.manual) { row[hdr] = `${f.label} (M)`; filled.push(hdr); filledCells++; }
    else if (st?.[lk]) row[hdr] = st[lk];
    else if (f?.label) { row[hdr] = `${f.label} (KB)`; filled.push(hdr); filledCells++; }
    else { row[hdr] = ''; empty.push(hdr); stillEmptyCells++; }
  }
  for (const [hdr, lk, field] of CLOSE_COLS) {
    const f = rec.close?.[field];
    if (f?.manual) { row[hdr] = `${f.label} (M)`; filled.push(hdr); filledCells++; }
    else if (cl?.[lk]) row[hdr] = cl[lk];
    else if (f?.label) { row[hdr] = `${f.label} (KB)`; filled.push(hdr); filledCells++; }
    else { row[hdr] = ''; empty.push(hdr); stillEmptyCells++; }
  }
  let cozum = (c.resolutionNote ?? '').trim();
  if (!cozum) cozum = (cl?.closureSuggestion?.reason ?? '').trim();
  if (!cozum) cozum = (st?.aiDrafts?.engineeringHandoff ?? '').trim();
  row['Çözüm Açıklaması'] = cozum.replace(/\s+/g, ' ').slice(0, 32000);
  row['Doldurma Notu'] = [filled.length ? `KB ile dolduruldu: ${filled.join(', ')}` : '',
    empty.length ? `Boş kaldı: ${empty.join(', ')}` : '',
    (rec.notes && rec.notes.length) ? `(${rec.notes.join('; ')})` : ''].filter(Boolean).join(' | ');
  return row;
});
await prisma.$disconnect();

const ws = XLSX.utils.json_to_sheet(rows);
ws['!cols'] = Object.keys(rows[0] ?? { x: 1 }).map((k) => ({ wch: k.includes('Açıklama') ? 60 : (k === 'Başlık' || k.includes('Not')) ? 45 : k === 'Müşteri' ? 26 : 17 }));
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'VK Kapali Vakalar');

const desk = path.join(os.homedir(), 'Desktop');
const candidates = ['VK-kapali-vakalar-KB-dolu.xlsx', 'VK-kapali-vakalar-KB-dolu-v2.xlsx', 'VK-kapali-vakalar-KB-dolu-v3.xlsx'];
let written = null;
for (const name of candidates) {
  try { XLSX.writeFile(wb, path.join(desk, name)); written = path.join(desk, name); break; }
  catch (e) { if (e.code !== 'EBUSY') throw e; console.log(`  (kilitli, atlandi: ${name})`); }
}
if (!written) { console.error('Tum aday dosyalar kilitli! Lutfen acik Excel pencerelerini kapatin.'); process.exit(1); }

console.log(`Vaka: ${cases.length} | KB ile dolu hucre: ${filledCells} | bos kalan hucre: ${stillEmptyCells}`);
console.log(`Excel: ${written}`);
