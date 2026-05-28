# Quality Gates by Change Type

This matrix says **which checks are mandatory for which kind of change**
before a PR can be considered "Ready". It is the practical companion to
the longer rule docs:

- `docs/AI_WORKFLOW.md` — what the standards are, why they exist
- `docs/AGENTIC_PLANNING_PROTOCOL.md` — the 5-stage planning loop
- `docs/IN_PRODUCT_HELP_STANDARD.md` — Help Impact gate
- `docs/WORK_REGISTER.md` — IDs and status rules
- `.github/pull_request_template.md` — the PR-side checklist that
  enforces this matrix

If a check is **not mandatory** for a given change type, it is still
encouraged when relevant. If you skip a mandatory check, the PR body
must carry a concrete justification in the relevant section.

---

## Legend

- **✓ required** — must be run and reported in the PR body
- **— not required** by default (run if relevant)
- **N/A** — does not apply to this change type
- Numbers (e.g. "8-sec.") refer to the 8-section Multi-tenant
  Endpoint & UI Review Checklist in `docs/AI_WORKFLOW.md`

---

## Matrix

| Change type | build / typecheck | `prisma validate` | `smoke:data-contracts` | `smoke:help-content` | `smoke:ai-telemetry` | Tenant / auth review | Migration safety | Performance Gate verdict | Help Impact | Planning Card |
|---|---|---|---|---|---|---|---|---|---|---|
| **docs-only** (markdown, planning cards, READMEs) | ✓ | ✓ | — | — | — | — | — | — | Not needed | — |
| **frontend-only** (UI copy, layout, polish, no API change) | ✓ | ✓ | — | ✓ (if visible copy / labels touched) | — | — | — | — | Updated _or_ "Not needed: __" | small change — optional |
| **backend endpoint** (new route or modified handler) | ✓ | ✓ | ✓ | — | ✓ if endpoint calls AI | ✓ (general checklist) | — | ✓ Pass | if user-visible | ✓ |
| **schema migration** (new model / field / enum) | ✓ | ✓ | ✓ (Demo Seed Drift) | — | — | ✓ | ✓ additive only; backfill plan if not | ✓ Pass | if user-visible | ✓ |
| **tenant/auth sensitive** (role gate, `allowedCompanyIds`, scope filter) | ✓ | ✓ | ✓ (Tenant Scope Contract) | — | — | ✓ **8-sec.** | — | ✓ Pass | if visible | ✓ |
| **AI feature** (new endpoint, new call site, prompt change) | ✓ | ✓ | ✓ | ✓ if Help surface touched | ✓ | ✓ if data scope changes | — | ✓ Pass | Updated | ✓ |
| **cron / background job** (new schedule, new job, scope change) | ✓ | ✓ | ✓ if tenant-scoped writes | — | ✓ if AI invoked | ✓ if tenant data | ✓ if schema | ✓ Pass + Observability mitigation | — | ✓ |
| **import / export / reporting** (new format, new flow, export) | ✓ | ✓ | ✓ | ✓ (operator-facing) | — | ✓ (sensitive payloads) | ✓ if schema | ✓ Pass + Large Query Guard | Updated | ✓ |
| **hotfix** (P0 bug, single line / narrow patch) | ✓ | ✓ | if contract changed | if visible copy | if AI affected | if applicable | if migration | may skip with explicit note | if visible | small — skip with note |
| **release PR** (`dev → main`) | ✓ | ✓ | ✓ | ✓ | ✓ | — (composite — covered by feature PRs) | — | — | composite (note shipped features) | composite |

---

## Notes on individual gates

### Build / typecheck

Enforced by CI on every PR (`.github/workflows/ci.yml` → `npx tsc -b`
and `npx vite build`). Failures block merge.

### `prisma validate`

Enforced by CI on every PR. Schema syntax + Prisma client generation
sanity check. Does **not** validate migration safety (additive vs.
destructive) — that is the "Migration safety" column.

### `smoke:data-contracts`

Read-only DB smoke. Requires `DATABASE_URL` / `DIRECT_URL` env vars,
so it is **not** in default CI. Run locally before opening a PR for
any change in the contract column. Output PASS / WARN / FAIL summary
goes in the PR body. See `docs/AI_WORKFLOW.md` §"System Data Contract
Smoke" for when to add a new `defineGroup`.

### `smoke:help-content`

No DB required. Now enforced by CI on every PR. Validates required
keywords, banned phrases, and `updatedAt` per `HelpTopic`. See
`docs/IN_PRODUCT_HELP_STANDARD.md`.

### `smoke:ai-telemetry`

DB-backed; not in default CI. Run locally for AI changes. Asserts that
shipped AI call sites still write `AIUsageLog` rows with the right
fields and without PII leakage.

### `smoke:pr5-static-guards`

Pure file-string static guard (no DB, no HTTP). Cheap; safe in CI.
Locks four Half-Shipped Audit risk surfaces against silent regression:
- AI Accept/Reject telemetry timing (Apply-click MUST NOT write;
  submit-success / dismiss DO write).
- Cron workflows use `curl --fail-with-body` (no silent 5xx).
- `ActionItem` upsert update branch clears `archivedAt: null`.
- `accountRepository` listAccounts gates the `tcknHash` branch on
  11-digit + `validateTckn.ok` + `tcknPepperAvailable()`, and no
  Prisma `select` block exposes `tcknHash`.

Run locally before any change in TransferModal, NewCaseForm AI card,
cron workflows, `actionItemRepository.emitActionItem`, or
`accountRepository.listAccounts`.

### `smoke:account-tckn-search`

DB-backed; requires running BFF + `TCKN_HASH_PEPPER`. Exercises the
PR-4b TCKN-by-search end to end: valid TCKN matches, invalid does not,
unrelated valid TCKN does not, response never leaks plain TCKN or
`tcknHash`, tenant scope path still drops out-of-scope rows.

### `smoke:admin-create-phase5c`

DB-backed; requires running BFF. Exercises Phase 5C admin create flows
(Teams / SLA / Checklists / Categories) — positive happy path + missing
`companyId` 4xx guard. Protects against `400 companyId required`
regressions in the per-tenant admin UI picker.

### Tenant / auth review

When the change touches `allowedCompanyIds`, role gates, account /
company / case scope, search endpoints reused by multiple flows, or
shared aggregate metrics, run through the 8-section checklist in
`docs/AI_WORKFLOW.md` §"Multi-tenant Endpoint & UI Review Checklist".
Attest in the PR body.

### Migration safety

For schema migrations, additive is the default expectation: new
nullable column, new table, new index. Destructive operations (DROP
COLUMN, ALTER COLUMN TYPE, RENAME COLUMN, NOT NULL on existing column
without default) require an explicit backfill plan in the PR body.

### Performance & Architecture Gate verdict

Mandatory for backend, schema, tenant/auth, AI, cron, and import/export
changes. The Card section in `docs/AGENTIC_PLANNING_PROTOCOL.md §2③`
must end with one of:

- **Pass** — all 7 sub-checks (Query Optimization, Caching, Connection
  Pooling, Frontend Perf, Concurrent Mutations, Large Query Guards,
  Observability) are explicitly OK
- **Needs mitigation** — at least one sub-check requires a mitigation;
  the mitigation list becomes a hard rule in the implementation prompt
- **Blocked** — design exceeds the system budget; loop returns to
  Architecture Fit before implementation continues

For trivial frontend / docs-only / hotfix changes the verdict is N/A
and may be skipped with a note in the Card field.

### Help Impact

Every user-facing PR's final report must include a Help Impact line:
either **Updated: `<topic>`** (with registry bump) or **Not needed:
`<concrete reason>`**. "Not needed" is not a wave-off — give a real
reason (e.g. "BFF-only change, no user-visible surface", "infra
config change, no operator-visible behavior"). See
`docs/IN_PRODUCT_HELP_STANDARD.md` §A.

### Planning Card

Required for any non-trivial change. Trivial changes (typo, label
tweak, single-line bugfix) may skip the Card with an explicit
"skipped — trivial change" note in the PR body's Planning Card field.
Status changes in `docs/WORK_REGISTER.md` (Backlog → Ready → Shipped)
must reference a Card or an explicit skip.

---

## When in doubt

Size **up**, not down. If you cannot decide whether a change is
"frontend-only" or "tenant/auth sensitive", treat it as the stricter
category and run the extra gates. The cost of running one extra smoke
is small; the cost of shipping a regression that a gate would have
caught is large.
