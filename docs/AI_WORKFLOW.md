# AI Workflow

## Purpose

This document defines how AI agents should contribute to this repository
safely and consistently. It exists so that AI-assisted work stays
reviewable, preserves invariants (auth, tenant scope, existing flows),
and produces clean handover material for the engineering team.

If you are an AI agent working on this repo, read this file first and
follow it. If you are a human reviewer, this is the contract you can
hold AI work against.

## Before Coding

Agents must read relevant context before changing code:

- `README.md` - project summary, local setup, commands, doc links
- `docs/API.md` - BFF endpoints, auth, tenant scope, request/response examples
- `docs/ARCHITECTURE.md` - frontend, BFF, Prisma, Supabase, cron, AI, multi-tenant model
- `docs/OPERATIONS.md` - env, migration, deployment, cron, monitoring, troubleshooting
- `docs/ROADMAP.md` if present - proposed/planned/in-progress features
- `docs/TECHNICAL_DEBT.md` if present - known debt and deferred work
- Existing code around the feature being changed

Agents should briefly summarize the intended approach before
implementation (one or two paragraphs). Surprises after the fact are
worse than a 30-second alignment check up front.

## Agent Roles

The following roles are used to keep responsibilities clear. A single
agent session may switch between roles, but each piece of output should
be tagged with its role so reviewers know what kind of artifact they
are reading.

### Product Analyst Agent

Turns product ideas into feature briefs: user journeys, acceptance
criteria, non-goals, risks, and docs impact. Does not write code. Uses
`docs/templates/FEATURE_BRIEF.md` as the output shape.

### Architecture Agent

Reads docs and code, produces a technical design: affected files, API
changes, data impact, auth/tenant impact, UI states, risks, test plan.
Does not write code. Uses `docs/templates/TECHNICAL_DESIGN.md`.

### Implementation Agent

Implements an approved technical design. Keeps changes scoped, follows
existing patterns, preserves auth/tenant rules, updates docs if
behavior changes, runs validation (`npm run build`, manual checks).

### Review Agent

Reviews PRs and branches for bugs, security, tenant scope, auth, edge
cases, UI states, build/test gaps, and documentation drift. Reports
findings first; does not silently rewrite.

### QA Agent

Creates manual test plans and regression checklists: happy path, empty
states, permission cases, tenant isolation, AI fallback, failure modes.
Uses `docs/templates/QA_CHECKLIST.md`.

### Documentation Agent

Updates `README.md`, `docs/API.md`, `docs/ARCHITECTURE.md`,
`docs/OPERATIONS.md`, `docs/ROADMAP.md`, `docs/HANDOVER.md` when
behavior changes. Treats docs drift as a bug.

### Handover Agent

Prepares engineering takeover material: current state, completed and
pending work, risks, technical debt, environment notes, recommended
first-week review order. Uses `docs/templates/HANDOVER_NOTE.md` for
per-feature notes.

## Standard Feature Workflow

Use this staged workflow. Skip stages only when the work is trivial
(typo fix, label tweak) and document the skip in the PR description.

1. **Product Brief** - Product Analyst Agent (template: FEATURE_BRIEF)
2. **Technical Design** - Architecture Agent (template: TECHNICAL_DESIGN)
3. **Implementation** - Implementation Agent
4. **Self Review** - Implementation Agent, against the Review Checklist below
5. **QA Checklist** - QA Agent (template: QA_CHECKLIST)
6. **Documentation Update** - Documentation Agent
7. **Handover Note** - Handover Agent, if the change is non-trivial or
   touches operations/data (template: HANDOVER_NOTE)

## Git Flow Rules

These rules apply to **every** implementation regardless of size. They
keep `dev` and `main` aligned regardless of which path a merge actually
takes through GitHub's UI.

### Observed reality (2026-05-19)

PRs #160, #161, #162, #163 were each opened against `dev` but landed on
`main` when merged through GitHub's UI (likely because the repository
default base is `main` and the operator did not switch it at merge
time). The protocol previously assumed the strict `feature → dev → main`
flow; that assumption produced wasted release-PR steps and stale `dev`.
The rules below replace the strict rule with a dual-path discipline:
**check where the PR actually landed** and apply the matching cleanup.

### Default flow

1. **Start from updated `dev`.** Before branching, run:
   ```bash
   git fetch origin
   git checkout dev
   git merge --ff-only origin/dev
   ```
   If the fast-forward fails because `dev` has local commits, stop and
   report — never overwrite.

2. **Create the feature branch from `dev`:**
   ```bash
   git checkout -b feature/<short-kebab-name>
   ```
   Prefixes: `feat/<name>` for new features, `fix/<name>` for bug fixes,
   `docs/<name>` for documentation-only work, `chore/<name>` for tooling.

3. **Open the PR with intended base `dev`.** State the intended base in
   the chat/PR body explicitly. PR body must include:
   - Work Register ID (e.g. `WR-A1`) when applicable
   - Planning Card link if one was authored
   - Validation summary
   GitHub's UI may show a different default base. **The operator must
   verify the base at merge time** — never trust the form default.

4. **After merge, identify which path actually happened** by re-fetching
   and reading the topology:
   ```bash
   git fetch origin
   git log --oneline origin/main..origin/dev   # commits in dev not yet in main
   git log --oneline origin/dev..origin/main   # commits in main not yet in dev
   ```
   Exactly one of the two paths below applies; report which one in the
   final task summary.

   **Path A — PR landed on `dev` (standard flow):**
   - `origin/main..origin/dev` is non-empty (your feature commits).
   - `origin/dev..origin/main` should be empty (assuming `dev` was even
     with `main` before merge).
   - Open a release PR `dev → main` to promote.
   - After release PR merges, re-fetch and confirm parity.

   **Path B — PR landed directly on `main` (observed default in this repo):**
   - `origin/dev..origin/main` is non-empty (your feature commits sit
     in `main`, not `dev`).
   - `origin/main..origin/dev` should be empty.
   - **Do not open a redundant release PR.** Fast-forward `dev` to
     `main` instead:
     ```bash
     git checkout dev
     git merge --ff-only origin/main
     git push origin dev
     ```
   - Sync local `main` too: `git branch -f main origin/main`.

5. **After either path, delete the feature branch (local + remote)**
   unless there is a documented reason to keep it:
   ```bash
   git branch -D feature/<short-name>
   git push origin --delete feature/<short-name>
   ```

6. **Before starting any new feature, confirm sync:**
   ```bash
   git log --oneline origin/main..origin/dev | head -3   # must be empty
   git log --oneline origin/dev..origin/main | head -3   # must be empty
   ```
   If either side is non-empty, resolve before branching.

### Final-report metadata (required)

Every post-merge task summary must include this metadata block — no
exceptions:

- **Intended PR base:** `dev` (or `main` only for release / approved hotfix)
- **Observed merge path:** `Path A` (landed on dev) or `Path B` (landed on main)
- **Action taken:** `release PR dev → main` (Path A) or `fast-forward dev to main` (Path B)
- **Feature branch deleted after merge:** Yes / No / Pending
- **Topology check:** `origin/main..origin/dev` and `origin/dev..origin/main`
  — both must be empty before the task closes
- **origin/main HEAD / origin/dev HEAD** — the commit hashes

Missing this block is a self-review failure; add it before declaring
"done".

### Anti-Patterns

These are prohibited; surfacing any of them in a Card or PR review
sends the work back:

1. **Opening a release PR `dev → main` when `main` is already ahead of
   `dev`.** That state means a feature PR landed on `main` (Path B);
   fast-forward `dev` instead. A release PR with no commits to release
   is noise.
2. **Leaving merged feature branches around.** Delete local + remote
   immediately after merge unless there is an explicit reason to keep
   them; the reason must be written down.
3. **Starting a new feature while `dev` is behind `main`.** Always
   sync first (`merge --ff-only origin/main` on `dev`, then push).
4. **Silently creating extra branches.** Every branch creation must be
   announced and tied to a Work Register item / Planning Card.
5. **Trusting GitHub's default base at merge time.** The repository
   default is `main`; if your intended base is `dev`, verify before
   clicking merge. If it landed on `main` anyway, switch to Path B —
   do not retry by re-opening or reverting.

### Branch Hygiene Audit

Periodically (and at the start of any "let's tidy up" session) run a
**branch hygiene audit**:

- List all local branches: `git branch`
- List all remote branches: `git branch -r`
- Cross-check each remote branch against `gh pr list --state merged --limit 50`
  (or the GitHub web equivalent) to determine which feature branches
  belong to already-merged PRs.
- For each merged-but-not-deleted branch, propose deletion (local +
  remote) and confirm before deleting.
- For each unmerged-but-stale branch (no commits in 30+ days, no open
  PR), flag for review with the original author.

This protocol task **does not delete branches automatically.** It only
documents the cleanup discipline. Actual deletions require an explicit
"approve cleanup" or similar instruction.

## Workflow Size Guide

Scale the workflow to the size and risk of the change. When in doubt,
size up rather than down.

**Small changes:**
- Typos, copy changes, minor UI polish, documentation wording.
- Required: summary, changed files, validation if relevant.

**Medium changes:**
- New UI panel, endpoint adjustment, service method, non-critical feature.
- Required: short feature brief, implementation notes, review checklist, docs impact.

**Large / high-risk changes:**
- Auth, tenant scope, database schema, cron, AI, file storage,
  production operations, handover-critical features.
- Required: full workflow - product brief, technical design,
  implementation, review, QA, documentation, handover note if needed.

## Definition of Done

A feature is not done unless:

- Acceptance criteria from the Feature Brief are met
- Existing behavior is preserved (no silent regressions)
- Auth and tenant scope (`allowedCompanyIds`, role gates) are checked
- Empty, loading, and error states are handled where applicable
- Build and typecheck pass, or the failure is explained
- Relevant docs are updated
- Follow-up risks are documented

## Review Checklist

Use this as a self-review pass before opening a PR, and as a review
pass when reviewing someone else's work.

- Does this respect `allowedCompanyIds` and tenant boundaries?
- Are role and auth checks preserved on every new or changed endpoint?
- Does it avoid leaking cross-tenant data (lists, lookups, AI inputs)?
- Are loading, empty, and error states handled in the UI?
- Are backend errors non-breaking where appropriate (silent fallback
  vs. hard fail - pick consciously)?
- Are AI failures handled with deterministic fallback where applicable?
- Are docs updated when endpoints, env, cron, auth, or deploy behavior
  changes?
- Are demo seed commands avoided on production or real-data shared
  environments?

## Multi-tenant Endpoint & UI Review Checklist

Before marking any multi-tenant or role-sensitive feature as done,
verify each item below. This is a stricter superset of the general
Review Checklist; it is mandatory for any feature that touches
`allowedCompanyIds`, role gates, account/company/case scope, search
endpoints reused by multiple flows, or shared aggregate metrics.

### 1. Role Matrix

- Which roles can open the full page?
- Which roles can use embedded widgets/pickers from another flow?
- Which roles can read detail?
- Which roles can mutate?
- Are page access and embedded access intentionally different?

### 2. Scope Matrix

- Are returned rows scoped by `allowedCompanyIds`?
- Are detail endpoints scoped?
- Are create/update/delete mutations scoped server-side?
- Is `SystemAdmin` behavior explicit?
- Do `Admin` / `Supervisor` / `Agent` scopes differ as expected?

### 3. Aggregate / Count Safety

- Are counts, badges, totals, summaries, dashboards, and KPI tiles
  scoped the same way as rows?
- Can a user infer hidden tenant activity from a count, badge, filter
  result, or empty/non-empty state?

### 4. Filter Safety

- Do filters apply only to visible tenant relations?
- For multi-company relations, does status/category/company filtering
  combine with `allowedCompanyIds`?
- Does filtering by one company accidentally match another hidden
  company relation?

### 5. Search / Picker Safety

- Is the endpoint used by full pages, pickers, modals, quick flows, or
  case creation?
- Do embedded consumers need narrower payload or broader role access
  than the full page?
- Are search results scoped and free of internal notes?

### 6. Legacy / Null Data

- What happens before/after backfill?
- Are nullable fields handled safely?
- Do legacy records with old relations still appear where needed?
- Is there an idempotent repair/backfill path?

### 7. Data Leakage Review

- Are internal notes, segment, sensitive identifiers, raw PII, or
  hidden company relations excluded from lower-role responses?
- Are AI prompts and report exports using the same visibility rules?

### 8. Regression Smoke

For every relevant role, test:

- allowed page access
- denied page access
- embedded picker/widget access
- scoped list results
- scoped counts
- scoped filters
- one legacy/null-data scenario

### Note

Avoid relying only on "nominal" or "happy path" validation.
Multi-tenant features are not complete until role, scope, aggregate,
filter, embedded usage, and legacy/null-data checks are covered.

## Seed / Environment Safety

- `db:seed` and `db:seed:auth` are allowed for fresh local, demo, or
  sandbox databases.
- They may be used for shared demo/test environments only if those
  environments are isolated from production and from real customer
  data.
- They must not be used on production or any real-data shared
  environment.

If an agent is unsure whether an environment is real-data, it must
refuse to seed and ask.

## System Data Contract Smoke (`smoke:data-contracts`)

`npm run smoke:data-contracts` is the standard regression gate for any
change that touches cross-module data contracts. The script is
read-only and groups contract checks by domain:

- Identity Contract — `User.id` vs `Person.id` mixups + FK existence
- Account / Case Integrity — AccountCompany/Product/Contact FK and
  shared/legacy `Account.companyId` handling
- Tenant Scope Contract — `allowedCompanyIds` enforcement across
  list/search/count/filter paths, plus persona-based visibility
- Demo Seed Drift — required demo companies/persons/users + role
  assignments
- Customer Picker Contract — role split (`LIST_ROLES` vs
  `DETAIL_READ_ROLES`) and scoped case-count behavior

### When this gate is mandatory

Run `npm run smoke:data-contracts` and include the PASS/WARN/FAIL
summary in the PR report whenever the change touches any of:

- a new table or schema field
- a new endpoint or role gate
- a tenant-scoped query, aggregate, count, or filter
- seed data, demo personas, or scenario flows
- integrations (Jira, telephony, mail, etc.) or AI payloads
- watcher / mention / note / reaction / reminder / transfer logic
- Account / Case / User / Person / Notification surfaces

### Extending the gate (mandatory for new contracts)

For any future PR that introduces a new contract (table, endpoint,
role permission, tenant scope rule, aggregate, integration, AI payload),
the developer must either:

1. **Add a new contract check** to `scripts/smoke-data-contracts.js` via
   `defineGroup('X Contract', async () => [...checks])`, or
2. **Explicitly state in the PR report** why no new contract check is
   needed (e.g. the change is purely cosmetic/UI copy, or an existing
   group already covers it).

The harness is intentionally designed as an extensible check registry,
not a one-off checklist. New product areas (Document Request,
Notification Rules, Jira Sync, Telephony/AloTech, Data Import,
Account Merge, Knowledge Base / AI Suggestion) should add their own
group rather than embedding ad-hoc checks elsewhere.

### Output expectations

- Exit code `0` only if every group is PASS or WARN; any FAIL exits `1`.
- The script never writes, mutates, deletes, or seeds.
- Sensitive payloads (note content, segment, VKN) are never printed.
- Examples are limited to 5 rows per check.

## Documentation Update Rules

Agents should update:

- `docs/API.md` when endpoints or request/response shapes change
- `docs/ARCHITECTURE.md` when architectural flow changes (new
  service, new module boundary, new data flow)
- `docs/OPERATIONS.md` when env vars, deploy, migration, cron,
  monitoring, storage, or AI operations change
- `docs/ROADMAP.md` when roadmap status changes (Proposed -> Planned
  -> In Progress -> Shipped) or when known limitations change
- `docs/TEST_SCENARIOS.md` when a new feature ships that PMs/QA should
  manually test (add a scenario with persona + steps + expected)
- `docs/HANDOVER.md` when handover-relevant decisions change
- `docs/IN_PRODUCT_HELP_STANDARD.md` defines the in-product help
  registry, the Help Impact gate, and the freshness smoke. Touch it
  when those rules change; otherwise follow it.
- `README.md` when local setup, commands, or doc links change

## In-Product Help

User-facing screens follow `docs/IN_PRODUCT_HELP_STANDARD.md`:

- Critical screens (import/export, case workflows, account/customer
  data, admin definitions, AI/KB, reporting, permissions) must expose
  visible "Nasıl çalışır?" help.
- Help copy stays in operator language; banned phrases (BFF, Prisma,
  payload, adapter, Phase 2a/2b, internal layout names, …) cannot
  appear in user-facing help.
- Topics live in `src/help/helpRegistry.ts`; the freshness smoke at
  `scripts/smoke-help-content.js` validates required keywords + banned
  phrases per topic.
- When workflow / labels / validation / role / import semantics change,
  bump the topic and its `updatedAt`.

## Final Response Format

When an agent finishes a unit of work, the final message should end
with the following sections (omit any that have nothing to report):

- **Summary** - one or two sentences on what changed
- **Changed files** - bullet list
- **Validation performed** - typecheck, build, manual smoke, etc.
- **AI / dependency assumptions** - any external service or env
  assumption made
- **Help Impact** - either `Updated: <topic/screen>` (with registry
  bump if applicable) or `Not needed: <concrete reason>`. See
  `docs/IN_PRODUCT_HELP_STANDARD.md` for when each applies.
- **Follow-up risks** - what could go wrong, what was deferred
