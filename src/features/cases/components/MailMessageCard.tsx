/**
 * Mail M6.1 — Tek bir CaseEmail kartı.
 *
 * Plan referansı: docs/M6-email-in-case-plan.md Bölüm 9.
 *
 * Render:
 *  - Yön ikonu (↓ inbound, ↑ outbound, ⚙ otomatik dispatch)
 *  - From / To / Cc / Bcc
 *  - Subject + zaman damgası + source rozeti (intake/manual/dispatch)
 *  - Body: sanitize-html ile temizlenmiş HTML, read-only
 *  - Ekler (CaseEmailAttachment) — indirme link'i (M6.2'de geliştirilebilir)
 *
 * GÜVENLİK: Backend sanitize-html ile yazıldı; client-side DOMPurify ile
 * ikinci kat. Defense in depth — render katmanında XSS riski yok.
 *
 * REUSE: NotesTab kart deseni (border, padding, hover, time format).
 */
import { ArrowDown, ArrowUp, Cog, Download, Paperclip } from 'lucide-react';
import DOMPurify from 'dompurify';
import type { CaseEmailItem } from '../../../services/caseEmailService';
import { caseEmailService } from '../../../services/caseEmailService';

const SOURCE_LABEL: Record<CaseEmailItem['source'], string> = {
  imap_intake: 'Gelen',
  manual_send: 'Agent',
  notification_dispatch: 'Otomatik',
};

const SOURCE_TINT: Record<CaseEmailItem['source'], string> = {
  imap_intake: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  manual_send: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  notification_dispatch: 'bg-slate-100 text-slate-600 dark:bg-ndark-card dark:text-ndark-muted',
};

function formatDate(s: string | null): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return s;
  }
}

function joinAddresses(arr: CaseEmailItem['to']): string {
  return arr
    .map((a) => (a.name ? `${a.name} <${a.address}>` : a.address))
    .join(', ');
}

interface Props {
  email: CaseEmailItem;
  caseId: string;
}

export function MailMessageCard({ email, caseId }: Props) {
  const isInbound = email.direction === 'inbound';
  const Icon = email.source === 'notification_dispatch' ? Cog : isInbound ? ArrowDown : ArrowUp;
  const iconTint = isInbound
    ? 'text-blue-500'
    : email.source === 'notification_dispatch'
      ? 'text-slate-400'
      : 'text-emerald-500';

  // Defense in depth — backend zaten sanitize etti, frontend DOMPurify ile
  // ikinci kat. cid: image M6.1'de gizlenir; M6.2 composer'da inline çözümü.
  const safeHtml = DOMPurify.sanitize(email.bodyHtml || '', {
    USE_PROFILES: { html: true },
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'src', 'alt', 'width', 'height', 'style', 'class'],
    FORBID_TAGS: ['script', 'iframe', 'form', 'object', 'embed', 'link', 'meta', 'style'],
  });

  async function handleDownloadAttachment(attachmentId: string) {
    const r = await caseEmailService.getAttachmentDownload(caseId, email.id, attachmentId);
    if (r?.url) {
      const a = document.createElement('a');
      a.href = r.url;
      a.download = r.fileName;
      a.click();
    }
  }

  const ts = isInbound ? email.receivedAt : email.sentAt;

  return (
    <article
      className={`rounded-lg border ${
        isInbound
          ? 'border-blue-100 dark:border-blue-900/40'
          : 'border-slate-200 dark:border-ndark-border'
      } bg-white dark:bg-ndark-card`}
    >
      <header className="flex items-start gap-2 border-b border-slate-100 px-3 py-2 dark:border-ndark-border">
        <span className={`mt-0.5 ${iconTint}`} aria-hidden="true">
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="min-w-0">
              <span className="truncate text-sm font-medium text-slate-800 dark:text-ndark-text">
                {email.from.name || email.from.address}
              </span>
              {email.from.name && (
                <span className="ml-1 text-xs text-slate-500 dark:text-ndark-muted">
                  &lt;{email.from.address}&gt;
                </span>
              )}
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${SOURCE_TINT[email.source]}`}
              title={`Kaynak: ${email.source}`}
            >
              {SOURCE_LABEL[email.source]}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-ndark-muted">
            <span>Kime: {joinAddresses(email.to) || '—'}</span>
            {email.cc.length > 0 && (
              <span className="ml-2">Cc: {joinAddresses(email.cc)}</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="truncate text-sm font-semibold text-slate-900 dark:text-ndark-text">
              {email.subject || '(konusuz)'}
            </h4>
            <time className="shrink-0 text-[11px] text-slate-500 dark:text-ndark-muted">
              {formatDate(ts)}
            </time>
          </div>
        </div>
      </header>

      <div
        className="prose prose-sm max-w-none px-3 py-2.5 text-slate-800 dark:text-ndark-text dark:prose-invert"
        // DOMPurify ile temizlenmiş HTML; backend sanitize-html ek koruma.
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />

      {email.attachments.length > 0 && (
        <footer className="border-t border-slate-100 px-3 py-2 dark:border-ndark-border">
          <div className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-ndark-muted">
            <Paperclip size={12} />
            <span>{email.attachments.length} ek</span>
          </div>
          <ul className="space-y-0.5">
            {email.attachments.map((att) => (
              <li key={att.id}>
                <button
                  type="button"
                  onClick={() => void handleDownloadAttachment(att.id)}
                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-300"
                  title={`${Math.round(att.fileSize / 1024)} KB`}
                >
                  <Download size={11} />
                  {att.fileName}
                </button>
              </li>
            ))}
          </ul>
        </footer>
      )}
    </article>
  );
}
