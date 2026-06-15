// Vaka + Akıllı Ticket taksonomi raporu (salt okunur).
// Kullanım: node --env-file=.env scripts/export-case-report.mjs [cikti.xlsx]
// Çıktı: reports/vaka-raporu-<tarih>.xlsx (tüm şirketler; Excel'de Şirket
// kolonundan filtrelenir). Taksonomiler okunabilir etiket olarak yazılır;
// Smart Ticket akışıyla açılmamış vakalarda o kolonlar boş kalır.
import { PrismaClient } from '@prisma/client';
import XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';

const prisma = new PrismaClient();

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleString('tr-TR', {
        timeZone: 'Europe/Istanbul',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      })
    : '';

const cases = await prisma.case.findMany({
  select: {
    caseNumber: true, title: true, description: true,
    companyName: true, accountName: true,
    status: true, priority: true, caseType: true,
    category: true, subCategory: true,
    assignedTeamName: true, assignedPersonName: true,
    createdAt: true, resolvedAt: true,
    resolutionNote: true, customFields: true,
  },
  orderBy: [{ companyName: 'asc' }, { createdAt: 'asc' }],
});

const rows = cases.map((c) => {
  let st = {};
  try {
    const cf = c.customFields ? JSON.parse(c.customFields) : {};
    if (cf && typeof cf.smartTicket === 'object' && cf.smartTicket) st = cf.smartTicket;
  } catch { /* bozuk JSON — taksonomi kolonları boş kalır */ }
  const cl = st.closure && typeof st.closure === 'object' ? st.closure : {};
  return {
    'Vaka No': c.caseNumber,
    'Başlık': c.title,
    'Vaka Açıklaması (Müşteri Sorunu)': c.description,
    'Şirket': c.companyName,
    'Müşteri': c.accountName ?? '',
    'Durum': c.status,
    'Öncelik': c.priority,
    'Vaka Tipi': c.caseType,
    'Kategori': c.category,
    'Alt Kategori': c.subCategory,
    'Atanan Ekip': c.assignedTeamName ?? '',
    'Atanan Kişi': c.assignedPersonName ?? '',
    'Açılış Tarihi': fmtDate(c.createdAt),
    'Çözüm Tarihi': fmtDate(c.resolvedAt),
    'Platform': st.platformLabel ?? st.platform ?? '',
    'İş Süreci': st.businessProcessLabel ?? st.businessProcess ?? '',
    'İşlem Tipi': st.operationTypeLabel ?? st.operationType ?? '',
    'Etkilenen Nesne': st.affectedObjectLabel ?? st.affectedObject ?? '',
    'Etki': st.impactLabel ?? st.impact ?? '',
    'Kök Neden Grubu': cl.rootCauseGroupLabel ?? cl.rootCauseGroup ?? '',
    'Kök Neden Detayı': cl.rootCauseDetailLabel ?? cl.rootCauseDetail ?? '',
    'Çözüm Tipi': cl.resolutionTypeLabel ?? cl.resolutionType ?? '',
    'Kalıcı Önlem': cl.permanentPreventionLabel ?? cl.permanentPrevention ?? '',
    'Çözüm Açıklaması': c.resolutionNote ?? '',
  };
});

const ws = XLSX.utils.json_to_sheet(rows);
// Başlık satırına filtre + makul kolon genişlikleri
const headers = Object.keys(rows[0] ?? {});
ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: headers.length - 1 } }) };
ws['!cols'] = headers.map((h) => ({
  wch: ['Başlık', 'Vaka Açıklaması (Müşteri Sorunu)', 'Çözüm Açıklaması'].includes(h) ? 60 : Math.max(h.length + 2, 14),
}));

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Vakalar');

const stamp = new Date().toISOString().slice(0, 10);
const outPath = process.argv[2] ?? path.resolve('reports', `vaka-raporu-${stamp}.xlsx`);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
XLSX.writeFile(wb, outPath);

const stCount = rows.filter((r) => r['Platform']).length;
const clCount = rows.filter((r) => r['Kök Neden Grubu']).length;
console.log(`Yazildi: ${outPath}`);
console.log(`Toplam ${rows.length} vaka | Akilli Ticket acilis dolu: ${stCount} | Kapanis dolu: ${clCount}`);

await prisma.$disconnect();
