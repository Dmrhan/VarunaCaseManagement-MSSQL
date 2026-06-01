/**
 * L1CaseResolutionConsole — Phase 1 shell.
 *
 * Behind the `featureFlags.l1CaseConsoleEnabled` flag (default OFF).
 * When the flag is true, this component renders INSTEAD of the
 * existing `CaseDetailPage`. Phase 1 ships only the 3-zone layout
 * skeleton + stub child components — no data loading, no actions,
 * no service calls.
 *
 * Zones:
 *   1. L1CommandBar    — top, full width
 *   2. L1WorkbenchPanel — center, main column
 *   3. L1DecisionRail  — right column on desktop; stacks under
 *                        Workbench on narrow viewports
 *
 * The global app shell (sidebar + header) is preserved by the parent
 * <App /> render path; this component fills the same content slot as
 * CaseDetailPage.
 */

import { L1CommandBar } from './l1-console/L1CommandBar';
import { L1WorkbenchPanel } from './l1-console/L1WorkbenchPanel';
import { L1DecisionRail } from './l1-console/L1DecisionRail';

export function L1CaseResolutionConsole({ caseId }: { caseId: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-4">
      <L1CommandBar caseId={caseId} />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <L1WorkbenchPanel caseId={caseId} />
        <L1DecisionRail caseId={caseId} />
      </div>
    </div>
  );
}

export default L1CaseResolutionConsole;
