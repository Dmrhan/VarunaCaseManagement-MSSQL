/**
 * Inbound Mail Intake — parsed e-posta → MEVCUT case create/append path.
 *
 * KURAL: REUSE — yeni model/eşleştirici/case-create yazmıyoruz.
 *   • Müşteri eşleştirme: customerMatchRepository.suggestCustomerMatches
 *     (Phase D Step 2 deterministic engine). Sinyaller intake field'lara
 *     (customerContactEmail/Name/CompanyName) yazılır → engine extract eder.
 *   • Vaka açma: caseRepository.create (Phase D müşterisiz akış zaten yerleşik
 *     — accountId=null ise customerMatchPending=true).
 *   • Otomatik bağlama (yüksek güven): caseRepository.linkAccount.
 *   • Thread reply: caseRepository.addNote.
 *
 * Karar matrisi:
 *
 *   A) Thread eşleşmesi (öncelik 1)
 *      - Subject'te [VK-xxx] token → mevcut vakaya addNote (yeni vaka AÇMA).
 *      - inReplyTo/references parse edilir ama M2'de eşleştirilemez
 *        (Case.threadMessageId field yok → M4'te tam threading).
 *
 *   B) Müşteri eşleştirme (vaka YENİ açılırken)
 *      - Vaka önce accountId=null ile açılır (Phase D müşterisiz yol,
 *        customerMatchPending=true otomatik).
 *      - suggestCustomerMatches çağrılır.
 *      - En iyi öneri confidence='High' + sebebi 'email' ise linkAccount
 *        (otomatik bağlama, yüksek güven).
 *      - Aksi halde vaka açık kalır; Supervisor sırasına düşer (mevcut akış).
 *      - Mail ASLA düşürülmez.
 *
 * Gizlilik (mevcut kural korunur):
 *   - customerContact alanları ve customerCompanyName analytics/AI
 *     payload'larına EKLENMEZ (sadece DB persist + UI requester context'inde
 *     gösterim).
 *
 * Stil: server/lib/devopsClient.js + mailProvider.js + inboundMailParser.js
 * (ESM .js, wrapped response, custom error class, throw etmez).
 */

import { randomUUID } from 'node:crypto';
import { caseRepository } from '../db/caseRepository.js';
import { caseEmailRepository } from '../db/caseEmailRepository.js';
import { customerMatchRepository } from '../db/customerMatchRepository.js';
import { emitEvent as emitNotificationEvent } from '../db/notificationRepository.js';
import { externalMailInboxRepo } from '../db/externalMailInboxRepository.js';
import { saveObject } from '../db/storage.js';
import { isAcceptedUpload } from './uploadWhitelist.js';
import { isInternalAddress, getInternalAddresses } from './internalAddressCache.js';
import { sanitizeIncomingEmailHtml } from './htmlSanitizer.js';
import { prisma } from '../db/client.js';

const RAW_SOURCE = 'inbound-mail-intake';

// M2.1 — Mail ekleri için boyut sınırı. Mevcut HTTP upload limiti
// (server/routes/cases.js:72 express.raw limit '25mb') ile uyumlu.
const MAIL_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

// Codex P2 fix — Per-case attachment cap. caseRepository.requestUpload
// (caseRepository.js:2825) FILE_MAX_COUNT = 20 sınırını HTTP upload
// akışında enforce ediyor. Mail intake bypass etmemeli; aynı limit.
const CASE_FILE_MAX_COUNT = 20;

// M2.1 — Sistem-tetikli upload aktörü. CaseAttachment.uploadedBy string
// alanına yazılır; uploadedByUserId NULL (User FK yok — intake bir kullanıcı
// değil).
const SYSTEM_UPLOADER = 'E-posta';

/**
 * M2.1 — Sistem-tetikli düşük seviye disk-yazma + caseAttachment.create.
 *
 * Tarayıcı upload akışı (caseRepository.finalizeUpload + signed token)
 * kullanıcı kimliği bağlıdır; gelen mail SİSTEM tetikli olduğu için
 * direkt storage.saveObject + caseAttachment satırı.
 *
 * - attachmentId cuid değil randomUUID (storage.js buildPath sadece string
 *   bekler, format-agnostic).
 * - safeName storage.buildPath içinde otomatik normalize ediliyor
 *   (regex non-word → '_').
 * - uploadedBy='E-posta', uploadedByUserId=null (User FK yok).
 * - CaseHistory 'Dosya yüklendi' (FileUploaded) actor=SYSTEM_UPLOADER.
 *
 * Wrapped şekilde { ok, attachmentId, fileName, size } veya { ok:false, error }
 * döner. Caller intake throw etmez — stored/skipped counts'a yansır.
 */
async function writeCaseFile({ caseId, companyId, filename, contentType, content, prisma }) {
  const attachmentId = randomUUID();
  // buildPath storage.js internal; orada safeName + caseId path normalize.
  // saveObject mkdir + writeFile yapar.
  const relPath = `cases/${caseId}/${attachmentId}-${(filename ?? 'unnamed').replace(/[^\w.\-]+/g, '_').slice(0, 120)}`;
  await saveObject(relPath, content);
  const row = await prisma.caseAttachment.create({
    data: {
      id: attachmentId,
      caseId,
      companyId,
      fileName: filename ?? 'unnamed',
      fileSize: content.length,
      mimeType: contentType ?? 'application/octet-stream',
      fileUrl: relPath,
      uploadedBy: SYSTEM_UPLOADER,
      uploadedByUserId: null,
    },
  });
  // CaseActivity 'Dosya yüklendi' — finalizeUpload deseni
  // (caseRepository.js:~2920; "history" relation Case.history → CaseActivity model).
  await prisma.caseActivity.create({
    data: {
      caseId,
      companyId,
      action: 'Dosya yüklendi',
      actionType: 'FileUploaded',
      fieldName: 'files',
      toValue: row.fileName,
      actor: SYSTEM_UPLOADER,
      actorUserId: null,
    },
  });
  // M6.3a — storageKey (relPath) caller'a döner; CaseEmailAttachment
  // yazımı için.
  return { attachmentId, fileName: row.fileName, size: row.fileSize, storageKey: relPath };
}

/**
 * M2.1 — Tüm parsed.attachments'i (ek + inline/cid) vakaya bağla.
 *
 * Filter: isAcceptedUpload(mime, name) — mevcut allowlist (forge-safe).
 * Boyut: MAIL_ATTACHMENT_MAX_BYTES (25mb HTTP limitiyle uyumlu).
 * Hata: tek bir ek fail → atla + skipped'a düş (intake DÜŞÜRÜLMEZ).
 *
 * @returns {Promise<{ stored: number, skipped: Array<{filename: string|null, reason: string}> }>}
 */
async function persistAttachmentsForCase({ caseId, companyId, attachments, prisma, emailId = null }) {
  const stored = [];
  const skipped = [];
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return { stored: 0, skipped: [] };
  }
  // Codex P2 fix — Cap enforcement. Mevcut attachment count alınır;
  // remaining slots hesaplanır. Cap aşımı → skipped:
  // 'attachment_cap_reached'.
  const existingCount = await prisma.caseAttachment.count({ where: { caseId } });
  let remaining = Math.max(0, CASE_FILE_MAX_COUNT - existingCount);

  for (const a of attachments) {
    const filename = a?.filename ?? null;
    const contentType = a?.contentType ?? null;
    const content = a?.content;
    if (!content || !Buffer.isBuffer(content) || content.length === 0) {
      skipped.push({ filename, reason: 'empty_content' });
      continue;
    }
    if (content.length > MAIL_ATTACHMENT_MAX_BYTES) {
      skipped.push({ filename, reason: 'too_large' });
      continue;
    }
    if (!isAcceptedUpload(contentType, filename ?? '')) {
      skipped.push({ filename, reason: 'mime_not_accepted' });
      continue;
    }
    // Cap check — geçerli (allowlist + boyut) ek için kontrol.
    // Format kontrolleri ile sonra: mime-reject'i cap'e SAYMAYIZ; yalnız
    // gerçekten yazılacak ekler slot tüketir.
    if (remaining <= 0) {
      skipped.push({ filename, reason: 'attachment_cap_reached' });
      continue;
    }
    try {
      const saved = await writeCaseFile({
        caseId,
        companyId,
        filename,
        contentType,
        content,
        prisma,
      });
      stored.push(saved);
      remaining -= 1;

      // M6.3a — emailId varsa CaseEmailAttachment satırı da yaz.
      // Inbound cid/inline metadata burada saklanır → render aşamasında
      // bodyHtml'deki cid:xxx referansları bu satırlarla eşlenir.
      // writeCaseFile saved.path veya saved.fileUrl döner (storage path);
      // shape detayı db/storage.js'ye bağlı, defansif erişim.
      if (emailId) {
        const storageKey = saved?.storageKey ?? saved?.path ?? saved?.fileUrl ?? saved?.relPath ?? null;
        if (storageKey) {
          try {
            await prisma.caseEmailAttachment.create({
              data: {
                emailId,
                storageKey,
                fileName: filename ?? 'dosya',
                mimeType: contentType ?? 'application/octet-stream',
                fileSize: content.length,
                contentId: a?.cid ?? null,
                isInline: !!a?.inline,
              },
            });
          } catch (e) {
            // CaseEmailAttachment fail → CaseAttachment kayıt yine sağlam;
            // sadece cid render etkilenebilir. Loglanır, intake düşürülmez.
            console.warn('[intake] caseEmailAttachment create failed',
              e?.message ?? e);
          }
        }
      }
    } catch (err) {
      // Disk/DB write fail → atla + skipped (intake düşürülmez)
      skipped.push({ filename, reason: 'write_failed' });
    }
  }
  return { stored: stored.length, skipped };
}

// Subject'te [PREFIX-xxx] token ararız. Case caseNumber iki format:
//   Legacy (2026-06 öncesi): `VK-${Date.now().toString(36).toUpperCase()}`
//                            → VK- sabit prefix + base36 uppercase harf+rakam.
//   Yeni (2026-07-01+):      `${Company.caseNumberPrefix}-${caseSeq}`
//                            → 2-4 harf prefix + tire + 7+ hane RAKAM (bigint).
//
// Codex P2 (round 1) — format-tight + try-all-candidates:
//   Önceki genel regex `[A-Z]{2,4}-[0-9A-Z]+` şüpheli dış referansları da
//   yakalıyordu (ör. "[AB-123] Re: ... [VK-MABC]" → önce AB-123 match, case
//   bulunmaz, fallthrough → yeni vaka açar, gerçek yanıt kaybolur).
//
//   Fix iki katman:
//     1) Regex TIGHT: legacy VK-XXX VEYA yeni 2-4 harf + 7+ hane RAKAM.
//        Dış referansların büyük çoğunluğu bu iki desene uymaz (ör. Jira
//        "ABC-123" 3 haneli → elenir; kısa Azure ID "AB-4567" → elenir).
//     2) matchAll ile TÜM eşleşmeler → intake her token'ı DB'de dener,
//        ilk resolve olan kullanılır. Bir dış referans + bir Varuna token
//        aynı subject'te olursa yine doğru case bulunur.
const SUBJECT_CASE_TOKEN_RE = /\[(VK-[0-9A-Z]+|[A-Z]{2,4}-\d{7,})\]/gi;

// Default vaka değerleri (M2 — mail intake için). Agent sonradan değiştirir.
const DEFAULT_CASE_TYPE = 'GeneralSupport';
const DEFAULT_PRIORITY = 'Medium';
const DEFAULT_CATEGORY = 'Genel';
const DEFAULT_SUBCATEGORY = 'E-posta';
const DEFAULT_REQUEST_TYPE = 'Bilgi';

function extractDomain(email) {
  if (!email || typeof email !== 'string') return null;
  const at = email.indexOf('@');
  return at > 0 ? email.slice(at + 1).toLowerCase() : null;
}

function truncate(s, max) {
  if (!s) return s;
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * Header threading — In-Reply-To + References Message-ID'lerini topla.
 *
 * mailparser (imapPoller kaynağı) `parsed.inReplyTo` string, `parsed.references`
 * genelde string array VEYA space-separated string döner. Defensive: her iki
 * biçim de handle edilir. Duplicate ID'ler dedupe edilir; boş/whitespace atılır.
 *
 * Format: RFC 5322 Message-ID `<...@host>` (angle bracket dahil). CaseEmail
 * tablosunda messageId aynı formatta saklanır → direkt eşleşme.
 *
 * @returns {string[]} Aday Message-ID'ler (dedupe, non-empty)
 */
function collectHeaderMessageIds(parsed) {
  const ids = new Set();
  if (parsed?.inReplyTo && typeof parsed.inReplyTo === 'string') {
    const clean = parsed.inReplyTo.trim();
    if (clean) ids.add(clean);
  }
  const refs = parsed?.references;
  if (Array.isArray(refs)) {
    for (const r of refs) {
      if (typeof r === 'string' && r.trim()) ids.add(r.trim());
    }
  } else if (typeof refs === 'string' && refs.trim()) {
    // Bazı parser'lar references'ı space-separated string olarak verir.
    for (const r of refs.split(/\s+/)) {
      if (r.trim()) ids.add(r.trim());
    }
  }
  return [...ids];
}

/**
 * Subject'ten TÜM [PREFIX-xxx] token'larını çıkar (sıralı). Yoksa [].
 *
 * Codex P2 (round 1): tek match yerine tüm match'ler — çoklu bracket'lı
 * subject'lerde (ör. dış referans + Varuna token birlikte) intake her
 * candidate'i DB'de dener, ilk resolve olan case kullanılır.
 */
function extractCaseTokensFromSubject(subject) {
  if (!subject || typeof subject !== 'string') return [];
  const out = [];
  const seen = new Set();
  // Regex `g` flag'li → matchAll güvenli. State paylaşımı yok.
  for (const m of subject.matchAll(SUBJECT_CASE_TOKEN_RE)) {
    const token = m[1].toUpperCase();
    if (!seen.has(token)) {
      seen.add(token);
      out.push(token);
    }
  }
  return out;
}

/**
 * Mail metnini case description'a normalize et. text > html (M2'de basit;
 * M4 daha gelişmiş HTML→text dönüşümü ve sanitization).
 *
 * M2.2 (3) — Signature/footer + quoted reply blokları ayıkla. Temiz gövde
 * hem case açıklamasına hem de eşleştirme motoruna gider — signature
 * telefonu/email'i gürültü olarak match etmesin diye.
 */
function buildDescription(parsed) {
  const text = parsed?.text?.trim();
  if (text) return stripSignatureAndQuotes(text);
  // M2 minimum HTML stripping — gerçek HTML→text M4'te (daha güvenli lib).
  const html = parsed?.html?.trim();
  if (html) {
    const stripped = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return stripSignatureAndQuotes(stripped);
  }
  return '(boş gövde)';
}

/**
 * M2.2 (3) — Signature/footer + quoted reply strip.
 *
 * Kuralları (defensive; yanlış pozitif minimal tutuluyor):
 *   - RFC 3676 imza ayıracı: "-- \n" (tire-tire-boşluk-newline) → sonrası
 *     KESİLİR (imza bloğu).
 *   - Common reply markers ile başlayan satırdan itibaren KESİLİR:
 *       "On <date>, <person> wrote:" (TR/EN)
 *       "----- Original Message -----"
 *       "From: ...", "Sent: ...", "Subject: ..." inline alıntı header'ları
 *       "<isim> şu tarihte yazdı:"
 *   - "> " ile başlayan satırlar (mail quote prefix) ATILIR.
 *
 * Çıktı: temiz gövde. Boş kalırsa orijinal kısaltılmış parça döner
 * (gövde tamamen quote'tan oluşuyorsa görsel bilgi kaybı yok).
 *
 * @param {string} raw
 * @returns {string}
 */
export function stripSignatureAndQuotes(raw) {
  if (!raw || typeof raw !== 'string') return raw ?? '';

  // 1) RFC 3676 imza ayıracı: "\n-- \n" veya satır olarak "-- "
  // Çoklu sürüm: bazı client'lar trailing whitespace eklemez; her ikisini destekle.
  const sigPatterns = [
    /\n--\s*\n[\s\S]*$/,    // multi-line signature blok
    /\n--\s*$/,             // signature ayıracı dosya sonunda
  ];
  let cleaned = raw;
  for (const re of sigPatterns) {
    cleaned = cleaned.replace(re, '');
  }

  // 2) Reply marker'larından itibaren kes
  const replyMarkers = [
    /\n\s*-+\s*Original Message\s*-+/i,
    /\n\s*On\s+.{1,80}\s+wrote:\s*$/im,
    /\n\s*.{1,80}\s+şu tarihte\s+.{1,30}\s+yazdı:/i,
    /\n\s*From:\s+.{1,200}\nSent:\s+/i, // inline forwarded header
  ];
  for (const re of replyMarkers) {
    const m = cleaned.match(re);
    if (m && m.index !== undefined) {
      cleaned = cleaned.slice(0, m.index);
      break;
    }
  }

  // 3) Satır satır: "> " ile başlayanları at (quote prefix)
  cleaned = cleaned
    .split(/\r?\n/)
    .filter((line) => !/^\s*>+\s/.test(line))
    .join('\n');

  const trimmed = cleaned.trim();
  if (trimmed.length === 0) {
    // Tamamen quoted'sa orijinalin başını döndür (kayıp önle)
    return raw.trim().slice(0, 500);
  }
  return trimmed;
}

/**
 * En iyi suggest engine önerisini değerlendir.
 *
 * Otomatik bağlama kuralı: en yüksek-skorlu öneride 'email' type reason
 * var (= exact email match Account.email VEYA Contact.email).
 *
 * Engine konvansiyonu (customerMatchRepository.js:267):
 *   score >= 70 → 'high', >= 40 → 'medium', else 'low'
 * Email-only match'i 50 puan veriyor → confidence='medium'. Ama email exact
 * match kendi başına yüksek-güven sinyal (Phase D Step 2 doc). Plan'da
 * "tam e-posta eşleşmesi → otomatik bağla" dendiği için confidence
 * etiketinden bağımsız olarak email reason VARSA otomatik bağlanır.
 *
 * @returns { auto: boolean, accountId: string|null, confidence, reasons }
 */
function pickAutoLinkSuggestion(suggestions, engineMeta = {}) {
  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    return { auto: false, accountId: null, confidence: null, reasons: [] };
  }
  const best = suggestions[0]; // en yüksek score (engine sıralı döndürür)
  const hasEmail = Array.isArray(best.reasons)
    && best.reasons.some((r) => r?.type === 'email');

  // M2.3 — Öğrenilen sender eşlemesi tetikleyicisi.
  // engineMeta.learned (suggestCustomerMatches return shape) varsa:
  //   - isRoleAddress=false (kişisel) → auto-link OK
  //   - isRoleAddress=true (rol adres) → SADECE öneri, auto-link YOK
  // Best suggestion'da 'learned' reason var ve engine.learned kişisel ise
  // auto kabul edilir.
  const hasLearned = Array.isArray(best.reasons)
    && best.reasons.some((r) => r?.type === 'learned');
  const learnedAutoOk = hasLearned
    && engineMeta.learned
    && !engineMeta.learned.isRoleAddress
    && engineMeta.learned.accountId === best.accountId;

  const auto = hasEmail || learnedAutoOk;
  return {
    auto,
    accountId: auto ? best.accountId : null,
    confidence: best.confidence ?? null,
    reasons: best.reasons ?? [],
    triggeredBy: hasEmail ? 'email_exact' : (learnedAutoOk ? 'learned_personal' : null),
  };
}

/**
 * Inbound mail intake — parsed .eml → vaka oluştur veya mevcuda ekle.
 *
 * @param {object} input
 * @param {object} input.parsed - inboundMailParser.parseInboundEml.data
 * @param {string} input.companyId - hangi tenant'a açılacak (M5'te
 *   per-tenant mailbox config'inden gelecek; M2'de parametre)
 * @param {string} input.companyName - tenant adı (NewCaseInput zorunlu)
 * @param {{ userId: string|null, displayName: string, personId: string|null,
 *   fullName: string|null, email: string|null, role: string|null }} input.actor
 *   - Sistem aktörü için ör: { displayName: 'system:mail-intake', userId: null, ... }
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   caseId?: string,
 *   action?: 'created'|'appended',
 *   match?: { confidence: string|null, accountId: string|null, reasons: Array<object> },
 *   token?: string|null,                       // thread eşleşmesinde bulunan VK token
 *   error?: { code: string, message: string, status?: number },
 *   meta?: { intakedAt: string, rawSource: string }
 * }>}
 */
export async function intakeInboundEmail({
  parsed,
  companyId,
  companyName,
  // Multi-Inbox A3 — inboxId set ise vaka inbox'a bağlı assignedTeamId'ye
  // (havuz) atanır. null/undefined ise eski davranış: takım atanmaz,
  // global havuz. Backward compat — eski caller'lar (örn. test/integration
  // smoke) inboxId göndermezse intake çalışmaya devam eder.
  inboxId = null,
  actor,
} = {}) {
  const intakedAt = new Date().toISOString();

  if (!parsed || !parsed.from || !parsed.from.email) {
    return {
      ok: false,
      error: {
        code: 'intake_input_invalid',
        message: 'parsed.from.email zorunlu (inboundMailParser çıktısı).',
        status: 400,
      },
      meta: { intakedAt, rawSource: RAW_SOURCE },
    };
  }
  if (!companyId || !companyName) {
    return {
      ok: false,
      error: {
        code: 'intake_company_required',
        message: 'companyId + companyName zorunlu.',
        status: 400,
      },
      meta: { intakedAt, rawSource: RAW_SOURCE },
    };
  }
  if (!actor || typeof actor.displayName !== 'string' || !actor.displayName) {
    return {
      ok: false,
      error: {
        code: 'intake_actor_required',
        message: 'actor.displayName zorunlu (sistem aktörü için en az displayName).',
        status: 400,
      },
      meta: { intakedAt, rawSource: RAW_SOURCE },
    };
  }

  const allowedCompanyIds = [companyId];

  // ─── A) THREAD eşleşmesi (subject token'ları) ─────────────────────
  // Codex P2 (round 1): birden fazla token varsa (dış referans + Varuna)
  // her birini sırayla DB'de dene, ilk resolve olan case kullanılır.
  const tokens = extractCaseTokensFromSubject(parsed.subject);
  // Response `token` alanı için — resolve olan token (yoksa ilk candidate).
  let token = tokens[0] ?? null;
  // Codex P2 R1 fix (2026-07-03) — Header threading gate flag'i.
  // ÖNCESINDE `if (!token)` guard'ı vardı ama tokens[0] her zaman set
  // edildiği için (candidate resolve olmasa bile), dış referanslı Re:
  // (ör. [ABC-1234567] Varuna'da YOK + In-Reply-To gerçek) senaryosunda
  // header threading atlanıp mükerrer vaka açılırdı. Gate artık gerçek
  // resolve durumuna bağlı.
  let subjectTokenResolvedCase = false;
  if (tokens.length > 0) {
    // Mevcut vakaya CaseEmail olarak ekle — caseNumber ile lookup.
    try {
      const { prisma } = await import('../db/client.js');
      let existing = null;
      for (const cand of tokens) {
        // eslint-disable-next-line no-await-in-loop
        const row = await prisma.case.findFirst({
          where: { caseNumber: cand, companyId },
          select: { id: true, status: true, caseNumber: true },
        });
        if (row) {
          existing = row;
          token = cand;
          break;
        }
      }
      if (existing) {
        subjectTokenResolvedCase = true;
        // ─── K3 OVERRIDE (M6.1) ──────────────────────────────────
        // Plan: kapalı/terminal vakaya gelen yanıt → YENİ vaka aç
        // (otomatik link YOK; ilişkilendirme mevcut LinksTab ile manuel).
        // Terminal statüler DB enum (ASCII): 'Cozuldu' + 'IptalEdildi'.
        // (Prisma `existing.status` ham DB değeri döner — fromDb çağrısı
        // burada yapılmaz.)
        // ROLLBACK FLAG (R1): M6_K3_NEW_TICKET_ON_TERMINAL=false → eski
        // davranışa dön (terminal vakaya da append). Default açık (true).
        const TERMINAL_STATUSES_DB = new Set(['Cozuldu', 'IptalEdildi']);
        const k3Enabled = (process.env.M6_K3_NEW_TICKET_ON_TERMINAL ?? 'true') !== 'false';

        if (TERMINAL_STATUSES_DB.has(existing.status) && k3Enabled) {
          // Terminal vakaya yanıt: token EŞLEŞTİ ama vaka kapalı →
          // YENİ vaka açma akışına düş (aşağıda B akışı çalışır).
          // Eski vakayla ilişkilendirme YOK — LinksTab'tan agent manuel.
          // (existing kayıtsayar değil; aşağı düşeriz.)
        } else {
          // Açık/Çalışan vakaya append (eski davranış + CaseEmail'a taşıma).
          const sanitizedHtml = sanitizeIncomingEmailHtml(parsed.html || parsed.text || buildDescription(parsed));
          const inboundEmail = await caseEmailRepository.appendInbound({
            caseId: existing.id,
            companyId,
            from: { address: parsed.from.email, name: parsed.from.name ?? null },
            to: (parsed.to ?? []).map((r) => ({ address: r.email, name: r.name ?? null })),
            cc: (parsed.cc ?? []).map((r) => ({ address: r.email, name: r.name ?? null })),
            subject: parsed.subject ?? '',
            bodyHtml: sanitizedHtml,
            bodyText: parsed.text ?? null,
            messageId: parsed.messageId ?? null,
            inReplyTo: parsed.inReplyTo ?? null,
            refs: Array.isArray(parsed.references)
              ? parsed.references.join(' ')
              : (parsed.references ?? null),
            receivedAt: parsed.date instanceof Date ? parsed.date : new Date(),
            rawSize: typeof parsed.rawSize === 'number' ? parsed.rawSize : null,
          });

          // M2.1 + M6.3a — Ekleri ve inline/cid görselleri vakaya bağla.
          // CaseAttachment'a yazım korunur (Files tab'ında erişilebilir);
          // CaseEmailAttachment satırı da yazılır (emailId varsa) → cid
          // rewrite render zamanı bunlarla eşlenir.
          //
          // Codex review fix — deduped ise ek YAZMA. appendInbound
          // companyId+messageId @@unique ile dedupe ediyor; bu durumda
          // inboundEmail.id ESKİ satırın id'si olabilir → yeni storage
          // path'leri eski thread'e bağlamak yanlış (mükerrer/çapraz
          // veri). Aynı şekilde CaseAttachment yazımı da gereksiz
          // (önceki intake'te yazıldı).
          let attachmentsResult = { stored: 0, skipped: [], note: 'deduped_skipped' };
          if (!inboundEmail.deduped) {
            attachmentsResult = await persistAttachmentsForCase({
              caseId: existing.id,
              companyId,
              attachments: parsed.attachments ?? [],
              prisma,
              emailId: inboundEmail.id,
            });
          }

          return {
            ok: true,
            caseId: existing.id,
            action: inboundEmail.deduped ? 'appended_deduped' : 'appended',
            match: { confidence: null, accountId: null, reasons: [] },
            token,
            attachments: attachmentsResult,
            caseEmail: { id: inboundEmail.id, deduped: inboundEmail.deduped },
            meta: { intakedAt, rawSource: RAW_SOURCE },
          };
        }
      }
      // Token var ama eşleşen vaka yok — fall through: yeni vaka aç.
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'intake_thread_lookup_failed',
          message: err?.message ?? 'Thread lookup hatası.',
          status: 500,
        },
        meta: { intakedAt, rawSource: RAW_SOURCE },
      };
    }
  }

  // ─── A2) HEADER THREADING (2026-07-03 fix) ────────────────────────
  // Senaryo: müşteri konu satırında [PREFIX-xxx] token'ı OLMADAN aynı
  // zincire cevap verir (ör. ek unuttu → Re: kendi mailine ek gönderir;
  // token bizim ACK'imizde vardı, kendi mailinde yok). Sistem token
  // bulamayınca MÜKERRER vaka açardı.
  //
  // Fix: parsed.inReplyTo + parsed.references içindeki Message-ID'leri
  // CaseEmail.messageId'de ara. Bulunan case terminal ise K3 (yeni vaka),
  // değilse mevcut vakaya append.
  //
  // Guard'lar:
  // - companyId scoped lookup (@@unique[companyId, messageId] — cross-tenant sızıntı yok)
  // - inbound + outbound satırlar taranır (müşteri bizim ACK'imize de cevap verebilir)
  // - Eşleşen vaka BAŞKA müşteriye bağlıysa müşteri değiştirilmez (accountId dokunulmaz)
  // - Terminal + k3Enabled → yeni vaka (mevcut K3 davranışı korunur)
  // - En yeni CaseEmail eşleşmesi (birden çok match olursa) — receivedAt/sentAt desc
  let headerMatchedMessageId = null;
  // Codex P2 R1 fix (2026-07-03): Guard artık `!token` DEĞİL — çünkü
  // token = tokens[0] ?? null; ilk candidate resolve olmasa bile set
  // edilir. Dış referanslı Re: ([ABC-1234567] Varuna'da YOK + gerçek
  // In-Reply-To) senaryosunda önceki guard header threading'i
  // atlayıp mükerrer vaka açardı. Artık gate gerçek resolve flag'ine
  // bağlı (token flow eşleşme buldu mu?). Terminal K3 durumunda
  // subjectTokenResolvedCase = true olduğu için header threading
  // tekrar çalışmaz (aynı case'e ikinci lookup gereksiz).
  if (!subjectTokenResolvedCase) {
    const headerIds = collectHeaderMessageIds(parsed);
    if (headerIds.length > 0) {
      try {
        const { prisma } = await import('../db/client.js');
        const matchedEmail = await prisma.caseEmail.findFirst({
          where: { companyId, messageId: { in: headerIds } },
          select: { caseId: true, messageId: true },
          // En yeni eşleşen — birden fazla ID match olursa deterministic
          orderBy: { createdAt: 'desc' },
        });
        if (matchedEmail) {
          const existing = await prisma.case.findFirst({
            where: { id: matchedEmail.caseId, companyId },
            select: { id: true, status: true, caseNumber: true },
          });
          if (existing) {
            const TERMINAL_STATUSES_DB = new Set(['Cozuldu', 'IptalEdildi']);
            const k3Enabled = (process.env.M6_K3_NEW_TICKET_ON_TERMINAL ?? 'true') !== 'false';

            if (TERMINAL_STATUSES_DB.has(existing.status) && k3Enabled) {
              // Terminal vakaya header-eşleşen cevap → K3: yeni vaka aç.
              // (mevcut token flow'dakiyle aynı davranış; existing kayıtsayar
              // değil, aşağı düşeriz.)
              headerMatchedMessageId = matchedEmail.messageId; // audit için
            } else {
              // Açık/Çalışan vakaya append — token flow'daki appendInbound
              // deseninin AYNISI. Ekler + persistAttachments dahil.
              const sanitizedHtml = sanitizeIncomingEmailHtml(parsed.html || parsed.text || buildDescription(parsed));
              const inboundEmail = await caseEmailRepository.appendInbound({
                caseId: existing.id,
                companyId,
                from: { address: parsed.from.email, name: parsed.from.name ?? null },
                to: (parsed.to ?? []).map((r) => ({ address: r.email, name: r.name ?? null })),
                cc: (parsed.cc ?? []).map((r) => ({ address: r.email, name: r.name ?? null })),
                subject: parsed.subject ?? '',
                bodyHtml: sanitizedHtml,
                bodyText: parsed.text ?? null,
                messageId: parsed.messageId ?? null,
                inReplyTo: parsed.inReplyTo ?? null,
                refs: Array.isArray(parsed.references)
                  ? parsed.references.join(' ')
                  : (parsed.references ?? null),
                receivedAt: parsed.date instanceof Date ? parsed.date : new Date(),
                rawSize: typeof parsed.rawSize === 'number' ? parsed.rawSize : null,
              });

              // Dedup guard — token flow'daki mantıkla aynı; deduped ise ek yazma.
              let attachmentsResult = { stored: 0, skipped: [], note: 'deduped_skipped' };
              if (!inboundEmail.deduped) {
                attachmentsResult = await persistAttachmentsForCase({
                  caseId: existing.id,
                  companyId,
                  attachments: parsed.attachments ?? [],
                  prisma,
                  emailId: inboundEmail.id,
                });
              }

              return {
                ok: true,
                caseId: existing.id,
                // Teşhis: 'appended_via_header' — token flow'dan ayırt etmek için.
                action: inboundEmail.deduped ? 'appended_deduped' : 'appended_via_header',
                match: { confidence: null, accountId: null, reasons: [] },
                token: null,
                headerMatch: { messageId: matchedEmail.messageId },
                attachments: attachmentsResult,
                caseEmail: { id: inboundEmail.id, deduped: inboundEmail.deduped },
                meta: { intakedAt, rawSource: RAW_SOURCE },
              };
            }
          }
        }
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'intake_header_threading_failed',
            message: err?.message ?? 'Header threading hatası.',
            status: 500,
          },
          meta: { intakedAt, rawSource: RAW_SOURCE },
        };
      }
    }
  }

  // ─── B) YENİ VAKA — Phase D müşterisiz yol + engine match ─────────
  const subject = parsed.subject?.trim() || `(konusuz e-posta — ${parsed.from.email})`;
  const description = buildDescription(parsed);
  const domain = extractDomain(parsed.from.email);

  // Multi-Inbox A3 — inbox routing.
  //
  // inboxId verildiyse repo'dan çek, assignedTeamId varsa Team'in adını da
  // resolve et. Team aktif değilse veya cross-tenant (defense-in-depth)
  // ise routing UYGULANMAZ (vaka takımsız havuza düşer, eski davranış).
  //
  // Routing'i caseRepository.create input'una m.assignedTeamId/Name olarak
  // geçiriyoruz; orada Person.teamId cascade'inin önüne geçer (caller-supplied
  // override; bkz. caseRepository:1378-1381).
  let routedTeamId = null;
  let routedTeamName = null;
  if (inboxId) {
    try {
      const inbox = await externalMailInboxRepo.findById(companyId, inboxId);
      if (inbox && inbox.assignedTeamId) {
        const team = await prisma.team.findUnique({
          where: { id: inbox.assignedTeamId },
          select: { name: true, companyId: true, isActive: true },
        });
        // Defense-in-depth — repo zaten aynı companyId kontrol ediyor ama
        // intake katmanında tekrar doğrula (Team silinmiş/passive olabilir).
        if (team && team.companyId === companyId && team.isActive) {
          routedTeamId = inbox.assignedTeamId;
          routedTeamName = team.name;
        }
      }
    } catch (err) {
      // Routing fail vakayı engellemesin — log + havuza düş.
      console.warn(
        `[intake] inbox routing lookup fail inboxId=${inboxId} companyId=${companyId}`,
        err?.message,
      );
    }
  }

  const newCaseInput = {
    title: truncate(subject, 200),
    description,
    caseType: DEFAULT_CASE_TYPE,
    priority: DEFAULT_PRIORITY,
    origin: 'E-posta',
    originDescription: `Inbound email · ${parsed.from.email}`,
    companyId,
    companyName,
    // accountId / accountName YOK → müşterisiz vaka (customerMatchPending=true otomatik)
    // Phase D Step 2 — başvuran intake field'ları (suggestCustomerMatches sinyalleri)
    customerContactEmail: parsed.from.email,
    customerContactName: parsed.from.name || null,
    customerCompanyName: domain || null,
    category: DEFAULT_CATEGORY,
    subCategory: DEFAULT_SUBCATEGORY,
    requestType: DEFAULT_REQUEST_TYPE,
    // Multi-Inbox A3 — inbox routing (havuz pattern; assignedPersonId YOK).
    // null ise caseRepository.create cascade'i normal (Person.teamId fallback
    // veya boş havuz). Set ise caller-override.
    assignedTeamId: routedTeamId,
    assignedTeamName: routedTeamName,
  };

  let created;
  try {
    created = await caseRepository.create(newCaseInput, actor);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: err?.code ?? 'intake_case_create_failed',
        message: err?.message ?? 'Vaka oluşturma hatası.',
        status: err?.status ?? 500,
      },
      meta: { intakedAt, rawSource: RAW_SOURCE },
    };
  }
  if (!created || !created.id) {
    return {
      ok: false,
      error: {
        code: 'intake_case_create_unknown',
        message: 'Vaka oluşturma bilinmeyen hata (null döndü).',
        status: 500,
      },
      meta: { intakedAt, rawSource: RAW_SOURCE },
    };
  }

  // Suggest engine çağır
  let match = { confidence: null, accountId: null, reasons: [] };
  try {
    const result = await customerMatchRepository.suggestCustomerMatches({
      caseId: created.id,
      allowedCompanyIds,
      limit: 5,
    });
    if (result && Array.isArray(result.suggestions)) {
      // M2.3 — engine response shape'inde learned meta'sı var; pick
      // fonksiyonu kişisel learned'i auto-link tetikleyicisi sayar.
      const pick = pickAutoLinkSuggestion(result.suggestions, { learned: result.learned });
      match = {
        confidence: pick.confidence,
        accountId: null, // doğrulama sonrası set edilir
        reasons: pick.reasons,
      };

      // F1 — İç adres koruması: forward eden Univera çalışanı senderEmail'i
      // iç adres setindeyse auto-link tamamen devre dışı kalır. Öneriler UI'da
      // görünmeye devam eder; vaka Supervisor kuyruğuna düşer.
      //
      // HOTFIX P1 (2026-07-03) — yerel try/catch: "mail düşürülmez" felsefesi.
      // isInternalAddress kendi içinde fail-open (boş Set döner) ama cache
      // dışı bir noktada beklenmedik throw olursa intake pipeline'ı burada
      // kırılmasın. Koruma devre dışı sayılır (senderIsInternal=false), akış
      // devam eder → mail case oluşturur. Yüksek sesle log.
      if (pick.auto) {
        let senderIsInternal = false;
        try {
          senderIsInternal = await isInternalAddress(parsed.from.email, companyId);
        } catch (err) {
          console.error(
            '[intake] isInternalAddress THROW — F1 devre dışı, akış devam',
            { companyId, sender: parsed.from.email, code: err?.code, message: err?.message },
          );
        }
        if (senderIsInternal) {
          console.info('[intake] iç adres — auto-link devre dışı', parsed.from.email);
          pick.auto = false;
          pick.triggeredBy = 'internal_address';
        }
      }

      // Codex P1 fix — Auto-link YALNIZ sender email eşleşmesinde.
      //
      // suggestCustomerMatches signals.emails'i case description'dan da
      // çıkarır (extractSignalsFromCase: text matchAll EMAIL_RX). Biz inbound
      // mail body'sini description'a koyduğumuz için, bilinmeyen göndericiden
      // gelen ama metninde başka müşterinin emaili geçen mail engine'i
      // yanlış yönlendirip yanlış müşteriye otomatik bağlanmasına yol açar
      // (engine reason.valueMasked maskedir, tam email vermez).
      //
      // Güvenlik için: önerilen account'un Account.email VEYA Contact.email
      // === sender email (parsed.from.email) eşleşmesini DB'den doğrulayalım.
      // Eşleşmiyorsa auto-link yapma; vaka Supervisor sırasına düşer.
      if (pick.auto && pick.accountId) {
        // M2.3 — Learned tetikleyici DB-doğrulamalı (learnedSenderAccount
        // satırı zaten manuel insan onayıydı); ekstra email guard'a gerek
        // yok. email_exact tetikleyicide ise Codex P1 sender-email guard
        // çalışır.
        let canLink = false;
        if (pick.triggeredBy === 'learned_personal') {
          canLink = true;
        } else {
          // email_exact path — Codex P1 sender guard
          const senderEmail = parsed.from.email; // normalize: parser lowercased
          const { prisma } = await import('../db/client.js');

          // F2 — Çakışan email koruması: aynı senderEmail birden fazla aktif
          // Account veya aktif Contact'ta kayıtlıysa otomatik bağlama güvenli
          // değil. Öneri sunulur, manuel doğrulama gerekir.
          // Aynı Account içindeki çoklu kontak tek müşteri sayılır.
          const distinctAccounts = await prisma.account.count({
            where: {
              isActive: true,
              companies: { some: { companyId: { in: allowedCompanyIds } } },
              OR: [
                { email: senderEmail },
                { contacts: { some: { isActive: true, email: senderEmail } } },
              ],
            },
          });
          if (distinctAccounts > 1) {
            console.info('[intake] çakışan email — birden fazla aktif müşteri eşleşti, auto-link devre dışı', senderEmail, distinctAccounts);
            canLink = false;
          } else {
            // Tekil eşleşme — mevcut Codex P1 sender guard
            const account = await prisma.account.findUnique({
              where: { id: pick.accountId },
              select: {
                email: true,
                contacts: { where: { isActive: true }, select: { email: true } },
              },
            });
            const accountEmails = [
              account?.email,
              ...(account?.contacts ?? []).map((c) => c.email),
            ]
              .filter(Boolean)
              .map((e) => String(e).trim().toLowerCase());
            canLink = accountEmails.includes(senderEmail);
          }
        }

        if (canLink) {
          try {
            // linkAccount route layer'da actor='string' (displayName);
            // sistem aktörü için actor.displayName (server/routes/cases.js:713).
            // M2.3 — source='auto' geç → öğrenme TETİKLEMEZ (intake'in
            // auto-link redundant; manuel link öğrenir).
            await caseRepository.linkAccount(
              created.id,
              pick.accountId,
              actor.displayName,
              allowedCompanyIds,
              { source: 'auto' },
            );
            match.accountId = pick.accountId;
          } catch (linkErr) {
            // linkAccount başarısız → vaka açık kalır. Mail düşürülmez.
            match.accountId = null;
          }
        }
        // senderMatches=false → engine eşleşmesi description'daki başka
        // bir emaildan kaynaklanmış olabilir. Auto-link YAPMA, vaka
        // Supervisor sırasına düşer (match.accountId null kalır).
      }
    }
  } catch {
    // Engine hata verirse vaka yine açık kalır. Mail düşürülmez.
  }

  // M6.1 — Yeni vakanın ilk inbound CaseEmail satırı. Vaka description'a
  // yazılan ham metnin yanında, "İletişim" tab'ında thread'in başı olarak
  // bu satır gösterilir. K3 OVERRIDE akışında da bu yol işler (terminal
  // vakaya gelen yanıt YENİ vaka açar; ilk CaseEmail satırı burada yazılır).
  // Hata kapsanır; vaka yine açık kalır (Mail düşürülmez).
  //
  // M6.3a — Sıra DEĞİŞTİ: önce CaseEmail (id alalım), sonra ekler
  // CaseEmailAttachment(emailId) ile yazılsın. Aksi halde cid/inline
  // metadata kaybolur.
  let firstEmail = { id: null, deduped: false };
  try {
    const sanitizedHtml = sanitizeIncomingEmailHtml(parsed.html || parsed.text || description);
    firstEmail = await caseEmailRepository.appendInbound({
      caseId: created.id,
      companyId,
      from: { address: parsed.from.email, name: parsed.from.name ?? null },
      to: (parsed.to ?? []).map((r) => ({ address: r.email, name: r.name ?? null })),
      cc: (parsed.cc ?? []).map((r) => ({ address: r.email, name: r.name ?? null })),
      subject: parsed.subject ?? '',
      bodyHtml: sanitizedHtml,
      bodyText: parsed.text ?? null,
      messageId: parsed.messageId ?? null,
      inReplyTo: parsed.inReplyTo ?? null,
      refs: Array.isArray(parsed.references)
        ? parsed.references.join(' ')
        : (parsed.references ?? null),
      receivedAt: parsed.date instanceof Date ? parsed.date : new Date(),
      rawSize: typeof parsed.rawSize === 'number' ? parsed.rawSize : null,
    });
  } catch (err) {
    // CaseEmail yazımı fail → vaka açık kalır. Loglanır; ek bilgi yok.
    console.warn('[inbound] caseEmail.appendInbound failed', err?.message ?? err);
  }

  // M2.1 + M6.3a — Ekleri ve inline/cid görselleri yeni vakaya bağla.
  // emailId varsa CaseEmailAttachment satırları da yazılır (cid render
  // için kritik).
  //
  // Codex review fix — firstEmail.deduped ise ek YAZMA. appendInbound
  // companyId+messageId @@unique ile dedupe ettiyse firstEmail.id ESKİ
  // satırın id'si (başka vakaya bağlı) olabilir → yeni vaka'nın
  // storage path'lerini eski email'e bağlamak yanlış.
  let attachmentsResult = { stored: 0, skipped: [] };
  try {
    const { prisma } = await import('../db/client.js');
    if (firstEmail.deduped) {
      attachmentsResult = { stored: 0, skipped: [], note: 'deduped_skipped' };
    } else {
      attachmentsResult = await persistAttachmentsForCase({
        caseId: created.id,
        companyId,
        attachments: parsed.attachments ?? [],
        prisma,
        emailId: firstEmail.id,
      });
    }
  } catch {
    // Ek persistence fail → vaka yine açık. Mail düşürülmez.
  }

  // M4.1 FAZ B — case_created event emission (Codex P1 fix konumu).
  //
  // Mail intake yeni vaka açtı (created) + customerMatch + linkAccount
  // BİTTİ. Bu noktada Case.accountId ya set'li (linkAccount başarılı) ya
  // da null (müşterisiz vaka — Supervisor sırasında). İkisi de OK:
  //   - accountId set → requester resolver opt-out gate uygular
  //   - accountId null → resolver email kullanır + opt-out skip
  //                      (henüz tanımlı müşteri yok, makul)
  //
  // KARDEŞ DESEN: caseRepository.update'teki case_closed/reopened +
  // status_changed emit'i (fire-and-forget void). Burada da aynı.
  void emitNotificationEvent({ event: 'case_created', caseId: created.id });

  return {
    ok: true,
    caseId: created.id,
    action: 'created',
    match,
    token: token ?? null,
    // Header threading K3 branch'i (terminal vakaya header-eşleşen cevap →
    // yeni vaka) audit için messageId'yi taşır; teşhis kolaylığı.
    ...(headerMatchedMessageId ? { headerMatch: { messageId: headerMatchedMessageId, k3: true } } : {}),
    attachments: attachmentsResult,
    caseEmail: firstEmail,
    meta: { intakedAt, rawSource: RAW_SOURCE },
  };
}

export const inboundMailIntake = {
  intakeInboundEmail,
};
