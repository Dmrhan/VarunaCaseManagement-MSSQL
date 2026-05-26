/**
 * NewCaseForm reconciliation helpers (no JSX → unit-testable via smoke).
 *
 * The single function below decides what to do with the currently-selected
 * account when the operator changes the company. Extracting it out of
 * NewCaseForm makes it both readable and assertable without spinning up
 * the React form.
 *
 * Behavioral contract (C3 Codex P1 follow-up):
 *  - If no account is currently selected → no account-side change.
 *  - If the new companyId matches one of the account's AC companies (or
 *    the account is "legacy" via direct companyId / nullable companyId)
 *    → keep the account; only clear the project reference (which is
 *    company-scoped through AC).
 *  - Otherwise → clear account + project + customer contact fields. This
 *    mirrors the pre-C3 conservative behavior, which was the original
 *    safety net.
 *
 * The helper does NOT mutate inputs and returns the patch to merge into
 * `form` via `setForm((f) => ({ ...f, ...patch }))`.
 */

export interface ReconcileInput {
  /** Currently-selected account id ('' when none). */
  accountId: string;
  /** Currently-selected account name (display). */
  accountName: string;
  /** The company the operator just switched to ('' when cleared). */
  newCompanyId: string;
  /** Company ids the account legitimately belongs to (via AccountCompany). */
  accountCompanyIds: string[];
  /** Direct `Account.companyId` when present (legacy, denormalized path). */
  accountDirectCompanyId?: string | null;
}

export interface ReconcilePatch {
  accountId: string;
  accountName: string;
  /** Always cleared on company change — project is AC-scoped. */
  accountProjectId: string;
  accountProjectName: string;
  /** Cleared only when the account is cleared (not when it's kept). */
  customerContactName?: string;
  customerContactPhone?: string;
  customerContactEmail?: string;
  customerCompanyName?: string;
  /**
   * Caller hint — true when the helper concluded the account is still
   * valid for the new company and should be retained. Useful for the
   * smoke to assert without inspecting the full patch shape.
   */
  accountRetained: boolean;
}

/**
 * Reconcile account/project/contact fields on company change.
 *
 * The returned patch can be safely merged with `setForm((f) => ({ ...f,
 * ...patch }))`. Conditional fields (`customerContact*`) are omitted from
 * the patch when the account is retained so the operator's contact
 * overrides aren't wiped.
 */
export function reconcileAccountForCompanyChange(
  input: ReconcileInput,
): ReconcilePatch {
  const {
    accountId,
    accountName,
    newCompanyId,
    accountCompanyIds,
    accountDirectCompanyId,
  } = input;

  // No account selected → nothing to reconcile. Only project (always
  // AC-scoped) gets cleared by the caller's effect anyway, but we return
  // a stable patch shape so the caller can merge uniformly.
  if (!accountId) {
    return {
      accountId: '',
      accountName: '',
      accountProjectId: '',
      accountProjectName: '',
      accountRetained: false,
    };
  }

  // The account is considered "linked" to the new company when:
  //  - One of its AC rows references newCompanyId; or
  //  - Its direct Account.companyId matches (legacy denormalized path),
  //    and that direct id was EXPLICITLY provided (a non-empty string).
  //
  // Note: passing `null` (or `undefined`) for `accountDirectCompanyId`
  // means "caller doesn't know" — not "this is a legacy companyId=null
  // account". We intentionally do NOT fall back to "linked to any company"
  // because callers like AccountDetailPage cannot surface the direct
  // Account.companyId column today; treating that as a wildcard would
  // keep mismatched accounts alive. A genuine legacy account with no AC
  // rows and no direct id has no operator-meaningful link to ANY tenant,
  // so clearing on company change is the safe + correct UX.
  const linked =
    accountCompanyIds.includes(newCompanyId) ||
    (typeof accountDirectCompanyId === 'string' && accountDirectCompanyId === newCompanyId);

  if (linked) {
    return {
      accountId,
      accountName,
      // Project is AC-scoped; the old AC may differ from the new one even
      // when account itself is shared across both companies. Clearing is
      // safest — the project-effect will re-suggest if applicable.
      accountProjectId: '',
      accountProjectName: '',
      accountRetained: true,
    };
  }

  // Not linked → clear account + dependent fields.
  return {
    accountId: '',
    accountName: '',
    accountProjectId: '',
    accountProjectName: '',
    customerContactName: '',
    customerContactPhone: '',
    customerContactEmail: '',
    customerCompanyName: '',
    accountRetained: false,
  };
}
