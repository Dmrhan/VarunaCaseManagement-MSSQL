/**
 * MailThreadListPane — Ortak mesaj listesi (PR-2 Aşama A + R9).
 *
 * REUSE:
 *   - Sekme içi (dikey usta-detay): ÜST kompakt liste
 *   - Fullscreen (Gmail düzeni):     SOL pane
 * Aynı bileşen; iki yerde de birebir. Kullanıcı direktifi: "yeni liste
 * yazma" — çatal yok.
 *
 * R9 (2026-07-04) — Gmail bilgi mimarisi:
 *   1. Satır: 2-satırlı anatomi
 *      - 1. satır: [yön] GÖNDEREN ADI (medium, flex-1) ... KISA TARİH
 *      - 2. satır: snippet (bodyText ilk satır, muted, truncate) + 📎N
 *   2. Konu satırda tekrarlanmaz (vaka bağlamı belli)
 *   3. İstisna: normalize edilmiş konu ≠ vaka title → "Konu değişti: X — snippet"
 *   4. [UNV-xxx] token gizli (stripCaseToken=true)
 *   5. Gönderen: gelen→ad; giden(agent)→"Siz · <name>"; sistem→"Varuna · Otomatik"
 *   6. Yön ayrımı: giden satır bg-slate-50/50 (default), bg-slate-100/60 (fs)
 *   7. Sıralama toggle: default YENİ→ESKİ (en son üstte); tercih localStorage
 *   8. Başlık: "Yazışma · N mesaj" + toggle
 */
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Paperclip } from 'lucide-react';
import type { CaseEmailItem } from '@/services/caseEmailService';
import { normalizeSubject } from '@/lib/subjectNormalizer';
import { formatSmartDate, formatSmartDateFull } from '@/lib/smartDate';
import { computeSenderDisplay } from '../lib/mailSender';

interface Props {
  emails: CaseEmailItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  className?: string;
  variant?: 'default' | 'fullscreen';
  /**
   * R9: Vaka başlığı — mail konusu ile karşılaştırma için (Konu değişti
   * istisnası). Verilmezse "Konu değişti" öneki üretilmez.
   */
  caseTitle?: string;
  /**
   * R9.1: Oturumdaki kullanıcının id'si. Giden mailde
   * sentByUserId === currentUserId ise "Siz" gösterilir (Gmail 'ben'
   * paritesi). Verilmezse "Siz" hiçbir zaman tetiklenmez (agent adı ya da
   * fallback).
   */
  currentUserId?: string | null;
}

type SortOrder = 'newest' | 'oldest';
const SORT_STORAGE_KEY = 'pr2.commTab.listSortOrder';

function loadSortOrder(): SortOrder {
  try {
    const v = localStorage.getItem(SORT_STORAGE_KEY);
    return v === 'oldest' ? 'oldest' : 'newest';
  } catch { return 'newest'; }
}
function saveSortOrder(v: SortOrder): void {
  try { localStorage.setItem(SORT_STORAGE_KEY, v); } catch { /* no-op */ }
}

/** İlk satır snippet — bodyText'in ilk satır \n ile split, trim, empty→''. */
function computeSnippet(email: CaseEmailItem): string {
  const raw = (email.bodyText ?? '').split('\n')[0]?.trim() ?? '';
  return raw;
}

export function MailThreadListPane({
  emails,
  selectedId,
  onSelect,
  className,
  variant = 'default',
  caseTitle,
  currentUserId = null,
}: Props) {
  const fs = variant === 'fullscreen';
  const [sortOrder, setSortOrder] = useState<SortOrder>(() => loadSortOrder());

  // Backend kronolojik (eskiden yeniye); yeni→eski için reverse.
  const sortedEmails = useMemo(() => {
    return sortOrder === 'newest' ? [...emails].reverse() : emails;
  }, [emails, sortOrder]);

  const toggleSort = () => {
    setSortOrder((cur) => {
      const next: SortOrder = cur === 'newest' ? 'oldest' : 'newest';
      saveSortOrder(next);
      return next;
    });
  };

  const caseTitleClean = useMemo(
    () => (caseTitle ? normalizeSubject(caseTitle, { stripCaseToken: true }).trim().toLocaleLowerCase('tr-TR') : ''),
    [caseTitle],
  );

  return (
    <div className={`flex flex-col overflow-hidden ${fs ? 'bg-slate-50 dark:bg-ndark-bg' : 'bg-white dark:bg-ndark-card'} ${className ?? ''}`}>
      {/* Başlık — R9: "Yazışma · N mesaj" + sıralama toggle */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-1.5 text-[11px] text-slate-500 dark:border-ndark-border dark:text-ndark-muted">
        <span>
          Yazışma · <span className="font-medium">{emails.length}</span> mesaj
        </span>
        <button
          type="button"
          onClick={toggleSort}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-slate-100 dark:hover:bg-ndark-bg"
          title={sortOrder === 'newest' ? 'Yeni → Eski (en son üstte). Değiştirmek için tıkla.' : 'Eski → Yeni. Değiştirmek için tıkla.'}
        >
          <ArrowUpDown size={11} />
          <span>{sortOrder === 'newest' ? 'Yeni → Eski' : 'Eski → Yeni'}</span>
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        <ul className={fs ? 'space-y-0.5 py-1' : 'divide-y divide-slate-100 dark:divide-ndark-border'}>
          {sortedEmails.map((e) => {
            const inbound = e.direction === 'inbound';
            const ts = e.receivedAt ?? e.sentAt ?? e.createdAt;
            const isSelected = e.id === selectedId;

            const senderDisplay = computeSenderDisplay(e, currentUserId);
            const rawSnippet = computeSnippet(e);
            // Konu değişti istisnası — normalize edilmiş konu vaka title'ından farklı mı?
            const subjectClean = normalizeSubject(e.subject, { stripCaseToken: true }).trim();
            const subjectChanged =
              subjectClean.length > 0 &&
              caseTitleClean.length > 0 &&
              subjectClean.toLocaleLowerCase('tr-TR') !== caseTitleClean;
            const snippet = subjectChanged
              ? `Konu değişti: ${subjectClean}${rawSnippet ? ' — ' + rawSnippet : ''}`
              : rawSnippet;
            const smartDate = formatSmartDate(ts);
            const smartDateFull = formatSmartDateFull(ts);

            // Yön zemini — giden hafif soluk
            const outboundRowBg = !inbound
              ? (fs ? 'bg-slate-100/60 dark:bg-ndark-bg/60' : 'bg-slate-50/60 dark:bg-ndark-bg/40')
              : '';

            const baseSelected = fs
              ? 'border-l-4 border-brand-600 bg-white pl-2 font-medium text-brand-900 dark:bg-ndark-card dark:text-brand-100'
              : 'bg-brand-50 text-brand-900 dark:bg-brand-900/20 dark:text-brand-100';
            const baseIdle = fs
              ? `border-l-4 border-transparent pl-2 hover:bg-white dark:hover:bg-ndark-card ${outboundRowBg}`
              : `hover:bg-slate-50 dark:hover:bg-ndark-bg ${outboundRowBg}`;

            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => onSelect(e.id)}
                  className={`flex w-full flex-col text-left transition ${
                    fs ? 'min-h-[52px] px-3 py-2' : 'min-h-[48px] px-3 py-1.5'
                  } ${isSelected ? baseSelected : baseIdle}`}
                  title={e.subject /* ham konu tooltip */}
                >
                  {/* 1. satır: yön + gönderen + tarih */}
                  <div className="flex w-full items-center gap-2">
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
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800 dark:text-ndark-text">
                      {senderDisplay}
                    </span>
                    <span
                      className="shrink-0 text-[11px] text-slate-500 dark:text-ndark-muted"
                      title={smartDateFull}
                    >
                      {smartDate}
                    </span>
                  </div>
                  {/* 2. satır: snippet + ek rozeti */}
                  <div className="mt-0.5 flex w-full items-baseline gap-2 pl-7">
                    <span className={`min-w-0 flex-1 truncate text-[11px] ${
                      subjectChanged
                        ? 'text-amber-700 dark:text-amber-300'
                        : 'text-slate-500 dark:text-ndark-muted'
                    }`}>
                      {snippet || <span className="italic opacity-60">(içerik yok)</span>}
                    </span>
                    {e.attachments.length > 0 && (
                      <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-slate-500 dark:text-ndark-muted">
                        <Paperclip size={10} />
                        <span>{e.attachments.length}</span>
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
