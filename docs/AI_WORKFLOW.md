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
- `README.md` when local setup, commands, or doc links change

## Final Response Format

When an agent finishes a unit of work, the final message should end
with the following sections (omit any that have nothing to report):

- **Summary** - one or two sentences on what changed
- **Changed files** - bullet list
- **Validation performed** - typecheck, build, manual smoke, etc.
- **AI / dependency assumptions** - any external service or env
  assumption made
- **Follow-up risks** - what could go wrong, what was deferred
