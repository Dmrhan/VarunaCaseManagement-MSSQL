# QA Checklist: <Feature Name>

## Happy Path

Primary user journey works end-to-end with realistic data.

- [ ] ...
- [ ] ...

## Empty State

UI when no data exists yet (new account, no notes, no cases).

- [ ] ...

## Error State

UI when the backend returns 4xx/5xx or times out. The screen must
not break; the user must understand what failed.

- [ ] ...

## Permission / Auth

Role gates are enforced (Agent, Supervisor, Admin, SystemAdmin).
Unauthorized roles cannot reach the screen or endpoint.

- [ ] ...

## Tenant Isolation

Cross-tenant access is blocked. Listings, lookups, and AI inputs do
not leak data from other tenants.

- [ ] ...

## AI Fallback

When `OPENAI_API_KEY` is missing or AI fails or times out, the
feature still works with a deterministic / non-AI fallback.

- [ ] ...

## Regression Checks

Things that used to work still work. Specifically check the screens
or endpoints adjacent to the change.

- [ ] ...

## Notes

Open QA notes, unresolved questions, or known risks the engineering
team should be aware of.
