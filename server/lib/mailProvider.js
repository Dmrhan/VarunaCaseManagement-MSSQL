/**
 * Mail Provider — gönderim katmanı (M1 IT-bağımsız yarı).
 *
 * Yol haritası:
 *   M1 (BU): SMTP send + Ethereal probe. IT-bağımsız doğrulama.
 *   M2: Gelen .eml ayrıştırma + müşteri eşleştirme + origin="E-posta"
 *       (yeni eşleştirici YAZILMAZ; mevcut deterministic suggestion engine'e
 *       sinyaller beslenir).
 *   M3: Gerçek mailbox IMAP polling (Gmail/Google Workspace).
 *   M4: Giden şablon + dispatch (notification rule, threading, LogOnly→Active).
 *   M5: Per-tenant admin config (ExternalSetting deseni — bkz.
 *       externalDevOpsSettingRepository.js) + secretCipher ile şifreli sırlar.
 *
 * Bu modülün BU PR kapsamı:
 *   - sendMail({ to, subject, text, html, from, replyTo, headers })
 *   - Transport seçimi env'den: MAIL_TRANSPORT=ethereal|smtp
 *   - Auth pluggable seam (şimdilik password; OAuth2 yapısı yorum olarak)
 *   - readInbox()/IMAP — M3'te (TODO yorum)
 *
 * Stil: server/lib/devopsClient.js ile aynı (ESM .js, wrapped response,
 * config resolver, custom error class, lazy import).
 */

import nodemailer from 'nodemailer';

const RAW_SOURCE = 'mail-provider';
const DEFAULT_FROM = 'Varuna <no-reply@univera.com.tr>';

export class MailProviderError extends Error {
  constructor(message, { code = 'mail_provider_error', status = 500 } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Mail config — env-driven, M1 kapsamı.
 *
 * Karar matrisi:
 *   - MAIL_TRANSPORT=ethereal (default) → nodemailer.createTestAccount()
 *     ile anında sahte SMTP. previewUrl ile mesajı browser'da göster.
 *   - MAIL_TRANSPORT=smtp → SMTP_HOST/PORT/SECURE/USER/PASS gerçek transport.
 *
 * Auth:
 *   - MAIL_AUTH=password (default) → user/pass ile auth.
 *   - MAIL_AUTH=oauth2 → M5'te. Şimdilik throw.
 *
 * NOT: secretCipher entegrasyonu M5'te (per-tenant ExternalSetting).
 * Şimdilik SMTP_PASS düz env — production'a koyma.
 */
function resolveConfig() {
  const transport = (process.env.MAIL_TRANSPORT || 'ethereal').toLowerCase();
  const auth = (process.env.MAIL_AUTH || 'password').toLowerCase();
  const from = process.env.MAIL_FROM || DEFAULT_FROM;

  if (auth !== 'password') {
    // OAuth2 plugin seam — M5'te eklenecek. Buraya
    // refresh_token/access_token/client_id/secret çözücüsü gelecek.
    throw new MailProviderError(
      `MAIL_AUTH=${auth} henüz desteklenmiyor (M5'te OAuth2).`,
      { code: 'mail_auth_unsupported', status: 501 },
    );
  }

  if (transport === 'ethereal') {
    return { transport, auth, from };
  }

  if (transport === 'smtp') {
    const host = process.env.SMTP_HOST;
    const port = Number.parseInt(process.env.SMTP_PORT, 10) || 587;
    const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!host) {
      throw new MailProviderError(
        'SMTP_HOST tanımlı değil.',
        { code: 'mail_smtp_host_missing', status: 500 },
      );
    }
    if (!user || !pass) {
      throw new MailProviderError(
        'SMTP_USER ve SMTP_PASS tanımlı olmalı (auth=password).',
        { code: 'mail_smtp_creds_missing', status: 500 },
      );
    }
    return { transport, auth, from, smtp: { host, port, secure, user, pass } };
  }

  throw new MailProviderError(
    `Bilinmeyen MAIL_TRANSPORT: ${transport} (ethereal|smtp).`,
    { code: 'mail_transport_invalid', status: 500 },
  );
}

/**
 * Transport instance üret. Ethereal için createTestAccount async — her
 * sendMail çağrısında bir yeni account üretmek pahalı; lazy cache.
 */
let cachedEtherealTransport = null;

async function buildTransport(config) {
  if (config.transport === 'ethereal') {
    if (cachedEtherealTransport) return cachedEtherealTransport;
    const account = await nodemailer.createTestAccount();
    cachedEtherealTransport = nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      auth: { user: account.user, pass: account.pass },
    });
    return cachedEtherealTransport;
  }
  if (config.transport === 'smtp') {
    return nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  throw new MailProviderError(
    'Transport oluşturulamadı.',
    { code: 'mail_transport_build_failed', status: 500 },
  );
}

/**
 * E-posta gönder. Wrapped response döner; throw etmez.
 *
 * @param {object} params
 * @param {string|string[]} params.to    Hedef adres(ler).
 * @param {string}   params.subject      Konu.
 * @param {string}  [params.text]        Düz metin gövde.
 * @param {string}  [params.html]        HTML gövde.
 * @param {string}  [params.from]        Override; verilmezse MAIL_FROM/default.
 * @param {string}  [params.replyTo]
 * @param {object}  [params.headers]     Ek başlıklar (örn. Message-ID,
 *                                       In-Reply-To, References — threading
 *                                       M4'te).
 * @returns {Promise<{
 *   ok: boolean,
 *   messageId?: string,
 *   previewUrl?: string|null,
 *   error?: { code: string, message: string, status?: number },
 *   meta?: { proxiedAt: string, transport: string }
 * }>}
 */
export async function sendMail({
  to,
  subject,
  text,
  html,
  from,
  replyTo,
  headers,
} = {}) {
  const proxiedAt = new Date().toISOString();

  if (!to || !subject || (!text && !html)) {
    return {
      ok: false,
      rawSource: RAW_SOURCE,
      error: {
        code: 'mail_input_invalid',
        message: 'to + subject + (text|html) zorunlu.',
        status: 400,
      },
      meta: { proxiedAt, transport: null },
    };
  }

  let config;
  try {
    config = resolveConfig();
  } catch (err) {
    return {
      ok: false,
      rawSource: RAW_SOURCE,
      error: {
        code: err?.code ?? 'mail_config_error',
        message: err?.message ?? 'Mail config hatası.',
        status: err?.status ?? 500,
      },
      meta: { proxiedAt, transport: null },
    };
  }

  let transport;
  try {
    transport = await buildTransport(config);
  } catch (err) {
    return {
      ok: false,
      rawSource: RAW_SOURCE,
      error: {
        code: err?.code ?? 'mail_transport_build_failed',
        message: err?.message ?? 'Transport oluşturulamadı.',
        status: err?.status ?? 500,
      },
      meta: { proxiedAt, transport: config.transport },
    };
  }

  try {
    const info = await transport.sendMail({
      from: from || config.from,
      to,
      subject,
      text,
      html,
      replyTo,
      headers,
    });

    // Ethereal için preview URL — bu URL'i browser'da açınca gönderilen
    // mesajı görebilirsin. SMTP'de null döner.
    const previewUrl =
      config.transport === 'ethereal'
        ? (nodemailer.getTestMessageUrl(info) || null)
        : null;

    return {
      ok: true,
      rawSource: RAW_SOURCE,
      messageId: info?.messageId ?? null,
      previewUrl,
      meta: { proxiedAt, transport: config.transport },
    };
  } catch (err) {
    return {
      ok: false,
      rawSource: RAW_SOURCE,
      error: {
        code: 'mail_send_failed',
        message: err?.message ?? 'Gönderim başarısız.',
        status: 502,
      },
      meta: { proxiedAt, transport: config.transport },
    };
  }
}

/**
 * IMAP gelen kutusu okuma — M3. ŞİMDİ YOK.
 *
 * TODO (M3): IMAP polling (imapflow veya node-imap), her N dakikada
 * INBOX'tan UNSEEN mesajları çek, .eml ayrıştır → M2 pipeline'a besle.
 * Idempotency: Message-ID + receivedAt dedup.
 */
// export async function readInbox(...) { ... }   // M3'te eklenecek

export const mailProvider = {
  sendMail,
};
