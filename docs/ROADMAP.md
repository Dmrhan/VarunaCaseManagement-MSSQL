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
**Status:** Partially Shipped (Case Detail) — New Case Flow deferred
**Source:** General Manager feedback (Mayıs 2026 sunumu)

**Shipped phases:**
- Phase 1 — Backend deterministic endpoint: `GET /api/cases/:id/customer-pulse`
- Phase 2 — Frontend service: `caseService.getCustomerPulse(caseId)`
- Phase 3 — UI panel: "Müşteri Durumu" inside `LeftPanel` of `CaseDetailPage` (self-fetching, non-blocking)
- Phase 5 — AI summary upgrade: `POST /api/ai/customer-pulse-summary` (numeric/categorical only, no raw notes; silent fallback to deterministic on failure)

**Deferred:**
- Phase 4 — New case flow integration. New case form's AI panel already has a
  "Müşteri Geçmişi" card (open count + last case). A full Customer Pulse panel
  there would need a 2nd account-based endpoint (`GET /api/accounts/:id/customer-pulse?companyId=...`)
  and duplicate UI; deferred to avoid an awkward partial integration. To enable
  later: add account-based variant of `getCustomerPulse` + reuse the same
  panel component with pre-fetched data prop.

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

---

## Known Limitations (Faz 2 sonrası)

Şu an üretimde olan ama eksikleri olan veya kısmi özellikler. Test eden
ekibe `docs/TEST_SCENARIOS.md` ile birlikte verilir.

### E-posta bildirimi
**Status:** Not implemented
Tüm `CaseNotification` satırları `channel='InApp'` olarak yazılır.
Hiçbir notification e-posta tetiklemez. Faz 2 §6 kapsamında WebSocket /
30sn poll modeline geçildiğinde e-posta opsiyonel kanal olarak eklenebilir.

### Watcher Inbox UI
**Status:** API mevcut, sayfa yok
`GET /api/cases/watching` (kullanıcının izlediği vakalar) ve
`GET /api/cases/me/notifications/unread` mevcut. Kullanıcı şu an watcher
güncellemelerini yalnız header bell drawer'dan görür. Dedicated "Inbox"
sayfası planlandı ama uygulanmadı.

### CasesList link count indicator
**Status:** Not implemented
Vakalar listesinde "bu vaka 2 başka vakaya bağlı" gibi küçük chip yok.
Kullanıcı detaya girip Bağlantılar sekmesinden görür.

### CaseNotification retention / cleanup
**Status:** Not implemented
Append-only tablo; eski satırlar silinmiyor. Cron retention policy
(örn. 30 gün+ okunmuşları sil) planlandı.

### Eski notlara reaksiyon bildirimi
**Status:** Partial — PR #68 sonrası yeni notlar etkilenir
`CaseNote.authorId` PR #68 ile eklendi (nullable). Daha önce yazılmış
notlar `authorId=NULL` taşır; reaksiyon eklenirse not sahibine bildirim
üretilmez (sessiz `if` gate). Backfill cron'u Faz 5 backlog'unda.

### OpenAI 401/429 simülasyonu
**Status:** Static review only
Prod'da gerçek API key rotate veya rate-limit testi yapılamaz. Phase 2
audit fix'leri (PR #72) kod yolunda doğrulandı; canlıda davranış
gözlemlenmedi.

### Mobile responsive
**Status:** General flow works, not mobile-first
Telefon görüntü oranlarıyla temel akış kullanılabilir ama "mobile-first"
tasarım hedefi değil. Modal/popover overflow durumları olabilir.
