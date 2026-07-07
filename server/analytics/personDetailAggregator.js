/**
 * Performans Panosu FAZ 2a — Kişi Uzmanlık Profili veri motoru.
 *
 * Tek kişinin drill-down profili: neyde uzman (kategori dağılımı + konu-içi hız),
 * en çok karşılaştığı sorunlar (subCategory), çalıştığı ürün, en uzun işleri,
 * nasıl çözüyor (kapanış imzası: rootCause/resolutionType/permanentPrevention),
 * ve günlük çözüm-süresi trendi.
 *
 * Güvenlik: her sorgu companyId IN (allowedCompanyIds) + assignedPersonId=@p +
 * isArchived=0 ile scoped. Route katmanı kişinin scope içinde olduğunu ayrıca
 * doğrular. PII: başlık dışında müşteri PII'si payload'a girmez (longestCases
 * yalnız caseNumber/title/taksonomi/süre — Case.customerContact* YOK).
 *
 * Median: PERCENTILE_CONT window (PARTITION BY) + dış GROUP BY MIN deseni
 * (queryByPerson ile aynı; MSSQL native).
 */
import { prisma } from '../db/client.js';
import { MIN_SAMPLE } from './metricFormulas.js';

const OPEN_STATUS_DB = ['Acik', 'Incelemede', 'ThirdPartyWaiting', 'Eskalasyon', 'YenidenAcildi'];

// Pozisyonel param bağlayıcı (@P1..). companyIds + [ekstra] sırayla.
function bind(companyIds, extra = []) {
  const params = [...companyIds, ...extra];
  const companyList = companyIds.map((_, i) => `@P${i + 1}`).join(', ');
  const at = (offsetFromEnd) => `@P${companyIds.length + offsetFromEnd}`; // 1-tabanlı ekstra
  return { params, companyList, at };
}

// Ortak resolved-in-period WHERE (companyList + person=@pIdx + from=@fIdx + to=@tIdx)
function resolvedWhere(companyList, pIdx, fIdx, tIdx) {
  return `[companyId] IN (${companyList}) AND [assignedPersonId] = ${pIdx}
    AND [isArchived] = 0 AND [resolvedAt] >= ${fIdx} AND [resolvedAt] < ${tIdx}
    AND [resolvedAt] > [createdAt]`;
}

// 1) Uzmanlık — kişi kategori dağılımı + konu-içi median (+ ekip median ayrı sorgu)
async function queryExpertise(companyIds, personId, from, to) {
  const b = bind(companyIds, [personId, from, to]);
  const P = `@P${companyIds.length + 1}`, F = `@P${companyIds.length + 2}`, T = `@P${companyIds.length + 3}`;
  const mine = await prisma.$queryRawUnsafe(`
    SELECT [category] AS cat, COUNT(*) AS cnt, MIN(med) AS med FROM (
      SELECT [category],
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CAST(DATEDIFF(SECOND,[createdAt],[resolvedAt]) AS float)/3600.0)
          OVER (PARTITION BY [category]) AS med
      FROM [Case] WHERE ${resolvedWhere(b.companyList, P, F, T)}
    ) x GROUP BY [category] ORDER BY cnt DESC;`, ...b.params);
  // Ekip median per kategori (aynı scope, tüm kişiler)
  const bt = bind(companyIds, [from, to]);
  const F2 = `@P${companyIds.length + 1}`, T2 = `@P${companyIds.length + 2}`;
  const team = await prisma.$queryRawUnsafe(`
    SELECT [category] AS cat, MIN(med) AS med FROM (
      SELECT [category],
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CAST(DATEDIFF(SECOND,[createdAt],[resolvedAt]) AS float)/3600.0)
          OVER (PARTITION BY [category]) AS med
      FROM [Case] WHERE [companyId] IN (${bt.companyList}) AND [isArchived]=0
        AND [resolvedAt] >= ${F2} AND [resolvedAt] < ${T2} AND [resolvedAt] > [createdAt]
        AND [assignedPersonId] IS NOT NULL
    ) x GROUP BY [category];`, ...bt.params);
  const teamMed = new Map(team.map((r) => [r.cat, r.med == null ? null : Number(r.med)]));
  const total = mine.reduce((s, r) => s + Number(r.cnt), 0) || 1;
  return mine.slice(0, 8).map((r) => {
    const cnt = Number(r.cnt);
    const med = r.med == null ? null : Math.round(Number(r.med) * 10) / 10;
    const tmed = teamMed.get(r.cat) ?? null;
    // Uzman = yeterli hacim (≥ MIN_SAMPLE.default) VE ekipten belirgin hızlı (>%20)
    let tag = 'normal', fasterPct = null;
    if (med != null && tmed != null && tmed > 0) {
      // Sıfıra yakın ekip medyanında oran patlar; sunulabilir aralığa clamp.
      fasterPct = Math.max(-99, Math.min(99, Math.round(((tmed - med) / tmed) * 100)));
    }
    if (cnt >= MIN_SAMPLE.default && fasterPct != null && fasterPct >= 20) tag = 'expert';
    else if (cnt >= MIN_SAMPLE.default) tag = 'solid';
    return { category: r.cat, count: cnt, sharePct: Math.round((cnt / total) * 100), medianHours: med, teamMedianHours: tmed, fasterPct, tag };
  });
}

// 2) En çok karşılaştığı sorunlar — subCategory
async function queryProblems(companyIds, personId, from, to) {
  const b = bind(companyIds, [personId, from, to]);
  const P = `@P${companyIds.length + 1}`, F = `@P${companyIds.length + 2}`, T = `@P${companyIds.length + 3}`;
  const rows = await prisma.$queryRawUnsafe(`
    SELECT TOP 6 [subCategory] AS sub, COUNT(*) AS cnt
    FROM [Case] WHERE ${resolvedWhere(b.companyList, P, F, T)}
    GROUP BY [subCategory] ORDER BY cnt DESC;`, ...b.params);
  return rows.map((r) => ({ subCategory: r.sub, count: Number(r.cnt) }));
}

// 3) Çalıştığı ürün/modül — productName
async function queryProducts(companyIds, personId, from, to) {
  const b = bind(companyIds, [personId, from, to]);
  const P = `@P${companyIds.length + 1}`, F = `@P${companyIds.length + 2}`, T = `@P${companyIds.length + 3}`;
  const rows = await prisma.$queryRawUnsafe(`
    SELECT TOP 5 [productName] AS prod, COUNT(*) AS cnt
    FROM [Case] WHERE ${resolvedWhere(b.companyList, P, F, T)} AND [productName] IS NOT NULL
    GROUP BY [productName] ORDER BY cnt DESC;`, ...b.params);
  const total = rows.reduce((s, r) => s + Number(r.cnt), 0) || 1;
  return rows.map((r) => ({ product: r.prod, count: Number(r.cnt), sharePct: Math.round((Number(r.cnt) / total) * 100) }));
}

// 4) En uzun süren işleri (PII yok — başlık + taksonomi + süre)
async function queryLongestCases(companyIds, personId, from, to) {
  const b = bind(companyIds, [personId, from, to]);
  const P = `@P${companyIds.length + 1}`, F = `@P${companyIds.length + 2}`, T = `@P${companyIds.length + 3}`;
  const rows = await prisma.$queryRawUnsafe(`
    SELECT TOP 5 [id], [caseNumber], [title], [category], [subCategory], [status],
      CAST(DATEDIFF(SECOND,[createdAt],[resolvedAt]) AS float)/3600.0 AS hrs
    FROM [Case] WHERE ${resolvedWhere(b.companyList, P, F, T)}
    ORDER BY hrs DESC;`, ...b.params);
  return rows.map((r) => ({
    id: r.id, caseNumber: r.caseNumber, title: r.title,
    category: r.category, subCategory: r.subCategory,
    hours: Math.round(Number(r.hrs) * 10) / 10,
    reopened: r.status === 'YenidenAcildi',
  }));
}

// 5) Çözüm imzası — kapanış etiketleri (rootCause/resolutionType top + permanentPrevention oranı)
async function querySolutionSignature(companyIds, personId, from, to) {
  const b = bind(companyIds, [personId, from, to]);
  const P = `@P${companyIds.length + 1}`, F = `@P${companyIds.length + 2}`, T = `@P${companyIds.length + 3}`;
  const where = resolvedWhere(b.companyList, P, F, T);
  const topOf = async (field) => {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT TOP 3 JSON_VALUE([customFields],'$.smartTicket.closure.${field}') AS code,
        MAX(JSON_VALUE([customFields],'$.smartTicket.closure.${field}Label')) AS label,
        COUNT(*) AS cnt
      FROM [Case] WHERE ${where} AND JSON_VALUE([customFields],'$.smartTicket.closure.${field}') IS NOT NULL
      GROUP BY JSON_VALUE([customFields],'$.smartTicket.closure.${field}') ORDER BY cnt DESC;`, ...b.params);
    const total = rows.reduce((s, r) => s + Number(r.cnt), 0);
    return rows.map((r) => ({ code: r.code, label: r.label ?? r.code, count: Number(r.cnt), pct: total ? Math.round((Number(r.cnt) / total) * 100) : 0 }));
  };
  const rootCause = await topOf('rootCauseGroup');
  const resolutionType = await topOf('resolutionType');
  // permanentPrevention oranı: kişi vs ekip
  const ppMine = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS total, SUM(CASE WHEN JSON_VALUE([customFields],'$.smartTicket.closure.permanentPrevention') IS NOT NULL THEN 1 ELSE 0 END) AS pp
    FROM [Case] WHERE ${where};`, ...b.params);
  const bt = bind(companyIds, [from, to]);
  const F2 = `@P${companyIds.length + 1}`, T2 = `@P${companyIds.length + 2}`;
  const ppTeam = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS total, SUM(CASE WHEN JSON_VALUE([customFields],'$.smartTicket.closure.permanentPrevention') IS NOT NULL THEN 1 ELSE 0 END) AS pp
    FROM [Case] WHERE [companyId] IN (${bt.companyList}) AND [isArchived]=0
      AND [resolvedAt] >= ${F2} AND [resolvedAt] < ${T2} AND [resolvedAt] > [createdAt] AND [assignedPersonId] IS NOT NULL;`, ...bt.params);
  const pctOf = (r) => Number(r.total) > 0 ? Math.round((Number(r.pp) / Number(r.total)) * 100) : null;
  return {
    rootCause, resolutionType,
    permanentPreventionPct: pctOf(ppMine[0]),
    teamPermanentPreventionPct: pctOf(ppTeam[0]),
  };
}

// 6) Günlük çözüm-süresi trendi — gün başına count + median (7g yürüyen JS'te)
async function queryDailyTrend(companyIds, personId, from, to) {
  const b = bind(companyIds, [personId, from, to]);
  const P = `@P${companyIds.length + 1}`, F = `@P${companyIds.length + 2}`, T = `@P${companyIds.length + 3}`;
  const rows = await prisma.$queryRawUnsafe(`
    SELECT d, COUNT(*) AS cnt, MIN(med) AS med FROM (
      SELECT CAST([resolvedAt] AS date) AS d,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CAST(DATEDIFF(SECOND,[createdAt],[resolvedAt]) AS float)/3600.0)
          OVER (PARTITION BY CAST([resolvedAt] AS date)) AS med
      FROM [Case] WHERE ${resolvedWhere(b.companyList, P, F, T)}
    ) x GROUP BY d ORDER BY d ASC;`, ...b.params);
  const daily = rows.map((r) => ({
    date: r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10),
    resolvedCount: Number(r.cnt),
    medianHours: r.med == null ? null : Math.round(Number(r.med) * 10) / 10,
  }));
  // 7 günlük yürüyen median (dalgalanmayı yumuşat)
  const rolling = daily.map((_, i) => {
    const window = daily.slice(Math.max(0, i - 6), i + 1).map((d) => d.medianHours).filter((v) => v != null).sort((a, b2) => a - b2);
    if (window.length === 0) return null;
    const mid = Math.floor(window.length / 2);
    const m = window.length % 2 ? window[mid] : (window[mid - 1] + window[mid]) / 2;
    return Math.round(m * 10) / 10;
  });
  return daily.map((d, i) => ({ ...d, rollingMedianHours: rolling[i] }));
}

export async function computePersonDetail({ personId, allowedCompanyIds, from, to }) {
  const t0 = Date.now();
  const companyIds = Array.isArray(allowedCompanyIds) ? allowedCompanyIds : [];
  if (companyIds.length === 0 || !personId) {
    return { person: null, expertise: [], problems: [], products: [], longestCases: [], solutionSignature: null, dailyTrend: [], meta: { durationMs: Date.now() - t0 } };
  }
  const fromD = new Date(from);
  const toD = new Date(to);
  const [expertise, problems, products, longestCases, solutionSignature, dailyTrend] = await Promise.all([
    queryExpertise(companyIds, personId, fromD, toD),
    queryProblems(companyIds, personId, fromD, toD),
    queryProducts(companyIds, personId, fromD, toD),
    queryLongestCases(companyIds, personId, fromD, toD),
    querySolutionSignature(companyIds, personId, fromD, toD),
    queryDailyTrend(companyIds, personId, fromD, toD),
  ]);
  const resolved = expertise.reduce((s, e) => s + e.count, 0);
  const nameRow = await prisma.$queryRawUnsafe(
    `SELECT TOP 1 [assignedPersonName] AS name FROM [Case] WHERE [assignedPersonId]=@P1 AND [assignedPersonName] IS NOT NULL`,
    personId,
  );
  return {
    person: { id: personId, name: nameRow[0]?.name ?? personId, resolved },
    expertise, problems, products, longestCases, solutionSignature, dailyTrend,
    meta: { minSampleAgent: MIN_SAMPLE.agentPerformance, durationMs: Date.now() - t0 },
  };
}
