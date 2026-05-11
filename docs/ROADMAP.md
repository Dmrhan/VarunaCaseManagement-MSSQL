# Roadmap

Bu doküman önerilen ve planlanan ürün özelliklerini takip eder. Her madde
durum etiketi (Proposed / Planned / In Progress / Shipped) ile birlikte yazılır.

PRODUCT_SPEC.md mevcut ürün davranışını tanımlar. ROADMAP.md gelecek
özellikleri ve onlara nasıl yaklaşılacağını tanımlar. Çelişki olursa
PRODUCT_SPEC.md öncelikli kabul edilir — bir özellik shipped olunca buraya
ekleniyor demektir.

**Status etiketleri:**
- **Proposed** — fikir aşamasında, tasarım/karar bekliyor
- **Planned** — onaylanmış, sprintliği bekliyor
- **In Progress** — aktif geliştirme
- **Shipped** — production'da, PRODUCT_SPEC.md'ye taşınmaya hazır

---

## Customer Context Intelligence

**Priority:** High
**Status:** Proposed
**Source:** General Manager feedback (Mayıs 2026 sunumu)

### Goal

Give the agent immediate customer context when opening or creating a case.
The agent should understand *"what kind of customer situation am I walking
into?"* before acting on the case.

### Problem

Agents currently see the case itself, but they also need a quick sense of
the customer's broader state:

- Does this customer have many open cases?
- Has the customer repeatedly contacted us about the same issue?
- Were there recent SLA violations?
- Are there unresolved critical or escalated cases?
- Do recent notes/call logs suggest dissatisfaction?
- Is there churn or retention risk?
- Should the agent handle this customer more carefully or proactively?

### Proposed UX

Add a compact **"Customer Pulse"** panel to the case detail screen and
optionally to the new case flow after account selection.

Example panel content:

- Customer state: Stable / Watch / Risky / Critical
- Open cases count
- Recent cases in the last 30/60/90 days
- Repeated categories/subcategories
- SLA violation history
- Critical/escalated case history
- Recent sentiment or customer mood
- AI-generated customer context summary
- Recommended handling approach

Example AI summary:

> "This customer has opened 3 cases in the last 30 days, mostly about
> integration issues. Two recent cases breached SLA and the latest notes
> show dissatisfaction. Proactive communication and supervisor visibility
> are recommended."

### Data sources

- Cases by account
- Open cases
- Historical cases
- Case notes
- Call logs
- Case history/activity
- SLA status and violations
- Churn-specific fields if available
- Existing account/customer data

### AI Output

- Customer mood/risk label: Stable / Watch / Risky / Critical
- 2–3 sentence customer context summary
- Recommended handling approach
- Key evidence behind the recommendation

### Technical notes

- Reuse existing account-based case lookup where possible
  (`caseService.findByAccount`, `caseRepository.findByAccount`).
- Add a backend endpoint only if needed — e.g. `GET /api/accounts/:id/customer-pulse`
  or `GET /api/cases/:id/customer-pulse`.
- Tenant scope must be respected through `allowedCompanyIds`.
- The feature should not block the case workflow if AI fails.
- If AI is unavailable, show **deterministic metrics only** (counts,
  violations, recent cases) — the panel still has value without AI.
- Avoid sending excessive sensitive data to AI; summarize relevant
  notes/call logs **before** the model call (e.g. last 5 notes, last 3
  calls, only essential fields).
- Log AI usage through the existing `AIUsageLog` mechanism if an AI
  endpoint is added (`endpoint: 'customer-pulse'`).

### Acceptance criteria

- [ ] Agent can see customer open case count from the case detail screen
- [ ] Agent can see recent historical case context for the selected account
- [ ] System identifies repeated issue categories when present
- [ ] System shows SLA/churn/escalation risk signals when present
- [ ] AI summary includes **evidence**, not only a vague score
- [ ] AI failure does not break the case detail screen
- [ ] Customer Pulse respects multi-tenant access control
- [ ] Feature is documented in roadmap/product spec before implementation

### Notes

Implementation has **not** started. This item must be reviewed and moved
to **Planned** before any work begins. When shipped, the spec moves into
PRODUCT_SPEC.md and the entry here is removed.
