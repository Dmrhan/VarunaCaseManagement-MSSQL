/**
 * Mail M6.1 — Vaka thread mail listesi.
 *
 * Plan referansı: docs/M6-email-in-case-plan.md Bölüm 9.
 *
 * Mailler kronolojik (eskiden yeniye) gösterilir. Boş durumda EmptyState.
 *
 * REUSE: NotesTab stack düzeni; vertical space-y, scrollable container.
 */
import { useEffect, useState } from 'react';
import { Inbox } from 'lucide-react';
import { caseEmailService, type CaseEmailItem } from '../../../services/caseEmailService';
import { MailMessageCard } from './MailMessageCard';

interface Props {
  caseId: string;
}

export function MailThread({ caseId }: Props) {
  const [items, setItems] = useState<CaseEmailItem[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void caseEmailService.listEmails(caseId).then((rows) => {
      if (!alive) return;
      setItems(rows);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [caseId]);

  if (loading) {
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
        <p className="text-xs text-slate-500 dark:text-ndark-muted">
          Yanıt yazma özelliği yakında aktif olacak (M6.2).
        </p>
      </div>
    );
  }

  return (
    <ol className="space-y-3" aria-label="E-posta thread">
      {items.map((email) => (
        <li key={email.id}>
          <MailMessageCard email={email} caseId={caseId} />
        </li>
      ))}
    </ol>
  );
}
