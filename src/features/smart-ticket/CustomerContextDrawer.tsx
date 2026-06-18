/**
 * Smart Ticket — Customer Context Drawer.
 *
 * Müşteri bağlamı için sağdan slide-in panel. 3 tab:
 *   1. Geçmiş Çözümler (default açık) — son kapalı vakalar + closure parse
 *   2. Açık Vakalar — duplicate banner + açık vaka listesi (AccountOpenCases pattern)
 *   3. Sinyaller — CustomerPulsePanel account variant reuse
 *
 * Self-fetch: drawer açıldığında lazy. accountId/companyId change'inde re-fetch.
 * Açıklama textarea'sını itmemek için sol panelde Banner kalır; Drawer ayrı
 * fixed-position layer.
 */
import { useEffect, useState } from 'react';
import { X, ExternalLink, Inbox, CheckCircle2, Activity } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatRelative } from '@/lib/format';
import { caseService } from '@/services/caseService';
import type { Case } from '@/features/cases/types';
import { CustomerPulsePanel } from '@/features/cases/components/CustomerPulsePanel';
import { parseClosureFromCustomFields, labelOrCode, type ClosureSummary } from './customerHistory';

type TabKey = 'resolved' | 'open' | 'signals';

interface CustomerContextDrawerProps {
  /** Drawer açık mı (parent state) */
  open: boolean;
  onClose: () => void;
  /** Müşteri */
  accountId: string;
  accountName: string;
  companyId: string;
  /** "Detayda Aç" → CaseDetail route'a yönlendir (parent navigate eder) */
  onOpenCase?: (caseId: string) => void;
  /**
   * Mevcut açık vaka listesi parent'tan paylaşılır (Smart Ticket page zaten
   * fetch ediyor). Drawer kendi state'i için sadece resolved + duplicate
   * fetch yapar — gereksiz duplikasyondan kaçınmak için.
   */
  openCases: Case[];
  openCasesLoading: boolean;
  openCasesError: string | null;
}

const TAB_META: Record<TabKey, { label: string; icon: typeof CheckCircle2 }> = {
  resolved: { label: 'Geçmiş Çözümler', icon: CheckCircle2 },
  open: { label: 'Açık Vakalar', icon: Inbox },
  signals: { label: 'Sinyaller', icon: Activity },
};

export function CustomerContextDrawer({
  open,
  onClose,
  accountId,
  accountName,
  companyId,
  onOpenCase,
  openCases,
  openCasesLoading,
  openCasesError,
}: CustomerContextDrawerProps) {
  const [tab, setTab] = useState<TabKey>('resolved');
  const [resolvedCases, setResolvedCases] = useState<Case[]>([]);
  const [resolvedLoading, setResolvedLoading] = useState(false);
  const [resolvedError, setResolvedError] = useState<string | null>(null);

  // Drawer her açılışta resolved fetch (lazy load).
  // accountId/companyId değişiminde yeniden fetch. Faz 1 scope'unda yalnız
  // closed case'leri çekiyoruz; AÇIK vaka listesi parent state'inden gelir.
  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;

    setResolvedLoading(true);
    setResolvedError(null);
    caseService
      .findByAccount(accountId, { statusIn: ['Çözüldü'] })
      .then((cases) => {
        if (cancelled) return;
        // Yeniden çözülenleri önce göster — resolvedAt DESC
        const sorted = [...cases].sort((a, b) => {
          const ta = a.resolvedAt ? new Date(a.resolvedAt).getTime() : 0;
          const tb = b.resolvedAt ? new Date(b.resolvedAt).getTime() : 0;
          return tb - ta;
        });
        setResolvedCases(sorted.slice(0, 5));
      })
      .catch(() => {
        if (!cancelled) setResolvedError('Geçmiş vakalar yüklenemedi.');
      })
      .finally(() => {
        if (!cancelled) setResolvedLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, accountId, companyId]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop — overlay click ile close */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Müşteri bağlamı drawer'ını kapat"
        className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-[1px] dark:bg-black/40"
      />

      {/* Drawer panel — sağdan slide-in */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Müşteri Bağlamı"
        className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-md flex-col bg-white shadow-xl dark:bg-ndark-surface"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-ndark-border">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-ndark-muted">
              Müşteri Bağlamı
            </div>
            <div className="mt-0.5 truncate text-sm font-semibold text-slate-800 dark:text-ndark-text">
              {accountName || accountId}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:text-ndark-muted dark:hover:bg-ndark-card"
            title="Kapat"
            aria-label="Kapat"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab nav */}
        <div className="flex border-b border-slate-200 px-2 dark:border-ndark-border">
          {(Object.keys(TAB_META) as TabKey[]).map((key) => {
            const Icon = TAB_META[key].icon;
            const isActive = tab === key;
            const countBadge =
              key === 'resolved'
                ? resolvedCases.length
                : key === 'open'
                ? openCases.length
                : null;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition ${
                  isActive
                    ? 'border-brand-500 text-brand-700 dark:text-brand-300'
                    : 'border-transparent text-slate-600 hover:text-slate-800 dark:text-ndark-muted dark:hover:text-ndark-text'
                }`}
              >
                <Icon size={12} />
                {TAB_META[key].label}
                {countBadge != null && countBadge > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0 text-[10px] ${
                      isActive
                        ? 'bg-brand-100 text-brand-800 dark:bg-brand-950/40 dark:text-brand-200'
                        : 'bg-slate-100 text-slate-700 dark:bg-ndark-card dark:text-ndark-muted'
                    }`}
                  >
                    {countBadge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content — scrollable */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {tab === 'resolved' && (
            <ResolvedTab
              loading={resolvedLoading}
              error={resolvedError}
              cases={resolvedCases}
              onOpenCase={onOpenCase}
            />
          )}
          {tab === 'open' && (
            <OpenTab
              loading={openCasesLoading}
              error={openCasesError}
              cases={openCases}
              onOpenCase={onOpenCase}
            />
          )}
          {tab === 'signals' && (
            <SignalsTab accountId={accountId} companyId={companyId} />
          )}
        </div>
      </aside>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Geçmiş Çözümler tab — closure parse ile zengin kart
   ───────────────────────────────────────────────────────────────── */
function ResolvedTab({
  loading,
  error,
  cases,
  onOpenCase,
}: {
  loading: boolean;
  error: string | null;
  cases: Case[];
  onOpenCase?: (id: string) => void;
}) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-slate-500 dark:text-ndark-muted">
        <Loader2 size={12} className="animate-spin" />
        Geçmiş çözümler yükleniyor…
      </p>
    );
  }
  if (error) {
    return (
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
        {error}
      </p>
    );
  }
  if (cases.length === 0) {
    return (
      <p className="text-xs text-slate-500 dark:text-ndark-muted">
        Bu müşterinin çözülmüş vakası yok.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {cases.map((c) => (
        <ResolvedCard key={c.id} c={c} onOpenCase={onOpenCase} />
      ))}
    </ul>
  );
}

function ResolvedCard({ c, onOpenCase }: { c: Case; onOpenCase?: (id: string) => void }) {
  // customFields parse — defansif. Eksikse closure bölümü atlatılır.
  const closure = parseClosureFromCustomFields(
    c.customFields as unknown as string | Record<string, unknown> | null | undefined,
  );

  const resolvedAtRel = c.resolvedAt ? formatRelative(c.resolvedAt) : null;
  const personOrTeam = c.assignedPersonName || c.assignedTeamName || null;

  return (
    <li className="rounded-md border border-slate-200 bg-white p-3 text-xs dark:border-ndark-border dark:bg-ndark-card">
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="font-mono font-semibold text-slate-700 dark:text-ndark-text">
          {c.caseNumber}
        </span>
        <StatusPill status={c.status} />
        <span className="truncate font-medium text-slate-800 dark:text-ndark-text" title={c.title}>
          {c.title}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-1.5 gap-y-0.5 text-[10px] text-slate-500 dark:text-ndark-muted">
        {resolvedAtRel && <span>Çözüm: {resolvedAtRel}</span>}
        {personOrTeam && <span>· {personOrTeam}</span>}
        {c.category && (
          <span>
            · {c.category}
            {c.subCategory && ` / ${c.subCategory}`}
          </span>
        )}
      </div>

      {c.resolutionNote && (
        <p className="mt-2 line-clamp-3 rounded-md bg-slate-50 px-2 py-1.5 text-[11px] leading-snug text-slate-700 dark:bg-ndark-bg dark:text-ndark-text">
          {c.resolutionNote}
        </p>
      )}

      {closure && <ClosureBlock closure={closure} />}

      {onOpenCase && (
        <button
          type="button"
          onClick={() => onOpenCase(c.id)}
          className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:underline dark:text-brand-300"
        >
          Detayda Aç
          <ExternalLink size={10} />
        </button>
      )}
    </li>
  );
}

function ClosureBlock({ closure }: { closure: ClosureSummary }) {
  const rcg = labelOrCode(closure.rootCauseGroupLabel, closure.rootCauseGroup);
  const rcd = labelOrCode(closure.rootCauseDetailLabel, closure.rootCauseDetail);
  const rt = labelOrCode(closure.resolutionTypeLabel, closure.resolutionType);
  const pp = labelOrCode(closure.permanentPreventionLabel, closure.permanentPrevention);
  const hasAny = !!(rcg || rcd || rt || pp);
  if (!hasAny) return null;

  return (
    <div className="mt-2 space-y-0.5 text-[11px] text-slate-700 dark:text-ndark-text">
      {rcg && (
        <Row label="Kök Neden">
          {rcg}
          {rcd && <span className="text-slate-500 dark:text-ndark-muted"> → {rcd}</span>}
        </Row>
      )}
      {!rcg && rcd && <Row label="Kök Neden Detayı">{rcd}</Row>}
      {rt && <Row label="Çözüm Tipi">{rt}</Row>}
      {pp && <Row label="Kalıcı Önlem">{pp}</Row>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <span className="shrink-0 text-slate-500 dark:text-ndark-muted">{label}:</span>
      <span className="truncate">{children}</span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Açık Vakalar tab — AccountOpenCases pattern reuse
   ───────────────────────────────────────────────────────────────── */
function OpenTab({
  loading,
  error,
  cases,
  onOpenCase,
}: {
  loading: boolean;
  error: string | null;
  cases: Case[];
  onOpenCase?: (id: string) => void;
}) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-slate-500 dark:text-ndark-muted">
        <Loader2 size={12} className="animate-spin" />
        Açık vakalar yükleniyor…
      </p>
    );
  }
  if (error) {
    return (
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
        {error}
      </p>
    );
  }

  const breachCount = cases.filter((c) => c.slaViolation).length;

  return (
    <div className="space-y-3">
      {/* Sayım + SLA breach özet */}
      <div className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-ndark-muted">
        <span>
          {cases.length === 0
            ? 'Açık vakası yok'
            : `${cases.length} açık vaka`}
        </span>
        {breachCount > 0 && (
          <span className="rounded-full bg-rose-100 px-1.5 py-0 text-[10px] font-semibold text-rose-700 dark:bg-rose-900/40 dark:text-rose-200">
            {breachCount} SLA ihlal
          </span>
        )}
      </div>

      {/* Liste */}
      {cases.length > 0 && (
        <ul className="space-y-1.5">
          {cases.map((c) => (
            <li
              key={c.id}
              className="rounded-md border border-slate-200 bg-white p-2 text-[11px] dark:border-ndark-border dark:bg-ndark-card"
            >
              <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                <span className="font-mono font-medium text-slate-700 dark:text-ndark-text">
                  {c.caseNumber}
                </span>
                <StatusPill status={c.status} />
                <span className="truncate text-slate-700 dark:text-ndark-text" title={c.title}>
                  {c.title}
                </span>
                {c.slaViolation && (
                  <span className="rounded bg-rose-100 px-1 py-0 text-[9px] font-medium text-rose-700 dark:bg-rose-900/40 dark:text-rose-200">
                    SLA
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-1.5 text-[10px] text-slate-500 dark:text-ndark-muted">
                {c.assignedPersonName && <span>{c.assignedPersonName}</span>}
                {c.assignedTeamName && !c.assignedPersonName && <span>{c.assignedTeamName}</span>}
                <span>· {formatRelative(c.createdAt)}</span>
              </div>
              {onOpenCase && (
                <button
                  type="button"
                  onClick={() => onOpenCase(c.id)}
                  className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-brand-700 hover:underline dark:text-brand-300"
                >
                  Detayda Aç
                  <ExternalLink size={9} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Sinyaller tab — CustomerPulsePanel account variant reuse
   ───────────────────────────────────────────────────────────────── */
function SignalsTab({ accountId, companyId }: { accountId: string; companyId: string }) {
  return (
    <div>
      <CustomerPulsePanel source={{ kind: 'account', accountId, companyId }} skipAi />
    </div>
  );
}
