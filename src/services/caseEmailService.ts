/**
 * Mail M6.1 — Vaka thread mail listesi servis.
 *
 * Plan referansı: docs/M6-email-in-case-plan.md Bölüm 9.
 *
 * Bu servis sadece read-only thread çekimi içindir. Composer/send M6.2'de.
 *
 * REUSE: caseService apiFetch deseni — toast/error handling otomatik.
 */

import { apiFetch } from './caseService';

export interface CaseEmailAddress {
  address: string;
  name: string | null;
}

export interface CaseEmailAttachmentInfo {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  contentId: string | null;
  isInline: boolean;
}

export type CaseEmailDirection = 'inbound' | 'outbound';
export type CaseEmailSource = 'imap_intake' | 'manual_send' | 'notification_dispatch';

export interface CaseEmailItem {
  id: string;
  caseId: string;
  direction: CaseEmailDirection;
  source: CaseEmailSource;
  from: CaseEmailAddress;
  to: CaseEmailAddress[];
  cc: CaseEmailAddress[];
  bcc: CaseEmailAddress[];
  subject: string;
  bodyHtml: string;
  bodyText: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  refs: string | null;
  visibility: string;
  sentByUserId: string | null;
  dispatchId: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  attachments: CaseEmailAttachmentInfo[];
}

/**
 * GET /api/cases/:caseId/emails — vakanın thread mailleri.
 * Kronolojik (eskiden yeniye).
 */
export async function listEmails(caseId: string): Promise<CaseEmailItem[]> {
  const out = await apiFetch<{ items: CaseEmailItem[] }>(
    `/api/cases/${encodeURIComponent(caseId)}/emails`,
    undefined,
    'E-posta thread\'i',
  );
  return Array.isArray(out?.items) ? out!.items : [];
}

/**
 * GET /api/cases/:caseId/emails/:emailId/attachments/:attachmentId/download
 * — Mail eki indirme URL'i (short-lived token).
 */
export async function getAttachmentDownload(
  caseId: string,
  emailId: string,
  attachmentId: string,
): Promise<{ url: string; fileName: string; mimeType: string; fileSize: number } | undefined> {
  return apiFetch(
    `/api/cases/${encodeURIComponent(caseId)}/emails/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}/download`,
    undefined,
    'Ek indirme',
  );
}

// ─── M6.2b composer için lookup endpoint'leri ───

export interface FromAliasOption {
  id: string;
  address: string;
  displayName: string | null;
  isDefault: boolean;
}

/**
 * GET /api/cases/:caseId/from-aliases — composer From dropdown beslemesi
 * (M5-extension lookup endpoint). Sadece aktif alias'lar.
 */
export async function getFromAliases(caseId: string): Promise<FromAliasOption[]> {
  const out = await apiFetch<{ items: FromAliasOption[] }>(
    `/api/cases/${encodeURIComponent(caseId)}/from-aliases`,
    undefined,
    'Gönderen adresleri',
  );
  return Array.isArray(out?.items) ? out!.items : [];
}

export interface ReplyContext {
  caseNumber: string | null;
  to: CaseEmailAddress[];
  cc: CaseEmailAddress[];
  bcc: CaseEmailAddress[];
  subject: string;
  inReplyTo: string | null;
}

/**
 * GET /api/cases/:caseId/emails/reply-context — composer "Yanıtla" prefill
 * (M6.2a backend). Vakanın son inbound CaseEmail'ından çıkarılır; tenant
 * alias adresleri loop koruması için filtrelenmiştir.
 */
export async function getReplyContext(caseId: string): Promise<ReplyContext | undefined> {
  return apiFetch<ReplyContext>(
    `/api/cases/${encodeURIComponent(caseId)}/emails/reply-context`,
    undefined,
    'Yanıt bağlamı',
  );
}

export interface SendEmailDraft {
  fromAddress: string;
  to: CaseEmailAddress[];
  cc?: CaseEmailAddress[];
  bcc?: CaseEmailAddress[];
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  /** CaseAttachment.id[] — composer attachments uploader'dan toplanır. */
  attachments?: string[];
}

export interface SendEmailResult {
  ok: true;
  emailId: string;
  messageId: string;
  previewUrl: string | null;
}

/**
 * POST /api/cases/:caseId/emails — composer gönderim (M6.2a backend).
 * Hata yakalanır: apiFetch toast'ı zaten gösterir, undefined döner.
 */
export async function sendEmail(
  caseId: string,
  draft: SendEmailDraft,
): Promise<SendEmailResult | undefined> {
  return apiFetch<SendEmailResult>(
    `/api/cases/${encodeURIComponent(caseId)}/emails`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    },
    'E-posta gönderimi',
  );
}

/**
 * GET /api/cases/:caseId/email-signature — composer açılışında tenant
 * default imzasını gövdeye append etmek için.
 */
export async function getEmailSignature(caseId: string): Promise<string | null> {
  const r = await apiFetch<{ signatureHtml: string | null }>(
    `/api/cases/${encodeURIComponent(caseId)}/email-signature`,
    undefined,
    'İmza',
  );
  return r?.signatureHtml ?? null;
}

export const caseEmailService = {
  listEmails,
  getAttachmentDownload,
  getFromAliases,
  getReplyContext,
  sendEmail,
  getEmailSignature,
};
