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
**Status:** Shipped (Case Detail + New Case Flow)
**Source:** General Manager feedback (Mayıs 2026 sunumu)

**Shipped phases:**
- Phase 1 — Backend deterministic endpoint: `GET /api/cases/:id/customer-pulse`
- Phase 2 — Frontend service: `caseService.getCustomerPulse(caseId)`
- Phase 3 — UI panel: "Müşteri Durumu" inside `LeftPanel` of `CaseDetailPage` (self-fetching, non-blocking)
- Phase 4 — New case flow integration: `GET /api/cases/accounts/:accountId/customer-pulse?companyId=...` + shared `CustomerPulsePanel` component (account/case discriminated union); replaces the old "Müşteri Geçmişi" mini-card.
- Phase 5 — AI summary upgrade: `POST /api/ai/customer-pulse-summary` (case-based only; account variant deterministic-only since AI route is caseId-bound).

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
to the new case flow after company + account selection.

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
- Case detail uses `GET /api/cases/:id/customer-pulse`.
- New case flow uses `GET /api/cases/accounts/:accountId/customer-pulse?companyId=...`.
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

- [x] Agent can see customer open case count from the case detail screen
- [x] Agent can see recent historical case context for the selected account
- [x] Agent can see customer context in the new case flow after company + account selection
- [x] System identifies repeated issue categories when present
- [x] System shows SLA/churn/escalation risk signals when present
- [x] AI summary includes **evidence**, not only a vague score
- [x] AI failure does not break the case detail screen
- [x] Customer Pulse respects multi-tenant access control
- [x] Feature is documented in roadmap/product spec before implementation

### Notes

Case Detail and New Case Flow implementations are shipped. The case detail
panel can upgrade deterministic metrics with AI; the new case flow currently
uses deterministic account-level pulse data so case creation remains fast and
non-blocking. Next documentation step: move the shipped behavior into
PRODUCT_SPEC.md, then keep only future enhancements in this roadmap.

---

## Recent Ships / Platform Capabilities

Bu bölüm production'da çalışan ana yetenekleri envanterler. Backlog'dan
shipped'e geçen kalemler buraya tek satır olarak düşülür; detay için
ilgili planning card veya PRODUCT_SPEC referansı verilir.

### Action Center / Aksiyonlarım inbox
**Status:** Shipped (WR-NOTIFICATION-CENTER Phase 1/2A/2B/2C)
**Source:** `docs/planning_cards/WR-NOTIFICATION-CENTER-VARUNA-INBOX.md`
Unified inbox: `kind ∈ {approval, mention, watcher_event, system_alert}`.
Snooze/done/dismiss + dedupKey + tenant scope. Live emit + backfill
(legacy CaseNotification → ActionItem). Legacy mention bell hâlâ
fallback olarak `VITE_LEGACY_MENTION_BELL_ENABLED` flag arkasında.

### Resolution Approval flow
**Status:** Shipped
**Source:** `docs/planning_cards/WR-D4-D3-RESOLUTION-APPROVAL-NOTIFICATION-RULES.md`
`server/db/approvalRepository.js` — policy matching, submit/approve,
sibling expiry. ActionItem `kind='approval'` üzerinden inbox'ta görünür.
Smoke: `scripts/smoke-resolution-approval-flow.js`.

### Customer 360 — Phase A/B/C2 + deterministic Customer Match
**Status:** Shipped (Phase D Step 2 prod 2026-05-18)
**Source:** `docs/planning_cards/` + `server/db/customerMatchRepository.js`
Account + AccountCompany + AccountContact + AccountAddress modelleri.
Suggestion engine: AI YOK; auto-link YOK; deterministic + stable scoring
(VKN, telefon, e-posta, ad benzerliği). Smoke kapsamı: 12+ smoke script.

### Customerless case flow / `customerMatchPending`
**Status:** Shipped
Case `accountId=null` geçerli; `customerMatchPending` flag + filter +
CasesListPage chip + CaseDetailPage match suggestions. Smoke:
`scripts/smoke-customerless-case-flow.js`.

### External KB console
**Status:** Shipped
`server/db/externalKbSettingRepository.js` + admin UI. Smokes:
`smoke-external-kb-console.js`, `smoke-external-kb-settings.js`.

### Watcher Inbox UI
**Status:** Shipped (Phase 5c)
`src/features/my/WatcherInboxPage.tsx` — sidebar > Çalışma Alanım >
**İzleyici Inbox**. İzlenen vakalar (kart grid) + son okunmamış generic
CaseNotification'lar (top 10) + statü/zaman filtreleri. Bell drawer
hızlı erişim için kalır.

### Reply threading + reactions
**Status:** Shipped (Faz 2 §4 — kısmi)
- `CaseNote.parentNoteId` self-relation + `replyCount` (`prisma/schema.prisma:1210-1221`)
- `CaseNoteReaction` normalized table (NOT Json field — spec'ten sapma) (`schema.prisma:1230-1244`)
- `ReplyItem` component + reply composer (`CaseDetailPage.tsx`)
- `reactionRepo.toggle()` (`caseRepository.js:3145`) + ActionItem emission

Kalan alt-kalem: "Canlı Özet kartı" (BACKLOG P3 Yazman AI'a foldlandı).
Aktivite-seviye reactions (`CaseActivity.reactions`) intentionally
not-implemented — only note reactions kabul edildi.

### Customer Pulse — case detail + new case flow
**Status:** Shipped (Phase 1-5)
Detay yukarıda "Customer Context Intelligence" bölümünde.

### AI Status Report / Durum Raporu
**Status:** Shipped
`server/routes/ai.js` brief/insights/explain/report/drilldown-assistant
endpoint'leri. Operations Dashboard + Report Studio konsumasyonu.

### Sidebar/header redesign
**Status:** Shipped (commits 2026-04 — 2026-05)
Kullanıcı + tema kontrolleri sidebar'dan üst-sağ header'a taşındı,
bottom items pinned, voice button revize, Müşteri Ara header'a. Sidebar
default dar (icon-only), hover ile genişler.

### CaseNotification retention / cleanup cron
**Status:** Shipped (Phase 5a)
`POST /api/cron/notification-cleanup` — `readAt NOT NULL` + 30g+ rows
delete; okunmamışlar korunur. GitHub Actions/UptimeRobot tarafından
tetiklenir.

### CasesList link count indicator
**Status:** Shipped (Phase 5b)
Vakalar listesinde başlık yanında violet chip `🔗 N` (N>0 ise).
`outgoingLinks._count` üzerinden hesaplanır; tam liste için Bağlantılar
sekmesi.

---

## Future Product Direction (moved from BACKLOG cleanup 2026-05-27)

Aşağıdaki kalemler `docs/BACKLOG.md`'den canonical olarak ROADMAP'a
taşındı. Aktif backlog değiller; tetik koşulu (trigger) veya ürün kararı
beklenir.

### Future export formats
**Priority:** Low
**Status:** Proposed
**Trigger:** Executive sunum talebi
PPTX export — `pptxgenjs` ile sunum çıktısı (her major section = bir
slayt). OPERATIONS_DASHBOARD_DESIGN.md §6 zaten "out of scope" demiş.
XLSX/PDF zaten REPORT_STUDIO_BACKLOG.md'de P1.

### Commercialization — Multi-tenant AI key + budget per tenant
**Priority:** High (when needed)
**Status:** Proposed
**Trigger:** İkinci paying tenant onboarding
`CompanySettings.aiProvider/aiApiKey/aiMonthlyTokenLimit` alanları + per-
companyId limit enforcement. Bugün tek global `OPENAI_API_KEY`.
Supabase Vault entegrasyonu gerek.

### Customer Context Intelligence — Phase F (Account Merge)
**Priority:** High (when triggered)
**Status:** Proposed
**Trigger:** Mükerrer kayıt sayısı kritik eşiğe ulaşırsa
- Master account seçimi + dry-run preview
- Audit log zorunlu
- `Account.mergedIntoAccountId` soft-delete veya source pasive
- Customer matching queue (Supervisor/Admin)
- Duplicate detection (VKN, telefon, e-posta, Levenshtein)

Phase A-D shipped — bu Phase F, yüksek riskli operasyon, kendi başına
faz olarak ele alınmalı.

### Operations Dashboard polish (deferred items)

Aşağıdaki kalemler `docs/BACKLOG.md` #39/#40 üzerinden buraya taşındı:

- **Karşılaştırmalı period selector** — "geçen hafta vs bu hafta" yan
  yana. Yakın-vade talep yok.
- **Pinned / saved dashboard views** — kullanıcı favori filter setini
  kaydeder. URL-sync zaten var, persistence yok.
- **Drilldown drawer inline actions** — backlog'da hâlâ aktif P2; bu
  satır sadece referans.

### Admin Tooling — Audit replay UI
**Priority:** Low
**Status:** Proposed
`MetricQueryAudit` tablosu yazılıyor ama UI'da hiç okunmuyor. Admin
"explain query → audit row → drill into the snapshot" akışı. OPS §7
Q12 retention sorusu açık.

### Scale — Real-time refresh (WebSocket/SSE)
**Priority:** Low
**Status:** Proposed
OPS §6 "out of scope"; action-center recently moved to silent
background polling (commit `e557cda`) — explicit decision to stay on
polling. Yakın-vade revisiting beklenmiyor.

### Infra — Vercel Hobby → Pro cron geçişi
**Priority:** Medium (cost gate)
**Status:** Proposed
**Trigger:** Daily cron limit aşılırsa
Bugün GitHub Actions/UptimeRobot dual-auth pattern (`cron.js:9-11`).
Vercel Pro'ya geçiş = `vercel.json` crons array etkin + ext-trigger
ihtiyacı kalkar.

### Notification — Channel matrix + businessHours + daily digest
**Priority:** Low (follow-up to Resend MVP)
**Status:** Proposed
**Trigger:** Resend MVP (BACKLOG P2) prod'da stabilize olunca
Faz 2 §6'nın MVP-sonrası kalanları:
- Channel matrix: mesai içi/dışı, etiketleme/atama/SLA/eskalasyon
  başına kanal seçimi
- `CompanySettings.businessHours` (varsayılan 09:00-18:00 Pzt-Cuma)
- Günlük digest (09:00 e-posta) takipçi profili `digest` olanlar için
- SMS sağlayıcısı (NetGSM/İletimerkezi) — ileri sprint

MVP `kind ∈ {approval, mention}` için tek-event e-postası ile ship
edildikten sonra burası açılır.

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
**Status:** Shipped (Phase 5c)
Yeni sayfa: sidebar > Çalışma Alanım > **İzleyici Inbox**. İzlenen
vakalar (kart grid) + son okunmamış generic CaseNotification'lar (top 10)
+ statü/zaman filtreleri. Bell drawer hızlı erişim için kalır.

### CasesList link count indicator
**Status:** Shipped (Phase 5b)
Vakalar listesinde başlık yanında violet chip `🔗 N` görünür (sadece N>0).
`outgoingLinks._count` üzerinden hesaplanır; tam liste için Bağlantılar
sekmesi.

### CaseNotification retention / cleanup
**Status:** Shipped (Phase 5a)
`POST /api/cron/notification-cleanup` — `readAt NOT NULL` ve 30g+ eski
satırları siler; okunmamış bildirimler korunur. Cron tetiklenmesi
(GitHub Actions / Vercel Cron) ops ekibi tarafından yapılandırılır.

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

Spesifik polish çatlakları (BACKLOG #32'den taşındı, ongoing posture):
- Modal/popover overflow (KeyboardShortcutsModal, CustomerCardModal,
  ReportStudioModal mobile)
- Drilldown drawer mobile (genişlik kontrolü)
- Sidebar collapse/expand mobile geçişi
- Dashboard FilterBar wrap davranışı dar ekranda
- Dark mode legibility audit (Operations Dashboard, Report Studio, AI
  surfaces tek tek gez)

Tetik: yöneticilerden telefonda kullanım şikayeti.

### A11y / klavye navigasyon
**Status:** Partial — defensive in place, no systematic audit
`aria-label` drawer close/backdrop'ta, focus rings, `useHotkey`
shortcut framework, `KeyboardShortcutsModal` documentation hep mevcut.
WCAG 2.1 AA sistematik audit yapılmadı; OPS §7 Q49 açık karar.

Tetik: kurumsal müşteri a11y şartnamesi.
