/**
 * Performans Panosu FAZ 2a — Kişi Uzmanlık Profili veri motoru.
 *
 * Tek kişinin drill-down profili: neyde uzman (kategori dağılımı + konu-içi hız),
 * en çok karşılaştığı sorunlar (subCategory), çalıştığı ürün, en uzun işleri,
 * nasıl çözüyor (kapanış imzası: rootCause/resolutionType/permanentPrevention),
 * ve günlük çözüm-süresi trendi.
 *
 * Güvenlik: her sorgu companyId IN (allowedCompanyIds) + (varsa) teamId IN
 * (teamIds) + assignedPersonId=@p + isArchived=0 ile scoped (Codex #455 P2 —
 * teamIds honore edilir; scope dışı personId → boş, cross-company/team sızıntı
 * yok). İsim sorgusu da aynı scope'la (Codex #455 P1). PII: başlık dışında
 * müşteri PII'si payload'a girmez.
 *
 * Median: PERCENTILE_CONT window (PARTITION BY) + dış GROUP BY MIN deseni.
 */
import { prisma } from '../db/client.js';
import { MIN_SAMPLE } from './metricFormulas.js';

// Kişi-scoped WHERE + params: company + (varsa) team + person + resolved period.
// Dönüş: { where, params, companyList } — companyList ek sorgular için.
function scopeParts(companyIds, teamIds, personId, from, to) {
  const params = [...companyIds];
  const companyList = companyIds.map((_, i) => `@P${i + 1}`).join(', ');
  let where = `[companyId] IN (${companyList})`;
  if (teamIds && teamIds.length > 0) {
    const teamList = teamIds.map((_, i) => `@P${params.length + i + 1}`).join(', ');
    params.push(...teamIds);
    where += ` AND [assignedTeamId] IN (${teamList})`;
  }
  params.push(personId); const pIdx = `@P${params.length}`;
  params.push(from); const fIdx = `@P${params.length}`;
  params.push(to); const tIdx = `@P${params.length}`;
  where += ` AND [assignedPersonId] = ${pIdx} AND [isArchived] = 0`
    + ` AND [resolvedAt] >= ${fIdx} AND [resolvedAt] < ${tIdx} AND [resolvedAt] > [createdAt]`;
  return { where, params, companyList };
}

// Takım baseline WHERE (person YOK) — ekip median/permanentPrevention kıyası için.
function teamScopeParts(companyIds, teamIds, from, to) {
  const params = [...companyIds];
  const companyList = companyIds.map((_, i) => `@P${i + 1}`).join(', ');
  let where = `[companyId] IN (${companyList})`;
  if (teamIds && teamIds.length > 0) {
    const teamList = teamIds.map((_, i) => `@P${params.length + i + 1}`).join(', ');
    params.push(...teamIds);
    where += ` AND [assignedTeamId] IN (${teamList})`;
  }
  params.push(from); const fIdx = `@P${params.length}`;
  params.push(to); const tIdx = `@P${params.length}`;
  where += ` AND [isArchived] = 0 AND [resolvedAt] >= ${fIdx} AND [resolvedAt] < ${tIdx}`
    + ` AND [resolvedAt] > [createdAt] AND [assignedPersonId] IS NOT NULL`;
  return { where, params };
}

// 1) Uzmanlık — kişi kategori dağılımı + konu-içi median (+ ekip median).
//    Dönüş { items, total } — total tüm kategoriler (Codex #455 P2: header
//    sayımı top-8'e kırpılmasın).
async function queryExpertise(companyIds, teamIds, personId, from, to) {
  const s = scopeParts(companyIds, teamIds, personId, from, to);
  const mine = await prisma.$queryRawUnsafe(`
    SELECT [category] AS cat, COUNT(*) AS cnt, MIN(med) AS med FROM (
      SELECT [category],
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CAST(DATEDIFF(SECOND,[createdAt],[resolvedAt]) AS float)/3600.0)
          OVER (PARTITION BY [category]) AS med
      FROM [Case] WHERE ${s.where}
    ) x GROUP BY [category] ORDER BY cnt DESC;`, ...s.params);
  const t = teamScopeParts(companyIds, teamIds, from, to);
  const team = await prisma.$queryRawUnsafe(`
    SELECT [category] AS cat, MIN(med) AS med FROM (
      SELECT [category],
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CAST(DATEDIFF(SECOND,[createdAt],[resolvedAt]) AS float)/3600.0)
          OVER (PARTITION BY [category]) AS med
      FROM [Case] WHERE ${t.where}
    ) x GROUP BY [category];`, ...t.params);
  const teamMed = new Map(team.map((r) => [r.cat, r.med == null ? null : Number(r.med)]));
  const total = mine.reduce((acc, r) => acc + Number(r.cnt), 0);
  const denom = total || 1;
  const items = mine.slice(0, 8).map((r) => {
    const cnt = Number(r.cnt);
    const med = r.med == null ? null : Math.round(Number(r.med) * 10) / 10;
    const tmed = teamMed.get(r.cat) ?? null;
    let tag = 'normal', fasterPct = null;
    if (med != null && tmed != null && tmed > 0) {
      fasterPct = Math.max(-99, Math.min(99, Math.round(((tmed - med) / tmed) * 100)));
    }
    if (cnt >= MIN_SAMPLE.default && fasterPct != null && fasterPct >= 20) tag = 'expert';
    else if (cnt >= MIN_SAMPLE.default) tag = 'solid';
    return { category: r.cat, count: cnt, sharePct: Math.round((cnt / denom) * 100), medianHours: med, teamMedianHours: tmed, fasterPct, tag };
  });
  return { items, total };
}

async function queryProblems(companyIds, teamIds, personId, from, to) {
  const s = scopeParts(companyIds, teamIds, personId, from, to);
  const rows = await prisma.$queryRawUnsafe(`
    SELECT TOP 6 [subCategory] AS sub, COUNT(*) AS cnt
    FROM [Case] WHERE ${s.where}
    GROUP BY [subCategory] ORDER BY cnt DESC;`, ...s.params);
  return rows.map((r) => ({ subCategory: r.sub, count: Number(r.cnt) }));
}

async function queryProducts(companyIds, teamIds, personId, from, to) {
  const s = scopeParts(companyIds, teamIds, personId, from, to);
  const rows = await prisma.$queryRawUnsafe(`
    SELECT TOP 5 [productName] AS prod, COUNT(*) AS cnt
    FROM [Case] WHERE ${s.where} AND [productName] IS NOT NULL
    GROUP BY [productName] ORDER BY cnt DESC;`, ...s.params);
  const total = rows.reduce((acc, r) => acc + Number(r.cnt), 0) || 1;
  return rows.map((r) => ({ product: r.prod, count: Number(r.cnt), sharePct: Math.round((Number(r.cnt) / total) * 100) }));
}

// En uzun işler — PII yok (başlık + taksonomi + süre; müşteri contact SELECT'te YOK)
async function queryLongestCases(companyIds, teamIds, personId, from, to) {
  const s = scopeParts(companyIds, teamIds, personId, from, to);
  const rows = await prisma.$queryRawUnsafe(`
    SELECT TOP 5 [id], [caseNumber], [title], [category], [subCategory], [status],
      CAST(DATEDIFF(SECOND,[createdAt],[resolvedAt]) AS float)/3600.0 AS hrs
    FROM [Case] WHERE ${s.where}
    ORDER BY hrs DESC;`, ...s.params);
  return rows.map((r) => ({
    id: r.id, caseNumber: r.caseNumber, title: r.title,
    category: r.category, subCategory: r.subCategory,
    hours: Math.round(Number(r.hrs) * 10) / 10,
    reopened: r.status === 'YenidenAcildi',
  }));
}

async function querySolutionSignature(companyIds, teamIds, personId, from, to) {
  const s = scopeParts(companyIds, teamIds, personId, from, to);
  const topOf = async (field) => {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT TOP 3 JSON_VALUE([customFields],'$.smartTicket.closure.${field}') AS code,
        MAX(JSON_VALUE([customFields],'$.smartTicket.closure.${field}Label')) AS label,
        COUNT(*) AS cnt
      FROM [Case] WHERE ${s.where} AND JSON_VALUE([customFields],'$.smartTicket.closure.${field}') IS NOT NULL
      GROUP BY JSON_VALUE([customFields],'$.smartTicket.closure.${field}') ORDER BY cnt DESC;`, ...s.params);
    const total = rows.reduce((acc, r) => acc + Number(r.cnt), 0);
    return rows.map((r) => ({ code: r.code, label: r.label ?? r.code, count: Number(r.cnt), pct: total ? Math.round((Number(r.cnt) / total) * 100) : 0 }));
  };
  const rootCause = await topOf('rootCauseGroup');
  const resolutionType = await topOf('resolutionType');
  const ppMine = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS total, SUM(CASE WHEN JSON_VALUE([customFields],'$.smartTicket.closure.permanentPrevention') IS NOT NULL THEN 1 ELSE 0 END) AS pp
    FROM [Case] WHERE ${s.where};`, ...s.params);
  const t = teamScopeParts(companyIds, teamIds, from, to);
  const ppTeam = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS total, SUM(CASE WHEN JSON_VALUE([customFields],'$.smartTicket.closure.permanentPrevention') IS NOT NULL THEN 1 ELSE 0 END) AS pp
    FROM [Case] WHERE ${t.where};`, ...t.params);
  const pctOf = (r) => Number(r.total) > 0 ? Math.round((Number(r.pp) / Number(r.total)) * 100) : null;
  return {
    rootCause, resolutionType,
    permanentPreventionPct: pctOf(ppMine[0]),
    teamPermanentPreventionPct: pctOf(ppTeam[0]),
  };
}

async function queryDailyTrend(companyIds, teamIds, personId, from, to) {
  const s = scopeParts(companyIds, teamIds, personId, from, to);
  const rows = await prisma.$queryRawUnsafe(`
    SELECT d, COUNT(*) AS cnt, MIN(med) AS med FROM (
      SELECT CAST([resolvedAt] AS date) AS d,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CAST(DATEDIFF(SECOND,[createdAt],[resolvedAt]) AS float)/3600.0)
          OVER (PARTITION BY CAST([resolvedAt] AS date)) AS med
      FROM [Case] WHERE ${s.where}
    ) x GROUP BY d ORDER BY d ASC;`, ...s.params);
  const daily = rows.map((r) => ({
    date: r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10),
    resolvedCount: Number(r.cnt),
    medianHours: r.med == null ? null : Math.round(Number(r.med) * 10) / 10,
  }));
  const rolling = daily.map((_, i) => {
    const window = daily.slice(Math.max(0, i - 6), i + 1).map((d) => d.medianHours).filter((v) => v != null).sort((a, b2) => a - b2);
    if (window.length === 0) return null;
    const mid = Math.floor(window.length / 2);
    const m = window.length % 2 ? window[mid] : (window[mid - 1] + window[mid]) / 2;
    return Math.round(m * 10) / 10;
  });
  return daily.map((d, i) => ({ ...d, rollingMedianHours: rolling[i] }));
}

// İsim — Codex #455 P1: scope'lu (scope dışı personId ismi/varlığı sızmasın).
async function queryPersonName(companyIds, teamIds, personId) {
  const params = [...companyIds];
  const companyList = companyIds.map((_, i) => `@P${i + 1}`).join(', ');
  let where = `[companyId] IN (${companyList})`;
  if (teamIds && teamIds.length > 0) {
    const teamList = teamIds.map((_, i) => `@P${params.length + i + 1}`).join(', ');
    params.push(...teamIds);
    where += ` AND [assignedTeamId] IN (${teamList})`;
  }
  params.push(personId);
  where += ` AND [assignedPersonId] = @P${params.length} AND [isArchived] = 0 AND [assignedPersonName] IS NOT NULL`;
  const rows = await prisma.$queryRawUnsafe(`SELECT TOP 1 [assignedPersonName] AS name FROM [Case] WHERE ${where};`, ...params);
  return rows[0]?.name ?? null;
}

export async function computePersonDetail({ personId, allowedCompanyIds, teamIds, from, to }) {
  const t0 = Date.now();
  const companyIds = Array.isArray(allowedCompanyIds) ? allowedCompanyIds : [];
  const teams = Array.isArray(teamIds) ? teamIds : [];
  if (companyIds.length === 0 || !personId) {
    return { person: null, expertise: [], problems: [], products: [], longestCases: [], solutionSignature: null, dailyTrend: [], meta: { durationMs: Date.now() - t0 } };
  }
  const fromD = new Date(from);
  const toD = new Date(to);
  const [expertiseRes, problems, products, longestCases, solutionSignature, dailyTrend, name] = await Promise.all([
    queryExpertise(companyIds, teams, personId, fromD, toD),
    queryProblems(companyIds, teams, personId, fromD, toD),
    queryProducts(companyIds, teams, personId, fromD, toD),
    queryLongestCases(companyIds, teams, personId, fromD, toD),
    querySolutionSignature(companyIds, teams, personId, fromD, toD),
    queryDailyTrend(companyIds, teams, personId, fromD, toD),
    queryPersonName(companyIds, teams, personId),
  ]);
  return {
    // Codex #455 P2 — resolved = TÜM kategoriler (top-8'e kırpılmamış toplam).
    person: { id: personId, name: name ?? personId, resolved: expertiseRes.total },
    expertise: expertiseRes.items,
    problems, products, longestCases, solutionSignature, dailyTrend,
    meta: { minSampleAgent: MIN_SAMPLE.agentPerformance, durationMs: Date.now() - t0 },
  };
}
