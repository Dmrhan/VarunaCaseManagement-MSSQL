// Bos kalan (vaka, alan) ciftlerini, vaka baglamini ve secilebilir taksonomi
// seceneklerini doker. Manuel doldurma karari icin. KB cagrisi YOK.
import { PrismaClient } from '@prisma/client';
import path from 'node:path';
import fs from 'node:fs';

const prisma = new PrismaClient();
const SINCE = new Date('2026-06-10T00:00:00');
const OPEN_COLS = [['Platform','platformLabel','platform'],['İş Süreci','businessProcessLabel','businessProcess'],['İşlem Tipi','operationTypeLabel','operationType'],['Etkilenen Nesne','affectedObjectLabel','affectedObject'],['Etki','impactLabel','impact']];
const CLOSE_COLS = [['Kök Neden Grubu','rootCauseGroupLabel','rootCauseGroup'],['Kök Neden Detayı','rootCauseDetailLabel','rootCauseDetail'],['Çözüm Tipi','resolutionTypeLabel','resolutionType'],['Kalıcı Önlem','permanentPreventionLabel','permanentPrevention']];

const cache = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts', 'vk-kb-fill-results.json'), 'utf8'));
const byId = new Map(cache.map((r) => [r.caseId, r]));

const tax = await prisma.taxonomyDef.findMany({ where: { companyId: 'COMP-UNIVERA', isActive: true },
  select: { id: true, taxonomyType: true, code: true, label: true, parentId: true } });
const byType = {}; for (const t of tax) (byType[t.taxonomyType] ??= []).push(t);
const childrenOf = (parentId) => tax.filter((t) => t.parentId === parentId);

const all = await prisma.case.findMany({
  where: { caseNumber: { startsWith: 'VK' }, status: { in: ['Cozuldu', 'IptalEdildi'] } },
  select: { id: true, caseNumber: true, title: true, status: true, description: true, resolutionNote: true, customFields: true, resolvedAt: true, updatedAt: true },
  orderBy: [{ resolvedAt: 'desc' }] });
const cases = all.map((c) => ({ ...c, closedAt: c.resolvedAt ?? c.updatedAt })).filter((c) => c.closedAt && new Date(c.closedAt) >= SINCE);

// efektif deger: orijinal label || KB cache
function effOpen(st, rec, field, lk) { return st?.[lk] || rec?.open?.[field]?.label || ''; }
function effClose(cl, rec, field, lk) { return cl?.[lk] || rec?.close?.[field]?.label || ''; }

const out = [];
for (const c of cases) {
  let st = {}; try { const cf = c.customFields ? JSON.parse(c.customFields) : {}; st = cf?.smartTicket ?? {}; } catch {}
  const cl = st.closure ?? {};
  const rec = byId.get(c.id) ?? { open: {}, close: {} };
  const emptyOpen = OPEN_COLS.filter(([, lk, f]) => !effOpen(st, rec, f, lk));
  const emptyClose = CLOSE_COLS.filter(([, lk, f]) => !effClose(cl, rec, f, lk));
  if (!emptyOpen.length && !emptyClose.length) continue;
  // efektif rootCauseGroup (detay secenekleri icin parent)
  const effRcg = effClose(cl, rec, 'rootCauseGroup', 'rootCauseGroupLabel');
  const rcgNode = (byType.rootCauseGroup || []).find((g) => g.label === effRcg);
  out.push({
    no: c.caseNumber, status: c.status,
    title: c.title,
    desc: (c.description || '').replace(/\s+/g, ' ').slice(0, 600),
    res: (c.resolutionNote || '').replace(/\s+/g, ' ').slice(0, 600),
    mevcut: {
      Platform: effOpen(st, rec, 'platform', 'platformLabel'),
      'İş Süreci': effOpen(st, rec, 'businessProcess', 'businessProcessLabel'),
      'İşlem Tipi': effOpen(st, rec, 'operationType', 'operationTypeLabel'),
      'Etkilenen Nesne': effOpen(st, rec, 'affectedObject', 'affectedObjectLabel'),
      Etki: effOpen(st, rec, 'impact', 'impactLabel'),
      'Kök Neden Grubu': effRcg,
      'Kök Neden Detayı': effClose(cl, rec, 'rootCauseDetail', 'rootCauseDetailLabel'),
      'Çözüm Tipi': effClose(cl, rec, 'resolutionType', 'resolutionTypeLabel'),
      'Kalıcı Önlem': effClose(cl, rec, 'permanentPrevention', 'permanentPreventionLabel'),
    },
    bos: [...emptyOpen.map(([h]) => h), ...emptyClose.map(([h]) => h)],
    rcgNode: rcgNode ? rcgNode.label : null,
  });
}
await prisma.$disconnect();

// Taksonomi secenek listeleri (label only)
const opts = {
  Platform: (byType.platform || []).map((t) => t.label),
  'İş Süreci': (byType.businessProcess || []).map((t) => t.label),
  'İşlem Tipi': (byType.operationType || []).map((t) => t.label),
  'Etkilenen Nesne': (byType.affectedObject || []).map((t) => t.label),
  Etki: (byType.impact || []).map((t) => t.label),
  'Kök Neden Grubu': (byType.rootCauseGroup || []).map((t) => t.label),
  'Çözüm Tipi': (byType.resolutionType || []).map((t) => t.label),
  'Kalıcı Önlem': (byType.permanentPrevention || []).map((t) => t.label),
};
console.log('=== BOS HUCRELI VAKALAR (' + out.length + ') ===\n');
for (const r of out) {
  console.log(`### ${r.no} [${r.status}]  BOS: ${r.bos.join(', ')}`);
  console.log(`Baslik: ${r.title}`);
  console.log(`Aciklama: ${r.desc}`);
  console.log(`Cozum: ${r.res || '(yok)'}`);
  console.log(`Mevcut: ${Object.entries(r.mevcut).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' | ')}`);
  if (r.bos.includes('Kök Neden Detayı')) {
    const kids = r.rcgNode ? childrenOf((byType.rootCauseGroup || []).find((g) => g.label === r.rcgNode)?.id).map((t) => t.label) : [];
    console.log(`  >> Kök Neden Detayı secenekleri (grup='${r.rcgNode || 'YOK'}'): ${kids.length ? kids.join(' / ') : '(grup yok — once grubu sec)'}`);
  }
  console.log('');
}
console.log('=== TAKSONOMI SECENEKLERI ===');
for (const [k, v] of Object.entries(opts)) console.log(`${k}: ${v.join(' / ')}`);
