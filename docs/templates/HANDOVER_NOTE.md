# Handover Note: <Feature Name>

## What Changed

Short summary in plain language: what the user can now do that they
could not do before, or what behavior has changed.

## Why It Matters

Product or business context. Why was this built now? What problem
does it solve for the business or the user?

## How It Works

Technical overview at the level of "an engineer reading this on day
one should understand the moving parts". Include:

- Entry points (which UI surface, which endpoint)
- Data flow
- Auth / tenant scope handling
- AI involvement, if any, and fallback behavior

## Files / Modules

Important files touched. List concrete paths so a reviewer can navigate
directly. Group by layer (DB, BFF, UI, docs).

## Known Risks

Risks or limitations the engineering team should be aware of:
- Performance concerns at scale
- Edge cases that were deferred
- Operational dependencies (env vars, cron, third-party services)

## Follow-Up Work

Pending items that are intentionally deferred. Reference roadmap or
issue tracker entries where applicable.

## Recommended First Review

Where the engineering team should look first when picking this up. A
short ordered list, e.g.:
1. Read this handover note end-to-end
2. Read the matching Feature Brief
3. Run the QA Checklist locally
4. Open the entry-point file and trace one request end-to-end
