/**
 * Mail M6.3-realign — Tablo satırı + expand panel.
 *
 * Plan referansı: docs/M6-email-in-case-plan.md + n4b paritesi.
 *
 * - Tablo satırı: yön oku (↓ inbound kırmızı / ↑ outbound yeşil) + From +
 *   To + Cc + Bcc + Tarih + Konu + Eklenti sayısı + Aksiyon ikonları
 *   (Görüntüle/Yanıtla/İlet).
 * - Görüntüle (👁) → expand satır altında body + cid render (M6.3a reuse).
 * - Yanıtla (↩) → onReply callback.
 * - İlet (➡) → onForward callback.
 * - Body: cid rewrite + DOMPurify (M6.3a cache-busted token refresh).
 *
 * REUSE: caseEmailService.getAttachmentDownload + sanitizer + DOMPurify.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, ChevronDown, Download, Eye, Paperclip, Reply } from 'lucide-react';
import { sanitizeMailHtml } from '@/lib/sanitizeMailHtml';
import type { CaseEmailItem } from '../../../services/caseEmailService';
import { caseEmailService } from '../../../services/caseEmailService';

const SOURCE_LABEL: Record<CaseEmailItem['source'], string> = {
  imap_intake: 'Gelen',
  manual_send: 'Agent',
  notification_dispatch: 'Otomatik',
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
  onReply?: (email: CaseEmailItem) => void;
  onForward?: (email: CaseEmailItem) => void;
  /** Tablo grid'ine sığması için colSpan değeri (sayı). 8 kolonlu yapı:
   *  yön / from / to / cc / bcc / tarih / konu+ek / aksiyon. */
  expandColSpan?: number;
  defaultExpanded?: boolean;
}

export function MailMessageCard({
  email,
  caseId,
  onReply,
  onForward,
  expandColSpan = 8,
  defaultExpanded = false,
}: Props) {
  const isInbound = email.direction === 'inbound';
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [renderedHtml, setRenderedHtml] = useState<string | null>(null);
  const [rewriteBusy, setRewriteBusy] = useState(false);

  // cid → CaseEmailAttachment.id map (mailparser cid format tutarsız)
  const cidMap = useMemo(() => {
    const m = new Map<string, { id: string; fileName: string }>();
    for (const a of email.attachments) {
      if (!a.contentId) continue;
      const raw = a.contentId.trim();
      const stripped = raw.replace(/^<|>$/g, '');
      m.set(raw, { id: a.id, fileName: a.fileName });
      m.set(stripped, { id: a.id, fileName: a.fileName });
      m.set(stripped.toLowerCase(), { id: a.id, fileName: a.fileName });
    }
    return m;
  }, [email.attachments]);

  const processBodyHtml = useCallback(async (): Promise<string> => {
    const html = email.bodyHtml ?? '';
    if (!html) return '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div id="root">${html}</div>`, 'text/html');
    const root = doc.querySelector('#root');
    if (!root) return html;

    const imgs = Array.from(root.querySelectorAll('img'));
    // Eski mail (CaseEmailAttachment hiç yok) flag — bu durumda cid: img'ler
    // için placeholder mesajı "Eski mail" diye açıklayalım.
    const isOldMailNoEmailAtt = email.attachments.length === 0;
    const cidJobs: Array<Promise<void>> = [];
    for (const img of imgs) {
      const src = (img.getAttribute('src') ?? '').trim();
      if (!src.toLowerCase().startsWith('cid:')) continue;
      const cid = src.slice(4).trim();
      const stripped = cid.replace(/^<|>$/g, '');
      const match = cidMap.get(cid) ?? cidMap.get(stripped) ?? cidMap.get(stripped.toLowerCase());
      if (!match) {
        const placeholder = doc.createElement('span');
        placeholder.setAttribute('class', 'inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700');
        placeholder.textContent = isOldMailNoEmailAtt
          ? `🖼 Eski mail — inline görsel desteklenmiyor`
          : `🖼 ${img.getAttribute('alt') || 'görsel'} (cid eşleşmedi)`;
        img.replaceWith(placeholder);
        continue;
      }
      cidJobs.push((async () => {
        const out = await caseEmailService.getAttachmentDownload(caseId, email.id, match.id);
        if (out?.url) {
          img.setAttribute('src', out.url);
          if (!img.getAttribute('alt')) img.setAttribute('alt', match.fileName);
        } else {
          const ph = doc.createElement('span');
          ph.setAttribute('class', 'inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500');
          ph.textContent = `🖼 ${escapeHtml(match.fileName)}`;
          img.replaceWith(ph);
        }
      })());
    }
    await Promise.all(cidJobs);
    return root.innerHTML;
  }, [caseId, cidMap, email.bodyHtml, email.id]);

  useEffect(() => {
    if (!expanded) {
      setRenderedHtml(null);
      setRewriteBusy(false);
      return;
    }
    let alive = true;
    setRewriteBusy(true);
    setRenderedHtml(null);
    void processBodyHtml().then((html) => {
      if (!alive) return;
      setRenderedHtml(html);
      setRewriteBusy(false);
    });
    return () => { alive = false; };
  }, [expanded, processBodyHtml]);

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
    // Compose-Signature F4 Codex P2 — paylaşılan sanitizeMailHtml
    // (backend allowlist mirror; tablo attrs preserve).
    return sanitizeMailHtml(renderedHtml);
  }, [renderedHtml]);

  const ts = isInbound ? email.receivedAt : email.sentAt;
  // Polish — yön oku renk kodu:
  //   Gelen (inbound)  = sky/mavi (giriş tonu — müşteriden geliyor)
  //   Giden (outbound) = emerald/yeşil (çıkış tonu — agent'tan gidiyor)
  // Hover state aynı renk ailesiyle eşlendi (görsel tutarlılık).
  const dirIcon = isInbound
    ? <ArrowDown size={14} className="text-sky-500" />
    : <ArrowUp size={14} className="text-emerald-500" />;

  // Tek mail = iki tr: header satırı + (expand'lı) detay satırı
  return (
    <>
      <tr
        className={`border-t ${
          isInbound
            ? 'border-sky-50 hover:bg-sky-50/40 dark:border-ndark-border dark:hover:bg-ndark-bg/40'
            : 'border-emerald-50 hover:bg-emerald-50/40 dark:border-ndark-border dark:hover:bg-ndark-bg/40'
        } text-xs`}
      >
        <td className="w-8 px-2 py-2 text-center align-top">
          <span title={isInbound ? 'Gelen' : 'Giden'}>{dirIcon}</span>
        </td>
        <td className="max-w-[180px] truncate px-2 py-2 align-top" title={email.from.address}>
          <div className="truncate font-medium text-slate-800 dark:text-ndark-text">
            {email.from.name || email.from.address}
          </div>
          <div className="text-[10px] text-slate-500 dark:text-ndark-muted">{SOURCE_LABEL[email.source]}</div>
        </td>
        <td className="max-w-[180px] truncate px-2 py-2 align-top text-slate-600 dark:text-ndark-muted" title={joinAddresses(email.to)}>
          {joinAddresses(email.to) || '—'}
        </td>
        <td className="max-w-[140px] truncate px-2 py-2 align-top text-slate-600 dark:text-ndark-muted" title={joinAddresses(email.cc)}>
          {joinAddresses(email.cc) || '—'}
        </td>
        <td className="max-w-[140px] truncate px-2 py-2 align-top text-slate-600 dark:text-ndark-muted" title={joinAddresses(email.bcc)}>
          {joinAddresses(email.bcc) || '—'}
        </td>
        <td className="w-32 shrink-0 whitespace-nowrap px-2 py-2 align-top text-slate-600 dark:text-ndark-muted">
          {formatDate(ts)}
        </td>
        <td className="max-w-[280px] truncate px-2 py-2 align-top">
          <div className="flex items-center gap-1">
            <span className="truncate font-medium text-slate-800 dark:text-ndark-text" title={email.subject}>
              {email.subject || '(konusuz)'}
            </span>
            {email.attachments.length > 0 && (
              <span
                className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-ndark-bg dark:text-ndark-muted"
                title={`${email.attachments.length} ek`}
              >
                <Paperclip size={10} />
                {email.attachments.length}
              </span>
            )}
          </div>
        </td>
        <td className="w-24 whitespace-nowrap px-2 py-2 align-top text-right">
          <div className="inline-flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-ndark-muted dark:hover:bg-ndark-bg dark:hover:text-ndark-text"
              title={expanded ? 'Katla' : 'Görüntüle'}
              aria-label="Görüntüle"
              aria-expanded={expanded}
            >
              {expanded ? <ChevronDown size={13} /> : <Eye size={13} />}
            </button>
            {onReply && (
              <button
                type="button"
                onClick={() => onReply(email)}
                className="rounded p-1 text-blue-600 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-900/30"
                title="Yanıtla"
                aria-label="Yanıtla"
              >
                <Reply size={13} />
              </button>
            )}
            {onForward && (
              <button
                type="button"
                onClick={() => onForward(email)}
                className="rounded p-1 text-slate-600 hover:bg-slate-100 dark:text-ndark-muted dark:hover:bg-ndark-bg"
                title="İlet"
                aria-label="İlet"
              >
                <ArrowRight size={13} />
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-slate-100 bg-slate-50/60 dark:border-ndark-border dark:bg-ndark-card/60">
          <td colSpan={expandColSpan} className="px-3 py-2">
            {/* Recipients özet */}
            <div className="mb-2 text-xs text-slate-500 dark:text-ndark-muted">
              <div><span className="font-medium">Kime:</span> {joinAddresses(email.to) || '—'}</div>
              {email.cc.length > 0 && <div className="mt-0.5"><span className="font-medium">Cc:</span> {joinAddresses(email.cc)}</div>}
              {email.bcc.length > 0 && <div className="mt-0.5"><span className="font-medium">Bcc:</span> {joinAddresses(email.bcc)}</div>}
            </div>

            {/* Body */}
            {rewriteBusy ? (
              <div className="py-3 text-xs text-slate-400">İçerik yükleniyor…</div>
            ) : (
              <div
                className="prose prose-sm max-w-none rounded border border-slate-200 bg-white px-3 py-2 text-slate-800 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: safeHtml }}
              />
            )}

            {/* Ekler */}
            {email.attachments.length > 0 && (
              <div className="mt-2 border-t border-slate-100 pt-2 dark:border-ndark-border">
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
                        {att.isInline && <span className="ml-1 text-[10px] text-slate-400">inline</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// Eski default tek-card export'unu da koru (geri uyumluluk için import edenler).
export default MailMessageCard;
