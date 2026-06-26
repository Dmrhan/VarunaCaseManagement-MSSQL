/**
 * Mail M6.1 + M6.3a — Tek bir CaseEmail kartı.
 *
 * Plan referansı: docs/M6-email-in-case-plan.md Bölüm 9.
 *
 * M6.3a — n4b paritesi:
 *  - VARSAYILAN KATLI: tek satır header (yön + gönderen + konu + tarih +
 *    ek sayısı). Tıkla → tam içerik açılır (in-place expand).
 *  - cid/inline görsel render: bodyHtml içindeki <img src="cid:xxx">
 *    referansları, ilgili CaseEmailAttachment'in download URL'i ile
 *    REWRITE edilir. Eşleşmeyen cid → temiz placeholder.
 *  - External <img src="https://..."> render edilir (n4b paritesi).
 *  - Satır aksiyonları: Görüntüle (expand) · Yanıtla (parent callback).
 *
 * GÜVENLİK: Backend sanitize-html ile yazıldı; client-side DOMPurify ile
 * ikinci kat. cid rewrite öncesi orijinal cid: scheme'i blob/data değil;
 * sadece bizim signed download URL'imize çevrilir. DOMPurify
 * configinde script/iframe/form/meta/style yasak; img'e izin var.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Cog, Download, Eye, Paperclip, Reply } from 'lucide-react';
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface Props {
  email: CaseEmailItem;
  caseId: string;
  /** M6.3a — Satır aksiyonu "Yanıtla" tıklanınca parent composer'ı açar. */
  onReply?: (email: CaseEmailItem) => void;
  /** Açılış (expand) state'i parent'ta tutuluyorsa override edilebilir.
   *  Default: kontrolsüz (içinde state). */
  defaultExpanded?: boolean;
}

export function MailMessageCard({ email, caseId, onReply, defaultExpanded = false }: Props) {
  const isInbound = email.direction === 'inbound';
  const Icon = email.source === 'notification_dispatch' ? Cog : isInbound ? ArrowDown : ArrowUp;
  const iconTint = isInbound
    ? 'text-blue-500'
    : email.source === 'notification_dispatch'
      ? 'text-slate-400'
      : 'text-emerald-500';
  const ts = isInbound ? email.receivedAt : email.sentAt;

  const [expanded, setExpanded] = useState(defaultExpanded);
  // cid rewrite işlenmiş HTML — async; expand olduğunda yüklenir.
  // Boş string → render placeholder skeleton.
  const [renderedHtml, setRenderedHtml] = useState<string | null>(null);
  const [rewriteBusy, setRewriteBusy] = useState(false);

  // bodyText'ten kısa snippet (header satırında preview)
  const snippet = useMemo(() => {
    const s = (email.bodyText ?? email.bodyHtml.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    return s.length > 80 ? s.slice(0, 80) + '…' : s;
  }, [email.bodyHtml, email.bodyText]);

  // cid → CaseEmailAttachment.id eşleşme map'i
  const cidMap = useMemo(() => {
    const m = new Map<string, { id: string; fileName: string }>();
    for (const a of email.attachments) {
      if (a.contentId) {
        // mailparser cid bazen <foo@bar> ile sarmalı gelir; ham + soyulmuş ikisini de map'le
        const raw = a.contentId.trim();
        const stripped = raw.replace(/^<|>$/g, '');
        m.set(raw, { id: a.id, fileName: a.fileName });
        m.set(stripped, { id: a.id, fileName: a.fileName });
        m.set(stripped.toLowerCase(), { id: a.id, fileName: a.fileName });
      }
    }
    return m;
  }, [email.attachments]);

  // bodyHtml'i parse et — cid:xxx img'leri download URL'e rewrite et;
  // eşleşmeyen → temiz placeholder.
  const processBodyHtml = useCallback(async (): Promise<string> => {
    let html = email.bodyHtml ?? '';
    if (!html) return '';
    // cid img'leri DOMParser ile dolaş (client-side)
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div id="root">${html}</div>`, 'text/html');
    const root = doc.querySelector('#root');
    if (!root) return html;

    const imgs = Array.from(root.querySelectorAll('img'));
    // cid: imgleri ayrı topla (paralel fetch için)
    const cidJobs: Array<Promise<void>> = [];
    for (const img of imgs) {
      const src = (img.getAttribute('src') ?? '').trim();
      if (!src.toLowerCase().startsWith('cid:')) continue;
      const cid = src.slice(4).trim();
      const stripped = cid.replace(/^<|>$/g, '');
      const match = cidMap.get(cid)
        ?? cidMap.get(stripped)
        ?? cidMap.get(stripped.toLowerCase());
      if (!match) {
        // Eşleşmeyen cid → placeholder span
        const placeholder = doc.createElement('span');
        placeholder.setAttribute('class', 'inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500');
        placeholder.textContent = `🖼 ${img.getAttribute('alt') || 'görsel'}`;
        img.replaceWith(placeholder);
        continue;
      }
      cidJobs.push((async () => {
        const out = await caseEmailService.getAttachmentDownload(caseId, email.id, match.id);
        if (out?.url) {
          img.setAttribute('src', out.url);
          if (!img.getAttribute('alt')) img.setAttribute('alt', match.fileName);
        } else {
          const placeholder = doc.createElement('span');
          placeholder.setAttribute('class', 'inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500');
          placeholder.textContent = `🖼 ${escapeHtml(match.fileName)}`;
          img.replaceWith(placeholder);
        }
      })());
    }
    await Promise.all(cidJobs);
    return root.innerHTML;
  }, [caseId, cidMap, email.bodyHtml, email.id]);

  // Expand toggle olduğunda cid rewrite çalıştır — bir kez cache'li.
  useEffect(() => {
    if (!expanded) return;
    if (renderedHtml !== null) return;
    setRewriteBusy(true);
    void processBodyHtml().then((html) => {
      setRenderedHtml(html);
      setRewriteBusy(false);
    });
  }, [expanded, processBodyHtml, renderedHtml]);

  async function handleDownloadAttachment(attachmentId: string) {
    const r = await caseEmailService.getAttachmentDownload(caseId, email.id, attachmentId);
    if (r?.url) {
      const a = document.createElement('a');
      a.href = r.url;
      a.download = r.fileName;
      a.click();
    }
  }

  const safeHtml = useMemo(() => {
    if (renderedHtml === null) return '';
    return DOMPurify.sanitize(renderedHtml, {
      USE_PROFILES: { html: true },
      ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'src', 'alt', 'width', 'height', 'style', 'class'],
      FORBID_TAGS: ['script', 'iframe', 'form', 'object', 'embed', 'link', 'meta', 'style'],
    });
  }, [renderedHtml]);

  return (
    <article
      className={`overflow-hidden rounded-lg border ${
        isInbound
          ? 'border-blue-100 dark:border-blue-900/40'
          : 'border-slate-200 dark:border-ndark-border'
      } bg-white dark:bg-ndark-card`}
    >
      {/* Header — KATLI satır. Tıklayınca expand. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50/60 dark:hover:bg-ndark-bg/40"
        aria-expanded={expanded}
      >
        <span className="mt-1 text-slate-400" aria-hidden="true">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <span className={`mt-0.5 ${iconTint}`} aria-hidden="true">
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="min-w-0">
              <span className="truncate text-sm font-medium text-slate-800 dark:text-ndark-text">
                {email.from.name || email.from.address}
              </span>
              <span className="ml-2 text-xs text-slate-500 dark:text-ndark-muted">
                {SOURCE_LABEL[email.source]}
              </span>
            </div>
            <time className="shrink-0 text-[11px] text-slate-500 dark:text-ndark-muted">
              {formatDate(ts)}
            </time>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <h4 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 dark:text-ndark-text">
              {email.subject || '(konusuz)'}
            </h4>
            {email.attachments.length > 0 && (
              <span
                className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-ndark-bg dark:text-ndark-muted"
                title={`${email.attachments.length} ek`}
              >
                <Paperclip size={10} />
                {email.attachments.length}
              </span>
            )}
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${SOURCE_TINT[email.source]}`}
              title={`Kaynak: ${email.source}`}
            >
              {SOURCE_LABEL[email.source]}
            </span>
          </div>
          {!expanded && snippet && (
            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-ndark-muted">
              {snippet}
            </p>
          )}
        </div>
      </button>

      {/* Expanded içerik */}
      {expanded && (
        <div className="border-t border-slate-100 dark:border-ndark-border">
          {/* Recipients */}
          <div className="px-3 py-1.5 text-xs text-slate-500 dark:text-ndark-muted">
            <div>
              <span className="font-medium">Kime:</span> {joinAddresses(email.to) || '—'}
            </div>
            {email.cc.length > 0 && (
              <div className="mt-0.5">
                <span className="font-medium">Cc:</span> {joinAddresses(email.cc)}
              </div>
            )}
          </div>

          {/* Body */}
          {rewriteBusy ? (
            <div className="px-3 py-4 text-xs text-slate-400">İçerik yükleniyor…</div>
          ) : (
            <div
              className="prose prose-sm max-w-none px-3 py-2.5 text-slate-800 dark:text-ndark-text dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: safeHtml }}
            />
          )}

          {/* Ekler */}
          {email.attachments.length > 0 && (
            <div className="border-t border-slate-100 px-3 py-2 dark:border-ndark-border">
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
                      {att.isInline && (
                        <span className="ml-1 text-[10px] text-slate-400">inline</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-1 border-t border-slate-100 px-3 py-1.5 dark:border-ndark-border">
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-ndark-muted dark:hover:bg-ndark-bg"
              title="Katla"
            >
              <Eye size={12} />
              Görüntüle
            </button>
            {onReply && (
              <button
                type="button"
                onClick={() => onReply(email)}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-900/30"
                title="Yanıtla"
              >
                <Reply size={12} />
                Yanıtla
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
