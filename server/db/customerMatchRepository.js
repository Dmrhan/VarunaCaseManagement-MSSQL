/**
 * Phase D Step 2 — Customer Match Suggestions.
 *
 * Deterministic helper — vaka açıldığında müşteri eşleştirme bekleyen vakaya
 * (customerMatchPending=true) potansiyel Account önerileri üretir.
 *
 * KURALLAR:
 *  - AI YOK (OpenAI çağrısı yok)
 *  - Auto-link YOK; manuel Supervisor onayı zorunlu
 *  - Yalnız case.companyId ile uyumlu Account'lar önerilir
 *    (AccountCompany OR legacy Account.companyId OR shared NULL)
 *  - AccountCompany.notes / segment hiçbir zaman response'a girmez
 *  - phone / email reason'larında maskli değer döner
 *  - Skorlama deterministic ve stable (aynı DB state → aynı sıra)
 *  - Case visibility: assertCaseInScope ile route layer guard
 */

import { prisma } from './client.js';

// ─────────────────────────────────────────────────────────────────
// Signal extraction (case → tokens)
// ─────────────────────────────────────────────────────────────────

const PHONE_RX = /\+?\d[\d\s()\-]{7,}\d/g;
const EMAIL_RX = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const FIVE_DIGIT_RX = /\b\d{5}\b/g;
// Anlamlı isim tokenleri: 3+ harf, Türkçe karakterleri normalize, noktalama yok.
const NAME_STOP = new Set([
  've', 'ile', 'için', 'icin', 'müşteri', 'musteri', 'şirket', 'sirket',
  'firma', 'a.ş', 'as', 'ltd', 'şti', 'sti', 'tic', 'san',
  'müşterisiz', 'musterisiz', 'vaka', 'bilinmiyor', 'bilinmeyen',
]);

function normalizePhone(s) {
  return (s ?? '').replace(/[\s()\-+]/g, '');
}
function normalizeEmail(s) {
  return (s ?? '').trim().toLowerCase();
}
function maskPhone(p) {
  if (!p) return null;
  const digits = String(p).replace(/[^\d]/g, '');
  if (digits.length < 4) return '***';
  return `${String(p).slice(0, Math.min(5, p.length))}*** ${digits.slice(-4)}`;
}
function maskEmail(e) {
  if (!e || typeof e !== 'string' || !e.includes('@')) return '***';
  const [local, domain] = e.split('@');
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}***@${domain}`;
}

function normalizeTokens(text) {
  return (text ?? '')
    .toLowerCase()
    .replace(/[çÇ]/g, 'c')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[ıİiI]/g, 'i')
    .replace(/[öÖ]/g, 'o')
    .replace(/[şŞ]/g, 's')
    .replace(/[üÜ]/g, 'u')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !NAME_STOP.has(t));
}

function extractSignalsFromCase(c) {
  // Title + description + accountName (eski sentinel "Müşterisiz vaka" elimine
  // edilir token filter'ı ile) + son call log description'ları.
  const textParts = [c.title, c.description].filter(Boolean);
  for (const cl of c.callLogs ?? []) {
    if (cl.description) textParts.push(cl.description);
    if (cl.callerName) textParts.push(cl.callerName);
  }
  const text = textParts.join(' \n ');

  // Text-extracted signals (low-confidence; free-text regex tabanlı)
  const textPhones = Array.from(text.matchAll(PHONE_RX))
    .map((m) => normalizePhone(m[0]))
    .filter((p) => p.length >= 7);
  const textEmails = Array.from(text.matchAll(EMAIL_RX)).map((m) => normalizeEmail(m[0]));
  const fiveDigit = Array.from(text.matchAll(FIVE_DIGIT_RX)).map((m) => m[0]);

  // Phase D Step 2 — Requester intake fields (high-confidence; Agent explicit).
  // Backend payload'ında trimlenmiş; burada normalize edip set'lere katarız.
  const requesterPhone = c.customerContactPhone ? normalizePhone(c.customerContactPhone) : null;
  const requesterEmail = c.customerContactEmail ? normalizeEmail(c.customerContactEmail) : null;
  const requesterCompany = c.customerCompanyName ?? '';
  const requesterContactName = c.customerContactName ?? '';

  const phones = [...new Set([...(requesterPhone ? [requesterPhone] : []), ...textPhones])];
  const emails = [...new Set([...(requesterEmail ? [requesterEmail] : []), ...textEmails])];

  // Name tokens: title + description + (sentinel filtreli) accountName + requester firma adı
  const nameTokens = new Set(
    normalizeTokens(`${c.title} ${c.description} ${c.accountName ?? ''} ${requesterCompany}`),
  );
  const contactNameTokens = new Set(normalizeTokens(requesterContactName));

  return {
    phones,
    emails,
    externalCodes: [...new Set(fiveDigit)],
    nameTokens,
    contactNameTokens,
    requesterPhone,
    requesterEmail,
    requesterCompany,
    rawText: text,
  };
}

// ─────────────────────────────────────────────────────────────────
// Candidate account lookup (scope by case.companyId)
// ─────────────────────────────────────────────────────────────────

async function fetchCandidateAccounts(companyId) {
  return prisma.account.findMany({
    where: {
      isActive: true,
      OR: [
        { companies: { some: { companyId } } },
        { companyId },
        { companyId: null },
      ],
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      vkn: true,
      companyId: true,
      companies: {
        where: { companyId },
        select: {
          id: true,
          companyId: true,
          externalCustomerCode: true,
          packageName: true,
          company: {
            select: {
              name: true,
              settings: { select: { primaryColor: true } },
            },
          },
          products: {
            where: { isActive: true },
            select: { productName: true, productCode: true },
            take: 20,
          },
        },
      },
      contacts: {
        where: { isActive: true },
        select: { fullName: true, phone: true, email: true },
        take: 20,
      },
    },
    take: 500,
  });
}

// ─────────────────────────────────────────────────────────────────
// Scoring
// ─────────────────────────────────────────────────────────────────

function tokenOverlap(aTokens, bTokens) {
  let hit = 0;
  for (const t of aTokens) if (bTokens.has(t)) hit++;
  return hit;
}

function scoreCandidate(account, signals) {
  /** @type {Array<{ type: string; label: string; valueMasked: string | null }>} */
  const reasons = [];
  let score = 0;

  // Phone — Account.phone + Contact.phone. Phase D Step 2: requester phone
  // (Agent'ın explicit girdiği) yüksek-öncelik kabul edilir. Tek bir reason
  // ekleriz; double-count yok.
  const accountPhones = [account.phone, ...account.contacts.map((c) => c.phone)]
    .filter(Boolean)
    .map(normalizePhone);
  for (const p of signals.phones) {
    if (accountPhones.some((ap) => ap === p || ap.endsWith(p.slice(-7)))) {
      score += 50;
      reasons.push({ type: 'phone', label: 'Telefon eşleşti', valueMasked: maskPhone(p) });
      break;
    }
  }

  // Email — Account.email + Contact.email
  const accountEmails = [account.email, ...account.contacts.map((c) => c.email)]
    .filter(Boolean)
    .map(normalizeEmail);
  for (const e of signals.emails) {
    if (accountEmails.includes(e)) {
      score += 50;
      reasons.push({ type: 'email', label: 'E-posta eşleşti', valueMasked: maskEmail(e) });
      break;
    }
  }

  // External customer code — yalnız case.companyId'deki AccountCompany'lerde
  const acCodes = account.companies.map((c) => c.externalCustomerCode).filter(Boolean);
  for (const code of signals.externalCodes) {
    if (acCodes.includes(code)) {
      score += 60;
      reasons.push({ type: 'externalCode', label: 'Müşteri dış kodu eşleşti', valueMasked: code });
      break;
    }
  }

  // Name similarity (case text + requester firma adı — extractSignals'da union)
  const accountNameTokens = new Set(normalizeTokens(account.name));
  const overlap = tokenOverlap(signals.nameTokens, accountNameTokens);
  if (overlap > 0) {
    const bonus = Math.min(overlap * 20, 40);
    score += bonus;
    // Phase D Step 2: requester firma adı varsa label "Firma adı benzer",
    // yoksa eski "İsim benzerliği" davranışı.
    const label = signals.requesterCompany ? 'Firma adı benzer' : 'İsim benzerliği';
    reasons.push({ type: 'name', label, valueMasked: null });
  }

  // Phase D Step 2 — requester contact-name vs AccountContact.fullName
  if (signals.contactNameTokens.size > 0 && account.contacts.length > 0) {
    let contactHit = false;
    for (const c of account.contacts) {
      const ct = new Set(normalizeTokens(c.fullName ?? ''));
      if (tokenOverlap(signals.contactNameTokens, ct) > 0) {
        contactHit = true;
        break;
      }
    }
    if (contactHit) {
      score += 25;
      reasons.push({ type: 'contactName', label: 'İletişim kişisi eşleşti', valueMasked: null });
    }
  }

  // Product / package signal
  let productHit = null;
  outer: for (const ac of account.companies) {
    if (ac.packageName) {
      const pkgTokens = normalizeTokens(ac.packageName);
      if (pkgTokens.some((t) => signals.nameTokens.has(t))) {
        productHit = ac.packageName;
        break;
      }
    }
    for (const p of ac.products) {
      const pTokens = normalizeTokens(`${p.productName} ${p.productCode ?? ''}`);
      if (pTokens.some((t) => signals.nameTokens.has(t))) {
        productHit = p.productName;
        break outer;
      }
    }
  }
  if (productHit) {
    score += 15;
    reasons.push({ type: 'product', label: 'Ürün sinyali', valueMasked: productHit });
  }

  if (score > 100) score = 100;
  const confidence = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
  return { score, confidence, reasons };
}

// ─────────────────────────────────────────────────────────────────
// Case stats — open/total case count for account on case.companyId scope
// ─────────────────────────────────────────────────────────────────

const OPEN_STATUSES = new Set(['Acik', 'Incelemede', 'ThirdPartyWaiting', 'Eskalasyon', 'YenidenAcildi']);

async function caseCountsByAccount(accountIds, companyId) {
  if (accountIds.length === 0) return new Map();
  const rows = await prisma.case.groupBy({
    by: ['accountId', 'status'],
    where: { accountId: { in: accountIds }, companyId },
    _count: { _all: true },
  });
  const map = new Map();
  for (const r of rows) {
    const stat = map.get(r.accountId) ?? { open: 0, total: 0 };
    stat.total += r._count._all;
    if (OPEN_STATUSES.has(r.status)) stat.open += r._count._all;
    map.set(r.accountId, stat);
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * Vaka için müşteri öneri listesi üret.
 *
 * @param {Object} args
 * @param {string} args.caseId
 * @param {string[]} args.allowedCompanyIds
 * @param {number} [args.limit=5]
 * @returns {Promise<{ suggestions: Array<object>; generatedAt: string; reason?: string }>}
 */
export async function suggestCustomerMatches({ caseId, allowedCompanyIds, limit = 5 }) {
  const allowed = Array.isArray(allowedCompanyIds) ? allowedCompanyIds : [];
  // Case + scope guard (callLogs dahil — signal extraction için)
  const c = await prisma.case.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      title: true,
      description: true,
      companyId: true,
      accountId: true,
      accountName: true,
      customerMatchPending: true,
      // Phase D Step 2 — Agent intake'inde alınan başvuran bilgileri,
      // extractSignalsFromCase'in yüksek-öncelik sinyalleri.
      customerContactName: true,
      customerContactPhone: true,
      customerContactEmail: true,
      customerCompanyName: true,
      callLogs: {
        select: { description: true, callerName: true },
        take: 20,
      },
    },
  });
  if (!c) return null;
  if (allowed.length && !allowed.includes(c.companyId)) {
    // Caller layer'da assertCaseInScope ile yakalanıyor; defansif fallback.
    return null;
  }

  // Already linked → boş öneri (manuel link sonrası tekrar fetch'lerde silent)
  if (!c.customerMatchPending || c.accountId) {
    return { suggestions: [], generatedAt: new Date().toISOString(), reason: 'case_already_linked' };
  }

  const signals = extractSignalsFromCase(c);
  const candidates = await fetchCandidateAccounts(c.companyId);

  const scored = candidates
    .map((a) => {
      const { score, confidence, reasons } = scoreCandidate(a, signals);
      return { account: a, score, confidence, reasons };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Tie-breaker: sabit sıra için account.id (deterministic)
      return a.account.id.localeCompare(b.account.id);
    })
    .slice(0, limit);

  const topAccountIds = scored.map((s) => s.account.id);
  const stats = await caseCountsByAccount(topAccountIds, c.companyId);

  const suggestions = scored.map(({ account, score, confidence, reasons }) => {
    const stat = stats.get(account.id) ?? { open: 0, total: 0 };
    return {
      accountId: account.id,
      accountName: account.name,
      score,
      confidence,
      reasons,
      // Yalnız case.companyId'deki AccountCompany (notes/segment yok)
      companies: account.companies.map((ac) => ({
        companyId: ac.companyId,
        companyName: ac.company?.name ?? null,
        companyColor: ac.company?.settings?.primaryColor ?? null,
        externalCustomerCode: ac.externalCustomerCode ?? null,
      })),
      openCaseCount: stat.open,
      totalCaseCount: stat.total,
    };
  });

  return { suggestions, generatedAt: new Date().toISOString() };
}

export const customerMatchRepository = {
  suggestCustomerMatches,
  // Test/diagnostic için iç helper'ları expose et — production'da kullanılmaz.
  __internal: {
    extractSignalsFromCase,
    scoreCandidate,
    normalizeTokens,
    maskPhone,
    maskEmail,
  },
};
