// VK kapali vakalarda BOS kalan acilis/kapanis kategori alanlarini YENI KB
// cagrisiyla doldurur. Route mantiginin (suggest-classification / suggest-closure)
// birebir kopyasi. SALT-OKUNUR: DB'ye yazmaz; sonuclari Excel + JSON cache'e doker.
// JSON cache: kullanici Excel'i onayladiktan sonra apply-vk-kb.mjs DB'yi
// yeniden cagri yapmadan gunceller.
import { PrismaClient } from '@prisma/client';
import XLSX from 'xlsx';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { externalKbClient } from '../server/lib/externalKbClient.js';
import { externalKbSettingRepo } from '../server/db/externalKbSettingRepository.js';
import { extractClassificationFromKb, mapClassificationToTaxonomy } from '../server/lib/smartTicketClassification.js';

const prisma = new PrismaClient();
const SINCE = new Date('2026-06-10T00:00:00');
const STATUS_TR = { Cozuldu: 'Çözüldü', IptalEdildi: 'İptal Edildi' };
const fmt = (d) => d ? new Date(d).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── route'tan kopyalanan yardimcilar ────────────────────────────────
function normalizeLabel(text) {
  if (typeof text !== 'string') return '';
  return text.normalize('NFC').toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c')
    .replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function matchByLabel(list, rawLabel) {
  if (!rawLabel) return null;
  const target = normalizeLabel(rawLabel);
  if (!target) return null;
  return list.find((t) => normalizeLabel(t.label) === target) ?? null;
}
const OPEN_TYPES = ['platform', 'businessProcess', 'operationType', 'affectedObject', 'impact'];
const CLOSE_TYPES = ['rootCauseGroup', 'rootCauseDetail', 'resolutionType', 'permanentPrevention'];
async function loadOpenTax(companyId) {
  const rows = await prisma.taxonomyDef.findMany({
    where: { companyId, isActive: true, taxonomyType: { in: OPEN_TYPES } },
    select: { taxonomyType: true, code: true, label: true, isActive: true, sortOrder: true, metadata: true },
    orderBy: [{ taxonomyType: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
  });
  const out = {}; for (const t of OPEN_TYPES) out[t] = [];
  for (const r of rows) out[r.taxonomyType].push(r); return out;
}
async function loadCloseTax(companyId) {
  const rows = await prisma.taxonomyDef.findMany({
    where: { companyId, isActive: true, taxonomyType: { in: CLOSE_TYPES } },
    select: { id: true, taxonomyType: true, code: true, label: true, parentId: true, metadata: true },
    orderBy: [{ taxonomyType: 'asc' }, { sortOrder: 'asc' }],
  });
  const out = { rootCauseGroup: [], rootCauseDetail: [], resolutionType: [], permanentPrevention: [] };
  for (const r of rows) out[r.taxonomyType].push(r); return out;
}
const STEP_LABEL = { suggested: 'Önerildi', tried: 'Denendi', worked: 'İşe yaradı', not_worked: 'İşe yaramadı', skipped: 'Uygun değil' };
function composeResolution(workedStep, allSteps) {
  const lines = [];
  if (workedStep) {
    const parts = [`[ÇÖZÜLEN ADIM] ${workedStep.title}`];
    if (workedStep.description) parts.push(workedStep.description);
    if (workedStep.note) parts.push(`Not: ${workedStep.note}`);
    lines.push(parts.join(' — '));
  }
  const others = (allSteps || []).filter((s) => !workedStep || s.id !== workedStep.id);
  if (others.length) { lines.push('', 'Diğer denenen adımlar:');
    for (const s of others) lines.push(`- ${s.title} — ${STEP_LABEL[s.status] ?? s.status}${s.note ? ` (Not: ${s.note})` : ''}`); }
  return lines.join('\n');
}

// ── Excel kolon tanimi ──────────────────────────────────────────────
const OPEN_COLS = [['Platform','platformLabel','platform'],['İş Süreci','businessProcessLabel','businessProcess'],['İşlem Tipi','operationTypeLabel','operationType'],['Etkilenen Nesne','affectedObjectLabel','affectedObject'],['Etki','impactLabel','impact']];
const CLOSE_COLS = [['Kök Neden Grubu','rootCauseGroupLabel','rootCauseGroup'],['Kök Neden Detayı','rootCauseDetailLabel','rootCauseDetail'],['Çözüm Tipi','resolutionTypeLabel','resolutionType'],['Kalıcı Önlem','permanentPreventionLabel','permanentPrevention']];

const settingCache = new Map();
async function getSetting(companyId) {
  if (!settingCache.has(companyId)) settingCache.set(companyId, await externalKbSettingRepo.getByCompany(companyId));
  return settingCache.get(companyId);
}

// ── vakalari cek ────────────────────────────────────────────────────
const all = await prisma.case.findMany({
  where: { caseNumber: { startsWith: 'VK' }, status: { in: ['Cozuldu', 'IptalEdildi'] } },
  select: { id: true, caseNumber: true, title: true, status: true, companyId: true, companyName: true,
    accountName: true, priority: true, assignedPersonName: true, createdAt: true, resolvedAt: true,
    updatedAt: true, description: true, resolutionNote: true, customFields: true },
  orderBy: [{ resolvedAt: 'desc' }],
});
let cases = all.map((c) => ({ ...c, closedAt: c.resolvedAt ?? c.updatedAt }))
  .filter((c) => c.closedAt && new Date(c.closedAt) >= SINCE);
// Test/parca calistirma: yalniz eksigi olanlari one al, opsiyonel limit.
cases.sort((a, b) => {
  const miss = (x) => { let st = {}; try { const cf = x.customFields ? JSON.parse(x.customFields) : {}; st = cf?.smartTicket ?? {}; } catch {} const cl = st.closure ?? {};
    let n = 0; for (const [, lk] of OPEN_COLS) if (!st?.[lk]) n++; for (const [, lk] of CLOSE_COLS) if (!cl?.[lk]) n++; return n; };
  return miss(b) - miss(a);
});
if (process.env.VK_LIMIT) cases = cases.slice(0, Number(process.env.VK_LIMIT));

const results = []; // DB apply icin cache
const rows = [];
let kbOpenCalls = 0, kbCloseCalls = 0, filledCells = 0, failedCases = 0;

for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  let st = {}; try { const cf = c.customFields ? JSON.parse(c.customFields) : {}; if (cf?.smartTicket && typeof cf.smartTicket === 'object') st = cf.smartTicket; } catch {}
  const cl = st.closure ?? {};
  const row = { 'Vaka No': c.caseNumber, 'Başlık': c.title, 'Durum': STATUS_TR[c.status] ?? c.status,
    'Şirket': c.companyName, 'Müşteri': c.accountName ?? '', 'Öncelik': c.priority ?? '',
    'Atanan Kişi': c.assignedPersonName ?? '', 'Açılış': fmt(c.createdAt), 'Kapanış': fmt(c.closedAt) };

  // mevcut degerler + eksik tespiti
  const curOpen = {}, curClose = {};
  const missOpen = [], missClose = [];
  for (const [, lk, field] of OPEN_COLS) { curOpen[field] = st?.[lk] || ''; if (!curOpen[field]) missOpen.push(field); }
  for (const [, lk, field] of CLOSE_COLS) { curClose[field] = cl?.[lk] || ''; if (!curClose[field]) missClose.push(field); }

  const rec = { caseId: c.id, caseNumber: c.caseNumber, companyId: c.companyId, open: {}, close: {}, notes: [] };
  const filledHere = [], stillEmpty = [];
  const desc = (c.description || '').trim();
  const setting = await getSetting(c.companyId);
  const kbReady = setting?.enabled && desc.length >= 5;

  // ── ACILIS ──
  if (missOpen.length && kbReady) {
    try {
      kbOpenCalls++;
      let kb = await externalKbClient.categorizeV2(setting, { description: desc });
      if (kb?.ok === false) kb = await externalKbClient.analyze(setting, { freeText: desc });
      if (kb?.ok !== false) {
        const raw = extractClassificationFromKb(kb);
        const tax = await loadOpenTax(c.companyId);
        const { suggestions } = mapClassificationToTaxonomy(raw, tax);
        for (const field of missOpen) {
          const s = suggestions[field];
          if (s?.label) { rec.open[field] = { code: s.code, label: s.label }; }
        }
      } else { rec.notes.push('acilis KB hata: ' + (kb.error?.code ?? '?')); }
    } catch (e) { rec.notes.push('acilis exception: ' + (e?.message ?? e)); }
  }

  // ── KAPANIS ──
  if (missClose.length && kbReady) {
    let resolution = (c.resolutionNote || '').trim();
    if (resolution.length < 5) {
      const steps = await prisma.caseSolutionStep.findMany({ where: { caseId: c.id }, orderBy: { stepIndex: 'asc' },
        select: { id: true, title: true, description: true, status: true, note: true, outcomeAt: true } });
      const worked = steps.filter((s) => s.status === 'worked' && s.outcomeAt).sort((a, b) => new Date(b.outcomeAt) - new Date(a.outcomeAt))[0] ?? steps.find((s) => s.status === 'worked') ?? null;
      resolution = composeResolution(worked, steps);
    }
    if (resolution.trim().length >= 5) {
      try {
        kbCloseCalls++;
        const sgBody = { description: desc, resolution };
        if (st?.platformLabel) sgBody.open_urun = st.platformLabel;
        if (st?.businessProcessLabel) sgBody.open_is_sureci = st.businessProcessLabel;
        if (st?.operationTypeLabel) sgBody.open_islem_tipi = st.operationTypeLabel;
        const kb = await externalKbClient.suggestClose(setting, sgBody);
        if (kb?.ok !== false) {
          const payload = kb?.data && typeof kb.data === 'object' ? kb.data : (kb ?? {});
          const tax = await loadCloseTax(c.companyId);
          const rcg = matchByLabel(tax.rootCauseGroup, payload.kok_neden_grubu);
          const rcdCand = rcg ? tax.rootCauseDetail.filter((d) => d.parentId === rcg.id) : tax.rootCauseDetail;
          const matches = {
            rootCauseGroup: rcg,
            rootCauseDetail: matchByLabel(rcdCand, payload.kok_neden_detayi),
            resolutionType: matchByLabel(tax.resolutionType, payload.cozum_tipi),
            permanentPrevention: matchByLabel(tax.permanentPrevention, payload.kalici_onlem),
          };
          for (const field of missClose) {
            const m = matches[field];
            if (m?.label) rec.close[field] = { code: m.code, label: m.label };
          }
        } else { rec.notes.push('kapanis KB hata: ' + (kb.error?.code ?? '?')); }
      } catch (e) { rec.notes.push('kapanis exception: ' + (e?.message ?? e)); }
    } else { rec.notes.push('kapanis atlandi: resolution<5'); }
  }
  if (!kbReady) rec.notes.push(setting?.enabled ? 'aciklama<5 — KB atlandi' : 'KB disabled');

  // Excel satiri: mevcut + KB ile dolan
  for (const [hdr, , field] of OPEN_COLS) {
    if (curOpen[field]) { row[hdr] = curOpen[field]; }
    else if (rec.open[field]) { row[hdr] = `${rec.open[field].label} (KB)`; filledHere.push(hdr); filledCells++; }
    else { row[hdr] = ''; stillEmpty.push(hdr); }
  }
  for (const [hdr, , field] of CLOSE_COLS) {
    if (curClose[field]) { row[hdr] = curClose[field]; }
    else if (rec.close[field]) { row[hdr] = `${rec.close[field].label} (KB)`; filledHere.push(hdr); filledCells++; }
    else { row[hdr] = ''; stillEmpty.push(hdr); }
  }
  if (rec.notes.length) failedCases++;
  row['Çözüm Notu'] = (c.resolutionNote ?? '').replace(/\s+/g, ' ').slice(0, 1000);
  row['Doldurma Notu'] = [filledHere.length ? `KB ile dolduruldu: ${filledHere.join(', ')}` : '',
    stillEmpty.length ? `Boş kaldı: ${stillEmpty.join(', ')}` : '',
    rec.notes.length ? `(${rec.notes.join('; ')})` : ''].filter(Boolean).join(' | ');
  rows.push(row);
  results.push(rec);
  console.log(`[${i + 1}/${cases.length}] ${c.caseNumber}  dolan:${filledHere.length} bos:${stillEmpty.length} ${rec.notes.length ? 'NOT:' + rec.notes.join(',') : ''}`);
}

// JSON cache (DB apply icin)
fs.writeFileSync(path.join(process.cwd(), 'scripts', 'vk-kb-fill-results.json'), JSON.stringify(results, null, 2));

// Excel
const ws = XLSX.utils.json_to_sheet(rows);
ws['!cols'] = Object.keys(rows[0] ?? { x: 1 }).map((k) => ({ wch: k === 'Başlık' || k.includes('Not') ? 45 : k === 'Müşteri' ? 26 : 17 }));
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'VK Kapali Vakalar');
const out = path.join(os.homedir(), 'Desktop', 'VK-kapali-vakalar-KB-dolu.xlsx');
XLSX.writeFile(wb, out);
await prisma.$disconnect();

console.log(`\n=== OZET ===`);
console.log(`Vaka: ${cases.length} | acilis KB cagrisi: ${kbOpenCalls} | kapanis KB cagrisi: ${kbCloseCalls}`);
console.log(`KB ile doldurulan hucre: ${filledCells} | not/hata olan vaka: ${failedCases}`);
console.log(`Excel: ${out}`);
console.log(`JSON cache: scripts/vk-kb-fill-results.json`);
