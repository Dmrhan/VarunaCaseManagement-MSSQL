/**
 * Mail M6.1 + M6.2b — Vaka thread mail listesi.
 *
 * Plan referansı: docs/M6-email-in-case-plan.md Bölüm 9.
 *
 * Mailler kronolojik (eskiden yeniye) gösterilir. Composer'dan gönderim
 * sonrası parent `ref.refresh({scrollToLast: true})` ile yeniler + son
 * mesaja scroll-into-view (kenar durum: uzun thread).
 *
 * REUSE: NotesTab stack düzeni; vertical space-y, scrollable container.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Inbox } from 'lucide-react';
import { caseEmailService, type CaseEmailItem } from '@/services/caseEmailService';
import { MailMessageCard } from './MailMessageCard';

export interface MailThreadHandle {
  refresh: (opts?: { scrollToLast?: boolean }) => Promise<void>;
}

interface Props {
  caseId: string;
}

export const MailThread = forwardRef<MailThreadHandle, Props>(function MailThread({ caseId }, ref) {
  const [items, setItems] = useState<CaseEmailItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const lastItemRef = useRef<HTMLLIElement | null>(null);
  const pendingScrollRef = useRef(false);

  const load = useCallback(async (opts?: { scrollToLast?: boolean }) => {
    setLoading(true);
    const rows = await caseEmailService.listEmails(caseId);
    setItems(rows);
    setLoading(false);
    if (opts?.scrollToLast) pendingScrollRef.current = true;
  }, [caseId]);

  useEffect(() => { void load(); }, [load]);

  useImperativeHandle(ref, () => ({
    refresh: (opts) => load(opts),
  }), [load]);

  // Items yüklendikten sonra scrollIntoView (DOM hazır olunca)
  useEffect(() => {
    if (pendingScrollRef.current && lastItemRef.current) {
      lastItemRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      pendingScrollRef.current = false;
    }
  }, [items]);

  if (loading && !items) {
    return (
      <div className="py-8 text-center text-sm text-slate-500 dark:text-ndark-muted">
        Yükleniyor…
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 py-10 text-center dark:border-ndark-border dark:bg-ndark-card">
        <Inbox size={24} className="text-slate-400" aria-hidden="true" />
        <p className="text-sm text-slate-600 dark:text-ndark-muted">
          Bu vakaya henüz e-posta gelmedi ya da gönderilmedi.
        </p>
      </div>
    );
  }

  return (
    <ol className="space-y-3" aria-label="E-posta thread">
      {items.map((email, idx) => {
        const isLast = idx === items.length - 1;
        return (
          <li key={email.id} ref={isLast ? lastItemRef : undefined}>
            <MailMessageCard email={email} caseId={caseId} />
          </li>
        );
      })}
    </ol>
  );
});
