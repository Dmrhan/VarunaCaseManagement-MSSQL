/**
 * MailThreadListPane — Ortak mesaj listesi (PR-2 Aşama A + görsel tur R4).
 *
 * REUSE:
 *   - Sekme içi (dikey usta-detay): ÜST kompakt liste
 *   - Fullscreen (Gmail düzeni):     SOL pane
 * Aynı bileşen; iki yerde de birebir. Kullanıcı direktifi: "yeni liste
 * yazma".
 *
 * Prop-driven, generic olmayan (CaseEmailItem'e özgü).
 */
import { ArrowDown, ArrowUp, Paperclip } from 'lucide-react';
import type { CaseEmailItem } from '@/services/caseEmailService';
import { normalizeSubject } from '@/lib/subjectNormalizer';
import { formatDateTime } from '@/lib/format';

interface Props {
  emails: CaseEmailItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Dış wrapper stili (boyut, border) caller kontrolünde. */
  className?: string;
}

export function MailThreadListPane({ emails, selectedId, onSelect, className }: Props) {
  return (
    <div className={`overflow-auto bg-white dark:bg-ndark-card ${className ?? ''}`}>
      <ul className="divide-y divide-slate-100 dark:divide-ndark-border">
        {emails.map((e) => {
          const inbound = e.direction === 'inbound';
          const ts = e.receivedAt ?? e.sentAt ?? e.createdAt;
          const isSelected = e.id === selectedId;
          return (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onSelect(e.id)}
                className={`flex w-full min-h-[40px] items-center gap-2 px-3 py-2 text-left text-xs transition ${
                  isSelected
                    ? 'bg-brand-50 text-brand-900 dark:bg-brand-900/20 dark:text-brand-100'
                    : 'hover:bg-slate-50 dark:hover:bg-ndark-bg'
                }`}
                title={e.subject}
              >
                <span
                  className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                    inbound
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                  }`}
                  aria-label={inbound ? 'Gelen' : 'Giden'}
                >
                  {inbound ? <ArrowDown size={10} /> : <ArrowUp size={10} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="truncate font-medium text-slate-800 dark:text-ndark-text">
                      {e.from.name || e.from.address}
                    </span>
                    <span className="truncate text-slate-500 dark:text-ndark-muted">
                      {normalizeSubject(e.subject) || '(konusuz)'}
                      {e.bodyText && ` — ${e.bodyText.slice(0, 80)}`}
                    </span>
                  </span>
                </span>
                {e.attachments.length > 0 && (
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-slate-500 dark:text-ndark-muted">
                    <Paperclip size={11} />
                    <span>{e.attachments.length}</span>
                  </span>
                )}
                <span className="shrink-0 text-slate-400 dark:text-ndark-muted">
                  {formatDateTime(ts)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
