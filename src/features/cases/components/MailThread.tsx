/**
 * Mail M6.3-realign — Vaka thread TABLO görünümü (n4b paritesi).
 *
 * Kolonlar: yön / From / To / Cc / Bcc / Tarih / Konu+Ek / Aksiyon.
 * Satıra tıklanırsa expand body (cid render M6.3a reuse).
 *
 * REUSE: NotesTab scroll deseni; mevcut MailMessageCard refactor satır
 * olarak render.
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
  onReply?: (email: CaseEmailItem) => void;
  /** M6.3-realign — satır "İlet" aksiyonu (forward). */
  onForward?: (email: CaseEmailItem) => void;
}

export const MailThread = forwardRef<MailThreadHandle, Props>(function MailThread(
  { caseId, onReply, onForward },
  ref,
) {
  const [items, setItems] = useState<CaseEmailItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const lastRowRef = useRef<HTMLTableRowElement | null>(null);
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

  useEffect(() => {
    if (pendingScrollRef.current && lastRowRef.current) {
      lastRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
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
    // Polish — sade empty state. Tablo iskeleti yerine ortalı temiz mesaj.
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 py-12 text-center dark:border-ndark-border dark:bg-ndark-card">
        <Inbox size={28} className="text-slate-400" aria-hidden="true" />
        <p className="text-sm font-medium text-slate-600 dark:text-ndark-muted">
          Henüz e-posta yok
        </p>
      </div>
    );
  }

  // 8 kolon: yön / From / To / Cc / Bcc / Tarih / Konu+Ek / Aksiyon
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-ndark-border">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-ndark-card dark:text-ndark-muted">
          <tr>
            <th className="w-8 px-2 py-2 text-center">Yön</th>
            <th className="px-2 py-2">Kimden</th>
            <th className="px-2 py-2">Kime</th>
            <th className="px-2 py-2">Cc</th>
            <th className="px-2 py-2">Bcc</th>
            <th className="px-2 py-2">Tarih</th>
            <th className="px-2 py-2">Konu / Ek</th>
            <th className="w-24 px-2 py-2 text-right">İşlemler</th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-ndark-card">
          {items.map((email, idx) => {
            const isLast = idx === items.length - 1;
            // Last row için ref vermek: MailMessageCard kendisi tr render
            // ediyor. Scroll-into-view için DOM hedef olarak biz dış div
            // kullanmıyoruz; sentinel <tr> ekleyebiliriz. Basit: items
            // listesi değiştiğinde scrollToLast pendingRef ile çalıştığı
            // için aşağıdaki sentinel TR ile son maile referans veririz.
            // Bunun yerine doğrudan MailMessageCard'a key + index versek
            // de DOM ref alamayız; sentinel daha temiz.
            void isLast;
            return (
              <MailMessageCard
                key={email.id}
                email={email}
                caseId={caseId}
                onReply={onReply}
                onForward={onForward}
                expandColSpan={8}
                // Son inbound mail varsayılan açık (M6.3a paritesi)
                defaultExpanded={isLast && email.direction === 'inbound'}
              />
            );
          })}
          {/* Sentinel — scroll hedefi */}
          <tr ref={lastRowRef} aria-hidden="true">
            <td colSpan={8} />
          </tr>
        </tbody>
      </table>
    </div>
  );
});
