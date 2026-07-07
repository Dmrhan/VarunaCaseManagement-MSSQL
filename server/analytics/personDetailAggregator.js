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

// Açık durum DB değerleri (FAZ 2c Etkinlik & Katkı — WIP/dokunulmayan iş için).
const OPEN_STATUS_DB = ['Acik', 'Incelemede', 'ThirdPartyWaiting', 'Eskalasyon', 'YenidenAcildi'];

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

// ===================================================================
// FAZ 2c — Etkinlik & Katkı (gizlenme tespiti). HASSAS.
// ===================================================================
// "Gerçekten çalışıyor mu, gizlenmiş mi" sorusu TEK SKORA İNDİRGENMEZ
// (oyunlanır + sessiz uzmanı haksız yakalar). 5 davranış sinyali BİRLİKTE +
// sonuçla (çözülen iş) eşli. Gizlenme = birden çok sinyal birlikte düşük +
// çözülmüş sonuç yok. "Dokunulmayan iş" müşteri/3.taraf/snooze beklemesini
// HARİÇ tutar (top kişide değilse sayılmaz). Pozitif çerçeve: yük adil mi.
const OPEN_LIST = OPEN_STATUS_DB.map((s) => `'${s}'`).join(', ');

function companyClause(companyIds, alias = '') {
  const col = alias ? `${alias}.[companyId]` : '[companyId]';
  const list = companyIds.map((_, i) => `@P${i + 1}`).join(', ');
  return `${col} IN (${list})`;
}

// Team scope'u sıralı placeholder ile ekler (Codex #457 P2: engagement sinyalleri
// de resolved/hard-share ile AYNI takım kapsamında olmalı, yoksa çapraz-takım
// davranış sızar). teamIds yoksa boş döner; varsa params'a push edip filtre verir.
// `aliasCol` = takım kolonunun tam yolu (ör. 'cs.[assignedTeamId]').
function teamClause(params, teamIds, aliasCol) {
  if (!teamIds || teamIds.length === 0) return '';
  const list = teamIds.map((t) => { params.push(t); return `@P${params.length}`; }).join(', ');
  return ` AND ${aliasCol} IN (${list})`;
}

export async function computePersonEngagement({ personId, allowedCompanyIds, teamIds, from, to, asOf }) {
  const t0 = Date.now();
  const companyIds = Array.isArray(allowedCompanyIds) ? allowedCompanyIds : [];
  if (companyIds.length === 0 || !personId) {
    return { signals: [], verdict: null, meta: { durationMs: Date.now() - t0 } };
  }
  const fromD = new Date(from), toD = new Date(to);
  const now = asOf instanceof Date ? asOf : new Date();
  const staleCutoff = new Date(now.getTime() - 7 * 86400000);

  // Kişinin User.id'si (aktivite/claim actorUserId ile eşleşir). Kapsam kanıtının
  // aktivite kolu için önce çözülür; tek başına veri sızdırmaz (sadece personId→User.id).
  const uRow = await prisma.$queryRawUnsafe(
    `SELECT TOP 1 [id] AS uid FROM [User] WHERE [personId] = @P1`, personId);
  const uid = uRow[0]?.uid ?? null;

  // KAPSAM KANITI (GÜVENLİK — Codex #457 R6/R7/R8 zinciri, #455 P1 sınıfı):
  // kişinin caller'ın KAPSAMINDA + NON-ARŞİVLİ izi var mı? Yoksa var-olmayan ile AYNI
  // boş payload dön — aksi halde kapsam-dışı/gizli personId global User'a çözülüp
  // non-null sinyal/verdict üreterek kişi-varlığını sızdırır ve yetkisiz profili "watch"
  // gösterir. Kanıt ÜÇ sinyal kaynağının HEPSİNİ kapsar (tek kaynağa dayanan kapı, o
  // kaynağı olmayan ama başka türlü kapsam-içi kişiyi ve sinyalini gizler):
  //  1) atanmış vaka (queryPersonName, arşivsiz)      → resolved/hard-share/idle
  //  2) kapsam-içi arşivsiz devir-çıkışı               → transferOut (hot-potato)
  //  3) kapsam-içi arşivsiz vakada aktivite (uid)      → activityPerDay/claims
  let inScope = (await queryPersonName(companyIds, teamIds, personId)) != null;
  if (!inScope) { // 2) devir kanıtı — kaynak takım + arşivsiz
    const sp = [...companyIds];
    const spList = companyIds.map((_, i) => `@P${i + 1}`).join(', ');
    sp.push(personId); const spIdx = `@P${sp.length}`;
    const spTC = teamClause(sp, teamIds, 't.[fromTeamId]');
    const spRow = await prisma.$queryRawUnsafe(
      `SELECT TOP 1 1 AS ok FROM [CaseTransfer] t
       WHERE t.[fromPersonId] = ${spIdx} AND t.[companyId] IN (${spList})${spTC}
         AND EXISTS (SELECT 1 FROM [Case] c WHERE c.[id]=t.[caseId] AND c.[isArchived] = 0)`, ...sp);
    inScope = spRow.length > 0;
  }
  if (!inScope && uid) { // 3) aktivite kanıtı — kapsam-içi arşivsiz vakada dokunuş
    const ap = [...companyIds];
    const apList = companyIds.map((_, i) => `@P${i + 1}`).join(', ');
    ap.push(uid); const apUid = `@P${ap.length}`;
    const apTC = teamClause(ap, teamIds, 'cs.[assignedTeamId]');
    const apRow = await prisma.$queryRawUnsafe(
      `SELECT TOP 1 1 AS ok FROM [CaseActivity] a JOIN [Case] cs ON cs.[id]=a.[caseId]
       WHERE a.[actorUserId] = ${apUid} AND cs.[companyId] IN (${apList}) AND cs.[isArchived] = 0${apTC}`, ...ap);
    inScope = apRow.length > 0;
  }
  if (!inScope) {
    return { signals: [], verdict: null, meta: { durationMs: Date.now() - t0 } };
  }

  const s = scopeParts(companyIds, teamIds, personId, fromD, toD); // resolved-in-period (kişi)
  const tb = teamScopeParts(companyIds, teamIds, fromD, toD);      // resolved-in-period (ekip)

  // CaseActivity sinyalleri Case'e HER ZAMAN join olur: (1) arşivli vaka aktivitesi
  // sayılmasın — cs.[isArchived]=0 (Codex #457 P2, dosyanın geri kalanıyla parite);
  // (2) team scope varsa aynı takıma kısıtla — assignedTeamId IN (resolved/hard-share ile parite).
  const caseJoin = 'JOIN [Case] cs ON cs.[id] = ca.[caseId]';

  // 1) Aktif dokunuş/gün — CaseActivity (actorUserId=kişi) / aktif gün
  let activityPerDay = null, teamActivityPerDay = null;
  if (uid) {
    // Kişi
    const p = []; const cList = companyIds.map((c) => { p.push(c); return `@P${p.length}`; }).join(', ');
    p.push(uid); const uidIdx = `@P${p.length}`;
    p.push(fromD); const fIdx = `@P${p.length}`;
    p.push(toD); const tIdx = `@P${p.length}`;
    const tc = teamClause(p, teamIds, 'cs.[assignedTeamId]');
    const a = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS c, COUNT(DISTINCT CAST(ca.[at] AS date)) AS d
       FROM [CaseActivity] ca ${caseJoin}
       WHERE ca.[actorUserId] = ${uidIdx} AND ca.[companyId] IN (${cList}) AND cs.[isArchived] = 0
         AND ca.[at] >= ${fIdx} AND ca.[at] < ${tIdx}${tc}`,
      ...p);
    const c = Number(a[0].c), d = Number(a[0].d);
    activityPerDay = d > 0 ? Math.round((c / d) * 10) / 10 : 0;
    // Ekip: kişi başına dokunuş/gün ortalaması (aynı takım kapsamı)
    const tp = []; const tcList = companyIds.map((c) => { tp.push(c); return `@P${tp.length}`; }).join(', ');
    tp.push(fromD); const tfIdx = `@P${tp.length}`;
    tp.push(toD); const ttIdx = `@P${tp.length}`;
    const ttc = teamClause(tp, teamIds, 'cs.[assignedTeamId]');
    const team = await prisma.$queryRawUnsafe(
      `SELECT AVG(perday) AS avg FROM (
         SELECT ca.[actorUserId], CAST(COUNT(*) AS float)/NULLIF(COUNT(DISTINCT CAST(ca.[at] AS date)),0) AS perday
         FROM [CaseActivity] ca JOIN [User] u ON u.[id]=ca.[actorUserId] ${caseJoin}
         WHERE u.[personId] IS NOT NULL AND ca.[companyId] IN (${tcList}) AND cs.[isArchived] = 0
           AND ca.[at] >= ${tfIdx} AND ca.[at] < ${ttIdx}${ttc}
         GROUP BY ca.[actorUserId]) x`,
      ...tp);
    teamActivityPerDay = team[0].avg == null ? null : Math.round(Number(team[0].avg) * 10) / 10;
  }

  // 2) Havuzdan üstlenme — kişinin "Vaka üstlenildi" aktivite sayısı
  let claims = null, teamClaims = null;
  if (uid) {
    const p = []; const cList = companyIds.map((c) => { p.push(c); return `@P${p.length}`; }).join(', ');
    p.push(uid); const uidIdx = `@P${p.length}`;
    p.push(fromD); const fIdx = `@P${p.length}`;
    p.push(toD); const tIdx = `@P${p.length}`;
    const tc = teamClause(p, teamIds, 'cs.[assignedTeamId]');
    const r = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS c FROM [CaseActivity] ca ${caseJoin}
       WHERE ca.[actorUserId] = ${uidIdx} AND ca.[companyId] IN (${cList}) AND cs.[isArchived] = 0
         AND ca.[action] LIKE N'%üstlenildi%' AND ca.[at] >= ${fIdx} AND ca.[at] < ${tIdx}${tc}`,
      ...p);
    claims = Number(r[0].c);
    const tp = []; const tcList = companyIds.map((c) => { tp.push(c); return `@P${tp.length}`; }).join(', ');
    tp.push(fromD); const tfIdx = `@P${tp.length}`;
    tp.push(toD); const ttIdx = `@P${tp.length}`;
    const ttc = teamClause(tp, teamIds, 'cs.[assignedTeamId]');
    const team = await prisma.$queryRawUnsafe(
      `SELECT AVG(CAST(c AS float)) AS avg FROM (
         SELECT ca.[actorUserId], COUNT(*) AS c FROM [CaseActivity] ca JOIN [User] u ON u.[id]=ca.[actorUserId] ${caseJoin}
         WHERE u.[personId] IS NOT NULL AND ca.[companyId] IN (${tcList}) AND cs.[isArchived] = 0 AND ca.[action] LIKE N'%üstlenildi%'
           AND ca.[at] >= ${tfIdx} AND ca.[at] < ${ttIdx}${ttc}
         GROUP BY ca.[actorUserId]) x`,
      ...tp);
    teamClaims = team[0].avg == null ? null : Math.round(Number(team[0].avg));
  }

  // 3) Dokunulmayan iş (top sende) — açık, 7g+ hareketsiz, top AJANDA.
  // Codex #457 R4: pendingCustomerReply=true = "müşteri yazdı, ajan cevap borçlu"
  // (top ajanda) — bu tam da sayılması gereken idle. Eski `=0` filtresi SİNYALİ
  // TERS çeviriyordu. Doğru dışlama: SADECE gerçekten müşteriyi bekleyen (ajan
  // cevaplamış = pendingCustomerReply=0 VE outbound VAR) durumu hariç tut;
  // e-posta olmayan/hiç cevaplanmamış vaka (outbound NULL) top-ajanda sayılır.
  const idleParams = [...companyIds]; const idleCC = companyIds.map((_, i) => `@P${i + 1}`).join(', ');
  idleParams.push(personId); const idlePIdx = `@P${idleParams.length}`;
  idleParams.push(staleCutoff); const idleSIdx = `@P${idleParams.length}`;
  const idleTC = teamClause(idleParams, teamIds, 'c.[assignedTeamId]');
  // Staleness çoklu "sayaç sıfırlayan" olaydan ölçülür — hepsi cutoff'tan eski olmalı:
  //  · createdAt (Codex #457 R3: aktivitesiz seed/import taze vaka idle sayılmasın)
  //  · lastEmailInboundAt (Codex #457 R5: müşteri BUGÜN yanıtlayınca appendInbound
  //    CaseActivity YARATMAZ; top ajanda bugün düşen vaka "7+ gün idle" sayılmasın)
  //  · son CaseActivity (NOT EXISTS)  — hepsi birlikte gerçek ihmali gösterir.
  const idle = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS c FROM [Case] c
     WHERE c.[companyId] IN (${idleCC}) AND c.[assignedPersonId] = ${idlePIdx}
       AND c.[isArchived]=0 AND c.[status] IN (${OPEN_LIST})
       AND c.[status] <> 'ThirdPartyWaiting'
       AND NOT (c.[pendingCustomerReply] = 0 AND c.[lastEmailOutboundAt] IS NOT NULL)
       AND c.[createdAt] <= ${idleSIdx}
       AND (c.[snoozeUntil] IS NULL OR c.[snoozeUntil] <= ${idleSIdx})
       AND (c.[lastEmailInboundAt] IS NULL OR c.[lastEmailInboundAt] <= ${idleSIdx})
       AND NOT EXISTS (SELECT 1 FROM [CaseActivity] a WHERE a.[caseId]=c.[id] AND a.[at] > ${idleSIdx})${idleTC}`,
    ...idleParams);
  const idleOwned = Number(idle[0].c);

  // 4) Zor iş payı — çözülenlerden eskalasyon/yüksek öncelik %
  const hard = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN [escalationLevel] <> 'Yok' OR [priority] IN ('High','Critical') THEN 1 ELSE 0 END) AS hard
     FROM [Case] WHERE ${s.where}`, ...s.params);
  const hardTeam = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN [escalationLevel] <> 'Yok' OR [priority] IN ('High','Critical') THEN 1 ELSE 0 END) AS hard
     FROM [Case] WHERE ${tb.where}`, ...tb.params);
  const pct = (r) => Number(r.total) > 0 ? Math.round((Number(r.hard) / Number(r.total)) * 100) : null;
  const hardSharePct = pct(hard[0]), teamHardSharePct = pct(hardTeam[0]);
  const resolved = Number(hard[0].total);

  // 5) Hızlı devretme — kişinin devir-çıkışı / (çözülen + devir)
  // Codex #457 P2: team scope DEVİR-ANINDAKİ kaynak takıma göre (t.[fromTeamId]),
  // case'in güncel assignedTeamId'sine göre DEĞİL — yoksa L2→L3 devri L2 profilinde
  // eksik sayılır (tam ölçmek istediğimiz "sıcak patates" kaçar). EXISTS Case
  // arşivli hariç (resolved denominator'ı ile parite).
  const trParams = [...companyIds]; const trCC = companyIds.map((_, i) => `@P${i + 1}`).join(', ');
  trParams.push(personId); const trPIdx = `@P${trParams.length}`;
  trParams.push(fromD); const trFIdx = `@P${trParams.length}`;
  trParams.push(toD); const trTIdx = `@P${trParams.length}`;
  const trTC = teamClause(trParams, teamIds, 't.[fromTeamId]');
  // Codex #457 R3 (perf): tenant filtresini CaseTransfer'a DOĞRUDAN uygula —
  // @@index([companyId, transferredAt]) kullanılsın, tarama EXISTS'ten önce daralsın.
  // EXISTS yalnız isArchived teyidi için kalır. (Aynı company placeholder'ları reuse.)
  const tr = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS c FROM [CaseTransfer] t
     WHERE t.[fromPersonId] = ${trPIdx} AND t.[companyId] IN (${trCC})
       AND t.[transferredAt] >= ${trFIdx} AND t.[transferredAt] < ${trTIdx}${trTC}
       AND EXISTS (SELECT 1 FROM [Case] c WHERE c.[id]=t.[caseId] AND c.[isArchived] = 0)`,
    ...trParams);
  const transferOut = Number(tr[0].c);
  const transferOutPct = (resolved + transferOut) > 0 ? Math.round((transferOut / (resolved + transferOut)) * 100) : null;

  // Sinyaller — her biri value + teamValue + TON (good/warn/flat). Ton, verdict'in
  // hammaddesi; "warn" = endişe (concern). Absolut eşikli sinyaller (idle/transfer)
  // ekip baseline'ı gerektirmez.
  const toneHigherGood = (v, team) => {
    if (v == null) return 'flat';
    if (team == null) return 'flat';
    if (v >= team * 0.85) return 'good';
    if (v < team * 0.5) return 'warn';
    return 'flat';
  };
  const signals = [
    { key: 'activityPerDay', label: 'Aktif dokunuş / gün', value: activityPerDay, teamValue: teamActivityPerDay, unit: 'adet',
      tone: toneHigherGood(activityPerDay, teamActivityPerDay), hint: 'not, yanıt, durum değişimi — işin görünür izi' },
    { key: 'claims', label: 'Havuzdan üstlenme', value: claims, teamValue: teamClaims, unit: 'adet',
      tone: claims == null || teamClaims == null ? 'flat' : (claims >= teamClaims * 0.7 ? 'good' : (claims < teamClaims * 0.3 ? 'warn' : 'flat')),
      hint: 'kendi seçip aldığı iş — atanmayı bekleyen değil' },
    { key: 'idleOwned', label: 'Dokunulmayan iş · top sende', value: idleOwned, teamValue: null, unit: 'vaka',
      tone: idleOwned <= 2 ? 'good' : (idleOwned >= 5 ? 'warn' : 'flat'),
      hint: '7+ gün hareketsiz kendi işi; müşteri/3.taraf/erteleme beklemesi HARİÇ' },
    { key: 'hardSharePct', label: 'Zor iş payı', value: hardSharePct, teamValue: teamHardSharePct, unit: '%',
      tone: hardSharePct == null || teamHardSharePct == null ? 'flat' : (hardSharePct >= teamHardSharePct ? 'good' : (hardSharePct < teamHardSharePct * 0.4 && resolved >= MIN_SAMPLE.agentPerformance ? 'warn' : 'flat')),
      hint: 'eskalasyon/yüksek öncelik oranı — sadece kolay iş mi seçiyor' },
    { key: 'transferOutPct', label: 'Hızlı devretme', value: transferOutPct, teamValue: null, unit: '%',
      tone: transferOutPct == null ? 'flat' : (transferOutPct <= 15 ? 'good' : (transferOutPct >= 40 ? 'warn' : 'flat')),
      hint: 'işi tutup çözüyor mu, sıcak-patates gibi başkasına mı atıyor' },
  ];

  // Verdict — CONCERN TETİKLİ, tek skor DEĞİL. Gizlenme = warn sinyalleri BİRLİKTE
  // + düşük çözülmüş sonuç. Concern yoksa "aktif" (yük paylaşılıyor). Tek warn
  // asla "kaytarıyor" demez.
  const concerns = signals.filter((x) => x.tone === 'warn').length;
  const lowOutput = resolved < MIN_SAMPLE.default;
  let read;
  if (concerns === 0 && resolved >= MIN_SAMPLE.default) read = 'active';
  else if (lowOutput && concerns >= 2) read = 'watch';   // düşük sonuç + çoklu endişe → gizlenme sinyali
  else if (concerns >= 3) read = 'watch';
  else if (lowOutput && concerns === 0) read = 'inconclusive'; // az veri, endişe yok
  else read = 'mixed';
  const verdict = { read, concerns, resolved, signalCount: signals.length };
  return { signals, verdict, meta: { minSampleAgent: MIN_SAMPLE.agentPerformance, durationMs: Date.now() - t0 } };
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
