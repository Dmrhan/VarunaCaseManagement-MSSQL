# WR-ACTION-CENTER — Varuna Action Center

> **Status:** Planning Card (Phase 0) — no code, schema, or migration changes in this document.
> **Owner:** Ürün direktörü (connect@univera.com.tr)
> **Created:** 2026-05-28
> **Cross-reference:** WR-D4/D3 Level A (Resolution Approval + Notification Rules) is the upstream dependency — Action Center turns those features into actionable inbox items. See `docs/planning_cards/WR-D4-D3-RESOLUTION-APPROVAL-NOTIFICATION-RULES.md` and `docs/qa/WR-D4-D3-LEVEL-A-MANUAL-QA.md`.

---

## 1. Executive Summary

### Vizyon — "Action Center"

Action Center, Varuna'da bir bildirim listesi değildir. Bir **rol bilen operasyonel iş kuyruğu**dur. Sorduğu soru hep aynı:

> *"Şu an benden ne yapmam bekleniyor?"*

Klasik bildirim çanları "ne oldu?" sorusunu cevaplar. Action Center "ne yapmalıyım?" sorusunu cevaplar. Aradaki fark hem ürün hem operasyon değerinin neredeyse tamamıdır.

**Ana fikirler:**

- **Action-first, not message-first.** Her satır, bir eylemle ilişkilidir — onaylamak, cevap vermek, yönlendirmek, kapatmak, manuel iletişim notu eklemek. Salt "bilgilendirme" satırları (FYI) ayrı bir banda ya da arşive iner.
- **Role-aware.** Agent, Supervisor, CSM, Admin, SystemAdmin, Team Lead — her rol farklı bir varsayılan inbox görür. Aynı kullanıcı birden çok rolse, rol seçici ile bağlamlar arası geçer.
- **Connected.** WR-D4/D3 onay akışı, NotificationDispatch manuel iletişim, SLA risk sinyalleri, @mention, watcher event'leri, transfer/atama, pattern alert — hepsi tek tip "ActionItem" çatısında toplanır.
- **Auditable.** Her bir ActionItem'ın "neden ben görüyorum?", "ne zaman teslim aldım?", "ne kararla kapattım?" cevapları izlenebilir. WR-D4/D3 ile getirilen audit invariantları (Sent vs Suppressed asla revert edilemez) Action Center'da görsel olarak da net taşınır.
- **Implementable.** İmkansız "AI yönlendirir" gibi vaatlere değil; mevcut WR-D4/D3 modeline çatı çakarak başlanır. AI/scoring ek katman olarak ileride binebilir.

### Sınır (deliberate)

Action Center bir **dispatcher** değildir. Mesaj göndermez, e-posta atmaz. Aktif gönderim hâlâ Phase 4 (Level B) kapsamındadır ve bu planlama kartının dışındadır.

Action Center bir **iş yapma motoru** da değildir. Onayı kendisi vermez, vakayı kendisi çözmez; sadece operatörü doğru ekrana, doğru aksiyonla, doğru zamanda gönderir.

### Hedef değer (rol bazlı)

| Rol | Bugün ne yapıyor? | Action Center ile ne değişir? |
|---|---|---|
| **Agent** | Vaka listesi + mention bell'i tarayıp ne çözeceğine kendi karar veriyor | "Bana atanan + SLA riskli + onayım bekleyen" tek bir prioritize edilmiş kuyrukta |
| **Supervisor** | Vaka transferi, pattern alert ve customerless queue'yu ayrı ayrı geziyor | Onay verilecek vakalar, transfer talepleri, pattern alarm'lar, risky cases — tek inbox |
| **CSM** | Müşteri-facing dispatch'i CaseDetail'de manuel kapatıyor | Bekleyen müşteri iletişim kapatmaları + opt-out warning'leri tek listede |
| **Admin** | Politika/kural drift'leri ve audit log'u ayrı sayfalardan görüyor | Yapılandırma sağlığı + Suppressed/Failed dispatch trendi + rate-limit hit'leri tek panel |
| **Team Lead** | Onaylayıcı atandığını ancak CaseDetail'e gidince anlıyor | "My Pending Approvals" doğrudan home page'de, badge sayısı + kuyruk |

Yukarıdaki tabloda "Team Lead" satırı bugün **en akut boşluktur** — WR-D4/D3 Level A bir onaylayıcı atadığında, o kişi şu an kendisinden onay beklendiğini ancak vaka detayına gidince fark ediyor (bkz. §3 Item 12). Action Center'ın Phase 1 hedefi bu boşluğu kapatmaktır.

---

## 2. Global Product Pattern Review

Aşağıdakileri yüzeysel kopyalamak için değil, *çıkarılabilir prensipleri Varuna'ya çevirmek* için inceledik. Mimari kararlar §5 ve §10'da bu prensiplere atıfla yapılır.

### 2.1 Inceleme

**Zendesk — Views, Side Conversations, Triggers**
- "View" konsepti: kullanıcının sürekli geri döndüğü filtreli vaka listesi (Saved Search'ün operasyonel hali). Anahtar: aynı view'a tekrarlanan açılışlar pahalı olmamalı (cache + count badge).
- Side conversations: bir vakaya bağlı paralel iletişim track'i. Notification kanalı vs case timeline kanalı ayrımı.
- Triggers: server-side koşullu otomasyon (event → action). Varuna'da WR-D3 NotificationRule'lar bunun yerine geçer.

**Jira Service Management — Queues + Approvals**
- "Queue" first-class entity: bir admin "Çözüm Onayı Bekleyen" gibi rol-spesifik kuyruklar tanımlar; ekibin tamamı aynı önceliklendirmeyi görür.
- Approval'lar Issue'nun side panel'inde değil, ayrı bir **Approvals tab**'ında ve **Approval Inbox**'ta gösterilir — Action Center için kanonik referans.

**Salesforce — Console + Utility Bar + Task Feed**
- Utility bar persistent: kullanıcı vakadan vakaya geçerken inbox kaybolmaz. Floating notification panel.
- Task feed: bir kaydın altında biriken aksiyon istekleri zaman damgalı.

**Linear / GitHub Notification Inbox**
- "Notification" ≠ "Message". Linear notification öğesi mention, status change, assigned, sub-issue updated gibi event tiplerini birleştirir.
- **Read vs Unread vs Done** üçlüsü kritik: "okudum" haritası "halletim"den farklıdır. Action Center bu üçlüyü almalı.
- **Snooze:** notification ileri tarihe ertelenebilir; tetik döner.
- **Group by source:** aynı issue'ya ait birden çok notification tek satıra collapse olur (avatar stack + "+3 more").

**Slack — Actionable Notifications**
- "Approve / Reject" butonu mesajın içinde. Mesaja inanılmaz hız. Yan etki: operatör mesajdan ayrılmadan karar verir. Varuna için Action Center satırında "tek-tık" mini-actions imkânı.
- **Thread modeli:** Action Center satırı vakaya inmeden çabuk preview için sub-feed gösterebilir.

**ServiceNow — Work Queues + Approvals**
- "My Approvals" widget her dashboard'un parçası. Approver kendine atanmış approval'ları kuyrukta görür.
- "Reason" / "Why" sütunu: neden burada gösteriliyor? (örn. "Çünkü TeamLead politikası eşleşti").
- Bulk approve / bulk decline.

### 2.2 Çıkarılabilir Prensipler → Varuna Gereksinimleri

1. **Action-first vs message-first.** ActionItem'ın `actionRequired: boolean` ayrımı şart. Varuna'da Agent'a düşen bir mention "FYI" ise farklı band'da, kendine atama gelen bir vaka "must act" band'ında durmalı.

2. **Object-anchored grouping.** Aynı vakaya birden fazla event geliyorsa (örn. mention + transfer + approval bekleme) Action Center'da tek satıra collapse olmalı; "açınca" sub-feed gösterir. Tek vakaya 5 satır harcamayız.

3. **Read / Unread / Done** üçlüsü — bkz. §6 lifecycle.

4. **"Why am I seeing this?"** her satır için tek cümlelik açıklama: "Bu vakanın atanmış Takım Lideri sensin" / "Süpervizör olarak SLA ihlali izlenebilir" / "Müşteri opt-out olduğu için dispatch suppress'lendi".

5. **Bulk operations + keyboard navigation.** j/k satır gez, e=arşivle, a=onayla, m=Mark done. Power user için sine qua non.

6. **Snooze + Follow-up.** Action Center satırı ileri tarihe ertelenebilir; o tarih gelince yeniden "actionable" olur.

7. **Notification ≠ Task ≠ Audit.** Üç farklı kavram (bkz. §4) — tek tip ActionItem altında ama her birinin lifecycle'ı farklı.

8. **Role-aware default view.** Login eden Agent farklı, Supervisor farklı default kuyruğu görür. Her rol için bir "default view" tanımlı, kullanıcı override edebilir.

9. **Inbox bandwidth control.** Spam'ı önlemek için ana inbox'ta birikimi sınırlandır (örn. her 10 dk'da bir aggregate). FYI events biriksin, "must act" hemen patlar.

10. **Explainable suppression.** Bir satır neden Suppressed/Done/Arşiv'de olduğu görünür (Slack mesaj action'ında olduğu gibi).

---

## 3. Current-State Audit

Bu bölüm Varuna'da **bugün** olan, Action Center'ın üzerine kuracağı veya tamamen replace edeceği yüzeyleri tek tek dökümante eder. Tüm referanslar 2026-05-28 commit `3abd6b6` (main) bazında alınmıştır.

### 3.1 CaseNotification (mevcut "bell" deposu)

- **Model:** `prisma/schema.prisma:1452-1464`
  - `id`, `caseId`, `companyId`, `eventType` (`CaseAssigned` / `SLAWarning` / `SLAViolation` / `watcher_update` / `watcher_added` / `note_reaction`), `channel` (`InApp`), `recipient`, `payload` (Json), `sentAt`, `readAt`.
- **Routes:**
  - `GET /api/cases/me/notifications/unread` → `server/routes/cases.js:882-891`
  - `POST /api/cases/me/notifications/seen` → `server/routes/cases.js:899-910` (drawer açıldığında veya "mark all read" ile).
- **Polling:** 60s sabit (`MentionBellBadge.tsx:45-217`); custom event `app:notifications-changed` ile manuel refresh.
- **Boşluk:** Yalnız "read/unread" ikilisi var. "Done" / "Snoozed" / "Action required vs FYI" ayrımları yok. Group-by-case yok; aynı vaka için 5 satır yazılabiliyor.

### 3.2 CaseMention

- **Model:** `prisma/schema.prisma:1561-1594` — `mentionedUserId`, `seenAt` null = unread.
- **Routes:**
  - `GET /api/cases/me/mentions/unread` → `server/routes/cases.js:865-873`
  - `POST /api/cases/:id/mentions/seen` → `server/routes/cases.js:849-857` (vaka açıldığında auto).
- **UI:** `MentionBellBadge.tsx` mention + notification akışını birleşik tek drawer'da gösteriyor.
- **Boşluk:** Mention bir "action" değil, FYI sinyali. Bu Action Center modeli için doğal `actionRequired=false` örneğidir.

### 3.3 CaseWatcher + notifyWatchers

- **Model:** `prisma/schema.prisma:1637-1654` — `(caseId, userId)` unique.
- **Routes:** `POST/DELETE /api/cases/:id/watchers` (cases.js:533-604).
- **notifyWatchers helper:** `server/db/caseRepository.js:2610-2637` — addNote (line 903), status transitions (1020, 1207, 1349, 1872, 2006), assignment & escalation değişimlerinde CaseNotification yazıyor.
- **Boşluk:** Watcher event'ler hep "FYI" tipindedir; Action Center'ın FYI bandına otomatik düşer. Action gerektirenler ayrılmalı.

### 3.4 CaseReminder / Snooze

- **Model:** `prisma/schema.prisma:1159-1177` — `userId`, `caseId?`, `remindAt`, `message`, `sentAt`.
- **Snooze flow:** `SnoozeModal.tsx:56-260` — preset'ler (1 saat / yarın 9 / pazartesi 9 / custom), `SnoozeReason` enum (CustomerWillCall / WaitingThirdParty / Reminder).
- **Cron:** `POST /cron/snooze-wakeup` (cases.js:23-41), 5dk UptimeRobot tetiği.
- **Calendar:** `GET /api/my/calendar` (my.js:100-137).
- **Reuse potansiyeli:** Action Center satırının snooze'u CaseReminder ile aynı altyapıyı kullanmalı (DRY). Reminder = case-anchored ActionItem'a denk düşüyor.

### 3.5 MyHomePage Dashboard (mevcut landing)

- **Endpoint:** `GET /api/my/dashboard` → `server/db/myRepository.js:451-847` (in-memory cache 30s).
- **Component:** `src/features/my/MyHomePage.tsx:76-150`.
- **Widget envanteri:**
  1. **Urgent signals** — SLA risk + unread mentions + active pattern alerts (sidebar badge + main card)
  2. **Assigned to me** (KPI tile + drawer)
  3. **Resolved today**
  4. **Snoozed**
  5. **Follow-up today** (CaseCallLog'tan)
  6. **Today's calendar** (max 6 — reminder + snooze wakeups + SLA due)
  7. **My top cases** (max 5 — SLA + priority sıralı)
  8. **"Pending approvals"** widget — *AMA bu adı taşımasına rağmen yapay AI heuristic'i*: SLA <6h, overdue follow-up. **WR-D4/D3 approval inbox'ı DEĞİL.**
- **Kritik gözlem:** MyHome `pendingApprovals` adıyla yanıltıcı bir widget var (heuristic suggestions). Gerçek "kendime atanmış çözüm onayı" inbox'ı yok. Action Center'ın Phase 1'i bu widget'ı *gerçek* CaseResolutionApproval verisiyle besler veya yan başka bir widget ekler — naming çatışması §16'da resolved edilir.

### 3.6 CaseResolutionApproval — UI surface

- **Model:** `prisma/schema.prisma:1417-1450` — `expectedApproverPersonId` indexed `(expectedApproverPersonId, state)`, `state` = `Pending`/`Approved`/`Rejected`.
- **Endpoints:** `/api/approvals/cases/:caseId/{submit,approve,reject}` (`server/routes/approvals.js:213-253`).
- **UI:** Sadece CaseDetail'de `ResolutionApprovalCard` (CaseDetail içinde). Inbox veya bell-level görünürlük YOK.
- **Bell entegrasyonu:** Submit edildiğinde `notifyWatchers` fire ediyor ama o sadece watcher'lara yazıyor; **resolved approver'a otomatik bir CaseNotification yazılmıyor**.
- **Kritik gap:** §3.5 ile aynı — approver kendine atandığını ancak başka kanaldan (mention / watcher / vaka listesi tarama) öğreniyor.

### 3.7 NotificationDispatch (WR-D3 Phase 2 audit table)

- **Model:** WR-D4/D3 Phase 2 ile `NotificationDispatch` tablosu eklendi.
- **Admin viewer:** `GET /api/approvals/notification-dispatches` (`server/routes/approvals.js:377-391`) — Supervisor/CSM/Admin/SystemAdmin.
- **Case-scope:** `GET /api/approvals/cases/:caseId/dispatches` (`server/routes/approvals.js:399-411`) — herkes case scope'unda görür.
- **Manuel confirm:** `POST /api/approvals/dispatches/:id/manual-confirm` (Agent+, deliveryNote zorunlu).
- **UI:** `CommunicationDispatchCard` CaseDetail'de + `NotificationDispatchesPage` admin viewer'da. **Inbox-level görünürlük YOK** — CSM'nin "bekleyen müşteri-facing dispatch'lerim" listesi yok.

### 3.8 Role model + Per-Company Pivot

- **Enums:** `UserRole` (`prisma/schema.prisma:201-208`) — `Agent`, `Backoffice`, `Supervisor`, `CSM`, `Admin`, `SystemAdmin`. `CompanyRole` (216-221) — pivot için.
- **Person.isTeamLead:** `prisma/schema.prisma:804` boolean default false. Onay routing'i için kritik.
- **UserCompany pivot:** kullanıcı bir tenant'ta farklı rolle görünebilir (multi-tenant).
- **Action Center implikasyonu:** Inbox view'ları `req.user.allowedCompanyIds + role + personId` ile filtrelenir (§9).

### 3.9 MentionBellBadge — birleşik bildirim drawer'ı

- **Component:** `src/features/cases/components/MentionBellBadge.tsx:45-217`.
- **Davranış:** Bell ikonu sayaç + drawer; mention + CaseNotification birleşik liste, type ikonuna göre rozetler.
- **Polling:** 60s + 4 custom event (`app:notifications-changed`, `app:mentions-changed`, `app:patterns-changed`, `app:calendar-changed`).
- **Action Center pozisyonu:** Bu bileşen Action Center bell ikonu için ya genişler, ya yerini "ActionInboxBell" / "ActionInboxDrawer" çiftine bırakır. §10'da karar.

### 3.10 App.tsx top-bar polling envanteri

- **Pattern Alert badge:** 60s poll + `app:patterns-changed` event (`src/features/analytics/PatternsPage.tsx:60`).
- **Calendar reminder count:** 600s (10dk) poll + `app:calendar-changed` event.
- **MentionBellBadge:** kendi 60s poll'ü.
- **Toplam:** Şu an 3 ayrı 60s/10dk polling timer + 4 custom event birbirinden bağımsız çalışıyor. Action Center, *tek bir poll* ile bu üçünü besleyebilir (badge counts + items) — performans kazancı (§12).

### 3.11 PatternAlert / Urgent signals

- **Model:** `prisma/schema.prisma:1511-1535` — `category`, `caseCount`, `windowMinutes`, `caseIds[]`, `status` (active/dismissed).
- **Cron:** 15 dk'da bir grup; ≥5 vaka aynı kategoride → alarm.
- **UI:** `PatternsPage.tsx:29-163` (Supervisor+).
- **Action Center entegrasyonu:** Pattern alert kanonik bir ActionItem'dır (Supervisor için). `kind='pattern_alert'`, `objectType='PatternAlert'`, `objectId=alert.id`.

### 3.12 **Approver Inbox — YOK (kritik gap)**

- WR-D4/D3 Level A submit/approve/reject akışı çalışıyor; ama bir Team Lead/Supervisor/Admin/SystemAdmin için "kendime düşen Pending onaylar" kuyruğu YOK.
- `CaseResolutionApproval.expectedApproverPersonId` indexed (Phase 1) — yani **veri var**, sadece UI ve route yok.
- Action Center'ın Phase 1'i bu gap'i kapatır.

---

## 4. Conceptual Model — Notification vs Action Item vs Task vs Approval vs Dispatch vs System Alert

Operatörün karıştırmaması gereken 6 farklı kavram var. Action Center hepsini tek **çatı** altında gösterir ama lifecycle ve gen rule'ları farklı kalır.

### 4.1 Notification (bilgilendirme)

**Tanım:** Olay bildiren, eylem gerektirmeyen mesaj. *"X oldu, haberin olsun."*
**Örnek:** Watcher'ı olduğun vakanın statüsü değişti; bir not eklendi; mention aldın.
**Özellikler:**
- `actionRequired: false`
- Mark-as-read ile kapanır; ek aksiyon yok.
- Bell'de FYI band'ına düşer.
- Lifecycle: `Unread → Read → (auto-archive 30d)`

### 4.2 Action Item (aksiyon istemi)

**Tanım:** Operatörden bir eylem bekleyen iş öğesi. *"X yapman gerekiyor."*
**Örnek:** Sana atanan vakada SLA risk var; sana düşen onay var; bekleyen manuel iletişim kapatma var; reject olmuş onay için revize gerekiyor.
**Özellikler:**
- `actionRequired: true`
- Mark-as-read **yetmez**; aksiyon (approve/handle/snooze/dismiss-with-reason) gerekir.
- Bell'de "Aksiyon Gerek" band'ında.
- Lifecycle: `Pending → InProgress → Done` (veya `Pending → Snoozed → Pending`).

### 4.3 Task (görev)

**Tanım:** Manuel olarak (kullanıcı veya supervisor tarafından) atanmış iş kalemi. *"Bunu yap."*
**Örnek:** Supervisor "müşteriyi telefonla ara, geri bildirim al" diye Agent'a manuel task düşürdü; QA review'u bir vakaya işaretlendi.
**Özellikler:**
- `actionRequired: true` ama Action Item'dan farkı: **kullanıcı kaynaklı**, sistem değil.
- Lifecycle: ActionItem ile aynı.
- Phase 2+ (bu kart Phase 1'de "Task" entity'sini açmaz; ActionItem yeterli — *task* = `kind='manual_task'`).

### 4.4 Approval (CaseResolutionApproval)

**Tanım:** Resmi onay isteği (kanonik audit invariantları ile). *"Onayla / Reddet."*
**Örnek:** Agent çözüm önerdi; politika Team Lead onayı istiyor.
**Özellikler:**
- WR-D4 modeli kanonik. Action Center bir Approval için `ActionItem(kind='approval_pending', objectType='CaseResolutionApproval', objectId=approval.id)` yazar.
- Lifecycle özel: Approve veya Reject **kendileri** Approval state'ini değiştirir, sonra ActionItem Done olur. **Açıkça farklı:** ActionItem Done değil, *Approval Decision Made* → ActionItem.state=Done with `outcome='approved'`/`'rejected'`.

### 4.5 Customer Communication Dispatch (NotificationDispatch)

**Tanım:** Müşteriye gidecek mesajın audit kaydı (WR-D3 Phase 2). Manuel-confirm tek tamamlama yolu.
**Özellikler:**
- Bir Pending dispatch için Action Center `ActionItem(kind='dispatch_manual_confirm', objectType='NotificationDispatch')` yazar.
- Manual confirm gerçekleşince ActionItem Done.
- Suppressed dispatch'ler ActionItem'a düşmez (Sent değiller ama actionable da değiller).

### 4.6 System Alert

**Tanım:** Pattern alert, audit anomalisi, "rate-limit aşıldı", "AI usage spike" gibi yapılandırma/sistem sağlığı sinyalleri.
**Örnek:** PatternAlert ≥5 vaka 1 saat içinde aynı kategoride; "rule X saatlik üst sınıra ulaştı"; "20 dispatch Suppressed/no_channel_available son 24h".
**Özellikler:**
- Genelde Supervisor/Admin/SystemAdmin için.
- Lifecycle: `Active → Dismissed` (audit kalır).
- Action Center'da rol-spesifik band'da.

### 4.7 Watcher Event

**Tanım:** Watcher olunan vakanın aktivitesi (kanonik FYI).
**Özellikler:**
- §4.1 Notification ile aynı kategori; ayrı tutmaya gerek yok.
- `kind='watcher_event'` ile etiketlenir, FYI band'ında.

### 4.8 Karşılaştırma matrisi

| Kavram | actionRequired? | Otomatik üretilir mi? | Müşteri/operatör? | Lifecycle terminal |
|---|---|---|---|---|
| Notification (mention, status change, watcher) | hayır | evet (event) | operatör | Read |
| Action Item | evet | evet (event veya policy match) | operatör | Done |
| Task | evet | hayır (manuel) | operatör | Done |
| Approval | evet | otomatik snapshot, manuel decision | operatör | Decided |
| Dispatch | evet (manuel-confirm bekleyenler için) | otomatik (rule fire) | müşteri (operatör manuel kapatır) | Sent / Suppressed |
| System Alert | evet (rol bazında) | otomatik (cron / threshold) | operatör (admin) | Dismissed |
| Watcher Event | hayır | otomatik | operatör | Read |

### 4.9 Kanonik kelime seçimi

UI'da kullanılacak Türkçe etiket seti (planning-time karar; §10'da örnek):

- **Eylem Bekliyor** → `actionRequired=true`, `state=Pending`
- **Üzerinde Çalış** / **Aç** → ActionItem'ı InProgress'e taşır (örn. case detail'e gidince auto)
- **Hallettim** → Manuel Done (örn. dispatch manual-confirm)
- **Yok Say** → Dismiss (audit nedeni zorunlu, opsiyonel)
- **Ertele** → Snooze
- **Sadece bilgi** → FYI band

---

## 5. Recommended Domain Model

### 5.1 Yeni model — `ActionItem`

Tek tablo; çoklu kind, polymorphic object referansı.

```prisma
enum ActionItemKind {
  approval_pending          // CaseResolutionApproval pending → expectedApprover
  approval_decided          // approve/reject sonrası submitter'a "kararın çıktı" FYI
  case_assigned             // case assignedPersonId değiştiğinde yeni atanan
  case_transferred          // CaseTransfer hedef Agent
  case_returned_to_assignee // reject → ReturnToAssignee path
  case_sla_at_risk          // SLA <X saat
  case_sla_breach           // SLA ihlal
  mention                   // CaseMention
  watcher_event             // notifyWatchers FYI
  dispatch_manual_confirm   // NotificationDispatch Pending+Manual
  dispatch_review_needed    // Suppressed/no_channel_available — operatör manuel ulaştırmalı
  pattern_alert             // PatternAlert active
  manual_task               // Phase 2+ supervisor → agent task
  system_alert              // admin/SystemAdmin yapılandırma sağlığı
}

enum ActionItemState {
  Pending        // Yeni; actionable
  InProgress     // Operatör vakaya gidince auto veya manuel
  Snoozed        // İleri tarihe ertelendi
  Done           // Tamamlandı (outcome opsiyonel)
  Dismissed     // Operatör kasıtlı yok saydı
  Expired        // Action geçerliliği gitti (örn. approval başkası tarafından onaylandı)
}

model ActionItem {
  id          String            @id @default(cuid())
  companyId   String            // multi-tenant scope
  userId      String            // hedef kullanıcı
  personId    String?           // Person bağlıysa snapshot (TeamLead routing için)
  kind        ActionItemKind
  state       ActionItemState   @default(Pending)
  actionRequired Boolean        @default(true)  // false → FYI band

  // Polymorphic object reference (denormalized — Action Center detail card'ı open eder)
  objectType  String?           // 'Case' | 'CaseResolutionApproval' | 'NotificationDispatch' | 'CaseMention' | 'PatternAlert'
  objectId    String?

  // Snapshot fields for inbox rendering without join
  caseId      String?
  caseNumber  String?
  caseTitle   String?
  caseCompanyId String?

  // Routing / dedup
  generatedBy   String?         // 'rule:<ruleId>' | 'policy:<policyId>' | 'system' | 'user:<userId>'
  groupKey      String?         // collapse aggregation: '<caseId>:<kind>' or custom
  dedupKey      String?         // idempotency: '<companyId>:<userId>:<kind>:<objectId>'
  priority      Int             @default(50)   // 0..100; SLA-breach 90, mention 30

  // "Why am I seeing this?" explainability — single human-readable sentence
  reasonLabel   String

  // Lifecycle timestamps
  createdAt     DateTime        @default(now())
  firstSeenAt   DateTime?       // ilk drawer açılışında stamp
  snoozedUntil  DateTime?
  doneAt        DateTime?
  doneByUserId  String?
  doneOutcome   String?         // 'approved'|'rejected'|'manual_confirmed'|'arşivlendi'

  // Optional structured note for Done/Dismissed
  closeNote     String?

  @@unique([dedupKey])
  @@index([userId, state, createdAt(sort: Desc)])
  @@index([userId, state, actionRequired])
  @@index([groupKey, state])
  @@index([companyId, kind, state])
}
```

**Notlar:**

- `dedupKey` partial unique — aynı `(userId, kind, objectId)` için ikinci ActionItem upsert ile yeniden yazılmaz.
- `groupKey` aynı objeye birden çok event geliyorsa Action Center UI'da collapse için.
- `priority` salt sıralama için; Action Center kullanıcıya sayı göstermez.
- `reasonLabel` zorunlu — "Çünkü ..." cümlesi (örn. "Çünkü bu vakanın atanmış Team Lead'isin.").

### 5.2 Mevcut modeller — değiştirmiyoruz

WR-D4/D3 modellerinin **hiçbiri** değişmiyor:
- `CaseResolutionApproval` — kaynak gerçek
- `NotificationDispatch` — audit invariantları korunur
- `CaseNotification` — Phase 1'de paralel çalışmaya devam eder (Phase 2'de gradual migration §17)
- `CaseMention`, `CaseWatcher`, `CaseReminder`, `PatternAlert` — değişmiyor

### 5.3 İleri kavramlar (forward-compat; Phase 1'de açılmaz)

- **`ActionView`** — admin'in saved view tanımladığı queue. Adı dahil Jira queue'larından geliyor. Phase 1'de hard-coded role-default view; Phase 2+'da custom view CRUD.
- **`ActionRule`** — system-level config: "Hangi event hangi kullanıcıya ActionItem üretsin?" — Phase 1'de hard-coded; Phase 2+ admin UI.
- **`ActionItemHistory`** — her state geçişi için audit log (Approval audit modeline benzer). Phase 1'de basit `doneAt`/`doneByUserId`/`doneOutcome` yeterli; Phase 2 ayrı tablo gerekirse.

---

## 6. Action Item Lifecycle

```
                        +---- Snoozed ----+
                        |        ^         |
                        |        | wake    |
                        v        |         v
   (event) → Pending → InProgress → Done
              |                       ^
              +------ Dismissed ------+
              |
              v
            Expired
```

### 6.1 State semantiği

| State | Anlamı | Kim değiştirebilir |
|---|---|---|
| `Pending` | Yeni üretildi; inbox'ta görünür; aksiyon bekliyor (`actionRequired=true`) veya FYI (`actionRequired=false`) | Sistem üretir; kullanıcı sadece taşır |
| `InProgress` | Operatör açtı/üzerine çalışıyor. Auto-set: ilgili vaka açıldığında. Manuel-set: "Çalışıyorum" işareti | Sistem (case open) veya user |
| `Snoozed` | `snoozedUntil` tarihine kadar gizli | User (kendi item'ını) |
| `Done` | Tamamlandı. Audit'te kalır | User veya sistem (örn. başkası onayladıysa) |
| `Dismissed` | Yok sayıldı; aksiyon alınmadı; audit'te neden var | User (kasıtlı) |
| `Expired` | Geçerliliği gitti (örn. approval başka birinde tamamlandı, dispatch Suppressed olarak finalize oldu) | Sistem |

### 6.2 İlginç transitions

- **Pending → InProgress (auto):** Operatör action item'ın referansladığı vakayı CaseDetail'de açtığında. Stamp `firstSeenAt`.
- **Pending → Done (auto via sibling):** Approver A pending bir approval'ı onayladığında, aynı Approval için B/C/D approver'larına atanmış ActionItem'lar **Expired** olur (kim onayladı görünür).
- **Pending → Snoozed:** Kullanıcı drawer'da snooze butonuyla; aynı Reminder altyapısını kullanır (§3.4).
- **Snoozed → Pending (wake):** Cron 5dk poll + `snoozedUntil <= now` → state geri Pending.
- **Done outcome:**
  - `approval_pending` ActionItem'ı Done olunca outcome=`approved` veya `rejected`
  - `dispatch_manual_confirm` Done olunca outcome=`manual_confirmed`
  - generic mention/watcher Done olunca outcome=`acknowledged`
- **InProgress → Expired:** Approval başka biri tarafından (override path) verildi → Expired with note.

### 6.3 Idempotency

- `(userId, kind, objectId)` üzerinden upsert. Aynı approval için ikinci kez ActionItem yazılmaz; sadece updated.
- Bir CaseTransfer hedefi değişirse: eski hedef için ActionItem Expired, yeni hedef için Pending üretilir.

---

## 7. Generation Rules — Hangi event hangi ActionItem'ı kime üretir?

Tablo, Phase 1 generation rules için kanonik kontrat. Tüm üretim **fire-and-forget** (caller bloklanmaz).

| Event / Tetik | ActionItem kind | Hedef kullanıcı(lar) | Reason label | Priority |
|---|---|---|---|---|
| `CaseResolutionApproval` insert (state=Pending) | `approval_pending` | `expectedApproverPersonId → Person.user` | "Çünkü %politika% kapsamında onaylayıcısın" | 70 |
| Approval state → Approved/Rejected | `approval_decided` (FYI) | `submittedByUserId` | "Onay kararın çıktı: %outcome%" | 30 |
| Approval Approved (multi-approver scenario) | (mevcut diğer pending approver ActionItem'larını Expired) | diğer eligible approver'lar | "Başka onaylayıcı kararı verdi" | n/a |
| `Case.assignedPersonId` change → atama | `case_assigned` | yeni assigned Person.user | "Sana atanan yeni vaka" | 50 |
| `CaseTransfer` insert | `case_transferred` | hedef Person.user | "Bir vaka sana transfer edildi" | 60 |
| Approval rejected with `behavior=ReturnToAssignee` | `case_returned_to_assignee` | önceki assignee | "Çözüm onayı reddedildi — revize gerek" | 70 |
| SLA `<6h` (cron) | `case_sla_at_risk` | assignedPerson | "Yanıt/Çözüm süresi <6 saat" | 80 |
| SLA breach | `case_sla_breach` | assignedPerson + assignedTeamLead | "SLA ihlali" | 90 |
| `CaseMention` insert | `mention` (FYI) | mentioned user | "Bir notta @etiketlendin" | 30 |
| `notifyWatchers` fire | `watcher_event` (FYI) | watcher set | "İzlediğin vakada güncelleme" | 20 |
| `NotificationDispatch` insert with state=Pending + mode=Manual + audience=customer_primary_contact | `dispatch_manual_confirm` | case.assignedPerson (varsayılan) | "Müşteriye iletilecek mesajı manuel kapat" | 65 |
| `NotificationDispatch` insert with state=Pending + suppressionReason=`no_channel_available` | `dispatch_review_needed` | case.assignedPerson + CSM | "Müşteriye yapılandırılmış kanal yok — manuel ulaş" | 75 |
| `PatternAlert` insert (status=active) | `pattern_alert` | tenant Supervisors | "Pattern: 5+ vaka 1 saatte aynı kategoride" | 70 |

### 7.1 Generation hook'ları (mevcut kod nereye dokunur — Phase 1 implementation reference)

- **Approval submit hook'u:** `server/db/approvalRepository.js:submitApproval` zaten `emitNotificationEvent('resolution_submitted', ...)` çağırıyor. Aynı yere `emitActionItem('approval_pending', ...)` ekle.
- **Approval approve/reject hook'u:** aynı dosya, `approveApproval`/`rejectApproval` sonu.
- **Case assign:** `caseRepository.js:update` patch içinde `assignedPersonId` değişimi.
- **CaseTransfer:** `caseRepository.js:transferCase` sonrasında.
- **SLA cron:** mevcut SLA monitör cron'a hook (henüz cron varsa — yoksa Phase 2'ye).
- **CaseMention:** `addNote` mention parse path'i.
- **NotificationDispatch insert:** `notificationRepository.js:emitEvent` create sonrasında, audience=customer_primary_contact + mode=Manual + state=Pending koşuluyla.
- **PatternAlert:** `analytics` patterns cron'unda.

### 7.2 "Çok küçük olay" filtresi

Watcher event'ler ve mention'lar yüksek hacimli. Phase 1'de ActionItem üret ama:
- `actionRequired=false`
- `priority<=30`
- UI FYI band'ında gösterilir
- Default inbox view'da görünmez; "Tümü" view'unda görünür

Bu sayede mention/watcher gürültüsü ana inbox'ı kirletmez.

---

## 8. Aggregation, Deduplication, Grouping

### 8.1 Idempotency anahtarı (dedup)

`dedupKey = <companyId>:<userId>:<kind>:<objectId>` — DB unique partial index.

Aynı approval için ikinci submit-event ActionItem'ı upsert eder (state=Pending zorla, `updatedAt` artar). Bir vakaya transfer + atama aynı anda gelirse iki ayrı `kind` olduğu için iki satır olur — bu doğru, ikisi de farklı eylem.

### 8.2 Group key (UI collapse)

`groupKey = <caseId>:<kind>` veya `<objectId>:approval`.

UI'da aynı vakanın aynı kind'ındaki birden çok ActionItem (örn. ardışık SLA warning + breach) tek satıra collapse olur. Açınca alt detay listesi.

### 8.3 "Quiet hours" / aggregate window

FYI ActionItem'lar (mention, watcher) için: kullanıcı 5dk içinde aynı vakaya 3+ FYI alırsa, bunlar bell sayacını 3× değil 1× yükseltir (aggregate). Detayda hepsi görünür.

Aktif ActionItem'lar bu kısıtlamadan muaf — sayaç patlamalı.

---

## 9. Role-Aware Filtering & Inbox Views

### 9.1 Phase 1 hard-coded default views

| Rol | Default Inbox | Saved view'lar (Phase 2+) |
|---|---|---|
| **Agent** | "Bana Atanmış" — `kind ∈ {case_assigned, case_transferred, case_returned_to_assignee, case_sla_at_risk, case_sla_breach, dispatch_manual_confirm, dispatch_review_needed, mention}`, `state=Pending` | "Bekleyen dispatch'lerim", "Bu hafta sonu beklenen reminderlar" |
| **Team Lead** (Person.isTeamLead) | Agent'ın hepsi + "Bekleyen Onaylarım" — `kind=approval_pending` and `personId=req.user.personId` | "Onay verdiğim son 30 gün" |
| **Supervisor** | "Bekleyen Onaylarım" + `kind=case_sla_breach` (team scope) + `pattern_alert` | "Takımımın SLA risklisi", "Manuel iletişim ihtiyacı" |
| **CSM** | `dispatch_manual_confirm` + `dispatch_review_needed` + assigned cases | "Müşteri-facing manuel" |
| **Admin** | `system_alert` + ekibin SLA breach'leri + Suppressed trend | "Kural çakışmaları" |
| **SystemAdmin** | Hepsi cross-tenant aggregate | n/a |

### 9.2 Inbox query shape

```
GET /api/action-center?
    view=default        (or 'all', 'fyi', 'snoozed', 'done')
    &state=Pending      (default; multi accepted)
    &kind=...           (optional comma-sep)
    &since=ISO          (optional, polling delta)
    &limit=50           (max 200)
```

Response: `{ items, total, badgeCounts: { pending, fyi, snoozed, done } }`.

### 9.3 "Why am I seeing this?" — açıklanabilirlik

Her satırın `reasonLabel`'ı vardır (`§5.1` zorunlu alan). UI tooltip ile gösterilir.

Örnekler:
- "Çünkü bu vakanın atanmış Takım Lideri sensin."
- "Çünkü Süpervizör olarak SLA ihlali izlenebilir kişisin."
- "Çünkü manuel iletişim kapatması Atanan Kişiye düşer."
- "Çünkü bu vakayı izliyorsun (watcher)."

### 9.4 Tenant scope

- Tüm query'ler `req.user.allowedCompanyIds` ile filtrelenir. ActionItem.companyId field'ı zorunlu.
- SystemAdmin global scope (mevcut Varuna convention).

---

## 10. UI/UX Design

### 10.1 Bell, Drawer, Inbox Page

Üç farklı entry point:

**A) Bell** (header) — minimum görünüm:
- Top-right'ta tek ikon + 2 badge: kırmızı (actionRequired=true Pending count) + gri (FYI Pending count). İki ayrı sayaç önemli — "kaç eylem bekliyor + kaç bildirim".
- Bell hover: tooltip "X eylem bekliyor".
- Click: Drawer açar.

**B) Drawer** (header'dan açılır panel):
- Üst: 4 tab — "Eylem Bekleyen" (default) / "Bildirimler" (FYI) / "Ertelenen" (Snoozed) / "Yapıldı" (Done, son 7 gün)
- Her satır: kind ikonu + `reasonLabel` + vaka kısa rozeti + zaman + mini-action(lar)
- Mini-action örnekleri:
  - `approval_pending` → [Onayla] [Reddet] [Vakayı Aç]
  - `dispatch_manual_confirm` → [Vakaya Git]
  - `mention` → [Vakaya Git]
- Bulk: shift-click range select, "Toplu Hallettim" / "Toplu Ertele"
- Klavye: j/k satır, e=arşiv/done, a=approve (varsa), m=mark done, .=snooze
- "Inbox'ı tam ekran aç" linki → /action-center

**C) Tam-ekran Inbox Page** (`/action-center`):
- Sol taraf: view picker (default + role-based saved views)
- Sağ taraf: list + filter chip'leri (kind, kim, zaman, state)
- Üst: arama (`search across reasonLabel + caseTitle + caseNumber`)
- Power user için.

### 10.2 MyHomePage entegrasyonu

Phase 1'de:
- Mevcut "Pending approvals" widget'ı **gerçek `kind=approval_pending`** verisiyle besle (heuristic yerine).
- Yeni widget: "Eylem Bekleyenler" — top 5 actionRequired Pending item.
- Mevcut Urgent signals card'ı Action Center pending count'a bağla.

Phase 2+:
- MyHomePage'de tam-ekran inbox embed varyantı (compact view).

### 10.3 CaseDetail entegrasyonu

- Bir vakayı açtığında, o vakaya ait kullanıcının Pending ActionItem'ları otomatik **InProgress** olur (`firstSeenAt` stamp).
- CaseDetail'in üstünde "Bu vakada sana atanan: ✅ Çözüm Onayı, 🔔 Mention" rozetleri.
- Sağ kolon'da kompakt ActionItem listesi (sadece bu vakaya ait).

### 10.4 "Why am I seeing this?" tooltip

Her ActionItem satırı `(i)` ikonuyla; tıklanınca `reasonLabel` + tetikleyen event metadata (örn. "policy: Yazılım onayı") gösterilir.

### 10.5 Bildirim band'ları (color tokens)

- **Eylem Bekleyen** — amber/orange
- **Bildirim (FYI)** — slate
- **Ertelenen** — blue
- **Yapıldı** — emerald
- **Yok Sayıldı** — rose-muted

### 10.6 Empty state

"Bekleyen eylem yok" — küçük yeşil onay görsel + "Tebrikler, inbox sıfır."

---

## 11. Realtime, Polling & Event Strategy

### 11.1 Phase 1: tek-poll konsolidasyonu

Şu an 3 ayrı polling timer çalışıyor (§3.10). Action Center Phase 1'de **tek endpoint** `GET /api/action-center/summary` (60s poll):

```json
{
  "actionRequired": 7,
  "fyi": 12,
  "snoozed": 3,
  "patternAlerts": 1,
  "newSinceLastFetch": 2
}
```

Mevcut bell'ler (MentionBell, PatternAlert badge, Calendar) bu tek endpoint'i tüketir; eski 3 poll kaldırılır. Custom event sayısı 4'ten 1'e (`app:action-center-changed`) düşer.

### 11.2 Phase 2+: Realtime opsiyonel

- Supabase Realtime / SSE / WebSocket pruva — gerçek-zaman push, ama Phase 1 için scope dışı (mevcut Varuna polling pattern'ı yeterli).
- Phase 2'de "newSinceLastFetch" delta query (`?since=ISO`) ile incremental fetch.

### 11.3 Mutation sonrası invalidation

ActionItem mutate eden tüm mutation (mark done, snooze, dismiss) yanıtında **fresh badge counts** döndürür ve client `app:action-center-changed` event dispatch eder. Diğer açık tab'lar `storage` event ile invalidate.

### 11.4 Snooze wakeup

`snoozedUntil <= now` kontrolü:
- A) Mevcut `runSnoozeWakeup` cron'una piggy-back: 5dk'da bir tüm ActionItem'larda da kontrol et.
- B) Polling tarafında lazy wake-up: kullanıcı inbox'ı her açtığında server-side `WHERE state=Snoozed AND snoozedUntil <= now` toplu update Pending'e çevirir (idempotent).

Phase 1: B (lazy) yeterli. Phase 2'de cron eklenir.

---

## 12. Performance & Architecture Gate

> Mandatory gate — implementation Planning Card'ı bu kısımdan **Pass** veya **Needs mitigation** verdict almadan PR aşamasına geçmez. Sistem bütçesi: 800-1000 eş zamanlı kullanıcı, 30-40 günlük yeni vaka/kullanıcı kohortu; donma/timeout yok.

### 12.1 Query maliyeti

- **List query:** `WHERE userId=X AND state=Pending ORDER BY priority DESC, createdAt DESC LIMIT 50`. Index `(userId, state, createdAt(Desc))` — O(log n + 50). 1000 user × 50 saatlik query ≈ 50K query/saat → 14 query/sec → cache'siz dahi rahat.
- **Count query (badge):** `WHERE userId=X AND state=Pending AND actionRequired=true` — aynı index'ten count. Cache'le (30s tenant-user TTL) — mevcut myDashboard pattern.
- **Generate cost:** Hot path event'lerinde (case assign, approval submit) bir ActionItem upsert ekler. P50 +5-10ms. Fire-and-forget olduğu için caller bloklanmaz.

### 12.2 Dispatch table büyümesi

- Aylık tahmin: 1 ortalama kullanıcı × 20 ActionItem/gün × 30 gün = 600/ay/user; 200 active user = 120K/ay.
- Year 1 ~1.5M satır. Index'ler `(userId, state, createdAt)` + `(groupKey, state)` — partial bile değil. Kabul edilebilir.
- **Retention:** Done satırlar 30 günden eski → ayrı `ActionItemArchive` tablosuna taşı (Phase 2 cron). Aktif tablo sadece son 30 gün Done + tüm Pending/Snoozed/InProgress.

### 12.3 Generation in-transaction vs fire-and-forget

- **WR-D4/D3 pattern (kanonik):** Approval/Dispatch event'leri `void emitEvent(...)` fire-and-forget. Aynı pattern ActionItem üretiminde de uygulanır.
- Caller mutation (örn. submitApproval) içine ActionItem üretimi konmaz — race condition + transaction büyür.

### 12.4 Cache stratejisi

- **Summary badge** (count): per-user 30s in-memory cache (mevcut myDashboard pattern).
- **List items**: cache yok; ucuz query.
- **Invalidation:** mutation tarafında user cache key'i drop.

### 12.5 N+1 koruması

- ActionItem satırı denormalize alanlar taşır (`caseNumber`, `caseTitle`, `caseCompanyId`, `reasonLabel`). Inbox listing **JOIN yok**.
- Sadece "Detayı aç" durumunda case fetch edilir.

### 12.6 Gate verdict pre-implementation

**Phase 1 verdict:** **Pass** (bu planlama kartı; gerçek verdict Implementation Planning Card'da yenilenir).
Riskler: snooze wakeup cron piggy-back'inin SLA cron'unu bozmadığını verify et; lazy wake-up race yok.

---

## 13. Security / RBAC / Tenant Scope

### 13.1 Tenant scope (mevcut convention)

- `ActionItem.companyId` zorunlu.
- Tüm query'ler `WHERE companyId IN (allowedCompanyIds)` zincirinden geçer.
- SystemAdmin global scope.

### 13.2 ActionItem mutation izinleri

| İşlem | İzin |
|---|---|
| Read (kendi item'ları) | Sahip kullanıcı |
| Read (başka kullanıcının item'ları) | Yok (SystemAdmin dahil — privacy bir prensip, audit gerekirse ayrı admin endpoint Phase 2+) |
| Mark Done / Snooze / Dismiss | Sahip kullanıcı |
| Bulk operations | Sahip kullanıcı |
| Generate (sistem) | Backend-only (kullanıcı endpoint'i yok) |
| Manual task assign (Phase 2+) | Supervisor → Agent |

### 13.3 Sensitive content (PII)

- ActionItem `caseTitle` / `reasonLabel` müşteri PII içerebilir (örn. müşteri adı). Loglara PII maskleme aynı standart.
- Mention metnindeki PII zaten CaseMention'da var; ActionItem ayrıca taşımaz — `reasonLabel` jenerik kalır ("Bir notta @etiketlendin").

### 13.4 Approval/Dispatch authority paralel

- ActionItem **decision yapmaz**. "Onayla" mini-action gerçekte `POST /api/approvals/:id/approve` çağırır; o endpoint'in `expectedApproverPersonId` ya da SystemAdmin override authority guard'ı aynen geçerli.
- ActionItem sadece kuyrukta görünür; izinsiz kullanıcı `[Onayla]` butonuna basamaz veya basabilir ama API 403 döner; bu durumda UI graceful hata + item kalır.

---

## 14. Audit and Compliance

### 14.1 Hangi alanlar audit'e dahil?

ActionItem kanonik audit kaydı değildir (WR-D4 `CaseResolutionApproval` ve WR-D3 `NotificationDispatch` zaten kanonik). Ama ActionItem'ın kendi state geçişleri de izlenebilir olmalı:

- `createdAt`, `firstSeenAt`, `snoozedUntil`, `doneAt`, `doneByUserId`, `doneOutcome`, `closeNote` — hepsi denormalize satırda.
- Phase 2'de `ActionItemHistory` (immutable transitions) gerekirse açılır. Phase 1'de mevcut alanlar yeter.

### 14.2 KVKK / privacy

- ActionItem soft-delete YOK; kullanıcı silinirken (KVKK GDPR hakkı) ilgili kullanıcının ActionItem'ları cascade silinir.
- Müşteri-facing PII (caseTitle) audit silme talebinde nasıl davranılır → `Case` silme akışıyla aynı (Phase 3'te bu konu ele alındı).

### 14.3 Compliance görünürlüğü

- Admin için "rolüm gereği şu kadar onay yaptım son 30 gün" raporu Phase 2+.
- "Suppressed dispatch'ler için manuel ulaşım kapanma oranı" raporu Phase 2+.

---

## 15. Failure Modes and Safe Defaults

### 15.1 Generation hatası caller'ı bozmaz

- `emitActionItem` fire-and-forget; logla ama re-throw ETME.
- Aksi halde bir ActionItem insert hatası approval submit'i bozar — kabul edilemez.

### 15.2 Bell down (UI hatası)

- Bell yüklenemezse: yumuşak fallback ("Eylemler yüklenemedi, sayfayı yenile"). Diğer UI çalışmaya devam eder.

### 15.3 Çift üretim

- `dedupKey` unique → P2002 yakalanır, retry ile state=Pending zorlanır.

### 15.4 Race: approval onaylandı ama ActionItem hâlâ Pending

- Approval state değişimi her zaman birden fazla ActionItem state'ini etkileyebilir (multi-approver, override path).
- Çözüm: approve/reject hook'unda `UPDATE ActionItem SET state='Expired' WHERE objectType='CaseResolutionApproval' AND objectId=X AND state='Pending'`.
- Aynı transaction'a koymayız (fire-and-forget), nadir-saniye gecikme kabul.

### 15.5 Snooze bozulması

- `snoozedUntil < createdAt` mantıksız değer ise hata 400.
- snooze cron çökerse: kullanıcı inbox açtığında lazy wake-up garanti edilir.

### 15.6 Sınırsız büyüme

- Per-user ActionItem cap yok ama Done satırların 30 gün retention'u var. Pending limit pratikte yok ama 1000+ Pending olan kullanıcı bir alarmdır (Phase 2'de admin uyarısı).

### 15.7 "Eski sistemi paralel kullan" güvencesi (Phase 1)

- Mevcut MentionBellBadge ve CaseNotification çalışmaya devam eder. Action Center Phase 1 **paralel** kurulum.
- Phase 2'de gradual migration: ilk feature flag arkasında, sonra default, sonra eski bell sunset.

---

## 16. Implementation Split (Phases + Completion Boundary)

### 16.0 Completion Boundary

Action Center "complete" tanımı:
- Level 1: Approval inbox visibility (Phase 1) — Team Lead "kendime düşen onay" gap'i kapanır.
- Level 2: Unified ActionItem layer (Phase 2) — mevcut CaseNotification gradual replace, dispatch + sla + mention ortak çatıda.
- Level 3: Saved views + bulk + power-user (Phase 3) — keyboard, custom views.
- Level 4: Realtime + cross-tenant aggregate (Phase 4) — opsiyonel.

### 16.1 Phase 1 — Approval Inbox (MVP, en kritik gap)

**Scope:**
- Schema: `ActionItem`, enums `ActionItemKind`, `ActionItemState`.
- Migration: yalnız yeni tablo + enum (mevcut bozulmaz).
- BFF:
  - `emitActionItem({...})` helper (`server/db/actionItemRepository.js`)
  - Generation hooks: approval submit/approve/reject; case assign; case transfer; reject ReturnToAssignee.
  - Endpoint: `GET /api/action-center` (list + view filter), `GET /api/action-center/summary` (badge counts), `POST /api/action-center/:id/done`, `POST /:id/snooze`, `POST /:id/dismiss`.
- UI:
  - `ActionItemBell` (yeni; mevcut MentionBellBadge paralel kalır)
  - `ActionItemDrawer` 4-tab
  - MyHomePage'de "Eylem Bekleyenler" widget + heuristic-pending-approvals widget gerçek veri ile
  - CaseDetail'de Pending→InProgress auto-transition
- Smoke: §19.

**Out of scope (Phase 1):**
- FYI band'ı (mention/watcher conversion) — Phase 2
- SLA breach hook'u — Phase 2 (mevcut SLA cron audit henüz yetersiz olabilir)
- NotificationDispatch ActionItem hook'u — Phase 2
- Tam-ekran `/action-center` page — Phase 3 (drawer Phase 1'de yeterli)
- Saved views, bulk ops, keyboard nav — Phase 3
- Realtime push — Phase 4

**Phase 1 ship kriteri:**
1. Team Lead login eder, MyHomePage'de "Bekleyen Onayım: 3" widget'ı görür.
2. Bell ikonuna tıklar, drawer'da 3 satır görünür; her birinin reasonLabel'ı var.
3. [Onayla] mini-action ile decide eder; satır Done olur; aynı vakaya ait olası diğer approver'ların ActionItem'ları Expired olur.
4. Snooze edebilir; cron veya lazy wake-up ile yeniden Pending olur.

### 16.2 Phase 2 — Unified Layer + FYI Migration

**Scope:**
- Mention, watcher event, dispatch_manual_confirm, sla_at_risk hook'ları
- FYI band drawer'da
- Eski MentionBellBadge sunset (feature flag arkasında)
- `dispatch_review_needed` (no_channel_available case'leri için)
- 30-gün Done retention cron + ActionItemArchive

### 16.3 Phase 3 — Power user

**Scope:**
- Tam-ekran `/action-center` page
- Saved views (`ActionView` model)
- Bulk operations (mark all done, snooze multi)
- Keyboard navigation (j/k/e/m/a/.)
- Search + filter chips
- "Reason" tooltip detaylı metadata

### 16.4 Phase 4 — Realtime + System Alerts

**Scope:**
- Supabase Realtime / SSE pruva
- System alert kind (admin yapılandırma sağlığı: rate-limit hit, Suppressed trend)
- Manual task (supervisor → agent) — yeni mutation endpoint
- Cross-tenant SystemAdmin aggregate dashboard

### 16.5 Phase 5 — AI optional layer

**Conditional:** prod ROI ölçümünden sonra.
- Priority scoring (LLM ile)
- "Bu eylem için önerilen yanıt"
- Anomaly detection (kullanıcı 50 mention birikti → uyarı)

### 16.6 Naming / FK migration

Phase 1 yeni tablo açıldığı için backward-compatible. Phase 2 mention/watcher migration sırasında `CaseNotification` veri taşıması: önce paralel yazılır, sonra Phase 3 sonunda CaseNotification deprecated (silinmez; salt-okunur audit).

---

## 17. Data Migration / Backward Compatibility

### 17.1 Phase 1 — additive only

- Yeni tablo + enum'lar; schema migration additive.
- Mevcut hiçbir tablo değişmez.
- Mevcut MentionBellBadge ve CaseNotification çalışmaya devam.

### 17.2 Phase 2 mention/watcher migration

- Plan: yeni event'ler hem `CaseNotification` hem `ActionItem` üretir (double-write).
- 30 gün sonra eski `CaseNotification` salt-okunur; yeni bell yalnız ActionItem'a bakar.
- Geriye dönük dolum opsiyonel; eski CaseNotification rows için backfill cron çağrılabilir (ama gerek olmayabilir — yaşlı bell row'ları zaten kullanıcı için anlamsız).

### 17.3 Rollback

- Phase 1 schema değişimi backward-additive: drop yapılırsa `ActionItem` tablosu boş, kalan kod etkilenmez.
- Feature flag `actionCenterEnabled` UI tarafında — kapalıyken yeni bell render olmaz; eski bell devam.

### 17.4 Seed

- Demo seed Phase 1'de boş başlar; admin bir politika kurup vaka açtıkça organik dolar.
- Phase 2+'da örnek scenario seed'i (DEMO-AC-001..010) ile UI testleri için fixture.

---

## 18. MSSQL / On-Prem Portability

Mevcut WR-D4/D3 §18 standardı ile aynı.

| Konu | Yaklaşım | MSSQL ✓ |
|---|---|---|
| Enum types | Prisma enum (PG native; MSSQL provider string + check) | ✓ |
| JSON fields | YOK (Phase 1 — payload denormalize) | ✓ |
| Unique partial index (`dedupKey`) | `WHERE dedupKey IS NOT NULL` | ✓ MSSQL filtered index identical |
| Sort index | Composite, no PG-specific | ✓ |
| Cron / poll | Mevcut UptimeRobot pattern | ✓ |
| Realtime (Phase 4) | Provider abstraction; SQL Server için workaround | ⚠️ Phase 4 ele alınır |

### 18.1 Tasarım kuralları

- ❌ PG-specific (`jsonb_path_query`, `array_agg`, GIN) yok
- ❌ Trigger/view/function Phase 1-3 boyunca yok
- ✅ Tüm filter app-layer
- ✅ Idempotency unique partial index

---

## 19. Smoke + Acceptance Criteria

### 19.1 Phase 1 smoke — `scripts/smoke-action-center-phase1.js`

Senaryo seti (kanonik akış):

1. **Approval submit → ActionItem üret** — Agent submitApproval çağırır, ActionItem(kind='approval_pending', userId=teamLead, state=Pending) üretilir; dedupKey unique.
2. **Approval submit (idempotent)** — Aynı approval için ikinci submit (hypothetic) yeni satır YAZMAZ; mevcut güncellenir.
3. **Pending count summary** — `GET /api/action-center/summary` for teamLead → `actionRequired >= 1`.
4. **List inbox** — `GET /api/action-center?view=default` → satır var, reasonLabel dolu, caseNumber denorm doğru.
5. **Mark done** — `POST /:id/done` → state=Done, doneAt set; summary count azalır.
6. **Approve via mini-action (integration)** — `POST /api/approvals/:id/approve` → approval Approved; ActionItem Expired (başka approver'a düşmüştü) veya Done; submitter için yeni FYI ActionItem(kind='approval_decided').
7. **Reject → ReturnToAssignee** — `kind='case_returned_to_assignee'` ActionItem assignee'ye düşer.
8. **Snooze** — `POST /:id/snooze` with snoozedUntil → state=Snoozed; summary'den düşer.
9. **Lazy wake-up** — `snoozedUntil < now` durumda summary çağrısı → ActionItem state otomatik Pending'e döner.
10. **Dismiss with reason** — `POST /:id/dismiss` with closeNote → state=Dismissed; audit reachable.
11. **Tenant scope leak** — User A şirket X'te, ActionItem User A şirket Y'de oluşturulsa (manuel insert via prisma) → User A'nın `GET /api/action-center` listesinde görünmez.
12. **Wrong-user mutation** — User B, User A'nın ActionItem'ını done yapmaya çalışır → 403/404.
13. **Generation fire-and-forget** — emitActionItem içine kasıtlı exception fırlat (test mock), submitApproval başarılı dönmeli (caller bloklanmaz).
14. **Auto-InProgress** — CaseDetail çağrısı (GET /api/cases/:id veya benzeri "ben bu vakaya giriyorum" event'i) Pending ActionItem'ları InProgress'e taşır + firstSeenAt stamp.

**Tahmini başarı:** 14/14 green.

### 19.2 Regression smokes

- `smoke-resolution-approval-flow` — 16/16 PASS (Approval davranışı değişmemeli)
- `smoke-notification-flow` — 19/19 PASS (Dispatch davranışı değişmemeli; ActionItem üretimi side-effect)
- `smoke-customer-response-channel` — 20/20 PASS

### 19.3 UI manuel QA

`docs/qa/WR-ACTION-CENTER-MANUAL-QA.md` (Phase 1 ship sırasında oluşturulur). Şimdilik ana akış:
1. Team Lead login, MyHomePage'de "Bekleyen Onayım" widget'ı sayaçlı görünür
2. Bell drawer'ı açılır, satır görünür, reasonLabel doğru
3. Mini-action [Onayla] çalışır
4. CaseDetail'e gidip dön → state InProgress'e geçmiş
5. Snooze → 1 saat → wake-up → tekrar Pending

---

## 20. Open Decisions

Ürün/operasyon tarafının onaylaması gerekenler:

| # | Konu | Seçenekler | Önerilen |
|---|---|---|---|
| 1 | Phase 1'de FYI band aktif mi? | (a) yok — sadece actionRequired (b) FYI passive show (c) FYI sadece sayaç | (b) — passive show but default view'a girmez |
| 2 | Snooze cron mu lazy mi? | (a) cron 5dk (mevcut runSnoozeWakeup piggy-back) (b) lazy on-read | Phase 1 (b); Phase 2'de (a) eklenir |
| 3 | Approval override sonrası approver inbox temizlenir mi? | (a) hepsi Expired (b) override yapan kişiye also "Override yapıldı" FYI | (a) Phase 1; (b) Phase 2 |
| 4 | "Bekleyen onayım" widget mevcut "heuristic pendingApprovals"ın yerini alır mı? | (a) replace (b) coexist with naming clarification | (a) — heuristic widget rename "Önerilen Aksiyonlar" (mevcut algoritma korunur) |
| 5 | Done retention süresi | (a) 30 gün (b) 90 gün (c) sınırsız | (a) — depo şişmesi vs audit ihtiyacı dengesi |
| 6 | Action Center cross-tenant SystemAdmin için aggregate gösterir mi? | (a) tenant-isolated her zaman (b) SystemAdmin'e cross-tenant toplam | (b) — Phase 1'de bile minik bir kazanım |
| 7 | "InProgress" auto-transition gerçekten otomatik mi yoksa manuel "Bunu üstleniyorum"? | (a) auto on CaseDetail open (b) manuel button | (a) — Phase 1; Phase 3'te toggle UI eklenir |
| 8 | Bell'de 2 sayaç (action + FYI) veya 1 toplam? | (a) 2 ayrı (b) 1 toplam tooltip detay | (a) — Slack/Linear convention |

---

## 21. Out-of-Scope (Deliberate)

Aşağıdakiler bu plana **dahil değildir**; ayrı çalışma gerektirir.

- Aktif e-posta sağlayıcısı (Phase 4 / Level B — WR-D4/D3 hâlâ koşullu)
- Müşteri portal acceptance (WR-D4/D3 Level C)
- SMS/WhatsApp/Webhook dispatch (Level C)
- AI-driven priority scoring (Phase 5+)
- Custom rule builder (`ActionRule` admin CRUD) — Phase 2+
- Mobile push notification — şu an yok, Phase 4+ değerlendir
- Browser desktop notification API — Phase 3 nice-to-have, kart dışı
- Webhook outbound to tenant systems (Slack/Teams entegrasyonu) — Phase 5+
- Analytics dashboard "kaç onay aldım, ne kadar geç verdim" — Phase 5

---

## 22. Outcomes / Success Metrics

### 22.1 İş çıktıları (qualitative)

- **Team Lead deneyimi:** "Bana düşen onayları görüyor muyum?" sorusunun cevabı bugün **hayır**, Phase 1 sonrası **evet**.
- **Operatör inbox güveni:** "Aksiyon bekleyen iş kaldı mı?" sorusu tek-bakışta cevaplanabilir.
- **Bildirim hijyeni:** 4 ayrı polling timer → 1; 4 custom event → 1.
- **Audit görünürlüğü:** ActionItem state geçişleri kim/ne zaman/ne kararla görünür.

### 22.2 Pilot metrikleri (Phase 1 sonrası 2 hafta)

- **Bekleme süresi:** Bir approval submit → decide arasındaki ortalama süre %X azalmalı.
- **Suppressed dispatch dönüş:** "no_channel_available" Pending dispatch'lerin manuel-confirm kapanma oranı.
- **Snooze kullanımı:** Kullanıcı başına haftalık snooze sayısı (sağlıklı eğer 1-5; uyarı eğer 20+).
- **Dismiss reason analizi:** En çok kullanılan close note'lar = UX iyileştirme sinyali.

### 22.3 Başarısızlık göstergeleri (alarm)

- Bell sayaç boş ama kullanıcı CaseDetail'lerden "bilmiyordum" feedback'i veriyorsa → generation rule eksik.
- Pending Done oranı düşük (kullanıcı snooze + dismiss patlatıyor) → reasonLabel/relevance kalitesi düşük.
- DB latency spike → index/query plan revize.

### 22.4 Phase 2+ ileri hedefler

- "Mention/watcher noise eski bell vs Action Center" karşılaştırması (Phase 2'de mention conversion sonrası).
- Tam-ekran inbox günde kaç kez açılıyor (Phase 3'te).
- Cross-tenant SystemAdmin ne kadar kullanıyor (Phase 4).

---

## Appendix A — Glossary

- **ActionItem:** Bu kart kapsamında üretilen yeni entity. Her satır bir operatör aksiyonunu temsil eder.
- **Inbox view:** Önceden tanımlı veya kullanıcı-saved filtreli ActionItem listesi.
- **Reason label:** Her ActionItem'ın "neden bu kullanıcıya düştü" açıklayan tek cümlesi.
- **Mini-action:** Inbox satırında inline (drawer içinde) tek-tıkla yapılabilen aksiyon (Onayla / Vakaya Git / Hallettim / Ertele).
- **FYI band:** `actionRequired=false` ActionItem'ların gösterildiği ikincil bant.
- **Group key:** UI'da aynı obje + kind'ın collapse'lendiği sıra anahtarı.

## Appendix B — Mevcut polling/event envanteri (Phase 1 sonrası konsolidasyon hedefi)

| Kaynak | Bugün | Phase 1 sonrası |
|---|---|---|
| MentionBellBadge poll | 60s | kaldırıldı (paralel kalır feature-flag arkasında) |
| Pattern alert poll | 60s | Phase 2'de Action Center'a entegre |
| Calendar reminder poll | 600s | Phase 2'de Action Center'a entegre |
| `app:notifications-changed` event | aktif | aktif (paralel kullanım Phase 2'ye kadar) |
| `app:mentions-changed` event | aktif | aktif |
| `app:patterns-changed` event | aktif | aktif |
| `app:calendar-changed` event | aktif | aktif |
| **`app:action-center-changed` event** | **YOK** | **eklenir (Phase 1 tek yeni event)** |

Phase 2 sunset planı: yukarıdaki 4 custom event ve 3 polling timer Phase 3 sonunda tek `app:action-center-changed` + tek 60s summary poll'a indirgenir.

---

**Bu kart bilinçli olarak kod, schema, migration, route veya UI değişikliği içermez. Yalnız planlama.**
