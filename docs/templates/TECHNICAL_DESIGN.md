# Technical Design: <Feature Name>

## Existing System Touchpoints

Relevant files, modules, services, and tables. List concrete paths
(e.g. `server/db/caseRepository.js`, `src/features/cases/CaseDetailPage.tsx`)
so reviewers can trace the impact without hunting.

## Proposed Approach

Backend, frontend, data, AI, cron, or operational approach. Describe
the data flow end-to-end. Mention reused patterns explicitly so it is
clear that no new abstraction is being invented unless necessary.

## API Changes

New or changed endpoints. For each:
- Method and path
- Auth requirements (verifyJwt, role gate)
- Request shape
- Response shape
- Error cases (404, 400, 403, 503)

State "No API changes" if none.

## Data Model Changes

Schema changes (Prisma models, new tables, new columns, indexes) or a
clear "No schema change is needed" statement.

If schema changes exist, include migration name and rollback notes.

## Auth / Tenant Impact

- Which roles can call or see this?
- How is `allowedCompanyIds` enforced?
- Any cross-tenant risk (lookups, AI inputs, lists)?
- Any new bypass path that needs explicit justification?

## UI States

Required states for every new UI surface:
- Loading
- Empty
- Error / non-blocking fallback
- Success / populated

For each state, describe what the user sees and what they can do.

## Test Plan

- Build / typecheck (`npm run build`, `npx tsc --noEmit`)
- Manual API checks (which curl or endpoint)
- UI checks (which screen, which role, which scenario)
- Permission / tenant isolation checks
- AI fallback check (if applicable)

## Rollout / Fallback

How to avoid breaking current flows. Examples:
- Feature is additive and opt-in via UI button
- Endpoint added; no existing endpoint changed
- Schema change is forward-compatible (NOT NULL with default)
- Behavior changes only after migration is applied

Include a quick revert plan if relevant.

## Documentation Updates

Docs that should be updated as part of the same PR:
- `docs/API.md`
- `docs/ARCHITECTURE.md`
- `docs/OPERATIONS.md`
- `docs/ROADMAP.md`
- `docs/HANDOVER.md`
- `README.md`
