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

export const caseEmailService = {
  listEmails,
  getAttachmentDownload,
};
