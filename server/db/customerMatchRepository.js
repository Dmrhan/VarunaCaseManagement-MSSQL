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
// Codex P2 fix (M2.2) — TAM eşleşme için kanonik form gerekir.
// Mevcut helper'ı REUSE et (tek formatta yazılmamış kullanıcı girdileriyle
// E.164 saklı DB kayıtları arasında uyumsuzluk yapmamak için).
import { normalizePhoneE164 } from '../utils/accountValidation.js';

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

/**
 * Codex P2 fix (M2.2) — Phone canonicalization for exact-match comparison.
 *
 * normalizePhoneE164 (server/utils/accountValidation.js:177): TR yaygın
 * formatları E.164'e çevirir:
 *   "0532 555 12 34" → "+905325551234"
 *   "5325551234"     → "+905325551234"
 *   "+905325551234"  → "+905325551234"
 *
 * Tanınmayan format → null (skip — yanlış eşleşme önlenir).
 * Eski naive normalize ('+'/'0' prefix korurdu) yerine kanonik form
 * üretir; account.phone (raw display) veya account.phoneE164 (kanonik)
 * fark etmez, AccountCompany.responsePhone vs. her input aynı form'da
 * karşılaştırılır.
 */
function normalizePhone(s) {
  return normalizePhoneE164(s);
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

/**
 * M2.2 (5) — Public/ücretsiz email domain blocklist (büyük harf duyarsız).
 * Bu domain'ler farklı müşterilerce paylaşıldığından "aynı domain" sinyali
 * discriminator DEĞİL — domain önerisi üretmezler.
 */
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'yandex.com',
]);

/**
 * M2.2 (4) — Placeholder telefon eşiği. Bir telefon numarası aday havuzunda
 * bu sayıdan fazla farklı hesapta görünüyorsa = discriminator değil
 * (örn. demo numaraları, "0555 555 5555"). Reason sayılmaz.
 */
const PLACEHOLDER_PHONE_THRESHOLD = 3;

/**
 * Email'in domain part'ını döndürür (lower, "@" yoksa null).
 */
function emailDomain(email) {
  if (!email || typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  return at > 0 ? email.slice(at + 1).toLowerCase() : null;
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

  // M2.2 (2/3) — Inbound (origin='Eposta') vakalarında structured gönderen
  // (customerContactEmail/customerContactName + customerCompanyName) esas
  // sinyaller; gövdeden phone/email KAZIMAZ. Mail imza/footer ve quoted
  // bloklar gürültü olur (M2.2 (3) inbound parser stripleyebilir ama
  // savunmacı kural: inbound'da text regex'lerini kapat).
  //
  // Manuel Phase D vakaları (origin='Telefon', 'Web' vs.) eski davranışla
  // gövdeden de kazımaya devam eder — regresyon yok.
  const isInbound = c.origin === 'Eposta';

  // Text-extracted signals (low-confidence; free-text regex tabanlı).
  // Inbound'da boş bırak.
  const textPhones = isInbound
    ? []
    : Array.from(text.matchAll(PHONE_RX))
        .map((m) => normalizePhone(m[0]))
        .filter((p) => p && p.length >= 7); // Codex P2: null guard
  const textEmails = isInbound
    ? []
    : Array.from(text.matchAll(EMAIL_RX)).map((m) => normalizeEmail(m[0]));
  const fiveDigit = Array.from(text.matchAll(FIVE_DIGIT_RX)).map((m) => m[0]);

  // Phase D Step 2 — Requester intake fields (high-confidence; Agent explicit).
  // Backend payload'ında trimlenmiş; burada normalize edip set'lere katarız.
  const requesterPhone = c.customerContactPhone ? normalizePhone(c.customerContactPhone) : null;
  const requesterEmail = c.customerContactEmail ? normalizeEmail(c.customerContactEmail) : null;
  const requesterCompany = c.customerCompanyName ?? '';
  const requesterContactName = c.customerContactName ?? '';
  // M2.2 (5) — domain önerisi için gönderen email domain'i.
  const requesterEmailDomain = requesterEmail ? emailDomain(requesterEmail) : null;

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
    requesterEmailDomain,
    requesterCompany,
    rawText: text,
    isInbound,
  };
}

// ─────────────────────────────────────────────────────────────────
// Candidate account lookup (scope by case.companyId)
// ─────────────────────────────────────────────────────────────────

/**
 * scoreCandidate'in beklediği account shape — fetchCandidateAccounts +
 * fetchHighSignalAccounts AYNI select kullanır ki dedupe edilmiş Map
 * birleştirmesi sorunsuz olsun.
 */
const CANDIDATE_SELECT = {
  id: true,
  name: true,
  phone: true,
  email: true,
  vkn: true,
  companyId: true,
  companies: {
    // companies select'inde companyId filtre dış değişken — fonksiyon
    // sarmalında verilir.
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
};

function buildCandidateSelect(companyId) {
  // companies.where dinamik (companyId), select sabit.
  return {
    ...CANDIDATE_SELECT,
    companies: {
      ...CANDIDATE_SELECT.companies,
      where: { companyId },
    },
  };
}

/**
 * Mevcut scope guard: 3 katmanlı OR (companies.some + denormalized
 * companyId + global null). fetchHighSignalAccounts da AYNI scope'u
 * uygular.
 */
function buildScopeWhere(companyId) {
  return {
    isActive: true,
    OR: [
      { companies: { some: { companyId } } },
      { companyId },
      { companyId: null },
    ],
  };
}

async function fetchCandidateAccounts(companyId) {
  return prisma.account.findMany({
    where: buildScopeWhere(companyId),
    select: buildCandidateSelect(companyId),
    take: 500,
    // Deterministic cap — 500'lük dilimin tekrar üretilebilir olması için.
    // Account.id cuid (chronological prefix) → insert sırasıyla doğal
    // sıralama; createdAt asc denendi ama MSSQL'de aynı ms timestamp'i
    // paylaşan kayıtlarda relation'lı select'in sonucu non-deterministic
    // sonuçlar üretiyordu (regression smoke:mail-match scenarioD).
    orderBy: { id: 'asc' },
  });
}

/**
 * High-signal aday garantisi (Plan onaylı):
 *   - Exact email (account.email VEYA contacts.email)
 *   - Exact phone (account.phone VEYA contacts.phone — normalize edilmiş)
 *   - External customer code (AccountCompany.externalCustomerCode)
 *   - Learned sender (learnedSenderAccountRepo.getByEmail → account)
 *
 * Cap YOK; tipik hit kümesi 1-10 satır. fetchCandidateAccounts ile aynı
 * scope guard + aynı select shape (dedupe Map güvenli).
 *
 * Hata durumlarında defansif: tek sorgu fail → boş dizi (silent fallback);
 * diğer sinyaller etkilenmez. signals empty → erken return ([]).
 */
async function fetchHighSignalAccounts(companyId, signals) {
  if (!companyId || !signals) return [];

  const where = buildScopeWhere(companyId);
  const select = buildCandidateSelect(companyId);

  const tasks = [];

  // (a) Exact email — account.email OR contacts.email
  if (signals.emails?.length) {
    tasks.push(
      prisma.account.findMany({
        where: {
          AND: [
            where,
            {
              OR: [
                { email: { in: signals.emails } },
                { contacts: { some: { email: { in: signals.emails }, isActive: true } } },
              ],
            },
          ],
        },
        select,
      }).catch((err) => {
        console.warn('[customerMatch] high-signal email lookup fail', err?.message ?? err);
        return [];
      }),
    );
  }

  // (b) Exact phone — normalize edilmiş.
  // BİLİNEN SINIR: signals.phones normalizePhone çıktısı tek format
  // ('+9053...'); Account.phone DB'de raw saklı ('+90 532...', '5333...')
  // → IN sorgusu raw'ı KAÇIRIR (smoke senaryo 3c ile kanıtlandı).
  // Normalize formatta saklı kayıtlar yakalanır (senaryo 3b).
  // Email/learned/external-code primary path; phone yolu opportunistic.
  // Tam kapsam için Account.phoneNormalized indeksli kolon migration'ı
  // gerek (kapsam dışı; ayrı PR).
  if (signals.phones?.length) {
    tasks.push(
      prisma.account.findMany({
        where: {
          AND: [
            where,
            {
              OR: [
                { phone: { in: signals.phones } },
                { contacts: { some: { phone: { in: signals.phones }, isActive: true } } },
              ],
            },
          ],
        },
        select,
      }).catch((err) => {
        console.warn('[customerMatch] high-signal phone lookup fail', err?.message ?? err);
        return [];
      }),
    );
  }

  // (c) External customer code — AccountCompany.externalCustomerCode scope'lu
  if (signals.externalCodes?.length) {
    tasks.push(
      (async () => {
        const links = await prisma.accountCompany.findMany({
          where: {
            companyId,
            externalCustomerCode: { in: signals.externalCodes },
          },
          select: { accountId: true },
        });
        if (!links.length) return [];
        return prisma.account.findMany({
          where: {
            AND: [where, { id: { in: links.map((l) => l.accountId) } }],
          },
          select,
        });
      })().catch((err) => {
        console.warn('[customerMatch] high-signal external-code lookup fail', err?.message ?? err);
        return [];
      }),
    );
  }

  // (d) Learned sender — inbound + requesterEmail varsa
  if (signals.isInbound && signals.requesterEmail) {
    tasks.push(
      (async () => {
        const { learnedSenderAccountRepo } = await import('./learnedSenderAccountRepository.js');
        const learned = await learnedSenderAccountRepo.getByEmail(companyId, signals.requesterEmail);
        if (!learned?.accountId) return [];
        return prisma.account.findMany({
          where: {
            AND: [where, { id: learned.accountId }],
          },
          select,
        });
      })().catch((err) => {
        console.warn('[customerMatch] high-signal learned lookup fail', err?.message ?? err);
        return [];
      }),
    );
  }

  if (!tasks.length) return [];
  const results = await Promise.all(tasks);
  // Dedupe by id — aynı account birden çok sinyali tetikleyebilir.
  const map = new Map();
  for (const arr of results) {
    for (const a of arr) {
      if (!map.has(a.id)) map.set(a.id, a);
    }
  }
  return Array.from(map.values());
}

// ─────────────────────────────────────────────────────────────────
// Scoring
// ─────────────────────────────────────────────────────────────────

function tokenOverlap(aTokens, bTokens) {
  let hit = 0;
  for (const t of aTokens) if (bTokens.has(t)) hit++;
  return hit;
}

function scoreCandidate(account, signals, ctx = {}) {
  /** @type {Array<{ type: string; label: string; valueMasked: string | null }>} */
  const reasons = [];
  let score = 0;

  // M2.2 (1) — Telefon eşleşmesi YALNIZ tam (normalized) eşitlikle. Eski
  // gevşek `ap.endsWith(p.slice(-7))` suffix kuralı KALDIRILDI; rastgele
  // numara collision'ları (örn. son 7 hane çakışması) artık eşleşmez.
  //
  // M2.2 (4) — Placeholder telefon filtresi. ctx.placeholderPhones set'i
  // verildiyse, bu numara aday havuzunda >threshold hesapla eşleşiyor =
  // discriminator değil → reason SAYILMAZ.
  const accountPhones = [account.phone, ...account.contacts.map((c) => c.phone)]
    .filter(Boolean)
    .map(normalizePhone)
    .filter(Boolean); // tanınmayan format → null elenir
  const placeholderPhones = ctx.placeholderPhones ?? null;
  for (const p of signals.phones) {
    if (!p) continue;
    if (placeholderPhones && placeholderPhones.has(p)) continue; // discriminator değil
    if (accountPhones.some((ap) => ap === p)) {
      score += 50;
      reasons.push({ type: 'phone', label: 'Telefon eşleşti', valueMasked: maskPhone(p) });
      break;
    }
  }

  // M2.2 (2) — Skor hiyerarşisi: email exact >> phone exact > domain > name.
  // Email TEK auto-link tetikleyicisidir (intake katmanı). 50 → 80 yükseltildi
  // ki eşleştiğinde diğer reason'larla birlikte listeyi domine etsin
  // (sıralama tie-breaker'ında üstte kalır).
  const accountEmails = [account.email, ...account.contacts.map((c) => c.email)]
    .filter(Boolean)
    .map(normalizeEmail);
  let emailMatched = false;
  for (const e of signals.emails) {
    if (accountEmails.includes(e)) {
      score += 80;
      reasons.push({ type: 'email', label: 'E-posta eşleşti', valueMasked: maskEmail(e) });
      emailMatched = true;
      break;
    }
  }

  // M2.3 — Öğrenilen sender eşlemesi (yalnız inbound; ctx.learnedAccountId
  // suggestCustomerMatches'te getByEmail ile çözüldü). 'learned' reason
  // exact-email ile EŞİT/üstün güç → +80 puan. Intake katmanı 'learned'
  // reason'ı auto-link tetikleyicisi olarak da kullanır (kişisel adres ise).
  if (ctx.learnedAccountId && ctx.learnedAccountId === account.id) {
    score += 80;
    reasons.push({
      type: 'learned',
      label: 'Önceki vakadan öğrenildi',
      valueMasked: signals.requesterEmail ? maskEmail(signals.requesterEmail) : null,
    });
  }

  // M2.2 (5) — Domain önerisi (yalnız evrensel, exact email YOKsa devreye girer).
  // Gönderen email'inin domain'i (signals.requesterEmailDomain) aday hesabın
  // Account.email VEYA Contact.email domain'leriyle eşleşiyorsa → 'domain' reason.
  // Public/ücretsiz domain'ler (gmail/outlook/...) blocklist ile filtrelenir.
  // ASLA auto-link tetikleyicisi DEĞİL — yalnız öneri.
  if (!emailMatched && signals.requesterEmailDomain) {
    const d = signals.requesterEmailDomain;
    if (!PUBLIC_EMAIL_DOMAINS.has(d)) {
      const candidateDomains = accountEmails.map(emailDomain).filter(Boolean);
      if (candidateDomains.includes(d)) {
        score += 25;
        reasons.push({
          type: 'domain',
          label: 'Aynı e-posta domaini',
          valueMasked: `@${d}`,
        });
      }
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
      // M2.2 — inbound (origin='Eposta') vakalarda gövde-kazımayı kapat.
      origin: true,
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

  // Aday havuzu: deterministik top 500 (createdAt asc + id asc) +
  // yüksek-sinyal augment (cap'siz).
  // KÖK SEBEP fix: 500 cap'i exact-email/learned hedefini havuz dışında
  // bırakabiliyordu. fetchHighSignalAccounts emin olur ki bu yüksek
  // güvenli sinyalleri taşıyan hesaplar HER ZAMAN havuzda.
  const candidates = await fetchCandidateAccounts(c.companyId);
  const highSignal = await fetchHighSignalAccounts(c.companyId, signals);

  // Dedupe — candidates priority; augment yalnız yeni id'ler ekler.
  const candidateMap = new Map(candidates.map((a) => [a.id, a]));
  for (const a of highSignal) {
    if (!candidateMap.has(a.id)) candidateMap.set(a.id, a);
  }
  const augmentedCandidates = Array.from(candidateMap.values());

  // M2.3 — Inbound için öğrenilen sender eşlemesi.
  // YALNIZ c.origin='Eposta' VE customerContactEmail dolu iken devreye girer.
  // Plan onaylı: learned guard augment SONRA çalışır — fetchHighSignalAccounts
  // learned account'u zorunlu havuza ekledi; guard sadece defansif.
  let learnedAccountId = null;
  let learnedIsRoleAddress = false;
  if (signals.isInbound && signals.requesterEmail) {
    try {
      const { learnedSenderAccountRepo } = await import('./learnedSenderAccountRepository.js');
      const learned = await learnedSenderAccountRepo.getByEmail(c.companyId, signals.requesterEmail);
      if (learned && augmentedCandidates.some((a) => a.id === learned.accountId)) {
        learnedAccountId = learned.accountId;
        learnedIsRoleAddress = learned.isRoleAddress;
      }
    } catch (err) {
      // Defensive: log + devam. learned'siz fallback davranış.
      console.warn('[suggestCustomerMatches] learned lookup fail',
        err?.message ?? err);
    }
  }

  // M2.2 (4) — Placeholder telefon filtresi: aday havuzunda bir signal
  // telefon PLACEHOLDER_PHONE_THRESHOLD'dan fazla farklı hesapla eşleşiyorsa
  // discriminator değildir. Augment edilmiş havuz üzerinden hesapla.
  const placeholderPhones = new Set();
  if (signals.phones.length > 0) {
    for (const p of signals.phones) {
      if (!p) continue; // Codex P2: null normalize sonucu atla
      let hits = 0;
      for (const a of augmentedCandidates) {
        const ap = [a.phone, ...a.contacts.map((c) => c.phone)]
          .filter(Boolean)
          .map(normalizePhone)
          .filter(Boolean);
        if (ap.includes(p)) {
          hits += 1;
          if (hits > PLACEHOLDER_PHONE_THRESHOLD) {
            placeholderPhones.add(p);
            break;
          }
        }
      }
    }
  }

  const scoreCtx = { placeholderPhones, learnedAccountId };

  const scored = augmentedCandidates
    .map((a) => {
      const { score, confidence, reasons } = scoreCandidate(a, signals, scoreCtx);
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

  // M2.3 — Intake auto-link kararı için learned info açıkça döndürülür.
  // null → öğrenilmiş eşleme yok / aday değil; obj varsa kişisel/rol bilgi.
  const learnedMeta = learnedAccountId
    ? { accountId: learnedAccountId, isRoleAddress: learnedIsRoleAddress }
    : null;

  return {
    suggestions,
    generatedAt: new Date().toISOString(),
    learned: learnedMeta,
  };
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
