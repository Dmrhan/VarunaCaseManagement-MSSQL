/**
 * L1CommandBar — Phase 2H Layout Hygiene.
 *
 * Slim 2-row operational header. Previous (Phase 2A-2G) version put
 * breadcrumb + title + chip row + Takım/Sorumlu meta + 6 disabled
 * top-level buttons in ~110px. The product shape review found the
 * disabled buttons created false affordances and that triplicated
 * Status/Priority/SLA rendering invited clone drift with
 * CaseDetailPage.
 *
 * New shape (~64-72px total):
 *
 *   Row 1 — identity + primary action
 *     [<] Vakalar > {caseNumber} — {accountName}   {title trunc}      [Devret][⋮]
 *
 *   Row 2 — operational chips + assignment
 *     <CaseHeaderChips> · Sorumlu: {name}
 *
 * Active in this phase:
 *   - Back navigation (onBack)
 *   - Compact breadcrumb (accountName clickable when onShowCustomer set)
 *   - Title (single line, truncated)
 *   - Devret (top-level when onTransferClick provided; Phase 2G wiring)
 *   - Overflow kebab (Kaydet / Çağrı Başlat / Durum Raporu / Ertele
 *     as DISABLED menu items with deferred-phase tooltips — no more
 *     misleading top-level affordances)
 *
 * Phase 2I+ migrations expected from the kebab:
 *   - Kaydet           — only when a real batched-edit surface exists
 *                        (currently L1 saves optimistically per field)
 *   - Çağrı Başlat     — better as customer-chip context action, not
 *                        a header button
 *   - Durum Raporu     — StatusReportModal extraction
 *   - Ertele           — SnoozeModal hoist
 */

import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  Clock3,
  MoreHorizontal,
  Phone,
  Save,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { Case } from '../types';
import { CaseHeaderChips } from '../components/CaseHeaderChips';

const PLACEHOLDER_TITLE = 'Sonraki L1 fazında bağlanacak (Phase 2I+).';

interface KebabItem {
  label: string;
  icon: React.ReactNode;
  title: string;
}

const KEBAB_ITEMS: KebabItem[] = [
  {
    label: 'Kaydet',
    icon: <Save size={12} />,
    title: `Kaydet — ${PLACEHOLDER_TITLE} (L1 zaten alan-bazında optimistic kaydeder; batched-edit surface oluşunca top-level olur)`,
  },
  {
    label: 'Çağrı Başlat',
    icon: <Phone size={12} />,
    title: `Çağrı Başlat — ${PLACEHOLDER_TITLE} (müşteri chip context'inde ActiveCallBanner pattern'iyle gelecek)`,
  },
  {
    label: 'Durum Raporu',
    icon: <Sparkles size={12} />,
    title: `Durum Raporu — ${PLACEHOLDER_TITLE} (StatusReportModal CaseDetailPage'den ayıklanacak)`,
  },
  {
    label: 'Ertele',
    icon: <Clock3 size={12} />,
    title: `Ertele — ${PLACEHOLDER_TITLE} (SnoozeModal hoist edilecek)`,
  },
];

export function L1CommandBar({
  item,
  onBack,
  onShowCustomer,
  onTransferClick,
}: {
  item: Case;
  onBack: () => void;
  onShowCustomer?: (accountId: string) => void;
  /** Devret aksiyonu — parent TransferModal'ı açar. Undefined ise
   *  buton disabled olarak kalır. */
  onTransferClick?: () => void;
}) {
  const [kebabOpen, setKebabOpen] = useState(false);
  const kebabRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!kebabOpen) return;
    function onClick(e: MouseEvent) {
      if (!kebabRef.current?.contains(e.target as Node)) {
        setKebabOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [kebabOpen]);

  return (
    <header className="border-b border-slate-200 bg-white dark:border-ndark-border dark:bg-ndark-card">
      {/* ── Row 1 — identity + primary action ──────────────────────── */}
      <div className="flex items-center gap-3 px-6 py-2">
        <button
          type="button"
          onClick={onBack}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 dark:text-ndark-muted dark:hover:bg-ndark-bg"
          title="Vakalar listesine dön"
          aria-label="Geri"
        >
          <ArrowLeft size={16} />
        </button>

        <div className="min-w-0 flex-1">
          {/* Compact breadcrumb */}
          <div className="flex flex-wrap items-center gap-1 text-[11px] text-slate-500 dark:text-ndark-muted">
            <button
              type="button"
              onClick={onBack}
              className="hover:text-brand-700 hover:underline"
            >
              Vakalar
            </button>
            <ChevronRight size={10} className="text-slate-400" />
            <span className="font-mono text-slate-700 dark:text-ndark-text">{item.caseNumber}</span>
            {item.accountName && (
              <>
                <span className="text-slate-400">—</span>
                {item.accountId && onShowCustomer ? (
                  <button
                    type="button"
                    onClick={() => onShowCustomer(item.accountId)}
                    className="truncate text-slate-600 hover:text-brand-700 hover:underline dark:text-ndark-muted"
                    title="Müşteri kartını aç"
                  >
                    {item.accountName}
                  </button>
                ) : (
                  <span className="truncate text-slate-600 dark:text-ndark-muted">{item.accountName}</span>
                )}
              </>
            )}
          </div>
          <h1 className="truncate text-sm font-semibold leading-tight text-slate-900 dark:text-ndark-text">
            {item.title}
          </h1>
        </div>

        {/* Primary action + overflow kebab */}
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<UserPlus size={12} />}
            onClick={onTransferClick}
            disabled={!onTransferClick}
            title={
              onTransferClick
                ? 'Vakayı başka bir takıma/kişiye devret'
                : `Devret — ${PLACEHOLDER_TITLE}`
            }
          >
            Devret
          </Button>

          <div ref={kebabRef} className="relative">
            <button
              type="button"
              onClick={() => setKebabOpen((v) => !v)}
              title="Daha fazla aksiyon"
              aria-label="Daha fazla aksiyon"
              aria-expanded={kebabOpen}
              aria-haspopup="menu"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted dark:hover:bg-ndark-bg"
            >
              <MoreHorizontal size={14} />
            </button>
            {kebabOpen && (
              <ul
                role="menu"
                className="absolute right-0 top-full z-20 mt-1 min-w-[220px] overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg dark:border-ndark-border dark:bg-ndark-card"
              >
                {KEBAB_ITEMS.map((kbi) => (
                  <li key={kbi.label} role="menuitem">
                    <button
                      type="button"
                      disabled
                      title={kbi.title}
                      className="flex w-full cursor-not-allowed items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-400 dark:text-ndark-muted"
                    >
                      <span className="shrink-0">{kbi.icon}</span>
                      <span className="flex-1 truncate">{kbi.label}</span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-300 dark:text-ndark-muted/60">
                        Yakında
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* ── Row 2 — chips + assignment ─────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 px-6 py-1.5 text-xs dark:border-ndark-border/60">
        <CaseHeaderChips item={item} />
        {(item.assignedTeamName || item.assignedPersonName) && (
          <span className="ml-auto text-[11px] text-slate-500 dark:text-ndark-muted">
            {item.assignedTeamName && (
              <>
                Takım:{' '}
                <span className="text-slate-700 dark:text-ndark-text">{item.assignedTeamName}</span>
              </>
            )}
            {item.assignedTeamName && item.assignedPersonName && (
              <span className="mx-1.5 text-slate-400">·</span>
            )}
            {item.assignedPersonName && (
              <>
                Sorumlu:{' '}
                <span className="text-slate-700 dark:text-ndark-text">{item.assignedPersonName}</span>
              </>
            )}
          </span>
        )}
      </div>
    </header>
  );
}

export default L1CommandBar;
