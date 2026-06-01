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

import { useEffect, useRef, useState } from 'react';
import { caseService } from '@/services/caseService';
import type { Case } from './types';
import { L1CommandBar } from './l1-console/L1CommandBar';
import { L1WorkbenchPanel } from './l1-console/L1WorkbenchPanel';
import { L1DecisionRail } from './l1-console/L1DecisionRail';
import { TransferModal } from './components/TransferModal';

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
  // Devret modal'ı — TransferModal mevcut implementasyon kullanılır.
  const [transferOpen, setTransferOpen] = useState(false);
  // Codex P2 follow-up — TransferModal'ın open-time effect'i
  // `[open, caseItem.id, caseItem.transferCount]` deps ile çalışır ve
  // toTeamId / brief / success state'lerini sıfırlar. Eğer
  // onTransferred içinden setItem(updated) çağırırsak transferCount
  // anında değişir → effect tetiklenir → modal brief panelini
  // gösterirken state reset olur (toTeamId boşalır, AI suggest yeniden
  // çalışır). Bunun yerine güncellenmiş case'i pending'de tut ve modal
  // onClose ile kapanınca uygula.
  const [pendingTransferUpdate, setPendingTransferUpdate] = useState<Case | null>(null);
  // Codex P2 (second follow-up) — onClose ve onTransferred arasındaki
  // mid-flight race. Eğer kullanıcı modal'ı X / Escape ile transfer
  // hâlâ in-flight iken kapatırsa onClose pending=null ile çalışır;
  // sonra onTransferred geldiğinde pending'e koyar ama uygulanmaz.
  // Ref ile sync flag tutarak onTransferred geldiğinde modal'ın hâlâ
  // açık olup olmadığını closure-stale olmadan kontrol ederiz.
  const transferOpenRef = useRef(false);

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
      <L1CommandBar
        item={item}
        onBack={onBack}
        onShowCustomer={onShowCustomer}
        onTransferClick={() => {
          transferOpenRef.current = true;
          setTransferOpen(true);
        }}
      />
      {/* Phase 2H Layout Hygiene — outer grid clips; each column owns
          its own scroll. Previously this used `overflow-auto` and
          shared one scroll container for Workbench + DecisionRail,
          which pushed the right rail (RUNA AI + readiness checklist)
          out of view as soon as the Notes thread grew. Now the rail
          stays put while the Workbench scrolls independently. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <L1WorkbenchPanel item={item} onItemUpdate={setItem} />
        <L1DecisionRail item={item} />
      </div>
      <TransferModal
        open={transferOpen}
        caseItem={item}
        onClose={() => {
          // Synchronously flip the ref so any in-flight onTransferred
          // callback that fires AFTER this point sees the modal as
          // closed and applies the update directly.
          transferOpenRef.current = false;
          // Apply the deferred transfer result here so CommandBar /
          // Workbench / DecisionRail refresh AFTER the modal is gone.
          // Mutating earlier would re-trigger TransferModal's open-time
          // effect (deps on caseItem.transferCount) and wipe the brief
          // panel mid-flow.
          if (pendingTransferUpdate) {
            setItem(pendingTransferUpdate);
            setPendingTransferUpdate(null);
          }
          setTransferOpen(false);
        }}
        onTransferred={(updated) => {
          // Mid-flight close guard — if the user already dismissed the
          // modal via X / Escape before transferCase resolved, the
          // ref is already false and there's no future onClose to
          // apply the pending update; setItem immediately so the L1
          // console doesn't stay on the stale team/transferCount.
          if (transferOpenRef.current) {
            setPendingTransferUpdate(updated);
          } else {
            setItem(updated);
          }
        }}
      />
    </div>
  );
}

export default L1CaseResolutionConsole;
