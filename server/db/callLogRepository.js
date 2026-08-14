/**
 * AloTech CallLog repository — gelen çağrı webhook'u (incoming-call-start / -end)
 * ile çağrı kayıtları + çağrı-merkezi raporu.
 *
 * İZOLE: CallLog'un Account/Case ile Prisma-relation'ı YOK (scalar FK). Müşteri
 * çözümü AccountCompany.externalCustomerCode üzerinden (companyId-scoped, exact).
 * Join'ler (rapor) uygulama katmanında yapılır.
 *
 * Tenant güvenliği: TÜM sorgular companyId ile scope'lanır — yanlış tenant'ın
 * müşterisi/çağrısı asla açığa çıkmaz.
 */
import { prisma } from './client.js';

/**
 * Müşteri şifresini (IVR) Varuna müşterisine çöz.
 * externalCustomerCode companyId içinde UNIQUE → tek hesap. Bulunamazsa null.
 */
export async function resolveAccountByPassword(companyId, password) {
  const code = (password ?? '').toString().trim();
  if (!companyId || !code) return null;
  const ac = await prisma.accountCompany.findUnique({
    where: { companyId_externalCustomerCode: { companyId, externalCustomerCode: code } },
    select: { accountId: true, account: { select: { id: true, name: true } } },
  });
  return ac?.account ? { id: ac.account.id, name: ac.account.name } : null;
}

/** Çağrı başında upsert (aynı callId tek satır). startedAt/ringing set edilir. */
export async function upsertOnStart({ companyId, callId, callerId, customerPassword, agentEmail, queue, direction = 'inbound', matchedAccountId, raw }) {
  if (!companyId || !callId) throw new Error('callLog: companyId + callId zorunlu');
  const now = new Date();
  const data = {
    callerId: callerId ?? null,
    customerPassword: customerPassword ?? null,
    agentEmail: agentEmail ?? null,
    queue: queue ?? null,
    direction,
    matchedAccountId: matchedAccountId ?? null,
    raw: raw ?? null,
  };
  return prisma.callLog.upsert({
    where: { companyId_callId: { companyId, callId } },
    // create → yeni çağrı: startedAt + ringing. update → tekrar gelen start event'i:
    // temel alanları tazele ama startedAt'i EZME.
    create: { companyId, callId, status: 'ringing', startedAt: now, ...data },
    update: { ...data },
  });
}

/** Çağrı sonu — süre + durum. answeredAt/endedAt opsiyonel. */
export async function updateOnEnd({ companyId, callId, answeredAt, endedAt, durationSec, status = 'ended' }) {
  if (!companyId || !callId) throw new Error('callLog: companyId + callId zorunlu');
  const existing = await prisma.callLog.findUnique({ where: { companyId_callId: { companyId, callId } }, select: { id: true } });
  if (!existing) return null; // start gelmemiş çağrı-sonu → yoksay (idempotent)
  return prisma.callLog.update({
    where: { companyId_callId: { companyId, callId } },
    data: {
      ...(answeredAt ? { answeredAt } : {}),
      endedAt: endedAt ?? new Date(),
      ...(Number.isFinite(durationSec) ? { durationSec: Math.max(0, Math.round(durationSec)) } : {}),
      status,
    },
  });
}

/** Ticket açılınca/bağlanınca çağrı↔ticket bağı (callId → caseId). */
export async function linkCase({ companyId, callId, callerId, caseId }) {
  if (!companyId || !caseId || (!callId && !callerId)) return null;
  // 1) callId (kesin) — CallLog anahtarıyla birebir.
  if (callId) {
    const existing = await prisma.callLog.findUnique({ where: { companyId_callId: { companyId, callId } }, select: { id: true } });
    if (existing) return prisma.callLog.update({ where: { id: existing.id }, data: { caseId } });
  }
  // 2) callerId fallback — pop çağrı çalarken (enrichment'tan ÖNCE) açıldıysa callLogKey
  // null kalır; ticket create anında CallLog kesin vardır → arayan numaranın EN SON
  // bağlanmamış gelen çağrısını bağla (son 2 saat, yanlış-çağrıyı bağlama riski düşük).
  if (callerId) {
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const cl = await prisma.callLog.findFirst({
      where: { companyId, callerId: String(callerId), caseId: null, direction: 'inbound', startedAt: { gte: since } },
      orderBy: { startedAt: 'desc' }, select: { id: true },
    });
    if (cl) return prisma.callLog.update({ where: { id: cl.id }, data: { caseId } });
  }
  return null;
}

/** /active-call zenginleştirme için: callId → {customerPassword, matchedAccountId}. */
export async function findByCallIds(companyId, callIds) {
  const ids = [...new Set((callIds || []).filter(Boolean))];
  if (!companyId || !ids.length) return new Map();
  const rows = await prisma.callLog.findMany({
    where: { companyId, callId: { in: ids } },
    select: { callId: true, customerPassword: true, matchedAccountId: true },
  });
  return new Map(rows.map((r) => [r.callId, { customerPassword: r.customerPassword, matchedAccountId: r.matchedAccountId }]));
}

/**
 * Şifreden (externalCustomerCode) müşterinin PROJESİNİ çöz. Şifre AccountCompany'ye
 * denk gelir; o AccountCompany'nin TEK aktif projesi varsa proje KESİNDİR → onu döner.
 * Sıfır ya da birden fazla aktif proje → null (şifre projeyi tek başına ayırt edemez;
 * frontend kullanıcıya bırakır). Proje-seviyesinde şifre YOK (schema: externalCustomerCode
 * yalnız AccountCompany'de).
 */
export async function resolveProjectByPassword(companyId, password) {
  const code = (password ?? '').toString().trim();
  if (!companyId || !code) return null;
  const ac = await prisma.accountCompany.findUnique({
    where: { companyId_externalCustomerCode: { companyId, externalCustomerCode: code } },
    select: { projects: { where: { isActive: true, status: 'Active' }, select: { id: true, name: true } } },
  });
  const ps = ac?.projects ?? [];
  return ps.length === 1 ? { id: ps[0].id, name: ps[0].name } : null;
}

/**
 * Faz 2 — /active-call pop zenginleştirme: callId → {matchedAccountId,
 * matchedAccountName, matchedProjectId, matchedProjectName}. Müşteri + proje app-level
 * join (izole tasarım). Proje şifreden çözülür (AccountCompany tek aktif proje).
 * Best-effort: hata olsa /active-call callerId ile yine çalışır.
 */
export async function resolveActiveCallContext(companyId, callIds) {
  const base = await findByCallIds(companyId, callIds);
  const accIds = [...new Set([...base.values()].map((v) => v.matchedAccountId).filter(Boolean))];
  const accs = accIds.length
    ? await prisma.account.findMany({ where: { id: { in: accIds } }, select: { id: true, name: true } })
    : [];
  const accMap = new Map(accs.map((a) => [a.id, a.name]));
  // Şifreden proje — distinct şifre başına 1 sorgu (genelde tek çağrı).
  const passwords = [...new Set([...base.values()].map((v) => v.customerPassword).filter(Boolean))];
  const projByPw = new Map();
  for (const pw of passwords) projByPw.set(pw, await resolveProjectByPassword(companyId, pw));
  const out = new Map();
  for (const [callId, v] of base) {
    // customerPassword'ü DIŞARI verme (gereksiz ifşa); yalnız çözülen müşteri + proje.
    const proj = v.customerPassword ? projByPw.get(v.customerPassword) : null;
    out.set(callId, {
      matchedAccountId: v.matchedAccountId,
      matchedAccountName: v.matchedAccountId ? (accMap.get(v.matchedAccountId) ?? null) : null,
      matchedProjectId: proj?.id ?? null,
      matchedProjectName: proj?.name ?? null,
    });
  }
  return out;
}

/**
 * Çağrı-merkezi raporu — müşteri × ticket × agent × süre.
 * Ham satırlar + özet döner; Account/Case adları app-level join ile eklenir.
 */
export async function report({ companyId, from, to, accountId, agentEmail, direction, limit = 5000 }) {
  if (!companyId) throw new Error('callLog.report: companyId zorunlu');
  const where = {
    companyId,
    ...(from || to ? { startedAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lt: new Date(to) } : {}) } } : {}),
    ...(accountId ? { matchedAccountId: accountId } : {}),
    ...(agentEmail ? { agentEmail } : {}),
    ...(direction ? { direction } : {}),
  };
  const rows = await prisma.callLog.findMany({
    where, orderBy: { startedAt: 'desc' }, take: Math.min(limit, 20000),
    select: {
      id: true, callId: true, callerId: true, customerPassword: true, direction: true, queue: true,
      agentEmail: true, matchedAccountId: true, caseId: true, status: true,
      startedAt: true, answeredAt: true, endedAt: true, durationSec: true,
    },
  });
  // app-level join: account adı + case numarası (izole tasarım gereği relation yok)
  const accIds = [...new Set(rows.map((r) => r.matchedAccountId).filter(Boolean))];
  const caseIds = [...new Set(rows.map((r) => r.caseId).filter(Boolean))];
  const [accs, cases] = await Promise.all([
    accIds.length ? prisma.account.findMany({ where: { id: { in: accIds } }, select: { id: true, name: true } }) : [],
    caseIds.length ? prisma.case.findMany({ where: { id: { in: caseIds } }, select: { id: true, caseNumber: true, accountProjectName: true } }) : [],
  ]);
  const accMap = new Map(accs.map((a) => [a.id, a.name]));
  const caseMap = new Map(cases.map((c) => [c.id, c]));
  const enriched = rows.map((r) => ({
    ...r,
    accountName: r.matchedAccountId ? (accMap.get(r.matchedAccountId) ?? null) : null,
    caseNumber: r.caseId ? (caseMap.get(r.caseId)?.caseNumber ?? null) : null,
    projectName: r.caseId ? (caseMap.get(r.caseId)?.accountProjectName ?? null) : null,
  }));
  // özet: müşteri bazında toplam çağrı + toplam/ort süre
  const byAccount = {};
  for (const r of enriched) {
    const k = r.matchedAccountId || '(eşleşmedi)';
    (byAccount[k] ??= { accountId: r.matchedAccountId, accountName: r.accountName, calls: 0, totalSec: 0, tickets: new Set() });
    byAccount[k].calls++; byAccount[k].totalSec += r.durationSec || 0;
    if (r.caseId) byAccount[k].tickets.add(r.caseId);
  }
  const summary = Object.values(byAccount).map((s) => ({
    accountId: s.accountId, accountName: s.accountName, calls: s.calls,
    totalSec: s.totalSec, totalMin: Math.round(s.totalSec / 60), ticketCount: s.tickets.size,
  })).sort((a, b) => b.totalSec - a.totalSec);
  return { rows: enriched, summary, count: enriched.length };
}
