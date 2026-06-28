/**
 * Mail M6.1 — Vaka thread mail listesi servis.
 *
 * Plan referansı: docs/M6-email-in-case-plan.md Bölüm 9.
 *
 * Bu servis sadece read-only thread çekimi içindir. Composer/send M6.2'de.
 *
 * REUSE: caseService apiFetch deseni — toast/error handling otomatik.
 */

import { apiFetch, invalidateCaseDetail } from './caseService';

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
  // silent — mail entegrasyonu yapılandırılmamış şirketlerde 404/403
  // dönebilir; toast yağmuru olmasın, sessiz boş liste.
  const out = await apiFetch<{ items: CaseEmailItem[] }>(
    `/api/cases/${encodeURIComponent(caseId)}/emails`,
    undefined,
    { silent: true },
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
    // silent — cid rewrite her görsel için çağrılır; başarısız olanlar
    // placeholder'a düşer, toast yağmuru olmasın.
    { silent: true },
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
    { silent: true },
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
export async function getReplyContext(
  caseId: string,
  emailId?: string,
): Promise<ReplyContext | undefined> {
  // Codex P2 fix — satır içi "Yanıtla" verili emailId ile çağrılır;
  // backend o mail satırını baz alır. Param yoksa son inbound (üst
  // toolbar davranışı).
  const qs = emailId ? `?emailId=${encodeURIComponent(emailId)}` : '';
  return apiFetch<ReplyContext>(
    `/api/cases/${encodeURIComponent(caseId)}/emails/reply-context${qs}`,
    undefined,
    { silent: true },
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
  /**
   * Codex P2 fix — Reply parent (Message-ID).
   * Satır içi "Yanıtla" → reply-context'in inReplyTo'su composer'dan
   * draft'a aktarılır → backend threading bu mail satırını parent
   * kabul eder. Yoksa: backend son inbound fallback.
   */
  inReplyTo?: string | null;
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
  const result = await apiFetch<SendEmailResult>(
    `/api/cases/${encodeURIComponent(caseId)}/emails`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    },
    'E-posta gönderimi',
  );
  // Codex P2 fix (M6.3b Faz 1) — Send başarılı: WR-H2 case detail
  // cache'i invalidate. Aksi halde 30sn TTL içinde caseService.get
  // stale (pendingCustomerReply=true) döner; header badge stale kalır.
  // Diğer mutation'larla parite (caseService.ts line 842/898/932/...).
  if (result) invalidateCaseDetail(caseId);
  return result;
}

export interface ForwardContext {
  caseNumber: string | null;
  to: CaseEmailAddress[];
  cc: CaseEmailAddress[];
  bcc: CaseEmailAddress[];
  subject: string;
  /** Composer gövdesinin SONUNA eklenen alıntılı orijinal mesaj (HTML). */
  quotedBodyHtml: string;
  inReplyTo: string | null;
}

/**
 * GET /api/cases/:caseId/emails/:emailId/forward-context — composer "İlet"
 * prefill (M6.3-realign).
 */
export async function getForwardContext(caseId: string, emailId: string): Promise<ForwardContext | undefined> {
  return apiFetch<ForwardContext>(
    `/api/cases/${encodeURIComponent(caseId)}/emails/${encodeURIComponent(emailId)}/forward-context`,
    undefined,
    { silent: true },
  );
}

export type EmailConfigReason =
  | 'no-setting'
  | 'disabled'
  | 'no-from'
  | 'has-alias'
  | 'fallback-from-address';

export interface EmailConfig {
  configured: boolean;
  reason: EmailConfigReason;
}

/**
 * GET /api/cases/:caseId/email-config — İletişim sekmesi "yapılandırılmış mı?"
 * dedicated kararı. CommunicationTab banner state'i bu yanıta dayanır.
 *
 * KONTRAT TUTARLILIĞI: backend `listActiveWithSettingFallback` çağırır →
 * composer dropdown ile AYNI kaynaktan beslenir. UNIVERA gibi config TAM
 * + manuel FromAlias YOK senaryosunda configured=true (reason
 * 'fallback-from-address') döner.
 *
 * Silent fetch — hata durumunda configured=false varsayımı banner gösterir;
 * toast YOK.
 */
export async function getEmailConfig(caseId: string): Promise<EmailConfig> {
  const out = await apiFetch<EmailConfig>(
    `/api/cases/${encodeURIComponent(caseId)}/email-config`,
    undefined,
    { silent: true },
  );
  return out ?? { configured: false, reason: 'no-setting' };
}

/**
 * GET /api/cases/:caseId/email-signature — composer açılışında tenant
 * default imzasını gövdeye append etmek için.
 */
export interface EmailSignatureBundle {
  /** Tenant ham şablonu (ExternalMailSetting.signatureHtml). */
  tenantHtml: string | null;
  /** Per-agent override imza (User.signatureHtml — M6.3b Faz 2). */
  agentHtml: string | null;
  /**
   * Compose-Signature F2 — Tenant şablonu Person bilgileriyle render
   * edildikten sonraki "effective" şirket imzası. Composer'ın varsayılan
   * "İmzam" davranışı: override (agentHtml) > composedHtml > none.
   */
  composedHtml: string | null;
  /**
   * Deprecated — eski caller'lar için fallback
   * (agentHtml > composedHtml > tenantHtml) düzleştirme.
   * Yeni caller'lar agentHtml/composedHtml ayrı oku.
   */
  signatureHtml: string | null;
}

/**
 * M6.3b Faz 2 — composer açılışında imza bundle. Composer fallback
 * chain: agentHtml > tenantHtml > none.
 *
 * Geri uyumluluk: eski caller `getEmailSignature(caseId)` string | null
 * imzasıyla çağırırsa, yeni bundle'dan `signatureHtml`'i düz olarak
 * döndürür (agent > tenant fallback).
 */
export async function getEmailSignatureBundle(caseId: string): Promise<EmailSignatureBundle> {
  const r = await apiFetch<EmailSignatureBundle>(
    `/api/cases/${encodeURIComponent(caseId)}/email-signature`,
    undefined,
    { silent: true },
  );
  return r ?? { tenantHtml: null, agentHtml: null, composedHtml: null, signatureHtml: null };
}

/** Geri uyumlu (eski imzayla) — yeni composer doğrudan bundle alır. */
export async function getEmailSignature(caseId: string): Promise<string | null> {
  const bundle = await getEmailSignatureBundle(caseId);
  return bundle.signatureHtml;
}

// ─── M6.3b Faz 3 — Composer "Mail Şablonu" dropdown ───

export interface CaseEmailTemplateItem {
  id: string;
  name: string;
  category: string | null;
  subject: string | null;
  bodyHtml: string;
  variables: string; // JSON string
}

export interface RenderedTemplate {
  subject: string | null;
  bodyHtml: string;
  missing: string[]; // bilinmeyen placeholder'lar
}

export async function listEmailTemplates(caseId: string): Promise<CaseEmailTemplateItem[]> {
  const out = await apiFetch<{ items: CaseEmailTemplateItem[] }>(
    `/api/cases/${encodeURIComponent(caseId)}/email-templates`,
    undefined,
    { silent: true },
  );
  return Array.isArray(out?.items) ? out!.items : [];
}

export async function renderEmailTemplate(
  caseId: string,
  templateId: string,
): Promise<RenderedTemplate | undefined> {
  return apiFetch<RenderedTemplate>(
    `/api/cases/${encodeURIComponent(caseId)}/email-templates/${encodeURIComponent(templateId)}/render`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    'Şablon önizleme',
  );
}

export const caseEmailService = {
  listEmails,
  getAttachmentDownload,
  getFromAliases,
  getReplyContext,
  getForwardContext,
  sendEmail,
  getEmailSignature,
  getEmailSignatureBundle,
  getEmailConfig,
  listEmailTemplates,
  renderEmailTemplate,
};
