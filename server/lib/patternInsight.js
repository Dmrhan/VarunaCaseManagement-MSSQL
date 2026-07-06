/**
 * Pattern Alert Insight — deterministik triage enrichment.
 *
 * PatternAlert (5+/60dk kategori bazlı tetik) bilgisini "manalı triage
 * kartı"na çevirir: ortak iplik + baseline/spike + etki metrikleri.
 *
 * REUSE:
 *  - PatternAlert.caseIds (zaten saklı; cron yazıyor)
 *  - prisma.case + accountProject (anaFirmaAccountId üzerinden)
 *  - Account.name + Product.name lookup
 *
 * Çıktı şeması:
 *  {
 *    commonThread: {
 *      topAnaFirma: { id, name, dominance } | null,
 *      topProduct: { id, name, dominance } | null,
 *      topKeyword: { word, dominance } | null,
 *    },
 *    spike: {
 *      value: number | null,         // current rate / baseline rate
 *      isNew: boolean,                // baseline=0 ise yeni kategori
 *      baselinePerHour: number,       // son 7g normalleştirilmiş
 *      currentPerHour: number,        // alert pencere baz alınmış
 *    },
 *    impact: {
 *      distinctAccounts: number,
 *      slaAtRisk: number,             // slaResolutionDueAt < now+24h veya geçmiş
 *      openCount: number,             // non-terminal status
 *      totalTriggerCases: number,
 *      missingCases: number,          // caseIds'te olup DB'de bulunamayan (silinmiş/scope dışı)
 *    },
 *    severity: 'critical' | 'warning' | 'info',
 *  }
 *
 * Severity türetimi:
 *  - spike >= 5x VEYA slaAtRisk >= 3 → critical
 *  - spike >= 2x VEYA slaAtRisk >= 1 → warning
 *  - else → info
 *
 * Cross-tenant koruma: caller (endpoint) scope filtresi uygular; bu helper
 * defense-in-depth olarak case.findMany'de companyId match enforce eder.
 */

import { prisma } from '../db/client.js';

// Terminal/non-open status'lar — openCount hesabı için.
// Memory pin'deki 7-kova enum:
//   open: Acik + YenidenAcildi
//   inProgress: Incelemede + Eskalasyon
//   waiting: ThirdPartyWaiting
//   closed: Cozuldu + IptalEdildi
const TERMINAL_STATUSES = new Set(['Cozuldu', 'IptalEdildi']);

// Dominance threshold — Codex revision: %60 baskınlık (%100 kesişim YERİNE).
// Gerçek örüntüler %100 temiz olmaz; 7/8'i Nestlé olan bir alarmda Nestlé
// chip'ini düşürmek sinyal kaybı.
const DOMINANCE_THRESHOLD = 0.6;

// Türkçe stop-words — token-bazlı ortak anahtar kelime çıkarımı için filter.
// Hardcode inline (harici dep YOK, kullanıcı kararı).
const STOP_WORDS = new Set([
  've', 'ile', 'için', 'bir', 'bu', 'şu', 'o', 'da', 'de', 'ki',
  'mi', 'mı', 'mu', 'mü', 'ne', 'ya', 'veya', 'ama', 'fakat',
  'çok', 'az', 'her', 'hiç', 'tüm', 'bazı', 'birkaç',
  'olarak', 'kadar', 'gibi', 'sonra', 'önce', 'şimdi',
  'var', 'yok', 'oldu', 'olur', 'edildi', 'ediliyor',
  // generic ticari/vaka kelimeleri (örn. başlığa girip dominance yapacak ama bilgisiz)
  'vaka', 'müşteri', 'sayın', 'merhaba', 'iyi', 'günler',
  // tek harfli & numeric'ler MIN_KEYWORD_LEN ile zaten elenir
]);

const MIN_KEYWORD_LEN = 3;
const MAX_TRIGGER_CASES_FETCH = 200; // defansif (cron 100 yazıyor; biraz tampon)
const SLA_AT_RISK_WINDOW_HOURS = 24;

/**
 * PatternAlert.caseIds (JSON string) → array.
 *
 * Cron `caseRows.map((c) => c.id)` ile array yazıyor; Prisma client
 * String alana array verince stringify ediyor. Defansif: zaten array
 * geliyorsa pass, string ise parse.
 */
function parseCaseIds(raw) {
  if (Array.isArray(raw)) return raw.filter((id) => typeof id === 'string');
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Frekans listesi → en baskın değer (≥threshold ise).
 *
 * @param {Array<string|null|undefined>} values — null/undefined filtrelenir
 * @param {number} threshold — 0..1
 * @returns {{ key: string, count: number, total: number, dominance: number } | null}
 */
export function findDominantValue(values, threshold = DOMINANCE_THRESHOLD) {
  const clean = values.filter((v) => v != null && v !== '');
  if (clean.length === 0) return null;

  const freq = new Map();
  for (const v of clean) {
    freq.set(v, (freq.get(v) ?? 0) + 1);
  }
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const [key, count] = sorted[0];
  const dominance = count / clean.length;
  if (dominance < threshold) return null;
  return { key, count, total: clean.length, dominance };
}

/**
 * Title metinlerinden ortak anahtar kelime çıkar.
 *
 * Tokenize: lowercase + split(/\s+|[\.,;:!?\-_/\\()\[\]"']/g)
 * Filter: min 3 char, stop-word'lerden değil, sadece harfsel (numeric reddi)
 *
 * Dönen kelime başına dominance = (kaç vakada geçti) / (toplam vaka).
 * Aynı vakada 5 kez geçse de 1 sayılır (case-coverage).
 *
 * @param {Array<string>} titles
 * @param {number} threshold
 * @returns {{ word: string, dominance: number, count: number, total: number } | null}
 */
export function findDominantKeyword(titles, threshold = DOMINANCE_THRESHOLD) {
  if (!Array.isArray(titles) || titles.length === 0) return null;

  // Vaka başına unique token set'i (aynı vakada tekrar = 1).
  //
  // Türkçe-aware lowercase: standart .toLowerCase() "GİRİŞ" için "gi̇riş"
  // (combining mark) üretir → "giriş" ile eşleşmez. toLocaleLowerCase('tr-TR')
  // doğru Türkçe büyük-küçük dönüşümü yapar (İ→i, I→ı).
  const perCaseTokens = titles.map((t) => {
    if (typeof t !== 'string') return new Set();
    const tokens = t
      .toLocaleLowerCase('tr-TR')
      .split(/[\s\.,;:!?\-_/\\()\[\]"'’“”]+/u)
      .filter((tok) => {
        if (tok.length < MIN_KEYWORD_LEN) return false;
        if (/^\d+$/.test(tok)) return false; // sadece rakam
        if (STOP_WORDS.has(tok)) return false;
        return true;
      });
    return new Set(tokens);
  });

  // Token frekansı = kaç vakada geçtiği (case-coverage)
  const freq = new Map();
  for (const tokenSet of perCaseTokens) {
    for (const tok of tokenSet) {
      freq.set(tok, (freq.get(tok) ?? 0) + 1);
    }
  }
  if (freq.size === 0) return null;

  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const [word, count] = sorted[0];
  const dominance = count / titles.length;
  if (dominance < threshold) return null;
  return { word, dominance, count, total: titles.length };
}

/**
 * Severity türetimi — spike ve SLA risk'e göre.
 */
function deriveSeverity({ spike, slaAtRisk }) {
  if ((spike != null && spike >= 5) || slaAtRisk >= 3) return 'critical';
  if ((spike != null && spike >= 2) || slaAtRisk >= 1) return 'warning';
  return 'info';
}

/**
 * Account.name + Product.name resolve helper — id → name.
 */
async function resolveNames({ anaFirmaId, productId }) {
  const result = { anaFirmaName: null, productName: null };
  const promises = [];
  if (anaFirmaId) {
    promises.push(
      prisma.account
        .findUnique({ where: { id: anaFirmaId }, select: { name: true } })
        .then((a) => { result.anaFirmaName = a?.name ?? null; }),
    );
  }
  if (productId) {
    promises.push(
      prisma.product
        .findUnique({ where: { id: productId }, select: { name: true } })
        .then((p) => { result.productName = p?.name ?? null; })
        .catch(() => { /* product modeli yoksa sessiz */ }),
    );
  }
  if (promises.length > 0) await Promise.all(promises);
  return result;
}

/**
 * Ana enrichment fonksiyonu.
 *
 * @param {Object} alert — PatternAlert row (Prisma fetched)
 * @param {Object} options
 * @param {Array<string>} options.allowedCompanyIds — defense-in-depth scope
 * @returns Promise<Object> insight payload (yukarıdaki şema)
 */
export async function enrichPatternAlert(alert, { allowedCompanyIds }) {
  const caseIds = parseCaseIds(alert.caseIds);

  // Empty alarm — defansif (cron her zaman caseIds yazar)
  if (caseIds.length === 0) {
    return emptyInsight(alert);
  }

  // Tetik vakalarını çek — scope filter + alarmın companyId'sine match
  // (caller assertion ile aynı; double-check sızıntı önler).
  const cases = await prisma.case.findMany({
    where: {
      id: { in: caseIds.slice(0, MAX_TRIGGER_CASES_FETCH) },
      companyId: alert.companyId, // patternAlert.companyId zaten scope içi
      isArchived: false, // 2026-07-06 — arşivli tetik vakası analize girmez
    },
    select: {
      id: true,
      title: true,
      status: true,
      accountId: true,
      productId: true,
      accountProjectId: true,
      slaResolutionDueAt: true,
      resolvedAt: true,
      accountProject: {
        select: { anaFirmaAccountId: true },
      },
    },
  });

  // Cross-tenant defense — scope dışı companyId vakası gelirse atla
  // (teorik olarak match'te zaten companyId şartı var; belt-and-suspenders).
  if (!allowedCompanyIds.includes(alert.companyId)) {
    return emptyInsight(alert);
  }

  // missingCases artık arşivlenen tetik vakalarını da kapsar (silinmiş/scope
  // dışı + arşivli) — "kayıp" semantiği aynı: analize giremeyen tetikler.
  const missingCases = caseIds.length - cases.length;

  // Codex #443 P2 — spike/currentPerHour kalıcı alert.caseCount'tan DEĞİL,
  // CANLI (arşivsiz) tetik sayısından türetilir. Tetikler sonradan
  // arşivlendiyse (448'lik temizlik senaryosu) kart bayat "critical spike"
  // göstermesin. Cap'siz kesin sayı için ayrı count (fetch 200 ile sınırlı).
  const liveTriggerCount = await prisma.case.count({
    where: {
      id: { in: caseIds },
      companyId: alert.companyId,
      isArchived: false,
    },
  });

  // commonThread — dominance
  const anaFirmaIds = cases.map((c) => c.accountProject?.anaFirmaAccountId ?? null);
  const productIds = cases.map((c) => c.productId ?? null);
  const titles = cases.map((c) => c.title ?? '');

  const topAnaFirmaRaw = findDominantValue(anaFirmaIds);
  const topProductRaw = findDominantValue(productIds);
  const topKeywordRaw = findDominantKeyword(titles);

  // Name lookup (paralel)
  const resolved = await resolveNames({
    anaFirmaId: topAnaFirmaRaw?.key ?? null,
    productId: topProductRaw?.key ?? null,
  });

  const topAnaFirma = topAnaFirmaRaw
    ? {
        id: topAnaFirmaRaw.key,
        name: resolved.anaFirmaName ?? '(isim bulunamadı)',
        count: topAnaFirmaRaw.count,
        total: topAnaFirmaRaw.total,
        dominance: topAnaFirmaRaw.dominance,
      }
    : null;

  const topProduct = topProductRaw
    ? {
        id: topProductRaw.key,
        name: resolved.productName ?? '(isim bulunamadı)',
        count: topProductRaw.count,
        total: topProductRaw.total,
        dominance: topProductRaw.dominance,
      }
    : null;

  const topKeyword = topKeywordRaw
    ? {
        word: topKeywordRaw.word,
        count: topKeywordRaw.count,
        total: topKeywordRaw.total,
        dominance: topKeywordRaw.dominance,
      }
    : null;

  // baseline/spike — son 7g, alarm penceresi DIŞ (son 60dk hariç tut ki
  // tetikleyen pencere baseline'ı bozmasın).
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const windowStart = new Date(now.getTime() - (alert.windowMinutes ?? 60) * 60 * 1000);
  const baselineCount = await prisma.case.count({
    where: {
      companyId: alert.companyId,
      category: alert.category,
      createdAt: { gte: sevenDaysAgo, lt: windowStart },
      isArchived: false,
    },
  });
  // 7 gün baseline penceresinden alarm penceresini çıkar
  const baselinePeriodHours = 7 * 24 - (alert.windowMinutes ?? 60) / 60;
  const baselinePerHour = baselinePeriodHours > 0 ? baselineCount / baselinePeriodHours : 0;
  const currentPerHour = liveTriggerCount / ((alert.windowMinutes ?? 60) / 60);
  const isNew = baselinePerHour === 0;
  const spike = isNew ? null : currentPerHour / baselinePerHour;

  // impact
  const distinctAccounts = new Set(cases.map((c) => c.accountId).filter(Boolean)).size;
  const slaCutoff = new Date(now.getTime() + SLA_AT_RISK_WINDOW_HOURS * 60 * 60 * 1000);
  const slaAtRisk = cases.filter((c) => {
    if (!c.slaResolutionDueAt) return false;
    if (c.resolvedAt) return false; // çözülmüşse risk yok
    return new Date(c.slaResolutionDueAt) < slaCutoff;
  }).length;
  const openCount = cases.filter((c) => !TERMINAL_STATUSES.has(c.status)).length;

  return {
    commonThread: { topAnaFirma, topProduct, topKeyword },
    spike: {
      value: spike == null ? null : Math.round(spike * 10) / 10,
      isNew,
      baselinePerHour: Math.round(baselinePerHour * 100) / 100,
      currentPerHour: Math.round(currentPerHour * 10) / 10,
    },
    impact: {
      distinctAccounts,
      slaAtRisk,
      openCount,
      totalTriggerCases: cases.length,
      missingCases,
    },
    severity: deriveSeverity({ spike, slaAtRisk }),
  };
}

function emptyInsight(alert) {
  return {
    commonThread: { topAnaFirma: null, topProduct: null, topKeyword: null },
    spike: { value: null, isNew: true, baselinePerHour: 0, currentPerHour: 0 },
    impact: {
      distinctAccounts: 0,
      slaAtRisk: 0,
      openCount: 0,
      totalTriggerCases: 0,
      missingCases: parseCaseIds(alert?.caseIds).length,
    },
    severity: 'info',
  };
}

export const _internal = {
  parseCaseIds,
  findDominantValue,
  findDominantKeyword,
  deriveSeverity,
  STOP_WORDS,
  DOMINANCE_THRESHOLD,
};
