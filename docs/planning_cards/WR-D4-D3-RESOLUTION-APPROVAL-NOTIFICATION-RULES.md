# Agentic Planning Card — WR-D4 / WR-D3

**Çözüm Onayı Süreci + Bildirim ve İletişim Kuralları (Resolution Approval + Notification & Communication Rules)**

> **Status:** Planning only. No code, no schema, no migrations, no routes, no WORK_REGISTER edit in this card.
> **Card date:** 2026-05-26
> **Cross-reference:** [PM-11 in PRODUCT_PLANNING_MATRIX.md](../PRODUCT_PLANNING_MATRIX.md) — D3 (NotificationRule) + D4 (ResolutionApprovalPolicy).
> **Protocol:** [AGENTIC_PLANNING_PROTOCOL.md](../AGENTIC_PLANNING_PROTOCOL.md) — Performance & Architecture Gate verdict at §19.

---

## 1. Executive Summary

Varuna bugün vaka kapatmayı tek bir buton seviyesinde işliyor: Agent `Cozuldu`'ya geçiriyor, `transitionStatus` çağrısı `CaseActivity` log'u yazıyor, `notifyWatchers` watcher'lara in-app bildirim atıyor. Müşteriye **resmi** bir cevap kanalı yok; iç onay (supervisor/team-lead governance) yok; mesaj şablonları yok; gönderim audit'i yok.

WR-D4 + WR-D3 bunu **kapatma yönetişimi + müşteri iletişimi kontrolü** olarak yeniden tasarlar:

1. **İç Çözüm Onayı (D4):**
   Belirli politika eşleşmesinde Agent doğrudan kapatamaz; "Çözüm Onayına Gönder" → atanan onaylayıcı (team lead / supervisor) **onaylar veya reddeder**. Karar denetlenebilir (immutable audit). Onay tipi politikadan gelir.

2. **Müşteri İletişim Kanalı + Bildirim Kuralları (D3):**
   Çözüm onaylandığında VEYA durum değişimlerinde müşteriye ne söyleneceği, hangi kanaldan gideceği (e-posta / portal / manuel görev / webhook), hangi şablonla, kim tarafından — bunlar **per-tenant policy engine + template engine + dispatch log** ile yönetilir.

3. **Aktif Gönderim Ayrımı:**
   Phase 1'de **log-only** (yapılacaklar listesi + audit) kayıt üretilir; aktif e-posta/SMS gönderimi sonraki adımda kontrollü opt-in olarak gelir. Operatör hangi bildirimin gerçekten gideceğini ekranda görmeden hiçbir müşteri iletişimi otomatik tetiklenmez.

Bu **"Supervisor onay butonu"** değildir. Üç ayrı motor: **policy engine** (kim onaylar?), **event engine** (ne olduğunda kim haberdar edilir?), **template engine** (mesaj ne der?), tek bir **dispatch/audit log** üzerinde birleşir. Reopen, transfer, SLA pause, customer-waiting davranışları bu altyapıya eklenecek.

---

## 2. Global Product Pattern Review

| Ürün | Pattern | Varuna için uyarlama |
|---|---|---|
| **Zendesk** | *Triggers* (event-driven) vs *Automations* (time-driven) ayrımı. Trigger = anlık event ("status changed to solved"); Automation = zamanlı/koşullu ("X saat içinde cevap yoksa"). Conditions + Actions JSON-driven. | Phase 1'de yalnız trigger benzeri *event rule*'lar (D3). Time-based reminders Phase 5. |
| **Jira Service Management** | *Approval-in-workflow*: workflow'a "Awaiting Approval" status'u eklenir; transition guard onay kontrolü yapar; approver listesi participant alanından gelir. | Varuna `Case.status` enum'unu **şişirmemeli** — onay overlay field olarak gelir (§5). JSM'in approval participant fikri (politika ile resolved approver) faydalı. |
| **Salesforce Service Cloud** | *Approval Process*: çok adımlı, paralel/sıralı approver, "Final Approval Actions" hooks (email, field update). Email Approval (e-posta üzerinden onay) opsiyonel. | Phase 1 tek-aşamalı, tek-onaylayıcı. Çok-aşamalı tasarımı dışlamayan model — `ApprovalChain` v2'de. Email-approval Phase 4+. |
| **ServiceNow** | *Business Rules* (server-side koşul + action) + *Notification Rules* (event-driven email) + *Templates* (mustache benzeri). Approval ayrı bir tablo + Workflow Activity. | Varuna'ya en yakın model: **NotificationRule + Template + Dispatch + ApprovalPolicy + ApprovalRequest** ayrımı bizim model önerimizle örtüşür. |
| **Generic enterprise pattern** | *Policy engine* (koşul→aksiyon), *event engine* (event→ruleset), *template engine* (variables), *delivery/audit log* (kim ne zaman aldı/almadı). Her layer ayrı ve test edilebilir. | Bu **tam olarak** önerdiğimiz mimari (§5). Layer ayrımı testability + Phase 4 active-send opt-in için zorunlu. |

**Varuna için seçilen sentez:**
- D4 = JSM "approval-in-workflow" + Salesforce policy-driven approver resolution
- D3 = Zendesk trigger pattern + ServiceNow notification rule/template/dispatch ayrımı
- Log-only first (Phase 1-3), active send sonra (Phase 4) — Phase'lar arası geri-uyumluluk açık

---

## 3. Varuna Current-State Audit

### A. Case status enum + transitions
**File:** `prisma/schema.prisma:33-41`
```
enum CaseStatus {
  Acik              @map("Açık")
  Incelemede        @map("İncelemede")
  ThirdPartyWaiting @map("3rdPartyBekleniyor")
  Eskalasyon
  Cozuldu           @map("Çözüldü")          // terminal
  YenidenAcildi
  IptalEdildi       @map("İptalEdildi")     // terminal
}
```

**Transition handling:** `server/db/caseRepository.js:1763` (`transitionStatus`):
- Tek atomic update.
- Tüm geçişler `CaseActivity` (actionType=`StatusChange`) loglanır.
- `Cozuldu` → `resolvedAt` set edilir.
- `Cozuldu`/`IptalEdildi` terminal: `transferCase`, `linkAccountToCase`, `addNote` gibi mutasyonlarda 400 (`closed_case`).
- SLA pause/resume (`ThirdPartyWaiting`) burada işlenir.
- Watcher bildirimi: `notifyWatchers({ kind: 'status' })` çağrılır.

**Gap for D4:** Mevcut yol Agent → `Cozuldu` direkt yazıyor. Onay araya girmiyor. Politika engine yok.

### B. Case activity logging
**Model:** `prisma/schema.prisma:1125` (`CaseActivity`)
```
caseId, companyId, action(string), actionType(enum?), fieldName?, fromValue?, toValue?, note?, actor, at
```
Action types include `StatusChange`, `FieldUpdate`, `NoteAdded`, `NoteReplyAdded`, `Assignment`, etc. (`CaseHistoryActionType` enum).

**Used for:** every mutation in `caseRepository.js`. Watcher fan-out via `notifyWatchers` (line 2595) → `CaseNotification` writes.

**Reusability for approval audit:** Tip ekleyebiliriz (`ApprovalSubmitted`, `ApprovalApproved`, `ApprovalRejected`, `DispatchCreated`) ama immutable detay için **ayrı tablo** (`CaseResolutionApproval`, `NotificationDispatch`) daha temizdir. CaseActivity üst seviye log; dedicated tablolarda detay snapshot.

### C. Role model
**Person:** `prisma/schema.prisma:772-789`
- `isTeamLead: Boolean @default(false)` ← onaylayıcı çözümünde sinyal
- `teamId?` ← team lead resolution için pivot
- `supportLevel: SupportLevel` (L1/L2/L3/Expert) ← politika filtresi olabilir
- `isActive: Boolean`

**Team:** `prisma/schema.prisma:751-770`
- `companyId` ← tenant scope
- `defaultSupportLevel` ← politika filtresi olabilir

**Role middleware:** `server/middleware/auth.js` (varsayım — mevcut Phase A çıktısı), `req.user.role` Supervisor/Agent/Admin/SystemAdmin + `req.user.allowedCompanyIds`.

**Gap:** "Approver" rolü tanımlı değil — TeamLead bayrağı var ama "policy → approver person" çözüm fonksiyonu yok.

### D. Notification / email / webhook infrastructure
**Model:** `prisma/schema.prisma:1293-1309` (`CaseNotification`)
```
caseId, companyId, eventType(string), channel(NotificationChannel enum),
recipient(string=Person.id or email), payload(Json), sentAt, readAt?
```

**Channel enum** (`schema.prisma:192-194`): yalnız `InApp` ve `Email`. Webhook/SMS yok.

**Delivery code:**
- `server/db/caseRepository.js:2595` `notifyWatchers` — yalnız `InApp` channel'ına watcher fan-out yazar.
- **Email/Webhook/SMS gönderim adaptörü YOK.** `resend.com`/`smtp`/`twilio` references yok.
- Template engine yok. Mesajlar code-bound (`message: '${caseNumber}: ${prev} → ${next}'`).

**Implication:** D3 Phase 1 mevcut `CaseNotification` tablosunu **log-only audit hedefi olarak yeniden kullanabilir** veya ayrı bir `NotificationDispatch` tablosu açabilir. Recommendation §5'te.

### E. Customer response/channel fields
**AccountContact.preferredChannel:** `prisma/schema.prisma:598` (`String?`, açıklayıcı enum yok — free text).
**Account.email / .phone / .phoneE164:** mevcut.
**AccountCompany:** `externalCustomerCode`, `packageName`, `status`, vb. — **dedicated customer-comms field yok.**

**Gap for D3:**
- Şirket-bazlı default response channel yok
- Case-level override yok
- "Allow customer notifications?" toggle yok

### F. AI / RUNA / KB communication surfaces
**Files:** `server/lib/transferAi.js`, `runaSuggest.js` (varsayım — admin AI usage page'inden referans). Bu surface'lar **kategori önerisi / transfer önerisi / KB araması** yapıyor — müşteri iletişim metni üretmiyor.

**Implication:** D3'ün template engine'i AI ile entegre edilebilir (Phase 6+ "Yazman AI" — BACKLOG §19) ama Phase 1 manuel/static şablonlardır.

### G. Customer close / reopen
**Close:** Agent → `transitionStatus(id, 'Cozuldu', { resolutionNote })` → terminal.
**Reopen:** `YenidenAcildi` status mevcut ama otomatik trigger yok — manuel status değişimi.
**Gap:** "Customer accepted / customer reopened" ayrımı kavramsal olarak yok. Approval süreciyle birlikte tanımlanmalı (§4, §6.D).

---

## 4. Product Concepts and Terminology

| Kavram | Tanım | Karıştırılmamalı |
|---|---|---|
| **Resolution draft** | Agent'ın yazdığı çözüm özeti + müşteriye gönderilecek mesaj taslağı. Henüz onaylanmamış. | Final response değil. CaseActivity'ye yazılmaz; `CaseResolutionApproval` üzerinde tutulur. |
| **Internal approval** | Politika eşleşmesinde TeamLead/Supervisor'ün "bu çözüm gönderilebilir / vaka kapatılabilir" kararı. | Customer acceptance ile karıştırılmamalı. İç governance. |
| **Customer notification** | Müşteriye giden (veya gidecek olan) mesaj. Phase 1'de log-only — sadece dispatch tablosuna yazılır, gerçek gönderim yok. | "Internal approval" tetikler ama eşit değildir. Log-only ≠ delivered. |
| **Customer acceptance** | Müşterinin "kabul ediyorum / yeniden açıyorum / cevap vermedim" kararı. Phase 5+ portal/email-reply ile gelir. | Internal approval ≠ Customer acceptance. Phase 1'de implicit "no response = accepted" varsayılır. |
| **Case closed** | Terminal durum: `Cozuldu` veya `IptalEdildi`. Müşteri kabulü beklenmiyor. | "Resolved"dan ayrı tutulmalı — bkz. §21 açık karar. |
| **Case resolved** | "Çözüm üretildi" iç durumu. Müşteri onayı/reddi beklenebilir. | Bugün Varuna'da ayrı yok; `Cozuldu` her ikisini kapsıyor. §21'de karar. |
| **Reopened** | `YenidenAcildi` status'una geçiş. Mevcut: manuel. Phase 5'te customer-reply trigger ile. | Approval cycle reset gerektirebilir (§6.D). |
| **Manual communication** | Operatörün "müşteriyi telefonla aradım / mail attım dış sistemden" gibi kayıt-dışı eylemi, kayıt-içi olarak `NotificationDispatch.mode='manual'` ile loglar. | Active send DEĞİL — sadece audit izi. |
| **Log-only notification** | Dispatch tablosuna yazılır, `mode='log_only'`, hiçbir external API çağrılmaz. Operatör panelinde "Bu olayda şu kişiye şu şablon gönderilecekti" görünür. | Active send'in güvenli prekürsörü. Phase 1 default. |
| **Active notification** | Gerçek email/SMS/webhook delivery. Per-tenant + per-rule explicit opt-in. Phase 4. | Phase 1'de yok. Yanlışlıkla tetiklenmemesi için kod yolu Phase 1'de mevcut bile değil. |

---

## 5. Recommended Domain Model

### 5.1 Status overlay vs Case.status enum genişletmesi — KARAR

**Option A: `CaseStatus`'a yeni değer ekle** (`AwaitingResolutionApproval`, `ApprovalRejected`)
- Avantaj: tek alan, UI bar zaten status üzerinden render ediyor.
- Dezavantaj:
  - `Cozuldu`/`IptalEdildi` terminal logic (~30 yerde `notIn: ['Cozuldu', 'IptalEdildi']`) approval state'leriyle uyumsuz — "approval bekliyor" terminal değil ama operasyonel olarak edit blokeleri lazım. Status enum semantic karmaşıklaşır.
  - SLA pause/resume (`ThirdPartyWaiting`) yan-etkili olduğundan başka bir "non-progress" değer eklemek SLA aritmetiğini etkiler.
  - Mevcut data migration: tüm mevcut cases default değer almalı; geriye uyumluluk riski.

**Option B (RECOMMENDED): Overlay fields** — `Case.approvalState` ve `Case.communicationState`
- `approvalState: ApprovalState? @default(null)` — enum: `Draft`, `Pending`, `Approved`, `Rejected`, `Skipped`.
- `communicationState: CommunicationState? @default(null)` — enum: `NotRequired`, `Pending`, `Dispatched`, `Failed`, `Manual`.
- `Case.status` saf lifecycle olarak kalır (`Acik`...`Cozuldu`).
- UI status badge + ayrı approval badge.
- Mevcut tüm `notIn` filtreleri etkilenmez.

**Karar:** **Option B.** Status enum şişirilmiyor, SLA semantiği değişmiyor, geri-uyumluluk net. Audit isteyen ayrıntılı state'ler dedicated tablolarda.

### 5.2 Önerilen modeller (migration YOK, tasarım taslağı)

#### `ResolutionApprovalPolicy`
**Amaç:** Hangi vaka kapatmasının onay gerektirdiğini ve onaylayıcının kim olduğunu tanımlar.
| Field | Tip | Not |
|---|---|---|
| `id` | cuid | |
| `companyId` | String (FK Company) | Tenant scope zorunlu |
| `name` | String | Admin UI display |
| `description` | String? | |
| `isActive` | Boolean (default true) | Soft-disable |
| `sortOrder` | Int (default 100) | Precedence: küçük → önce match |
| `matchScope` | Json | `{ category?, subCategory?, priority?, supportLevel?, teamId? }` — opsiyonel filtreler; tümü null = "tüm vakalar" |
| `approverType` | String enum | `TeamLead` / `Supervisor` / `Admin` / `SpecificPerson` / `AssignedTeamLead` |
| `approverPersonId` | String? (FK Person) | `SpecificPerson` ise zorunlu |
| `allowSelfApprove` | Boolean (default false) | Agent kendi çözümünü onaylayabilir mi |
| `rejectionBehavior` | String enum | `ReturnToAssignee` / `ReturnToTeam` / `Escalate` |
| `createdAt`, `updatedAt`, `createdByUserId` | audit |

**MSSQL portability:** `matchScope` Json — MSSQL `NVARCHAR(MAX)` + app-layer parse (Prisma `Json` zaten her iki provider'da çalışır). Tek-tek scalar field'lar yerine Json tercih — politika filtre seti zamanla genişler (product/package, requester channel).

#### `CaseResolutionApproval`
**Amaç:** Tek bir vakanın tek bir onay döngüsü. Reopen → yeni satır (immutable history).
| Field | Tip | Not |
|---|---|---|
| `id` | cuid | |
| `caseId` | String (FK) | onDelete: Cascade |
| `companyId` | String | Denormalize |
| `policyId` | String? (FK) | Politika sonradan silinirse `?` |
| `policyNameSnapshot` | String | Audit için |
| `state` | enum | `Pending` / `Approved` / `Rejected` / `Cancelled` |
| `submittedByUserId` | String | |
| `submittedAt` | DateTime | |
| `resolutionSummary` | String | Agent'ın yazdığı çözüm özeti (audit + dispatch template variable) |
| `customerMessageDraft` | String? | Müşteriye gidecek (gidecekti) taslak metin |
| `expectedApproverPersonId` | String? | Policy'den resolve edilen kişi (snapshot) |
| `decidedByUserId` | String? | Kim karar verdi |
| `decidedAt` | DateTime? | |
| `rejectionReason` | String? | `state=Rejected` ise zorunlu |
| `createdAt`, `updatedAt` | audit |

**Index:** `(caseId)`, `(companyId, state)`, `(expectedApproverPersonId, state)` — onaylayıcı inbox query'si.

#### `NotificationRule`
**Amaç:** Bir event olduğunda kime, hangi şablonla, hangi kanaldan dispatch yaratılacak.
| Field | Tip | Not |
|---|---|---|
| `id` | cuid | |
| `companyId` | String (FK) | Tenant scope |
| `name` | String | Admin UI display |
| `event` | String enum | `resolution_submitted` / `resolution_approved` / ... (bkz. §9) |
| `conditions` | Json | `{ priority?, supportLevel?, category? }` opsiyonel |
| `audience` | Json | `{ type: 'customer_primary' \| 'assignee' \| 'team_lead' \| 'supervisor' \| 'webhook_url' \| 'static_email', targetValue?: string }[]` — birden fazla audience tek rule'da |
| `templateId` | String (FK NotificationTemplate) | |
| `channel` | String enum | `in_app` / `email` / `manual_task` / `webhook` (Phase 1: `in_app` + `manual_task` only) |
| `mode` | String enum | `log_only` (default Phase 1) / `active` (Phase 4+) |
| `isActive` | Boolean | |
| `sortOrder` | Int | |
| `suppressDuplicateWithinMinutes` | Int? | Idempotency: aynı (caseId, event, audience, templateId) X dk içinde 1 kez |
| `rateLimitPerHour` | Int? | Tenant bazlı kanal koruması |
| audit fields |  | |

**MSSQL portability:** `audience`/`conditions` Json — yine `NVARCHAR(MAX)`. Audience seti tek scalar olarak normalize edilebilir ama 1-N audience yaygın — Json kontrollü.

#### `NotificationTemplate`
**Amaç:** Mesaj içeriği — subject + body + değişken listesi.
| Field | Tip | Not |
|---|---|---|
| `id` | cuid | |
| `companyId` | String (FK) | Tenant scope |
| `key` | String | Sabit referans ("approval_pending_to_lead", "customer_resolution_notice") |
| `name` | String | UI display |
| `language` | String (default 'tr') | Phase 1 tek dil; Phase 6 i18n |
| `subjectTemplate` | String | mustache benzeri `{{case.number}}` |
| `bodyTemplate` | String | HTML/plain — `format` ile |
| `format` | String enum | `plain` / `html` |
| `isCustomerFacing` | Boolean | UI'da "müşteriye gider" rozeti |
| `requiredVariables` | Json | `['case.number','account.name']` — preview eksik değişken doğrulaması |
| `version` | Int | Edit edildikçe ↑ |
| audit fields |  | |

**Snapshot strategy:** Dispatch sırasında template render edilir, **render edilmiş final içerik** `NotificationDispatch.snapshotSubject` + `.snapshotBody`'ye yazılır. Template sonradan değişse bile audit korunur.

#### `NotificationDispatch`
**Amaç:** Her tetiklenen bildirim için tek satır — audit + dedup + Phase 4 gerçek gönderim referansı.
| Field | Tip | Not |
|---|---|---|
| `id` | cuid | |
| `caseId` | String (FK) | onDelete: Cascade |
| `companyId` | String | |
| `event` | String | NotificationRule.event |
| `ruleId` | String? (FK) | Rule sonradan silinirse `?` |
| `ruleNameSnapshot` | String | Audit |
| `templateId` | String? (FK) | |
| `templateKeySnapshot` | String | |
| `templateVersionSnapshot` | Int | |
| `audienceType` | String | Resolved audience tipi |
| `audienceIdentifier` | String | Person.id / email / webhook URL — masked if PII |
| `channel` | String enum | |
| `mode` | String enum | `log_only` / `manual` / `active` |
| `state` | String enum | `Pending` / `Sent` / `Failed` / `Suppressed` |
| `snapshotSubject` | String | Render edilmiş final |
| `snapshotBody` | String | Render edilmiş final |
| `suppressionReason` | String? | "duplicate_within_window" / "rate_limited" / "no_channel" / "policy_inactive" |
| `idempotencyKey` | String? | `<companyId>:<event>:<caseId>:<audienceIdentifier>:<templateId>:<windowBucket>` — DB unique partial index |
| `failureReason` | String? | Phase 4 |
| `attempts` | Int (default 0) | Phase 4 |
| `dispatchedAt` | DateTime? | Phase 4 active gönderim anı |
| `createdAt` | audit |

**Indexes:**
- `(companyId, event, createdAt DESC)` — log viewer
- `(caseId, createdAt DESC)` — case timeline
- `(idempotencyKey)` unique (where not null) — dedup
- `(state)` — Phase 4 retry scanner

#### `AccountCompanyCommunicationPreference` (or extend `AccountCompany`)
**Karar:** Mevcut `AccountCompany` tablosuna **scalar field'lar ekle** — yeni tablo gerekmiyor, MSSQL portability daha kolay.
| Yeni Field | Tip | Not |
|---|---|---|
| `preferredResponseChannel` | String? | `email` / `phone` / `portal` / `manual` |
| `responseEmail` | String? | AccountContact'tan farklı olabilir (faturalama vs müşteri-destek) |
| `responsePhone` | String? | |
| `allowCustomerNotifications` | Boolean (default true) | "Otomatik bildirim alma" opt-out |

#### `Case` overlay alanları (mevcut `Case` modeline ek)
| Yeni Field | Tip | Not |
|---|---|---|
| `approvalState` | enum? (default null) | `Draft` / `Pending` / `Approved` / `Rejected` / `Skipped` |
| `communicationState` | enum? (default null) | `NotRequired` / `Pending` / `Dispatched` / `Failed` / `Manual` |
| `communicationChannelOverride` | String? | Case-level override over AccountCompany default |
| `currentApprovalId` | String? (FK CaseResolutionApproval) | Aktif onay döngüsünün id'si — denormalize, hızlı erişim için |

**Deletion strategy genel:**
- `ResolutionApprovalPolicy.isActive=false` (hard delete politika geçmişini bozar).
- `NotificationRule.isActive=false`.
- `NotificationTemplate.isActive=false` (Dispatch snapshot zaten render içeriği saklar).
- `CaseResolutionApproval`, `NotificationDispatch` — **immutable**, asla silinmez (Case cascade hariç).

**MSSQL portability özet:**
- Tüm enum'lar string olarak da modellenebilir (`@map` ile DB-string + app-layer enum) — Prisma her iki provider'da `enum` destekler, ama on-prem MSSQL'e geçişte string fallback'i daha güvenli.
- Json field'lar: Prisma MSSQL provider'ı Json'ı `NVARCHAR(MAX)` olarak saklar — uygulama layer'da parse.
- `idempotencyKey` unique partial index: PG'de `WHERE idempotencyKey IS NOT NULL`, MSSQL'de filtered index aynı — Prisma `@@unique` portable.
- Triggers/extensions yok.
- Queue: Phase 4 active sender — Supabase Realtime/PG_NOTIFY KULLANMA. Polling cron + idempotencyKey ile çek.

---

## 6. Workflow Design

### 6.A No policy matched
1. Agent vakayı çözer, `transitionStatus(id, 'Cozuldu', { resolutionNote })` çağrılır.
2. `Case.approvalState = 'Skipped'` set edilir (audit izi).
3. **NotificationRule'lar yine event üretebilir** — `event='case_closed'` rule eşleşirse log_only dispatch yazılır.
4. Mevcut davranış 1-1 korunur.

### 6.B Policy matched (D4)
```
[Agent]
  ├─ "Çözüm Onayına Gönder" butonu (approvalState=null, policy match var)
  ├─ Modal: resolutionSummary (zorunlu) + customerMessageDraft (opsiyonel) + politika önizleme
  └─ Submit → POST /api/cases/:id/approvals
      ↓
[Backend]
  ├─ matchPolicy() — sortOrder + specificity (§7)
  ├─ resolveApprover(policy, case) (§8)
  ├─ approverPersonId yoksa → 400 approver_unresolvable (UI'da actionable error)
  ├─ allowSelfApprove=false + submitter=expectedApprover → 400 self_approval_blocked
  ├─ CaseResolutionApproval insert (state=Pending)
  ├─ Case.approvalState=Pending, currentApprovalId set
  ├─ CaseActivity (ApprovalSubmitted)
  ├─ event='resolution_submitted' fire → NotificationRule scanner
  │     → matching rules → Dispatch log_only (Phase 1)
  └─ watcher notify (notifyWatchers reuse)
      ↓
[Onaylayıcı görür]
  ├─ Case detail'de approval pending badge
  ├─ Approver inbox (Phase 1 = ana case listesi filtered `approvalState=Pending AND expectedApproverPersonId=me`)
  └─ Action: "Onayla" / "Reddet"
```

**Onayla yolu:**
```
POST /api/cases/:id/approvals/:approvalId/approve
  ├─ assertCaseInScope
  ├─ approval.state==='Pending' AND req.user resolves to expectedApproverPersonId (or override)
  ├─ Update approval: state=Approved, decidedBy, decidedAt
  ├─ Update case: approvalState=Approved, communicationState=Pending (rule eşleşirse)
  ├─ CaseActivity (ApprovalApproved)
  ├─ event='resolution_approved' fire → dispatch
  ├─ Status hala 'Acik' / submitter durumunu set ettiyse 'Cozuldu' — politika davranışı (§21 karar)
  └─ Watcher notify
```

**Reddet yolu:**
```
POST /api/cases/:id/approvals/:approvalId/reject (body: rejectionReason)
  ├─ Same auth as approve
  ├─ rejectionReason required (UI modal)
  ├─ Update approval: state=Rejected, rejectionReason, decidedAt
  ├─ Update case: approvalState=Rejected, status unchanged
  ├─ rejectionBehavior:
  │     ReturnToAssignee → assigned* unchanged, Case.note prepend rejection
  │     ReturnToTeam → assignedPersonId=null, kept assignedTeamId
  │     Escalate → status='Eskalasyon', escalationReason=rejection
  ├─ CaseActivity (ApprovalRejected)
  └─ event='resolution_rejected' fire → dispatch (agent / team lead notify)
```

### 6.C Customer notification
- Onaylandığı an `event='customer_notification_created'` fire (Phase 1).
- NotificationRule audience'lara göre dispatch yazılır (log_only).
- `Case.communicationState = 'Pending'` set.
- Phase 4 active gönderim açıldığında → `Dispatched` veya `Failed` state'ine geçer.
- **Manual mode:** Operatör dispatch'i "elimle gönderdim" işaretlerse `mode='manual'`, `state='Sent'`, audit kalır.

### 6.D Reopen davranışı
- `Case.status='YenidenAcildi'` (manuel veya Phase 5 trigger).
- Yeni `CaseResolutionApproval` satırı oluşturulabilir (politika hâlâ matchliyorsa).
- Eski approval immutable kalır; `Case.currentApprovalId` yeni satıra döner.
- `Case.communicationState` reset → policy yeniden eşleşirse Pending; eşleşmezse null.
- **Karar:** Reopen'da otomatik yeni onay gerekir mi? **Önerim:** Politika `reopenRequiresReApproval: boolean` field'ı (Phase 2'ye ertelenebilir). Phase 1'de hayır — operatör manuel "tekrar onaya gönder" eder.

### 6.E Transfer davranışı
- Aktif `approvalState='Pending'` vaka transfer edilirse:
  - **Önerim (safe default):** Onay iptal edilmez ama `expectedApproverPersonId` yeniden çözülmez (snapshot). Yeni assigned team'in lead'i otomatik onaylayıcı olmaz — eski tablo kararı verir.
  - Alternatif: Transfer onay'ı `Cancelled` yapar, agent yeniden submit eder. Daha güvenli ama UX bozucu.
  - **Karar:** Phase 1 = ilk seçenek (snapshot kalır). UI banner: "Bu vaka transfer edildi ama onay hâlâ X kişiden bekleniyor — onayı iptal edip yeniden gönderebilirsiniz."

---

## 7. Policy Matching Rules

### Eşleşme alanları (matchScope JSON)
- `companyId` — **zorunlu** (politika tenant-bound)
- `isActive=true` — **zorunlu**
- Opsiyonel filtreler (null = wildcard):
  - `category: string`
  - `subCategory: string`
  - `priority: 'Low'|'Medium'|'High'|'Critical'`
  - `supportLevel: 'L1'|'L2'|'L3'|'Expert'`
  - `teamId: string`

**Phase 2+ eklenebilir:** `productId`, `packageId`, `accountId`, `requesterChannel`, `caseType`.

### Precedence
- `sortOrder ASC` (küçük sayı önce). Operator tenant başına override eder.
- Tie-break: en spesifik politika (= en az `null` matchScope alanı olan). 
- Hâlâ tie → `createdAt ASC` (deterministik).

### Ambiguity safe-fail
- 0 match → no policy → Skipped path (6.A).
- 2+ match aynı sortOrder+specificity → **en eski (`createdAt ASC`)** kazanır, audit'e `policy_resolution_ambiguous=true` warning kaydedilir. Operatör admin panelinde temizler.

### Implementation notu
- Match query: `prisma.resolutionApprovalPolicy.findMany({ where: { companyId, isActive: true } })` → app-layer JSON filtre. (DB-side JSON filtreleme MSSQL'de PG kadar zengin değil; app-layer daha portable + cacheable.)
- **Cache:** Per-tenant `(policies, fetchedAt)` 60sn in-memory cache. Cache invalidation: politika CRUD'unda flush.

---

## 8. Approver Resolution

### Approver tipleri ve resolve fonksiyonu

| `approverType` | Resolve logic | Phase 1? |
|---|---|---|
| **`TeamLead`** | `Case.assignedTeamId`'in lead'i (`Person` WHERE `teamId=case.assignedTeamId AND isTeamLead=true AND isActive=true`). 0 match → `approver_unresolvable`. >1 match → ilk by `createdAt`. | ✅ |
| **`AssignedTeamLead`** | TeamLead ile aynı. Alias for clarity. | ✅ |
| **`Supervisor`** | `req.user.role==='Supervisor'` olan Person — politikada `supervisorScope: 'company'` ya da `'any'`. Phase 1 = case.companyId scope. Birden fazla → tümü onaylayabilir (any-one). | ✅ |
| **`Admin`** | Company-admin (`UserCompany.role='Admin'` veya `Person.companyId=case.companyId` + Admin). | ✅ |
| **`SystemAdmin`** | Global role; Phase 1'de "kimse uygun değilse fallback" değil — ayrı `approverType`. SystemAdmin override capability §13'te. | ✅ |
| **`SpecificPerson`** | `policy.approverPersonId` zorunlu. O Person aktif olmalı. | ✅ |
| `AssignedPersonManager` | `Person → Team → leadPerson` (manager chain) — gelecekte. | Phase 2 |

### Self-approval
- Default: `allowSelfApprove=false`. Submitter == resolved approver → 400 `self_approval_blocked`.
- Politikada açıkça `allowSelfApprove=true` ise izinli.

### SystemAdmin override
- Her durumda SystemAdmin onaylayabilir — `?override=true` query param + audit'te `overriddenByPolicyResolver=true`.
- UI: SystemAdmin için "Politikayı geç ve onayla" buton — kullanım nadir.

### Multiple approvers: any-one vs all-required
- Phase 1 = **any-one** (one approver in resolved set yeterlidir).
- Phase 2+ `policy.approvalQuorum: 'any' | 'all'` field — multi-approver chain support.

### Fail-safe
- Resolved approver set boş → API 400 `approver_unresolvable` + actionable message: "Bu politika için onaylayıcı bulunamadı. {teamId} takımında aktif team lead yok. Lütfen takım liderini atayın veya politikayı düzenleyin."

---

## 9. Notification & Communication Rule Engine

### 9.1 Event taxonomy

| Event | Tetikleyici | Phase |
|---|---|---|
| `resolution_submitted` | `CaseResolutionApproval` insert (state=Pending) | 1 |
| `resolution_approved` | Approval → Approved | 1 |
| `resolution_rejected` | Approval → Rejected | 1 |
| `customer_notification_created` | Approved + müşteri-facing rule eşleşti | 1 (log-only) |
| `customer_notification_sent` | Dispatch state=Sent (Phase 4) | 4 |
| `customer_notification_failed` | Dispatch state=Failed | 4 |
| `case_closed` | Status→Cozuldu | 1 |
| `case_reopened` | Status→YenidenAcildi | 1 |
| `case_transferred` | `transferCase` mutation | 2 (rule support — şu an CaseActivity'ye yazılıyor) |
| `info_requested` | (Phase D5 — Bilgi Talep akışı) | 5+ |
| `pending_customer_reply_reminder` | Cron, customer waiting > X | 5 |
| `approval_overdue_reminder` | Cron, Pending > X | 5 |

### 9.2 Rule fields (recap from §5)
- `companyId`, `event`, `conditions`(JSON), `audience`(JSON), `templateId`, `channel`, `mode`, `isActive`, `sortOrder`, `suppressDuplicateWithinMinutes`, `rateLimitPerHour`.

### 9.3 Audience tipleri
| Type | Resolved to | Phase |
|---|---|---|
| `customer_primary_contact` | AccountContact WHERE `accountId=case.accountId AND isPrimary=true` → email/phone | 1 |
| `account_company_contacts` | Tüm `AccountContact` `accountId=case.accountId` (account-level, company-aware) | 2 |
| `assignee` | `Case.assignedPersonId` → Person.email | 1 |
| `team_lead` | Aynı approver TeamLead resolution | 1 |
| `supervisor` | Company Supervisor'lar | 1 |
| `admin` | Company Admin'ler | 1 |
| `static_email` | `audience.targetValue` literal | 2 |
| `webhook_url` | `audience.targetValue` URL | 4 |

### 9.4 Channel tipleri (Phase 1 yalnız ilk üç)
- `in_app` — `CaseNotification` reuse (Phase 1 reuse mevcut tablo)
- `manual_task` — Operatöre "şu kişiyi şu şekilde bilgilendir" görevi (`NotificationDispatch.mode='log_only'` + UI panel)
- `webhook` — Phase 4 active
- `email` — Phase 4 active (Resend.com tahmini — §21 karar)
- `sms`, `whatsapp` — Phase 5+

### 9.5 Mode: log_only / active / manual
- **`log_only` (default Phase 1-3):** Dispatch satırı oluşturulur, `state='Pending'` veya direkt `'Sent'` (manual_task channel için), external API çağrılmaz. Operatör panel'de görür.
- **`active` (Phase 4+):** Gerçek delivery. Per-tenant + per-rule explicit opt-in. Çift switch: rule.mode='active' AND tenant feature flag.
- **`manual`:** Operatör "ben hallettim" işareti — `Dispatch.mode='manual'`, `state='Sent'`, manualSetByUserId audit.

### 9.6 Suppress duplicates / rate limit
- **idempotencyKey:** `${companyId}:${event}:${caseId}:${audienceIdentifier}:${templateId}:${windowBucket}` — `windowBucket = Math.floor(now / suppressDuplicateWithinMinutes / 60000)`. DB unique partial index → insert conflict = suppressed (`state='Suppressed'`, `suppressionReason='duplicate_within_window'`).
- **rateLimitPerHour:** App-layer counter (Redis-less Phase 1: 1-saatlik tumbling window per-rule via SQL count; Phase 5 Redis if needed).

### 9.7 Phase 1 zorunlu kural — Active customer email YOK
- Phase 1 customer-facing rule'ların yalnız `mode='log_only'` veya `'manual_task'`. `mode='active'` rule create endpoint'i feature-flag arkasında.
- Phase 4 deployment: explicit product-owner opt-in per tenant + per rule.

---

## 10. Customer Response Channel

### 10.1 Mevcut alan envanteri
- `AccountContact.preferredChannel: String?` — serbest string, normalize yok.
- `Account.email`, `Account.phone` — denormalize.
- `AccountCompany` — comms field yok.

### 10.2 Önerilen yeni alanlar (§5.2 reuse)

**`AccountCompany`** ek alanlar:
- `preferredResponseChannel: String?` (`'email' | 'phone' | 'portal' | 'manual'`)
- `responseEmail: String?` (fallback chain'in başı)
- `responsePhone: String?`
- `allowCustomerNotifications: Boolean @default(true)` — KVKK uyumu (opt-out)

**`AccountContact.preferredChannel`** — mevcut alan: normalize edilmiş enum'a çevrilir (string ama validate).

**`Case`** ek alan:
- `communicationChannelOverride: String?` — case bazlı override (multi-channel müşteride hangi vakanın hangi kanaldan cevaplanacağını agent karar verir).

### 10.3 Fallback chain
Bir vakada müşteriye nasıl iletişim kurulacağı:
1. `Case.communicationChannelOverride` (varsa) → final channel
2. `AccountCompany.preferredResponseChannel` (case.companyId match) → final channel
3. `AccountContact.preferredChannel` (primary contact) → final channel
4. `Account.email`/`Account.phone` (mevcut denormalize) → varsa `email` veya `phone`
5. Hiçbiri yok → `manual` (dispatch oluşur, state='Pending', operatöre görev)

### 10.4 Missing channel davranışı
- `allowCustomerNotifications=false` → tüm customer-facing dispatch'ler suppressed (`suppressionReason='customer_opted_out'`).
- Channel resolved=null AND audience customer → dispatch yine yazılır ama `state='Pending'` + `suppressionReason='no_channel_available'`; operatör manuel görev olarak görür.

### 10.5 UI sade tutma
- Account detail → "İletişim Tercihleri" subsection (AccountCompany sekmesinde).
- Case detail → "Cevap Kanalı" badge + ✏️ override.
- Net olarak: bu alanlar zaten mevcut müşteri-iletişim akışını değiştirmez; sadece dispatch resolution'a beslenir.

---

## 11. Template System

### 11.1 Gereksinimler özet
- Subject + body (template engine: mustache-style `{{variable}}`)
- Internal vs customer-facing flag (`isCustomerFacing: boolean`)
- Allowed variables — Phase 1 sabit liste (aşağıda)
- Preview — admin UI'da sample case ile render
- Test send — **Phase 4** (active email kapısıyla birlikte)
- Missing variable validation — render'da `{{X}}` çözülemezse warning + render'da `[X eksik]` placeholder
- HTML vs plain text — `format: 'plain' | 'html'`
- Localization — Phase 1 tek dil (`language='tr'`), Phase 6 i18n
- Versioning — `template.version++` her edit'te; `Dispatch.templateVersionSnapshot` audit

### 11.2 Phase 1 sabit değişken listesi
| Değişken | Kaynak | Phase |
|---|---|---|
| `case.number` | Case.caseNumber | 1 |
| `case.title` | Case.title | 1 |
| `case.description` | Case.description (truncated 500ch) | 1 |
| `case.priority` | Case.priority (TR) | 1 |
| `case.status` | Case.status (TR) | 1 |
| `account.name` | Case.accountName denorm | 1 |
| `company.name` | Case.companyName | 1 |
| `assignee.name` | Case.assignedPersonName | 1 |
| `team.name` | Case.assignedTeamName | 1 |
| `resolution.summary` | CaseResolutionApproval.resolutionSummary | 1 |
| `resolution.customerMessage` | CaseResolutionApproval.customerMessageDraft | 1 |
| `approval.rejectionReason` | CaseResolutionApproval.rejectionReason | 1 |
| `approval.approverName` | Resolved approver Person.name | 1 |
| `portal.link` | Future deep-link | 5+ |

### 11.3 Snapshot at dispatch
Render edilmiş final içerik `Dispatch.snapshotSubject` + `.snapshotBody`'ye yazılır. Template post-dispatch değişirse audit etkilenmez.

---

## 12. UI/UX Design

### 12.1 Admin screens

**Çözüm Onayı Politikaları** (`/admin/resolution-approval-policies`)
- List: name, scope rozetleri (category/priority), approverType, sortOrder, isActive
- CRUD modal: matchScope filtreleri (multi-select chip), approverType seçici (+ specific person picker conditional), allowSelfApprove toggle, rejectionBehavior dropdown
- Validation: en az 1 policy field veya "match-all" explicit flag (yanlışlıkla all-cases politikası kurma riski)

**Bildirim ve İletişim Kuralları** (`/admin/notification-rules`)
- List: event, audience özetleri, channel, mode, isActive
- CRUD modal: event picker (enum), conditions JSON editor (basit chip-form), audience builder (multi-row), template picker, channel + mode dropdown'ları, suppression/rate-limit numerics

**Şablonlar** (`/admin/notification-templates`)
- List: key, name, isCustomerFacing badge, version, format
- Editor: split-pane (template source + preview with sample case)
- "Preview with sample case" — yan panelde render sonuç + eksik değişken uyarısı

**Dispatch / Message log viewer** (`/admin/notification-dispatches` veya Case detail timeline'a embed)
- Filter: companyId / event / state / channel / dateRange
- Row: timestamp, event, audience (masked PII), channel, mode, state, "View" → snapshot subject+body modal
- Pagination zorunlu (büyüyecek tablo)

### 12.2 Case detail experience

```
┌─────────────────────────────────────────────────┐
│ Case Detail Header                              │
│  [Status: Açık]  [Approval: Pending ⏳]         │
│                                                  │
│ Actions:                                         │
│  [Çözüm Onayına Gönder] (policy match VAR ise)   │
│  [Onayla]   (approver VE state=Pending)          │
│  [Reddet]   (approver VE state=Pending)          │
│  [Doğrudan Kapat] (policy match YOK)             │
└─────────────────────────────────────────────────┘
```

**Submit modal** (Çözüm Onayına Gönder):
- Resolution summary (zorunlu, multi-line)
- Customer message draft (opsiyonel)
- Politika preview banner: "Bu çözüm {policy.name} kapsamında {approverPersonName} onayına gönderilecek."
- Cevap kanalı preview: "Onaylandığında müşteriye {channel} kanalından bildirim gidecek (Phase 1: log-only)."
- Submit / Cancel

**Approve modal:**
- Resolution summary + customer message read-only
- "Bu çözüm onaylanacak ve aşağıdaki kişiler bilgilendirilecek:" — audience preview list (per rule)
- "log-only" rozeti (Phase 1)
- Confirm / Cancel

**Reject modal:**
- Rejection reason (zorunlu)
- Behavior preview: "Bu vaka rejectionBehavior gereği X'e dönecek."
- Confirm / Cancel

**Approval pending badge:** Renkli pill — Status pill'in yanında, ayrı görsel. Confuse etmemek için **"Müşteri Onayı" değil "İç Onay"** yazısı.

**Timeline:**
- ApprovalSubmitted (Submitter, timestamp)
- ApprovalApproved / ApprovalRejected (decidedBy, rejectionReason if any)
- DispatchCreated (event, audience masked, channel, mode badge)

**Critical UX kuralları:**
- "İç Onay" ≠ "Müşteri Cevabı" — iki ayrı badge.
- "log-only" rozeti her dispatch satırının yanında — operatör "gönderildi" sanmasın.
- Audience listesi submit-öncesi gösterilir — sürpriz alıcı yok.
- Hidden automatic customer communication YOK; sessizce e-posta gitmez.

---

## 13. Security / RBAC

| Aksiyon | Phase 1 izinli rol |
|---|---|
| `ResolutionApprovalPolicy` CRUD | `Admin` (companyId scope) + `SystemAdmin` (global) |
| `NotificationRule` CRUD | Aynı |
| `NotificationTemplate` CRUD | Aynı |
| Submit approval (Çözüm Onayına Gönder) | `Agent` (case'in assignee'si veya case'in scope'unda) |
| Approve / Reject | Resolved approver person (§8) + `SystemAdmin` override |
| Cancel approval (durdurma) | Submitter veya Admin (Phase 1'de "Cancel" eylemi yok — sadece reject) |
| Manual dispatch (manuel görev tamamlandı işareti) | `Agent` + assignee |
| Trigger active send (Phase 4) | `Admin` + tenant feature flag |
| View dispatch log | `Admin` (kendi tenant'ı) + `SystemAdmin` (tüm) |

**Tenant isolation:**
- Tüm CRUD `companyId` field'ı `req.user.allowedCompanyIds` içinde olmalı — `assertCompanyAdmin` reuse.
- Policy/Rule/Template hiçbir zaman cross-tenant okunmaz; query `companyId` filter zorunlu.
- Dispatch tablo query'leri her zaman `companyId` filtered.
- Snapshot içeriği (template render) audit için kalıcı, tenant değişse de erişim kuralları gevşemez.

**No cross-tenant leakage:**
- Template key collision farklı tenant'larda izinli (`@@unique([companyId, key])`).
- Audience `static_email` literal değerleri tenant config; cross-tenant kopyalama Admin UI'da export/import yok (Phase 1).

**Audit zorunlu:**
- Politika/Rule/Template her CRUD'u `CaseActivity` benzeri ayrı bir `ConfigAuditLog` tablosuna yazılır (Phase 2). Phase 1: standard application log + Prisma `updatedAt`/`createdByUserId`.

---

## 14. Audit and Compliance

### Immutable audit ne yazılır?

**`CaseResolutionApproval`** (immutable insert + state transitions):
- Approval request created (submittedBy, submittedAt, policy snapshot)
- Approver resolved (expectedApproverPersonId)
- Decision (decidedBy, decidedAt, state, rejectionReason)

**`NotificationDispatch`** (immutable):
- Dispatch created (event, ruleId snapshot, templateId snapshot, audience masked, channel, mode)
- Snapshot subject + body (render edilmiş final içerik)
- State transitions (Pending → Sent / Failed / Suppressed)
- suppressionReason / failureReason

**`CaseActivity`** (üst seviye log; mevcut tablo reuse):
- ApprovalSubmitted (action='Çözüm onayına gönderildi')
- ApprovalApproved (action='Çözüm onayı verildi')
- ApprovalRejected (action='Çözüm onayı reddedildi', note=rejectionReason)
- DispatchCreated (action='Bildirim oluşturuldu', note='log-only')

**Ne CaseActivity'ye yazılır, ne dedicated tabloya?**
- **CaseActivity** = "vakanın timeline'ında görünen şey" (operator-readable, short). Detay sınırlı.
- **Dedicated tablolar** = "tam denetim izi" (snapshot, immutable, search/filter için indexed). Admin compliance ekranında görünür.

### Compliance considerations
- KVKK opt-out: `AccountCompany.allowCustomerNotifications=false` → tüm customer dispatch suppressed + audit'te `suppressionReason='customer_opted_out'`.
- PII masking in audience identifier: emails partially masked in log viewer (`a***@example.com`).
- Retention: Dispatch tablosu büyür — Phase 5+ archive job (90 gün öncesi cold storage). Phase 1 retention infinite.

---

## 15. Failure Modes and Safe Defaults

| Hata durumu | Tetik | Önerilen davranış |
|---|---|---|
| Approver missing (resolve = 0) | Submit-time | 400 `approver_unresolvable` + actionable message; submit reddedilir, vaka korunur, audit'e `approval_blocked_at_submit` yazılır. |
| Template missing | Dispatch render | Dispatch `state='Failed'`, `failureReason='template_not_found'`. Rule trigger event yine kaydedilir (audit). Admin uyarı. |
| Customer email missing | Audience resolve | Dispatch `state='Pending'`, `suppressionReason='no_channel_available'`, manual task channel'a fallback. |
| Notification provider down | Phase 4 send-time | Dispatch `state='Failed'`, retry counter ↑, exponential backoff (Phase 4 implement). Phase 1: not applicable. |
| Duplicate event produced | Race / double-click | `idempotencyKey` unique conflict → `state='Suppressed'`, `suppressionReason='duplicate_within_window'`. |
| Case changed while approval pending | UPDATE Case during Pending | Onay yine geçerlidir; ama `case.title/description` değişmiş ise approval snapshot stale — `Dispatch.snapshotBody` template render edildiği anki içerik kalır. Audit'te uyarı `approval_snapshot_age_seconds`. |
| Case transfer while approval pending | `transferCase` mutation | Approval immutable kalır; expectedApproverPersonId snapshot. Banner: "Bu vaka transfer edildi; onay X kişiden bekleniyor. İptal edip yeniden gönderebilirsiniz." (§6.E) |
| User tries to close while approval pending | `transitionStatus(id, 'Cozuldu')` çağrısı | 400 `case_close_blocked_pending_approval` (yeni error code). Status değişmez. UI butonu zaten disabled gösterir; backend defense-in-depth. |
| Rule modified after approval created | NotificationRule UPDATE | Mevcut dispatch'ler etkilenmez (snapshot). Yeni event'lerden itibaren yeni rule geçerli. |
| Template modified after dispatch | Template UPDATE | Mevcut dispatch.snapshot* korunur; yeni dispatch'ler yeni template render eder. |
| Policy modified | Policy UPDATE | Mevcut Pending approvals etkilenmez (snapshot). Yeni submit'ler yeni policy ile match olur. |
| Policy deleted | Soft delete (`isActive=false`) | Yeni match'ler düşer. Pending approvals devam eder. Hard delete YOK (audit korunur). |
| Rollback (migration) | Schema rollback | Approval/Dispatch tablolar düşer — **audit kaybı**. Bu yüzden Phase 1 migration backward-additive: dropping the feature requires data export first. |
| Manual correction by admin | DB-direct manipulation | Audit dışı kalır. Operasyonel uyarı: Admin UI'da "Force-cancel approval" Phase 2'de — şu an support runbook'da. |

---

## 16. Implementation Split

### Phase 0 — Planning Card (this card)
- Bu doküman. Hiçbir kod değişikliği yok.
- Output: operator+product onayı için karar matrisi.

### Phase 1 — Resolution Approval Foundation
**Scope:**
- Schema: `ResolutionApprovalPolicy`, `CaseResolutionApproval`, `Case.approvalState`, `Case.currentApprovalId`.
- Backend:
  - Policy match function + per-tenant cache.
  - Approver resolution function.
  - POST `/api/cases/:id/approvals` (submit).
  - POST `/api/cases/:id/approvals/:approvalId/approve`.
  - POST `/api/cases/:id/approvals/:approvalId/reject`.
  - `transitionStatus` guard: `Cozuldu` bloklu when `approvalState='Pending'`.
- Admin UI: `/admin/resolution-approval-policies` CRUD.
- Case detail: action buttons + badges + timeline entries.
- **No external sending.** Dispatch yok.
- Smoke: §20.

### Phase 2 — Notification Rule + Template Foundation
**Scope:**
- Schema: `NotificationRule`, `NotificationTemplate`, `NotificationDispatch`, `Case.communicationState`.
- Backend:
  - Event emission hooks (resolution_submitted, approved, rejected, case_closed, case_reopened).
  - Rule scanner → dispatch creator (mode=log_only).
  - Template render (mustache) + snapshot.
  - Idempotency / suppress duplicates.
- Admin UI: `/admin/notification-rules`, `/admin/notification-templates`, `/admin/notification-dispatches` (read-only viewer).
- Case detail: dispatch timeline entries + manual_task channel UI.
- Smoke + data-contract.

### Phase 3 — Customer Response Channel
**Scope:**
- Schema: `AccountCompany.preferredResponseChannel/responseEmail/responsePhone/allowCustomerNotifications`, `Case.communicationChannelOverride`.
- Backend: channel resolution chain (§10.3), dispatch audience resolver uses it.
- UI: Account detail "İletişim Tercihleri" subsection, Case detail "Cevap Kanalı" badge + override modal.
- manual_task channel: operator action panel.

### Phase 4 — Active Email Adapter
**Scope:**
- Email provider (Resend.com tahmini — §21 karar): env var `RESEND_API_KEY`, abstraction `server/lib/notifications/emailSender.js`.
- Backend: dispatch worker (cron 1-5 dakika polling) → state='Pending' AND mode='active' AND channel='email' → send → state='Sent'/'Failed'.
- Per-tenant + per-rule explicit opt-in.
- Test-send admin UI: template preview → kendine gönder.
- Retry / backoff (max 3 attempts, exponential).
- Failure surfacing: dispatch state + notification to admin.

### Phase 5 — Reminder Automations
**Scope:**
- Cron job: pending approval > X hours → reminder dispatch.
- Cron job: customer waiting (status=ThirdPartyWaiting or customer-pending) > X days → reminder.
- SLA pause integration (existing slaThirdPartyWaitMin reuse).
- Event taxonomy expand: `approval_overdue_reminder`, `pending_customer_reply_reminder`.

### Phase 6+ — i18n + Webhook + SMS
- Template language support.
- Webhook channel adapter.
- SMS/WhatsApp providers.

### Alternatif split — neden bu sıralama?
- **D4 (approval) önce, D3 (notification) sonra** çünkü approval olmadan dispatch'i tetikleyecek olay yok. Approval Phase 1'de standalone değer üretir (internal governance) — dispatch eklenmeden de operatör onay süreci yaşar.
- D3 Phase 2'de geldiğinde D4 ile entegre — dispatch event'leri zaten approval ile fire ediliyor.
- D4 standalone ship-edilebilir + revert-edilebilir (NotificationDispatch tablosu olmadan da çalışır).

---

## 17. Data Migration / Backward Compatibility

### Mevcut cases nasıl etkilenir?
- **Hiçbir mevcut case zorla approval flow'a girmiyor.** Migration:
  - `Case.approvalState` default null.
  - Mevcut açık vakalar `approvalState=null` ile devam eder.
  - Phase 1 deploy edildikten sonra Agent yeni vakayı kapatırsa → policy match var → flow tetiklenir. Eski vakalar etkilenmez.
- **Default policy disabled:** Hiçbir tenant'a default politika kurulmaz; her tenant `Admin` panelinden açar.
- **Templates/rules empty by default:** Phase 2 deploy'unda tablo boş; operator opt-in.
- **No automatic customer send on deploy:** Phase 1-3 = log-only; Phase 4 deploy'unda ayrı tenant feature flag.

### Tenant rollout
- Per-tenant Admin opt-in. Sistem genelinde `feature_flag` server-side: `Company.resolutionApprovalEnabled: Boolean @default(false)`.
- false → submit endpoint 404 / policy match skip; mevcut `Cozuldu` direkt çalışır.
- true → submit endpoint açık; policy match işler.

### Rollback senaryosu
- Phase 1 schema değişimi backward-additive: drop yoksa, eski endpoint'ler çalışır. Eklenen field'lar `@default(null)` — geri-uyumlu.
- Tüm new tables `DROP TABLE` ile geri alınabilir (data kaybı kabul edilir — feature dev'de).
- Production rollback: feature flag `false` → kullanım durur, data tablolarda kalır.

---

## 18. MSSQL / On-Prem Portability

### Risk envanteri

| Konu | PG yaklaşımı | MSSQL portability | Risk |
|---|---|---|---|
| Enum types | Prisma `enum` (PG native enum) | Prisma string + check constraint (MSSQL provider) — Prisma handle eder | ⚠️ Düşük: Prisma migration MSSQL'de string'e fallback |
| JSON fields (matchScope, conditions, audience) | `jsonb` (PG) | `NVARCHAR(MAX)` (MSSQL) — Prisma `Json` portable | ✅ |
| Unique partial index (idempotencyKey) | `WHERE col IS NOT NULL` | Filtered index `WHERE col IS NOT NULL` — MSSQL identical syntax | ✅ |
| `@updatedAt` trigger | Prisma client-side | Identical | ✅ |
| Composite index | `@@index([a,b])` | Identical | ✅ |
| `JSON_VALUE()` in queries | PG `->>'key'` | MSSQL `JSON_VALUE(col, '$.key')` | ❌ **App-layer match yerine query-side JSON parse YAPMA**. Phase 1'de policy/rule eval app-layer. |
| Queue / pub-sub | Supabase Realtime / `pg_notify` | YOK | ✅ Phase 1 hiç queue yok; Phase 4 worker = cron poll, idempotencyKey-driven. |
| Full-text search | tsvector | MSSQL FULLTEXT INDEX | N/A (Phase 1 search yok) |
| Cron | Vercel Cron / Supabase Cron | SQL Server Agent + Node service | ⚠️ Phase 5 cron infra abstraction'a dikkat |

### Tasarım kuralları
- ❌ **PG-specific** features kullanmaktan kaçın: `jsonb_path_query`, `lateral join`, `array_agg`, `GIN`, `pg_trgm`.
- ✅ JSON yalnız storage; query app-layer.
- ✅ Tüm idempotency keys string column + filtered unique index.
- ✅ Indexler `(companyId, ...)` pattern — multi-tenant query'ler için.
- ❌ Trigger / view / function YOK Phase 1-3.

---

## 19. Performance & Architecture Gate

### Extra queries on Case detail
- Mevcut `getCase(id)` ~3 query (case + activities + watchers).
- Yeni: `currentApproval` (1 query), `recentDispatches` last 20 (1 query). **+2 query**, low impact.
- Approval'lar JOIN ile case query'sine eklenebilir (Phase 1 ayrı tutarız test edilebilirlik için).

### Policy matching cost
- Per-case-close: bir adet `findMany({ where: { companyId, isActive: true } })`. **Tenant başına ~10-50 politika tahmini.** App-layer JSON filtre O(n). 60sn in-memory cache ile gerçek DB hit / dakika = 1.
- 800-1000 concurrent users × hourly close rate (~1-2 case/saat per user) = ~16-33 query/saat (cached). **No problem.**

### Notification rule matching cost
- Her event: `findMany({ where: { companyId, event, isActive: true } })`. Cached 60sn.
- Rule sayısı tenant başına 20-100 tahmin. Audience resolution + template fetch + dispatch insert ortalama 50-200ms.
- Phase 1 log-only: external API yok → fast path.
- Phase 4 active: cron worker pull-based, anlık tetik yok.

### Dispatch log growth
- ~1 dispatch / case-close-event = ~5-10 dispatch / case (close + multiple rules).
- Aylık 10K case → 50-100K dispatch / ay.
- Index (companyId, event, createdAt) + retention Phase 5'te.
- Log viewer pagination zorunlu (`take: 50`, `skip` veya cursor).

### Indexes needed
```
@@index([companyId, isActive])     // policy/rule list
@@index([companyId, event, isActive]) // rule scanner
@@index([caseId])                   // approval+dispatch per-case
@@index([expectedApproverPersonId, state]) // approver inbox
@@index([companyId, state, createdAt]) // dispatch log viewer
@@unique([companyId, key])          // template
@@unique([idempotencyKey])          // dispatch dedup (filtered)
```

### Page-size caps for log viewer
- Default 50, max 200.
- Cursor pagination Phase 2 (offset Phase 1).

### Caching strategy
- In-memory per-process LRU: `policies:${companyId}` + `rules:${companyId}:${event}` TTL 60sn.
- Invalidation on CRUD: best-effort (single-process Phase 1; multi-instance Phase 4'te Redis-or-broadcast).
- Cache leak yok — companyId scope key.

### 800-1000 concurrent users target
- Phase 1 load: %80 idle + %20 active. Case close peak ~50/dk → 50 policy queries/dk (cached: ~1 DB hit/dk).
- DB layer: ek tablolar ek index'lerle <5ms p95.
- BFF response time impact: <30ms p95.

### **Verdict: PASS**

Notes:
- Phase 4 active send'de queue infra gerekirse Performance Gate yeniden değerlendirilir.
- Dispatch tablosunun retention'ı Phase 5'te otomatize edilmeli — büyük tenant'ta yıllık 1M+ satır olabilir.

---

## 20. Smoke / QA Plan

### Smoke tests — `scripts/smoke-resolution-approval-flow.js` (Phase 1)
1. `Acik` case + matching policy → submit approval → 201 + `approvalState='Pending'` + dispatch yok (Phase 1).
2. Submit duplicate → 409 `approval_already_pending`.
3. Approver resolves correctly: `TeamLead` policy + assignedTeam → approver = team lead.
4. `Approver missing` (team has no active lead) → 400 `approver_unresolvable` + audit logged.
5. `allowSelfApprove=false` + agent == approver → 400 `self_approval_blocked`.
6. Approve → 200 + `approvalState='Approved'` + activity logged.
7. Reject → 200 + `approvalState='Rejected'` + rejectionReason stored + rejectionBehavior applied.
8. Unauthorized approve (random user) → 403.
9. SystemAdmin override → 200 + audit `overridden=true`.
10. `transitionStatus(id, 'Cozuldu')` while `approvalState='Pending'` → 400 `case_close_blocked_pending_approval`.
11. Reopen after approved → new approval cycle CAN be created (manual submit).
12. Transfer while pending → approval snapshot kalır, `expectedApproverPersonId` değişmez.
13. Tenant isolation: tenant B'nin policy'sini tenant A submit edemez.
14. Cancel approval (Phase 2'de gelirse) → state=Cancelled, case.approvalState=null.

### Smoke tests — `scripts/smoke-notification-rule-engine.js` (Phase 2)
1. Approval approved → matching rule → dispatch log_only created with snapshot.
2. Template render eksik değişken → dispatch state=Failed + failureReason='template_variable_missing'.
3. Idempotency: 2x event fire window içinde → 1 Sent + 1 Suppressed.
4. Rate limit: rule rateLimitPerHour=2 + 5 trigger → 2 Sent + 3 Suppressed.
5. `mode='log_only'` → external API çağrılmaz (mock spy yok = 0 invocation).
6. Audience resolution: `customer_primary_contact` audience'ı doğru contact'ı resolve eder.
7. Audience `customer_primary_contact` + `allowCustomerNotifications=false` → suppressed.
8. Tenant isolation: rule B'nin template'i rule A'da kullanılamaz.
9. SystemAdmin path: tüm tenant'larda CRUD görünür.
10. Template snapshot: template post-dispatch değişse bile dispatch.snapshot* korunur.

### Data contracts (Phase 2'de eklenir)
- `Approval Audit Contract` — her approval'un decidedBy ya da Pending olmalı; state=Approved/Rejected ise decidedAt non-null.
- `Dispatch Audit Contract` — her dispatch'in `idempotencyKey` veya `suppressionReason` set olmalı.
- `Channel Resolution Contract` — `customer_*` audience'lar `allowCustomerNotifications=false` müşterilerde suppressed.

### Manual QA checklist
- [ ] Admin politika oluşturur → Agent submit eder → TeamLead onaylar → case kapanır (Phase 1 davranış).
- [ ] Reject + ReturnToAssignee → vaka assignee'de kalır + note prepend.
- [ ] Reject + ReturnToTeam → assignedPersonId temizlenir.
- [ ] Reject + Escalate → status=Eskalasyon.
- [ ] Multi-policy match → en yüksek precedence kazanır.
- [ ] AllowSelfApprove=true + Agent=approver → izinli.
- [ ] Transfer pending approval → banner görünür.
- [ ] Reopen + yeniden submit → yeni approval döngüsü.
- [ ] Phase 2: Dispatch log_only operatöre görünür ama hiçbir e-posta gitmedi (inbox kontrolü).
- [ ] Phase 3: Müşteri channel preference → dispatch audience resolution doğru.
- [ ] Phase 4: Active email test → tek tenant + tek rule + test inbox.

---

## 21. Open Product Decisions

| # | Karar | Önerim | Bekleyen |
|---|---|---|---|
| 1 | Agent self-approval default? | **Default `false`.** Politika başına opt-in. | PD onay |
| 2 | Approval required by default mi politika-only mu? | **Politika-only.** Hiçbir vaka onay olmadan zorla bekletilmez; tenant Admin politika açar. | PD onay |
| 3 | UI status etiketi | "İç Onay Bekliyor" + "Onaylandı" + "Reddedildi". "Müşteri" sözcüğü iç onayda yok. | PD onay |
| 4 | Customer notification hemen mi onay sonrası mı? | **Onay sonrası**, ayrı event (`customer_notification_created`). Onay tek başına müşteriye haber göndermez. | PD onay |
| 5 | Phase 1 kanalları | **`in_app` + `manual_task`** (log-only). Email Phase 4. | PD onay |
| 6 | İlk active sender | **Resend.com** (tahmini — basit API, KVKK uyumlu DPA). Alternatif: tenant SMTP. | PD karar — provider seçimi |
| 7 | Template metnine kim sahip? | **Tenant Admin** UI'dan yönetir. Varuna global default template seti gönderilmez. | PD onay |
| 8 | Customer acceptance ihtiyacı? | Phase 5+ portal/email-reply. Phase 1'de "no acceptance" — implicit accepted. | PD karar — Phase 5 scope |
| 9 | Closed vs Solved ayrımı? | **Phase 1'de YOK.** `Cozuldu` her ikisini kapsar. Phase 6'da customer acceptance gelirse `Resolved` + `Closed` ayrılır. | PD karar |
| 10 | `Company.resolutionApprovalEnabled` feature flag mi yoksa policy varlığı tetik mi? | **Politika varlığı tetik** (basit) + ayrı feature flag yok. Tenant politika oluşturmazsa flow tetiklenmez. | PD onay |
| 11 | `policy.reopenRequiresReApproval`? | Phase 2 field. Phase 1'de manuel submit. | PD karar |
| 12 | Rejection sonrası vaka durumu | `rejectionBehavior` enum: `ReturnToAssignee` / `ReturnToTeam` / `Escalate`. Default: `ReturnToAssignee`. | PD onay |

---

## 22. Recommended Next Prompt

**⚠️ DO NOT RUN UNTIL APPROVED. ⚠️**

> **TASK:** WR-D4 Phase 1 — Resolution Approval Foundation (schema + admin policy CRUD + submit/approve/reject + audit + smoke; no external sending)
>
> **Context:** Bu task, [docs/planning_cards/WR-D4-D3-RESOLUTION-APPROVAL-NOTIFICATION-RULES.md](../planning_cards/WR-D4-D3-RESOLUTION-APPROVAL-NOTIFICATION-RULES.md) Phase 1 scope'unu implemente eder. Notification engine (D3) ayrı PR — bu PR'da event firing hook'ları placeholder olarak hazırlanır ama dispatch yazımı yapılmaz.
>
> **Strict scope:**
> - Schema: `ResolutionApprovalPolicy`, `CaseResolutionApproval`, `Case.approvalState` (enum), `Case.currentApprovalId`.
> - Migration: additive only; mevcut Case rows `approvalState=null` ile devam eder.
> - Backend: policy match + approver resolution + 3 endpoint (submit / approve / reject) + status close guard (`Cozuldu` block when `approvalState='Pending'`).
> - Admin UI: `/admin/resolution-approval-policies` CRUD.
> - Case detail: action buttons + badge + timeline entries.
> - Smoke: `scripts/smoke-resolution-approval-flow.js` — §20 14 senaryo.
> - **No NotificationDispatch / NotificationRule / Template tabloları.**
> - **No external sending.** Watcher notify mevcut `notifyWatchers` ile yeterli (ApprovalSubmitted/Approved/Rejected timeline'a yazılır).
>
> **Guardrails:**
> - Customerless flow → dokunulmadı.
> - Customer 360 import / rollback → dokunulmadı.
> - C2/C3 customer-flow → dokunulmadı.
> - QuickCaseModal / NewCaseForm baseline → değişmedi (yalnız `Cozuldu` transition guard'a yeni hata kodu eklenir).
> - SLA pause/resume → değişmedi.
> - Tenant scope server-side; `assertCompanyAdmin` zorunlu.
> - Audit immutable.
>
> **Open product decisions to confirm before starting:** §21 #1, #2, #3, #4, #10, #12.
>
> **Validation:**
> - `node --check` on touched files
> - `tsc -b`
> - `vite build`
> - `node --env-file=.env scripts/smoke-resolution-approval-flow.js`
> - Adjacent regressions: `smoke-customer-selected-case-flow`, `smoke-account-new-case-prefill`, `smoke-case-product-package-flow`, `smoke-data-contracts`.
>
> **Final report:**
> - Schema diff
> - Files changed
> - Smoke results
> - Confirm no notification dispatch table created
> - Confirm no external sending code added
> - Confirm Help Impact block (todo: data-import-studio değil; yeni `resolution-approval` topic gerekirse?)

---

## Cross-references

- Card scope is parallel to [PM-11](../PRODUCT_PLANNING_MATRIX.md) capability.
- Backend modeling references: `prisma/schema.prisma:33` (CaseStatus), `:1125` (CaseActivity), `:1293` (CaseNotification), `:751` (Team), `:772` (Person).
- Backend behavior references: `server/db/caseRepository.js:1763` (transitionStatus), `:2595` (notifyWatchers).
- Help standard: [docs/IN_PRODUCT_HELP_STANDARD.md](../IN_PRODUCT_HELP_STANDARD.md) — Phase 1 ship'inde yeni topic gerekirse `resolution-approval` eklenecek.
- Protocol: [docs/AGENTIC_PLANNING_PROTOCOL.md](../AGENTIC_PLANNING_PROTOCOL.md) — bu card §⑨ Implementation Prompt'a hazır (§22).
