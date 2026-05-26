import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import type { DashboardPendingApprovalItem } from '@/services/myService';

/**
 * WR-ACTION-CENTER Phase 1 — "Bekleyen Onaylarım" panel on MyHome.
 *
 * Distinct from the AI suggestion list ("Önerilen Aksiyonlar") — this
 * shows REAL ActionItems of kind approval_pending assigned to the user.
 *
 * Up to 5 items; "Tümünü Gör" opens the Action Center drawer.
 */

export function PendingApprovalsPanel({
  items,
  onItemClick,
  onOpenDrawer,
}: {
  items: DashboardPendingApprovalItem[];
  onItemClick: (caseId: string) => void;
  onOpenDrawer: () => void;
}) {
  const count = items.length;

  return (
    <Card className="shadow-md">
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-ndark-border">
        <h2 className="flex items-center gap-2.5 text-base font-semibold text-slate-900 dark:text-ndark-text">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            <ShieldCheck size={16} />
          </span>
          Bekleyen Onaylarım
          {count > 0 && <Badge tint="amber">{count}</Badge>}
        </h2>
        {count > 0 && (
          <button
            type="button"
            onClick={onOpenDrawer}
            className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-300"
          >
            Eylem Merkezi
          </button>
        )}
      </div>
      {count === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300">
            <CheckCircle2 size={22} />
          </span>
          <div>
            <div className="text-sm font-medium text-slate-700 dark:text-ndark-text">
              Bekleyen onayın yok
            </div>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-500 dark:text-ndark-muted">
              Bir vaka onayına gönderildiğinde burada görünecek.
            </p>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-ndark-border/60">
          {items.slice(0, 5).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => item.caseId && onItemClick(item.caseId)}
              disabled={!item.caseId}
              className="flex w-full items-start gap-3 px-6 py-3 text-left transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-ndark-bg/40"
            >
              <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-md bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300">
                <ShieldCheck size={12} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {item.caseNumber && (
                    <span className="font-mono text-[11px] text-slate-500 dark:text-ndark-muted">
                      {item.caseNumber}
                    </span>
                  )}
                  {item.state === 'InProgress' && <Badge tint="slate">çalışıyor</Badge>}
                </div>
                {item.caseTitle && (
                  <div className="mt-0.5 truncate text-sm font-medium text-slate-800 dark:text-ndark-text">
                    {item.caseTitle}
                  </div>
                )}
                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-ndark-muted">
                  {item.reasonLabel}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
