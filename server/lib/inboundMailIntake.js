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
import { saveObject } from '../db/storage.js';
import { isAcceptedUpload } from './uploadWhitelist.js';
import { sanitizeIncomingEmailHtml } from './htmlSanitizer.js';

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
  return { attachmentId, fileName: row.fileName, size: row.fileSize };
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
async function persistAttachmentsForCase({ caseId, companyId, attachments, prisma }) {
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
    } catch (err) {
      // Disk/DB write fail → atla + skipped (intake düşürülmez)
      skipped.push({ filename, reason: 'write_failed' });
    }
  }
  return { stored: stored.length, skipped };
}

// Subject'te [VK-xxx] token ararız. Case caseNumber pattern (caseRepository.js:1154):
//   const caseNumber = `VK-${Date.now().toString(36).toUpperCase()}`;
// → base36 uppercase, harf+rakam, değişken uzunluk. Token: [VK-...]
const SUBJECT_CASE_TOKEN_RE = /\[(VK-[0-9A-Z]+)\]/i;

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
 * Subject'ten [VK-xxx] token çıkar. Yoksa null.
 */
function extractCaseTokenFromSubject(subject) {
  if (!subject || typeof subject !== 'string') return null;
  const m = subject.match(SUBJECT_CASE_TOKEN_RE);
  return m ? m[1].toUpperCase() : null;
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

  // ─── A) THREAD eşleşmesi (subject token) ─────────────────────────
  const token = extractCaseTokenFromSubject(parsed.subject);
  if (token) {
    // Mevcut vakaya CaseEmail olarak ekle — caseNumber ile lookup.
    try {
      const { prisma } = await import('../db/client.js');
      const existing = await prisma.case.findFirst({
        where: { caseNumber: token, companyId },
        select: { id: true, status: true, caseNumber: true },
      });
      if (existing) {
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

          // M2.1 — Ekleri ve inline/cid görselleri vakaya bağla.
          // M6.1 not: CaseAttachment'a yazımı şimdilik koruyoruz (Files
          // tab'ında erişilebilir kalır); CaseEmailAttachment ayrı yazımı
          // composer (M6.2) sırasında devreye girer.
          const attachmentsResult = await persistAttachmentsForCase({
            caseId: existing.id,
            companyId,
            attachments: parsed.attachments ?? [],
            prisma,
          });

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

  // ─── B) YENİ VAKA — Phase D müşterisiz yol + engine match ─────────
  const subject = parsed.subject?.trim() || `(konusuz e-posta — ${parsed.from.email})`;
  const description = buildDescription(parsed);
  const domain = extractDomain(parsed.from.email);

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

  // M2.1 — Ekleri ve inline/cid görselleri yeni vakaya bağla.
  let attachmentsResult = { stored: 0, skipped: [] };
  try {
    const { prisma } = await import('../db/client.js');
    attachmentsResult = await persistAttachmentsForCase({
      caseId: created.id,
      companyId,
      attachments: parsed.attachments ?? [],
      prisma,
    });
  } catch {
    // Ek persistence fail → vaka yine açık. Mail düşürülmez.
  }

  // M6.1 — Yeni vakanın ilk inbound CaseEmail satırı. Vaka description'a
  // yazılan ham metnin yanında, "İletişim" tab'ında thread'in başı olarak
  // bu satır gösterilir. K3 OVERRIDE akışında da bu yol işler (terminal
  // vakaya gelen yanıt YENİ vaka açar; ilk CaseEmail satırı burada yazılır).
  // Hata kapsanır; vaka yine açık kalır (Mail düşürülmez).
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

  return {
    ok: true,
    caseId: created.id,
    action: 'created',
    match,
    token: token ?? null,
    attachments: attachmentsResult,
    caseEmail: firstEmail,
    meta: { intakedAt, rawSource: RAW_SOURCE },
  };
}

export const inboundMailIntake = {
  intakeInboundEmail,
};
