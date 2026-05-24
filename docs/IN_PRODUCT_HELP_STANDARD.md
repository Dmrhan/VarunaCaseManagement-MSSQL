# Varuna In-Product Help Standard

This document defines how in-product help (drawers, tooltips, inline notes,
empty-state copy) is written, kept current, and verified across Varuna.

It exists because we have seen help drift several times: copy ages out of
date when workflow changes, and internal terminology (legacy adapter
names, dev-time labels) leaks into user-facing text. The standard below
prevents both classes of drift with a small set of rules, a registry,
and a smoke check.

If you are an AI agent or human contributor, follow this when touching
any user-facing screen. If you are a reviewer, hold PRs to it.

---

## Why this standard

1. **Help must be user-facing, not implementation-facing.** Operators
   should never need to know about adapters, payloads, ORMs, or release
   phase names to use the product.
2. **Help must explain user decisions and workflow**, not internal
   plumbing or backend code paths.
3. **Help must stay current when workflow changes.** Stale help is worse
   than no help — it teaches wrong behavior.
4. **Help must be scenario-based, scannable, and action-oriented.**
   Wall-of-text guides do not get read; checklist + accordion + concrete
   examples do.
5. **Critical screens must expose visible "Nasıl çalışır?" guidance.**
   If a screen can cause irreversible or audit-visible side effects, the
   user must be able to reach help without leaving the page.

---

## Rules

### A. Help Impact Gate (every PR)

Every user-facing PR's final report must include a **Help Impact** block:

```
Help Impact:
- Updated: <topic/screen> (registry version bump if applicable)
or
- Not needed: <reason — e.g. "BFF-only change, no user-visible surface">
```

If a PR touches a screen, a workflow step, a button label, a validation
message, a role/permission check, an import/export semantic, an AI/KB
behavior, or any visible copy, the default expectation is **Updated**.
"Not needed" must carry a concrete justification, not a hand-wave.

This block belongs in the same final report that already carries
**Summary / Changed files / Validation performed / Follow-up risks**
(see `AI_WORKFLOW.md` → Final Response Format).

### B. Critical screen rule

These screen classes **must** have visible in-product help (a "Nasıl
çalışır?" button or equivalent affordance, opening a drawer/panel with a
registered topic):

- Import / export / integration screens
- Case create / detail / workflow screens
- Account / customer master data screens
- Admin definition screens (categories, checklists, teams, …)
- AI / KB screens (chat, suggestions, governance)
- Reporting / analytics screens with operator decisions
- Permission / security-impacting screens

For non-critical screens, in-product help is encouraged but not
mandatory.

### C. User-language rule

User-facing help must avoid internal implementation terms unless they
are already visible product concepts the user is expected to act on.

**Banned by default in operator-facing help** (extend per topic):

- `BFF`, `Prisma`, `payload`, `adapter`, `internal`
- `TODO`, `FIXME`, `Phase 2a`, `Phase 2b`, `Phase 3`, etc.
- `dry-run only`, `will be added later`, `not implemented yet`
- File paths, function names, table names, env var names
- Release-phase legacy names that operators never saw in the product
  itself (e.g. former system sheet names that map through an adapter)

If a banned word is a **legitimate product label** in a specific topic
(e.g. "Prisma" appearing in a developer-onboarding guide), the topic
may declare a per-topic exception with an inline `// allowed: <reason>`
comment in the registry. No silent allowlists.

### D. Scenario / action rule

Each help topic must answer at least these questions, in this order:

1. **What is this screen for?** (one or two sentences)
2. **When should I use it?** (mode comparison if there are multiple)
3. **What are the steps?** (quick start, 4-8 items)
4. **What should I check before committing/saving?** (preflight)
5. **What do warnings/errors mean?** (interpretation table)
6. **How do I recover?** (rollback / re-do / contact)

Long topics use a grouped, accordion structure (Başlangıç / Hazırlık /
Güvenli Yürütme / Sorun Giderme) and keep only the most common
sections open by default.

### E. Freshness rule

A PR that changes any of the following **must** update the relevant help
topic (or carry an explicit "Not needed: …" justification under Help
Impact):

- A workflow step (added, removed, reordered)
- A user-visible button or action label
- A validation error message or its semantics
- A role / permission boundary
- Import / export semantics (parser branches, target entities,
  required fields, snapshot fields)
- AI / KB behavior visible to users (sources, confidence, prompt copy)
- Any visible label/copy on the screen

When updating, also bump `updatedAt` on the topic in the registry and,
where useful, add a short note inside the relevant section explaining
the new behavior in user language.

---

## Registry

In-product help lives in `src/help/helpRegistry.ts` as an array of
`HelpTopic` entries. The registry is the source of truth for both the
rendered drawers and the smoke check below.

Shape (see file for type definitions):

```ts
{
  topic: string;                  // stable kebab-case id
  audience: 'operator' | 'admin' | 'technical-admin';
  title: string;
  summary: string;
  sections: Array<{
    title: string;
    body: string | string[];
    tone?: 'info' | 'warning' | 'success';
  }>;
  requiredKeywords?: string[];    // smoke fails if any keyword missing
  bannedPhrases?: string[];       // smoke fails if any phrase present
  updatedAt?: string;             // ISO date, bump on substantive change
}
```

Migration policy: do **not** migrate every existing screen at once.
Start with the most critical topic (Data Import) and grow as PRs touch
new screens.

---

## Component pattern

Where in-product help is shown, prefer the existing `Drawer` +
`Accordion` components (see `src/components/ui/Drawer.tsx`,
`src/components/ui/Accordion.tsx`) for visual consistency. The Data
Import help drawer is the current reference implementation
(`src/features/admin/dataImport/ImportHelpPanel.tsx`).

A lightweight `HelpButton` / `HelpDrawer` wrapper can be added when more
screens migrate; for now, individual screens may render their own
drawer + import their topic from the registry directly.

---

## Smoke check

`scripts/smoke-help-content.js` validates every registry topic:

1. `topic`, `audience`, `title`, `summary`, `sections` all present and
   non-empty.
2. Every `requiredKeyword` appears in the topic title/summary/sections
   (case-insensitive).
3. No `bannedPhrase` appears anywhere in the topic
   (case-insensitive). Per-topic exceptions are allowed only when an
   `// allowed: <reason>` comment sits beside the term in the registry
   file.
4. `updatedAt` is a parseable ISO date if present.

Run locally:

```bash
node --check scripts/smoke-help-content.js
node scripts/smoke-help-content.js
```

The smoke is intended for `smoke:data-contracts`-style CI but can be
invoked standalone at any time. Exit code 0 = all topics pass; non-zero
= at least one rule violation (printed with topic + reason).

---

## Cross-references

- `docs/AI_WORKFLOW.md` — Final Response Format section adds the
  **Help Impact** block.
- `docs/AGENTIC_PLANNING_PROTOCOL.md` — §3.E / §3.F (post-merge)
  references this standard for PRs touching user-visible surface.
