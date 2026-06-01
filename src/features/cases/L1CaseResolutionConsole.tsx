/**
 * L1CaseResolutionConsole — Phase 2A.
 *
 * Behind the `featureFlags.l1CaseConsoleEnabled` flag (default OFF).
 * Phase 2A wires the top L1CommandBar with real case data; Workbench
 * and DecisionRail remain Phase 1 stubs.
 *
 * Data flow:
 *   - `caseService.get(caseId)` on mount, same pattern as
 *     CaseDetailPage. Simple loading / error states; no draft
 *     accumulation, no inline edits, no sub-fetches yet.
 *   - `case` passed down to L1CommandBar; Workbench/DecisionRail still
 *     receive `caseId` only.
 *   - `onBack` lifted from App.tsx so the back button in CommandBar
 *     can return to the cases list. `onShowCustomer` is optional;
 *     parity with CaseDetailPage.
 */

import { useEffect, useState } from 'react';
import { caseService } from '@/services/caseService';
import type { Case } from './types';
import { L1CommandBar } from './l1-console/L1CommandBar';
import { L1WorkbenchPanel } from './l1-console/L1WorkbenchPanel';
import { L1DecisionRail } from './l1-console/L1DecisionRail';

export function L1CaseResolutionConsole({
  caseId,
  onBack,
  onShowCustomer,
}: {
  caseId: string;
  onBack: () => void;
  onShowCustomer?: (accountId: string) => void;
}) {
  const [item, setItem] = useState<Case | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    caseService
      .get(caseId)
      .then((c) => {
        if (!alive) return;
        if (c) {
          setItem(c);
        } else {
          setError('Vaka bulunamadı.');
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [caseId]);

  if (loading && !item) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-ndark-muted">
        Vaka yükleniyor…
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-slate-500 dark:text-ndark-muted">
        <span>{error ?? 'Vaka bulunamadı.'}</span>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
        >
          Vakalar listesine dön
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <L1CommandBar item={item} onBack={onBack} onShowCustomer={onShowCustomer} />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <L1WorkbenchPanel caseId={item.id} />
        <L1DecisionRail caseId={item.id} />
      </div>
    </div>
  );
}

export default L1CaseResolutionConsole;
