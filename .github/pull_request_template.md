## Summary

-

## Work Register / Planning

- **Work Register ID:** WR-_ (e.g. `WR-A1`) — see `docs/WORK_REGISTER.md`
- **Product Planning Matrix ID:** PM-_ (e.g. `PM-01`) — see `docs/PRODUCT_PLANNING_MATRIX.md`
- **Planning Card:** `docs/planning_cards/WR-_.md` — link, or `skipped — trivial change`
- **Performance & Architecture Gate verdict:** Pass / Needs mitigation (list) / Blocked / N/A — see `docs/AGENTIC_PLANNING_PROTOCOL.md §2③`
- **Intended PR base:** `dev` (default) — `main` only for release / approved hotfix

Required gates by change type: see `docs/QUALITY_GATES.md`.

## Product Context

-

## Technical Notes

-

## Validation

- [ ] `npm run build` (tsc + vite)
- [ ] `npm run smoke:help-content` — result: PASS / N topics validated
- [ ] `npm run smoke:data-contracts` — result: __ / __ groups PASS (when applicable; see Quality Gates)
- [ ] Feature-specific smokes: ___
- [ ] Manual API / UI checks: ___
- [ ] Tenant / role behavior checked — see `docs/AI_WORKFLOW.md` §"Multi-tenant Endpoint & UI Review Checklist" when applicable

## Data Contract Impact

- **Touches contract surface?** Yes / No (contract surface = new endpoint, schema change, tenant scope rule, role gate, AI payload, integration; see `docs/AI_WORKFLOW.md` §"When this gate is mandatory")
- **New `defineGroup` added to `scripts/smoke-data-contracts.js`?** Yes (group: __) / No (reason: __ / N/A)
- **Schema migration?** Yes / No
  - If Yes: additive only, no DROP/ALTER COLUMN without backfill? **Yes** / **No (rollback plan: __)**
- **Demo seed (`scripts/seed-full-demo-scenarios.js`) updated for new fields?** Yes / N/A

## AI Telemetry

- **New AI call site introduced?** Yes (logAIUsage wired) / No / N/A

## Help Impact

See `docs/IN_PRODUCT_HELP_STANDARD.md`.

- **Updated:** topic `__` (registry `updatedAt` bumped)

  _or_

- **Not needed:** concrete reason (e.g. "BFF-only change, no user-visible surface")

## Docs Impact

Tick all that apply; if none, justify under "no docs touched":

- [ ] `README.md` (setup / commands changed)
- [ ] `docs/API.md` (endpoint shape changed)
- [ ] `docs/ARCHITECTURE.md` (architectural flow changed)
- [ ] `docs/OPERATIONS.md` (env / cron / deploy / migration changed)
- [ ] `docs/ROADMAP.md` (status changed; "Recent Ships" added)
- [ ] `docs/BACKLOG.md` (active item closed / new item added)
- [ ] `docs/TECHNICAL_DEBT.md` (debt added / closed)
- [ ] `docs/PRODUCT_SPEC.md` (rule / workflow changed)
- [ ] `docs/TEST_SCENARIOS.md` (manual test scenario)
- [ ] `docs/HANDOVER.md` (handover-relevant decision)
- [ ] N/A — no docs touched (justification: __)

## Risks / Follow-ups

-

---

## Post-merge — fill after PR lands (see `docs/AI_WORKFLOW.md` §"Final-report metadata")

- **Observed merge path:** Path A (landed on `dev`) / Path B (landed on `main`)
- **Action taken:** release PR `dev → main` (Path A) / fast-forward `dev` to `main` (Path B) / N/A
- **Feature branch deleted (local + remote):** Yes / No (reason: __) / Pending
- **Topology check:**
  - `origin/main..origin/dev` empty? ✓ / ✗
  - `origin/dev..origin/main` empty? ✓ / ✗
- **origin/main HEAD:** _commit hash_
- **origin/dev HEAD:** _commit hash_
