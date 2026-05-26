# WR-NOTIFICATION-CENTER — Varuna Inbox

> **Status:** Planning Card (Phase 0) — no code, schema, or migration changes in this document.
> **Owner:** Ürün direktörü (connect@univera.com.tr)
> **Created:** 2026-05-26
> **Upstream:** WR-D4/D3 Level A (approval + notification dispatch foundation) and WR-ACTION-CENTER Phase 1 (`ActionItem` table, `Aksiyonlarım` bell + drawer + MyHome `Onayımda Bekleyenler` panel) are both shipped. This card unifies them with the legacy mention/bildirim bell and several adjacent surfaces into a single operator inbox.
> **Cross-references:** `docs/planning_cards/WR-ACTION-CENTER.md` (Phase 0 concept), `docs/planning_cards/WR-ACTION-CENTER-PHASE1-APPROVAL-VISIBILITY.md` (shipped MVP).

---

## 0. Why this card exists now

WR-ACTION-CENTER Phase 1 shipped a clean ActionItem foundation and an "Aksiyonlarım" surface for approvals. It is functional and pilot-ready. It is **not** a finished product.

Today an operator sees up to **six** distinct notification-like surfaces:

1. Üst menüde **Aksiyonlarım** zili (yeni — approval-only, drawer).
2. Üst menüde **bahsetme / bildirim** zili (eski — `MentionBellBadge`, iki kaynak: `listUnreadMentions` + `listUnreadNotifications`).
3. Benim Sayfam'da **Onayımda Bekleyenler** kartı (yeni — `PendingApprovalsPanel`).
4. Benim Sayfam'da **Önerilen Aksiyonlar** kartı (heuristik AI; ileride RUNA olarak konumlanacak).
5. Admin'de **Bildirim Kayıtları** (NotificationDispatch audit; manual-confirm aksiyonu vaka detayında).
6. Vaka detayında **İletişim Bildirimleri** kartı + **Çözüm Onayı** kartı.

Bu altı yüzeyin hepsi doğru şeyleri yapıyor. Hiçbirinin tek başına yanlışı yok. Ama birlikte **fragmented** bir deneyim üretiyorlar: kullanıcı için "bana ne soruluyor?" sorusunun cevabı tek bir yerde değil. Bu kart, bu altı yüzeyi tek bir **rol-aware operational inbox**'a evirmenin ürün ve teknik planını yapıyor. Adı dahili olarak **Varuna Inbox**, kullanıcı yüzeyinde mevcut **Aksiyonlarım** ismi devam eder (taşınmaz — operasyonel sürtünme yaratır, §18.B).

> **Bu kart bir uygulama planıdır, uygulama değildir.** Hiçbir runtime kod, schema, migration veya UI değişikliği yapılmaz. Aşağıdaki §19 ve §20 implementation prompt'un nasıl yazılacağına dair ipuçlarını **taslak olarak** içerir — onlar ayrı bir komut olarak verilmeden hiçbir şey kodlanmaz.

---

## 0.A. WR-ACTION-CENTER Phase 1 Closure and Carry-Forward

Varuna Inbox planlamasına başlamadan önce **WR-ACTION-CENTER Phase 1**'in pilot-ready olarak resmen kapatıldığını netleştiriyoruz. Bu kart sonraki evrim için bir devam belgesidir; Phase 1'i "yarım kaldı" gibi konumlandırmaz.

### 0.A.1. Status

> **WR-ACTION-CENTER Phase 1: Shipped / Pilot-ready.**
> **WR-NOTIFICATION-CENTER / Varuna Inbox: Next evolution / planning.**

Phase 1 nihai birleşik bildirim merkezi **değildir**; bilinçli olarak dar tutulan **onay görünürlüğü temelidir** (Approval Visibility MVP). Üzerine inşa edilecek mimari Phase 2+'da ele alınır.

### 0.A.2. Phase 1'de ne canlıya çıktı

- **ActionItem veri modeli** — 14 forward-compat `ActionItemKind` enum değeri + 6 değerli `ActionItemState` + 5 index + partial unique `dedupKey`.
- **Aksiyonlarım zili + drawer** — `ActionCenterBell` (sol, iki sayaç: kırmızı `İşler`, gri `Bildirimler`) + `ActionCenterDrawer` (4 sekme: İşler / Bildirimler / Ertelenen / Tamamlanan).
- **MyHome `Onayımda Bekleyenler` paneli** — `PendingApprovalsPanel`, tenant-scoped, gerçek `approval_pending` ActionItem'larından beslenir.
- **Üç inbox kind canlıda**:
  - `approval_pending` — onaylayıcıya "kararını ver" satırı.
  - `approval_decided` — gönderene FYI sonuç bildirimi.
  - `case_returned_to_assignee` — reddedilen vakanın güncel atanan kişisine "revize et" satırı.
- **Lifecycle aksiyonları** — `Done` (Tamamlandı/Okundu), `Snooze` (1 saat / yarın 09:00 / pazartesi 09:00 presetleri + lazy wake-up), `Dismiss` (opsiyonel not).
- **Multi-approver authority fix** — fan-out edilen `approval_pending` satırlarından sadece snapshot'lanan kullanıcı değil, **herhangi eligible üye** karar verebilir (`userIsEligibleApprover` re-resolve).
- **Decision-time self-approval guard** — `allowSelfApprove=false` politikalarda submitter, eligible set'te bile olsa kendi gönderdiği onayı approve/reject edemez (`self_approval_blocked` 403).
- **`case_returned_to_assignee` Tamamlandı butonu** — eski sürümde eksik olan inline kapanış aksiyonu eklendi; mevcut `markDone` endpoint'i yeniden kullanılır.
- **Operator Help drawer kaldırıldı** — Phase 1'in ikinci side panel'i UI'yi bozuyordu; çıkarıldı, copy inline'lara dağıtıldı.
- **Feature flag dokümante edildi** — `VITE_ACTION_CENTER_ENABLED` `.env.example`'da, Vercel'de prod redeploy gerektiği notlandı.

### 0.A.3. Bilinçli "by-design" sınırlar

Phase 1 şunları **kasıtlı olarak yapmadı**. Phase 2+'a yansıyacaktır:

- **Backfill yok** — Phase 1 deploy'undan ÖNCE submit edilmiş onaylar inbox'a geriye dönük yazılmaz. Pilot kickoff'ta açıklanır; gerekirse re-submit.
- **Eski bahsetme / bildirim zili paralel duruyor** — `MentionBellBadge` sağda, Aksiyonlarım solda. İki yüzey beraber yaşıyor (Phase 2A'da birleştirilecek).
- **Full-page inbox yok** — sadece drawer. `/inbox` rotası Phase 3'te.
- **Müşteri iletişim kuyruğu yok** — `dispatch_manual_confirm` kind'ı enum'da hazır ama yazan adapter yok. `CommunicationDispatchCard` vaka detayında elle yürütülüyor (Phase 2B).
- **Retention cron yok** — Done/Dismissed/Expired satırlar süresiz duruyor; cold storage Phase 4.
- **Realtime push yok** — Polling 60s + custom event invalidation; WS Phase 5.

### 0.A.4. Varuna Inbox'a taşınacaklar (carry-forward)

- **`ActionItem` tablosu olduğu gibi evrimleştirilir.** Yeniden adlandırılmaz, rename churn yok. Phase 2B'de nullable kolon eklemeleri (`readAt`, `category`, `severity`).
- **Approval generation hook'ları yeniden kullanılır.** `submitApproval` / `approveApproval` / `rejectApproval` içindeki fire-and-forget `emitActionItem` çağrıları olduğu yerde durur — yeni adaptörler bunlara dokunmaz.
- **"Aksiyonlarım" terminolojisinin operasyonel öğretimi korunur.** Pilot operatörleri bu adı tanır; ürün UI'sinde değiştirilmez (§18.B).
- **`reasonLabel` zorunluluğu, fire-and-forget pattern, owner-only mutation guard, tenant scope semantikleri** Phase 1'de doğrulandı; tüm yeni adaptörler aynı sözleşmeye uyar.
- **Operator help drawer çıkartılma kararı kalıcıdır.** Phase 2+'da hiçbir adapter "drawer içinde help" gerekçesiyle UI'a ek panel açmaz (§15, §17.G).

### 0.A.5. Daha sonra deprecate / merge edilecekler

| Yüzey | Phase 1 durumu | Sonraki adım |
|---|---|---|
| `MentionBellBadge` | Canlı, sağda paralel zil | Phase 2A'da UI'dan gizlenir; içerik `mention` kind'ı ile inbox'a feed edilir; component dosyası 2 hafta yedek kalır, sonra silinir. |
| Parçalı bildirim yüzeyleri (eski mention service, eski notifications service) | Endpoint'leri çalışıyor; UI'dan iki yerden besleniyor | Phase 2A'da yalnızca adapter girdisi olarak kalır; Phase 3'te endpoint cleanup. |
| "Bildirim" vs "Aksiyon" mental modelinin ikiliği | Operatör iki dünya arasında gidip geliyor | Phase 2A → tek bell, açık iki sayaç: İşler (kırmızı, aksiyon zorunlu) + Bildirimler (gri, FYI). Mental model tek bir yüzeyde birleşir. |
| MyHome `AISuggestionsPanel` "Önerilen Aksiyonlar" başlığı | Heuristik AI öneri kartı, inbox'la karışıyor | Phase 2A'da "RUNA Önerileri" rebrand; inbox sayaçlarına dahil değil, ayrı bir yardımcı koç paneldir (§18.E). |

### 0.A.6. Tracking docs için önerilen ifadeler

`docs/WORK_REGISTER.md`, planning matrix ve diğer izleme dokümanlarında **birebir** kullanılması önerilen iki cümle:

- **WR-ACTION-CENTER Phase 1: Shipped / Pilot-ready** — Approval Visibility MVP; üç inbox kind'ı canlıda; iki acceptance hotfix uygulandı; pilot için VITE_ACTION_CENTER_ENABLED=true + Vercel prod redeploy gerekiyor.
- **WR-NOTIFICATION-CENTER / Varuna Inbox: Next evolution / planning** — Unified, role-aware operational inbox plani; Phase 2A "Tek Zil" ilk uygulama adımı; §18'deki 7 ürün kararı verilmeden implementation prompt finalize edilmez.

---

## 1. Executive Summary

### Vizyon — "Sakin ama emin" iş kuyruğu

Varuna Inbox şunu söyler:

> *"Sana ait her şey burada. Aksiyon gerekenler üstte, bilgilendirmeler aşağıda. Her satır niçin senin önünde olduğunu açıklar."*

İki referans cümle:

- **Linear Inbox** kadar sade,
- **Slack mentions** kadar tanıdık,
- **Salesforce task center** kadar operasyonel,
- ama bizim domain'imize özel: **vaka çözüm onayı, müşteri iletişimi, SLA, bahsetme** kavramlarıyla birinci sınıf entegre.

### Üç hedef cümle

1. **Tek zil, iki sayaç.** Operatör başını çevirip "hangi zile bakacağım?" sorusunu sormayacak. Sayaçlar `İşler` (kırmızı) ve `Bildirimler` (gri).
2. **Her satır açıklar.** Hiçbir bildirim "buraya neden düştü" sorusunu cevapsız bırakmaz. `reasonLabel` zorunlu.
3. **Boşaltabileceğin bir kuyruk.** Tamamla, ertele, yok say — üçü de net. Read ≠ Done.

### Build edilmeyecek olanlar

- Yeni bir push/realtime servisi (Phase 5'e kadar polling devam eder; §13.G).
- Çoklu kanal (e-posta/SMS) push bildirim — Varuna canlı gönderim yapmıyor (Level A kararı korunur).
- Slack/Teams entegrasyonu (planlı değil; istenirse outbound webhook, ayrı kart).
- Operatöre "büyük yardım drawer'ı" (Phase 1 hotfix dersi — UI'yi bozar, §15).

---

## 2. Bağlam ve mevcut yüzeylerin envanteri

### 2.1. Bugün canlıda olanlar

| # | Surface | Kaynak | Audience | Action vs FYI |
|---|---|---|---|---|
| A | `ActionCenterBell` (sol) → `ActionCenterDrawer` ("Aksiyonlarım") | `ActionItem` tablosu (approval_pending / approval_decided / case_returned_to_assignee) | tüm roller | Karışık — drawer 4 sekme: İşler / Bildirimler / Ertelenen / Tamamlanan |
| B | `MentionBellBadge` (sağ) | `caseService.listUnreadMentions` + `listUnreadNotifications` | tüm roller | FYI ağırlıklı, fakat bahsetme bazen aksiyon gerektirir |
| C | MyHome `PendingApprovalsPanel` ("Onayımda Bekleyenler") | Aynı `ActionItem`, kind=`approval_pending` | tüm roller | Action |
| D | MyHome `AISuggestionsPanel` ("Önerilen Aksiyonlar") | `getDashboard.pendingApprovals` (heuristik) | tüm roller | "Öneri", aksiyon değil |
| E | Vaka detayı `Çözüm Onayı` kartı | `caseResolutionApproval` lifecycle | submit/approve/reject yetkili roller | Action |
| F | Vaka detayı `İletişim Bildirimleri` kartı (`CommunicationDispatchCard`) | `NotificationDispatch` | atanan kişi / supervisor | Action — manuel iletim + delivery note |
| G | Admin `Bildirim Kayıtları` ekranı | `NotificationDispatch` audit | admin / supervisor | FYI / audit |
| H | Vaka detayı timeline / activity | `CaseActivity` | tüm roller | FYI |

### 2.2. Yarın planda olan (henüz yok)

- **SLA risk uyarısı** (`case_sla_at_risk`, `case_sla_breach` — şema enum'da hazır).
- **Atama / transfer** (`case_assigned`, `case_transferred` — şemada hazır).
- **Pattern alert** (`pattern_alert` — şemada hazır, içerik üretimi mevcut `analyticsService.listPatterns`).
- **Manual customer comm görevi** (`dispatch_manual_confirm` — kind hazır, şu an dispatch ekranından elle yürür).
- **Dispatch review needed** (`dispatch_review_needed` — gelecekteki provider hatalarında).
- **Watcher events** (`watcher_event` — vaka takibi/follow özelliği ileride).
- **System alert** (`system_alert` — admin'e migration/cron/health uyarısı).
- **Manuel görev** (`manual_task` — ileride supervisor → agent atamalı görev).

`ActionItem.ActionItemKind` enum'u ileriye dönük tüm bu değerleri Phase 1'de eklediği için **schema migration gerekmeyecek**.

### 2.3. Düşürülecek / temizlenecek

| Yüzey | Sonraki durum |
|---|---|
| `MentionBellBadge` (sağ zil) | **Düşürülür** — kaynakları `mention` kind'ı altında `ActionItem`'a feed edilir (Phase 2A). |
| MyHome `AISuggestionsPanel` (Önerilen Aksiyonlar) | **Inbox dışında kalır.** Konumlandırma: "RUNA Önerileri" — aksiyon kuyruğu değildir, yardımcı koç paneldir. İsim ve görsel ayrımı netleşir (§4.G). |
| `PendingApprovalsPanel` ("Onayımda Bekleyenler") | **Kalır** — inbox'tan filtreli bir alt görünüm. MyHome'da öne çıkarılması ürünsel olarak değerlidir. |
| Admin `Bildirim Kayıtları` | **Kalır** — audit viewer farklı amaç. Inbox değildir. |

---

## 3. Ürün referansları — neyi distilliyoruz, neyi distillemiyoruz?

| Ürün | İncelediğimiz örüntü | Aldığımız | Almadığımız |
|---|---|---|---|
| **Linear Inbox** | "Active / Snoozed / Done" üçlüsü; her satır küçük actor avatarı + bağlam | Üç kova ayrımı, sakin görsel hiyerarşi | Custom rule engine UI (overkill) |
| **Slack mentions** | Unread state; `@channel` vs direct mention ayrımı | Bahsetmeleri "ben"e gelenle "grubuna gelen" diye ayırma kararı (§4.B) | Sound/desktop push (out of scope) |
| **GitHub Notifications** | "Reason" chip her satırda (assigned/mentioned/review_requested) | Her satıra `reasonLabel`; "Why?" sorusu UI'da göründü | Saved filters Phase 1'de yok |
| **Jira approvals** | "My approvals" ayrı sekme | Bizim "Onayımda Bekleyenler" zaten budur — kalır | Workflow designer (Varuna basit) |
| **Zendesk views** | View kavramı = saved filter | Phase 4'te custom view, Phase 1-3'te değil | Multi-screen layout (overkill) |
| **Salesforce activity** | Task vs Event ayrımı | Action vs FYI iki kova bizde aynı işi yapar | Multi-object timeline complexity |
| **ServiceNow work queues** | Team queue / mine queue | Phase 3+ için team inbox karar noktası (§18.G) | Quasi-tickets karmaşası |
| **Intercom Inbox** | Conversation-centric inbox | Bize uymaz — vaka modeli farklı, ama "deep link → conversation" örüntüsü → "deep link → case detail" | Conversation merge |
| **Notion Updates** | Page-level + workspace-level updates | Vaka-level + tenant-level ayrımı, ama Phase 1-2'de tek inbox | Block-level granularity |

**Distillenen prensipler:**

1. Tek zil, açık iki sayaç.
2. Her satır 4 saniyede okunur: ne, niçin, ne yap.
3. Read state ≠ Done state. Üçüncü kategori: Snoozed.
4. "Done" diyebileceği bir kuyruk olmazsa kullanıcı bildirim algıyı kapatır.
5. Empty state moral verir — "temizsin" diyen bir mesaj, gri spinner değil.

---

## 4. Information Architecture (IA)

### 4.A. Surface katmanları

```
┌─ Top-bar bell (single)
│   "Aksiyonlarım"        ⌐ kırmızı sayaç (İşler) + gri sayaç (Bildirimler)
│   tıklayınca
│   └─ Drawer (right side)         ← Phase 2A, mevcut
│       4 sekme: İşler / Bildirimler / Ertelenen / Tamamlanan
│       her satır = inline mini-aksiyonlar
│       footer link: "Tümünü gör →" (Phase 3'te /inbox'a yönlendirir)
│
├─ Full-page Inbox /inbox          ← Phase 3
│   Sol kenar:  category filter (İşler / Bildirimler / Bahsetme / Onaylar / Müşteri / Sistem)
│   Üst:        saved view chip'leri (Phase 4)
│   Orta:       satır listesi (today / yesterday / older grouping)
│   Sağ kenar:  seçili satırın preview + actions (CMD+K compatible)
│
├─ MyHome /                        ← mevcut, küçük rötüş
│   "Onayımda Bekleyenler" panel kalır
│   "Aksiyonlarım" linki + sayaç (drawer'a, sonra /inbox'a)
│   "RUNA Önerileri" (eski Önerilen Aksiyonlar) — inbox'tan AYRI
│
├─ Case detail                     ← mevcut, küçük rötüş
│   üst banner: "Bu vakada sana atanmış 2 açık iş var → Aksiyonlarım'a aç"
│   sağ panel: Çözüm Onayı / İletişim Bildirimleri (mevcut kartlar)
│
└─ Admin
    Bildirim Kayıtları (audit, mevcut)
    Inbox Audit Drawer (SystemAdmin, Phase 4 — cross-tenant görünüm)
```

### 4.B. Inbox kategorileri (operator-facing)

Inbox kategorileri **kullanıcının zihinsel modeline** göre kümelenir, technical kind'lara değil.

| Kategori | İçerdiği `ActionItemKind` | Karakter | Aksiyon zorunlu mu? |
|---|---|---|---|
| **İşler** | `approval_pending`, `case_returned_to_assignee`, `dispatch_manual_confirm`, `manual_task` | "Bekleyen kararın / işin" | ✓ |
| **Onaylar** | `approval_pending`, `approval_decided` | İşler'in onay-spesifik filtre görünümü | varies |
| **Bahsetmeler** | `mention` (eski sistemden taşınır) | "@adın geçti" | bağlama göre |
| **Müşteri İletişimi** | `dispatch_manual_confirm`, `dispatch_review_needed` | "Bu müşteriye sen ulaşacaksın" | ✓ |
| **Bildirimler (FYI)** | `approval_decided`, `case_assigned`, `case_transferred`, `pattern_alert`, `system_alert`, `case_sla_at_risk`, `case_sla_breach`, `watcher_event` | "Haberin olsun" | ✗ |
| **Sistem** | `system_alert` (admin-only) | Operasyon sağlığı | varies |
| **RUNA Önerileri** | _Inbox dışı_ — MyHome'da kendi paneli | AI heuristic | ✗ (öneri) |

**Önemli sınır:** "Onaylar" ve "Müşteri İletişimi" kategorileri aynı satırın iki farklı filtre görünümü olabilir; satırlar duplike olmaz. Filtre = bir sekme + bir chip. Veri çoğaltılmaz.

### 4.C. "Aksiyonlarım" ismi devam eder mi?

Evet. (§18.B kararının önerisi). Sebep:

- Phase 1'de canlıya çıktı, pilot operatörleri öğrendi.
- "Varuna Inbox" iç kod adı / satış sunumu için kalır.
- Drawer içinde gerekirse alt başlık: "Aksiyonlarım — bildirimler ve işler".
- Phase 3 full-page açıldığında URL `/inbox` ama header "Aksiyonlarım".

---

## 5. Kaynak sistemlerin birleştirilmesi (Source Adapters)

Her kaynak sistemden inbox'a satır akıtacak bir adaptörün **sorumluluğu sabittir**: emit zamanı + dedup key + reasonLabel + priority + actionRequired flag.

| Kaynak | Adapter | Inbox kind | Action? | Phase |
|---|---|---|---|---|
| `submitApproval` | mevcut `emitActionItem` | `approval_pending` | ✓ | 1 — canlı |
| `approveApproval` | mevcut | `approval_decided` (FYI) | ✗ | 1 — canlı |
| `rejectApproval` | mevcut | `approval_decided` + `case_returned_to_assignee` | mixed | 1 — canlı |
| `caseService.listUnreadMentions` | **yeni** — mention senkron worker | `mention` | optional | **2A** |
| `caseService.listUnreadNotifications` | **yeni** — eski-bildirim senkron worker | category-bazlı eşleme | optional | **2A** |
| `NotificationDispatch` (manual-confirm pending) | **yeni** — dispatch lifecycle hook | `dispatch_manual_confirm` | ✓ | **2B** |
| `NotificationDispatch` (review needed) | **yeni** — Phase 4'te provider failure | `dispatch_review_needed` | ✓ | 4 |
| `case.assignedPersonId change` | **yeni** — caseRepository hook | `case_assigned` (atanana) + `case_transferred` (eskiye FYI) | atanana ✓, FYI ✗ | **2C** |
| SLA cron / hesaplama | **yeni** — periyodik scan | `case_sla_at_risk`, `case_sla_breach` | ✓ | 3 |
| `analyticsService.listPatterns` | **yeni** — pattern lifecycle hook | `pattern_alert` | ✗ | 3 |
| System / health | **yeni** — admin only | `system_alert` | varies | 4 |
| Watcher events | **yeni** — opsiyonel, eğer follow şipirir | `watcher_event` | ✗ | 5 |

### 5.A. Adapter sözleşmesi (kontrat)

Her adapter şu sınırı korur:

- **Idempotent**: aynı kaynak event'i ikinci kez tetiklenirse `dedupKey` ile aynı satıra düşer (mevcut `emitActionItem.upsert` semantiği).
- **Fire-and-forget**: kaynağın hayat döngüsüne sızıntı yapmaz; çağıran `void` kullanır. Mevcut yapı koruyor (`approvalRepository.js`).
- **Tenant-safe**: `companyId` her satırda yer alır; UserCompany scope filtresi okuma tarafında çalışır.
- **Recipient resolution adapter-içinde**: kim alacak? Inbox satırı `userId` ile yazılır; takım/role inbox'u Phase 5'e ertelenir (§18.G).

### 5.B. "Bahsetmeleri inbox'a taşırken" (Phase 2A) — kritik tasarım kararı

Eski mention bell iki ayrı service çağırıyor (`listUnreadMentions`, `listUnreadNotifications`). Bunlar inbox'a iki yoldan dökülür:

**Plan:**
- `CaseMention` tablosundan **henüz inbox'a yazılmamış** bahsetmeleri tarayan tek seferlik **backfill** + sonrasında her yeni `CaseMention` create'inde **fire-and-forget** `emitActionItem({ kind:'mention', ... })`.
- Eski `MentionBellBadge` kaldırılır; ona feed olan iki endpoint çalışmaya devam eder (geri uyum) ama UI'da gösterilmez.
- Bahsetme satırının `dedupKey = caseMention.id`.
- `reasonLabel`: `"@${actor.shortName} ${case.caseNumber} yorumunda seni andı."`

**Kaçınılan tuzak:** Eski bell'i bırakıp yeni inbox'a da yazarsak iki yerde sayaç gösterir, "noise ratio" artar. §17.A anti-pattern.

---

## 6. Domain model strategy

### 6.A. Üç opsiyonun karşılaştırması

| | Option A — ActionItem'ı genişlet | Option B — Ayrı NotificationItem | Option C — Projection / view |
|---|---|---|---|
| Migration maliyeti | Düşük — şema zaten forward-compat enum'lu | Yüksek — yeni tablo + adapter yığını | Orta — read view + cache |
| FK çoğullaması | Polymorphic (mevcut) | Çift FK (object + parent) | View içinde join |
| Idempotent dedup | Mevcut `dedupKey` partial unique | Yeniden tasarım | View'da garanti zor |
| Read vs Done ayrımı | `readAt` ek kolon (1 migration) | Sıfırdan tasarım | View aslında source-of-truth değil |
| Eski Phase 1 yatırımı | %100 korunur | %30 throwaway | %60 throwaway |
| MSSQL portability | Mevcut (partial unique = filtered index) | Yeniden ispat | View karmaşık |

### 6.B. Tavsiye: **Option A** — `ActionItem` → `InboxItem` evrim

`ActionItem` zaten Phase 1'de forward-compat tasarlandı:
- 14 `ActionItemKind` enum değeri (Phase 1 set + reserved set).
- Polymorphic `objectType` / `objectId`.
- `dedupKey` unique.
- 5 index yeterli ölçek için.
- State machine 6 değerle yeterli.

Yapılacak minimum migration (Phase 2B/3'te birikim):

```diff
model ActionItem {
   // mevcut...
+  // FYI satırlarında "okudum ama tamamlamadım" ayrımı.
+  readAt          DateTime?
+
+  // grup kategori için (kuvvetli filtre / view'lar)
+  category        InboxCategory?    @default(work)
+
+  // FYI severity (info / warn / critical)
+  severity        InboxSeverity?    @default(info)
+
+  // recipient genişlemesi (Phase 4+):
+  // teamId        String?
+  // roleScope     CompanyRole?
+  // — Phase 1-3'te userId tek alıcı, sonra fan-out semantiği değişebilir.

   @@index([userId, category, state])     // yeni
}
```

`ActionItem` tablosu yeniden adlandırılmaz (kod tabanında çok yerden import edilir; isim sapması ses kirliliği). Üst seviyede UI ve metinler "Aksiyonlarım" / "Inbox" der; veri katmanı `ActionItem` kalır. **Code-level rename'e gerek yok.**

**Migration:** 2 yeni nullable kolon + 1 yeni index. Risk düşük; pre-Phase-2A için **gerekli değil** (Phase 2A sadece mention adapter ekler). Phase 2B'de `readAt` + `category` gelir.

### 6.C. Domain model — alan-by-alan açıklamalı görünüm

`ActionItem` (post-evolution; eklenecek alanlar **bold**):

| alan | tip | açıklama |
|---|---|---|
| `id` | String | cuid |
| `companyId` | String | tenant scope |
| `userId` | String | alıcı User (Phase 1-3: tek alıcı per satır) |
| `personId` | String? | snapshot — routing audit |
| `kind` | `ActionItemKind` | enum, 14+ değer |
| **`category`** | **`InboxCategory`** | **work / fyi / mention / approval / customer / system / suggestion** |
| **`severity`** | **`InboxSeverity`** | **info / warn / critical** |
| `state` | `ActionItemState` | Pending / InProgress / Snoozed / Done / Dismissed / Expired |
| `actionRequired` | Boolean | bell sayaç (kırmızı vs gri) ayrımı |
| `objectType` / `objectId` | String? | polymorphic kaynak referansı |
| `caseId` / `caseNumber` / `caseTitle` | String? | denormalized snapshot — fast list |
| `generatedBy` | String? | `policy:<id>` / `system` / `user:<id>` |
| `groupKey` | String? | grouping (`<caseId>:approval`) |
| `dedupKey` | String? | partial unique — idempotency |
| `priority` | Int | sıralama (50 default; 70 high; 90 critical) |
| `reasonLabel` | String | "Why am I seeing this?" — ZORUNLU |
| `previewText` | String? *(opsiyonel ekleme)* | satırın kısa özeti (caseTitle dışındaki bağlam) |
| `actorUserId` | String? *(opsiyonel ekleme)* | bildirimi tetikleyen kişi |
| `metadata` | Json? *(opsiyonel ekleme)* | adapter-specific snapshot (KVKK'lı PII içermez) |
| `createdAt` / `updatedAt` | DateTime | |
| `firstSeenAt` | DateTime? | drawer açıldı / case açıldı zamanı |
| **`readAt`** | **DateTime?** | FYI okundu sayılır (state=InProgress olmadan) |
| `snoozedUntil` | DateTime? | |
| `doneAt` / `doneByUserId` / `doneOutcome` / `closeNote` | | |

Yeni alanların tümü Phase 2B-3 birikimi. Phase 2A'da kimi eklemiyoruz (sadece adapter kodu).

### 6.D. Retention

Yeni alan: yok. Yeni cron: Phase 4'te. Politika önerisi:

- `Done` / `Dismissed` / `Expired` satırlar 90 gün sonra cold-storage (silinmez; auditable kalsın). Cron: `inbox-retention` (Phase 4).
- `Pending` ve `InProgress` satırlar zaman aşımı kavramı **yok** — operatör temizleyene kadar durur. Kasıtlı tasarım.

---

## 7. UX tasarım gereksinimleri

### 7.A. Top-bar bell

Tek zil. İki sayaç (mevcut Phase 1 + hotfix tasarımı korunur):

```
┌─────────────────────────┐
│  📋  ⓮  ⓿                │   ← 14 iş, 0 bildirim (kırmızı + gri)
└─────────────────────────┘
```

Davranış:
- Tıklama → drawer açılır.
- 99+ formatı.
- Hover tooltip: `"Aksiyonlarım — 14 iş bekliyor, 0 bildirim"`.
- aria-label aynı tooltip.
- Bell ikonu Phase 2A'da hâlâ `ListChecks` (Lucide). Phase 3'te full-page olunca aynı kalır.

### 7.B. Drawer (Phase 2A — mevcutu evrimleştir)

Mevcut "Aksiyonlarım" drawer'ı bozmadan içerik genişler:

```
┌──[ Aksiyonlarım ─────────────────────────[?] [×] ]──┐
│ Sana atanan işler ve bilgilendirmeler                │
├──────────────────────────────────────────────────────┤
│ [İşler 14] [Bildirimler] [Ertelenen] [Tamamlanan]    │
├──────────────────────────────────────────────────────┤
│  TODAY                                                │
│  ┌─ Çözüm onayı bekliyor       CASE #2415  · 2d   ─┐ │
│  │ Vakanın çözümü onay bekliyor — submitter @ali     │
│  │ Çünkü "Yazılım/Genel onay" politikası seni onay-  │
│  │   layıcı olarak atadı.                            │
│  │ [Vakayı Aç] [Onayla] [Reddet] [Ertele] [Yok Say]  │
│  └───────────────────────────────────────────────────┘
│  ┌─ Revizyon gerekiyor          CASE #2401  · 6sa  ─┐
│  │ ...                                                │
│  └───────────────────────────────────────────────────┘
│                                                      │
│  YESTERDAY                                            │
│  ...                                                  │
│  OLDER                                                │
│  ...                                                  │
└──────────────────────────────────────────────────────┘
```

- "Today / Yesterday / Older" grouping Phase 2A'da değil, **Phase 2B**'de eklenir (satır sayısı düşükken görsel gürültü yapar).
- Footer link: **Phase 3**'te "Tümünü gör → /inbox".
- "[?]" yok. Phase 1 hotfix dersine sadık kalınır (drawer ek panel açmaz).

### 7.C. Full-page Inbox (Phase 3)

```
┌──[ Aksiyonlarım ────────────────────────────── search [?] [ + Yeni saved view (P4) ] ]──┐
│ ┌──────────────────┬──────────────────────────────┬──────────────────────────────────┐ │
│ │ Filtreler        │  Liste                       │  Önizleme                         │ │
│ │ ──────────────   │  ──────────────              │  ──────────────                   │ │
│ │ [Hepsi 14]       │  TODAY                       │  Vaka #2415                       │ │
│ │ • İşler        4 │  ──────                       │  Yazılım/Genel — UNIVERA          │ │
│ │ • Bildirimler  6 │  ☑ Çözüm onayı bekliyor       │                                   │ │
│ │ • Bahsetmeler  3 │  ☐ Revizyon gerekiyor         │  Reasoning:                       │ │
│ │ • Onaylar      4 │  ☐ ...                        │  Çünkü "Yazılım/Genel onay"...    │ │
│ │ • Müşteri      1 │                                │                                   │ │
│ │ • Sistem       0 │  YESTERDAY                    │  Aksiyonlar:                      │ │
│ │                  │  ...                          │  [Onayla] [Reddet]                │ │
│ │ Severity         │                                │  [Ertele] [Yok Say]               │ │
│ │ • Kritik       0 │                                │                                   │ │
│ │ • Uyarı        2 │                                │  Geçmiş:                          │ │
│ │ • Bilgi        8 │                                │  · 14:02 @ali tarafından submit   │ │
│ │                  │                                │  · 14:05 @ben tarafından opened   │ │
│ │ State            │                                │                                   │ │
│ │ • Açık         8 │                                │                                   │ │
│ │ • Ertelenen    1 │                                │                                   │ │
│ │ • Tamamlanan   5 │                                │                                   │ │
│ └──────────────────┴──────────────────────────────┴──────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

Tasarım kararları:
- Üçlü kolon Phase 3'te. Phase 1-2'de drawer yeter.
- Sağ önizleme paneli — vaka geçmişi `CaseActivity`'den çekilir.
- Klavye: `J/K` satır geziniyor, `E` open case, `A` approve, `R` reject, `S` snooze, `D` done. (§7.G)
- Multi-select Phase 4 (`Shift+Click`).

### 7.D. Row anatomy

Bir satırın bilişsel yükü 4 saniyede tamamlanmalı:

```
┌─[icon] kind label                       case # · timestamp ─┐
│        İLK SATIR — kısa özet (1 line, ellipsis)              │
│        [info-icon] Why? bir cümle (gri, 11px)                │
│        [Vakayı Aç] [Primary action] [Snooze] [Dismiss]       │
└────────────────────────────────────────────────────────────┘
```

- Icon kind'a göre değişir (mevcut).
- Sağ üst köşede yalnızca timestamp ve case number.
- "Why?" inline; tooltip / drawer YOK.
- Primary action kind'a özel:
  - approval_pending → `Onayla` (+ Reddet)
  - approval_decided → `Okundu`
  - case_returned_to_assignee → `Tamamlandı`
  - mention → `Yorumu Aç` (vakaya yorumlardaki noktaya scroll)
  - dispatch_manual_confirm → `Manuel Hallettim` (Phase 2B)
  - case_assigned → `Vakayı Aç`
  - sla_at_risk → `Vakayı Aç` + `Ertele` (1 saat preset)
  - pattern_alert → `Detayı Gör` (analytics'e link)

### 7.E. Bell counter logic

```
İşler counter  = actionRequired=true AND state IN (Pending, InProgress)
Bildirimler counter = actionRequired=false AND state IN (Pending, InProgress)
                    + (Phase 2A'dan sonra) readAt=null FYI satırlar (eski "unread bildirim" davranışı)
Snoozed counter = state = Snoozed (drawer içinde gösterilir, bell'de gösterilmez)
Done sekmesi    = state IN (Done, Dismissed, Expired), son 7 gün
```

Sayaçlar 60s polling + `app:action-center-changed` event ile invalidate (mevcut). Phase 5'te WS push.

### 7.F. Boş durumlar — kelime kelime

| Sekme | Mesaj |
|---|---|
| İşler | "Şu an senden aksiyon bekleyen iş yok." (mevcut) |
| Bildirimler | "Yeni bilgilendirme yok." (mevcut) |
| Ertelenen | "Ertelenmiş iş yok." (mevcut) |
| Tamamlanan | "Son 7 günde tamamlanmış iş yok." (mevcut) |
| Bahsetmeler (P3) | "Yeni bahsetme yok." |
| Onaylar (P3) | "Bekleyen onayın yok." |
| Müşteri İletişimi (P3) | "Müşteriye iletilecek bir mesaj yok." |
| Sistem (admin, P4) | "Sistem uyarısı yok." |

Tonalite: sevincin kabul edildiği bir his ("temizsin") veya nötr; spammy ego dili yok ("Harika iş!").

### 7.G. Klavye kısayolları (Phase 3)

```
?         help overlay
J / K     satır gezin
Enter     primary action
E         vakayı aç (open case)
A         approve
R         reject + inline reason
S         snooze + preset picker
D         done
X         dismiss + optional note
M         mute this case (Phase 4)
/         search (Phase 4)
```

Sözleşme: J/K her zaman list nav, Enter her zaman primary. Slack/Linear pattern'i.

### 7.H. Mobile / dar viewport

- Drawer mobilde tam ekran (mevcut backdrop pattern).
- Full-page Inbox <lg breakpoint'inde sol kolon collapse → top filter chip bar.
- Row eylem sayısı mobile'da 3'ten fazla olursa "..." (overflow menu).

### 7.I. Accessibility

- Aria-label hep doldurulur (mevcut bell + drawer pattern korunur).
- Focus trap drawer/full-page'de.
- Tab order: filter → liste → preview → actions.
- Renkli badge'lerin yanında tekstual etiket (color-blind safe).
- Klavye-only kullanıcı bir satırı tamamen yönetebilir.

### 7.J. Undo

- "Done" / "Dismiss" sonrası 5sn toast: "Geri al". Phase 4.
- Phase 2-3'te undo yok; satır listesinden bir sonraki refresh'te `Tamamlanan` sekmesinden geri açılır.

---

## 8. Interaction design — action katalogu

| Aksiyon | UI nereden tetiklenir | Backend | Phase |
|---|---|---|---|
| Open case | satır → "Vakayı Aç" | `/api/cases/:id` (mevcut, auto-InProgress hook) | 1 |
| Approve | satır → "Onayla" | `/api/approvals/:id/approve` (mevcut) | 1 |
| Reject | satır → "Reddet" + reason | `/api/approvals/:id/reject` (mevcut) | 1 |
| Mark Done | satır → "Tamamlandı" / "Okundu" | `/api/action-center/:id/done` (mevcut) | 1 |
| Mark Read | FYI satır görüntülenir (intersection observer) | `/api/action-center/:id/read` *(yeni — Phase 2B)* | 2B |
| Snooze | satır → preset (1sa/yarın/pazartesi) | `/api/action-center/:id/snooze` (mevcut) | 1 |
| Dismiss | satır → "Yok Say" + opsiyonel not | `/api/action-center/:id/dismiss` (mevcut) | 1 |
| Copy message | dispatch satırı → "Mesajı Kopyala" | clipboard (mevcut card davranışı, inbox satırına taşınır) | 2B |
| Open mail draft | dispatch satırı → "Mail Taslağı" | `mailto:` (mevcut) | 2B |
| Manuel Confirm | dispatch satırı → "Manuel Hallettim" + delivery note | mevcut endpoint | 2B |
| Follow / unfollow | vaka detayı → satır + inbox row → "Bu vakayı takip etme" | gelecekteki watcher tablosu | 5 |
| Mute case | row context menu → "Bu vakayı sustur" | watcher mute flag | 4 |
| Mute category | filter chip context → "Bu kategori sus" (user pref) | user pref tablosu | 4 |
| Batch Done | full-page liste, Shift+click | bulk endpoint | 4 |
| Saved view | full-page header → "Yeni saved view" | user pref | 4 |
| Search | full-page top search | `/api/action-center?q=...` | 4 |

### 8.A. "Read" vs "Done" semantiği — net ayrım

- **Read**: FYI satır görünür alana girdi, intersection observer 1sn üzeri kalınca `readAt = now`. Sayaç düşmez (kullanıcı oradan ayrılana kadar açık), ama bir sonraki yüklemede gri sayaç düşmüş olur. Phase 2B.
- **Done**: kullanıcı bilinçli `Tamamlandı` / `Okundu` butonuna bastı. Satır `Tamamlanan` sekmesine geçer. Geri açılabilir (Phase 4 undo).
- **Snoozed**: gönüllü geri bildirim — şu an değil ama unutmak istemiyorum.
- **Dismissed**: "bu satır benim için anlamlı değil, yok say" — Done'dan farkı: outcome `dismissed`, audit'te ayrı.
- **Expired**: sistem kapattı (multi-approver sibling, ya da `expiresAt` Phase 4'te).

---

## 9. Notification lifecycle / semantics

```
[Created] ─ adapter emit ─→ Pending
                 │
        firstSeenAt set     ↓
                          InProgress
                             │
                             ├── readAt set (FYI) → kalır InProgress
                             │
                             ├── snooze → Snoozed ─(snoozedUntil < now / lazy wake)→ Pending
                             │
                             ├── markDone → Done
                             ├── dismiss → Dismissed
                             ├── sibling-of approval decided → Expired (mevcut)
                             └── retention cron / expiresAt → Expired (Phase 4)

[Suppressed] = adapter emit ETMEDİ; audit: NotificationDispatch.suppressionReason var.
```

### 9.A. State'in görünürlüğü

| State | İşler sekmesi | Bildirimler | Ertelenen | Tamamlanan | Bell sayaç |
|---|---|---|---|---|---|
| Pending (actionRequired) | ✓ | | | | kırmızı |
| Pending (actionNotRequired) | | ✓ | | | gri |
| InProgress | ✓ (action) / ✓ (FYI) | | | | mevcut sayaç |
| Snoozed | | | ✓ | | yok |
| Done | | | | ✓ | yok |
| Dismissed | | | | ✓ | yok |
| Expired | | | | ✓ | yok |
| Suppressed | hiç yazılmadı | — | — | — | — |

---

## 10. Role-based behavior

| Rol | Görür | Yapamaz |
|---|---|---|
| **Agent** | kendisine düşen tüm kategoriler; "Sistem" yok | Cross-tenant; başkasının inbox'u |
| **Supervisor** | kendisi + role bazlı approval_pending / pattern_alert; "Sistem" yok | Başka supervisor'ün inbox'u |
| **CSM** | atandığı vakalar + müşteri iletişimi; opsiyonel mention | Agent inbox'una giriş |
| **Backoffice** | atandığı vakalar; agent gibi | Approval karar verme (role kapsamında değilse) |
| **Admin** | kendisi + admin-rolüne düşen sistem uyarıları (`system_alert`) | Cross-tenant okuma (UserCompany kapsamı dışında) |
| **SystemAdmin** | tüm tenant'lar (explicit `?companyId=` ile filtre) | — |

Kurallar:
- Tek inbox satırı = tek `userId`. Phase 3'e kadar takım/role inbox'u yok (§18.G).
- Multi-approver fan-out (Phase 1 hotfix) hâlâ: aynı `objectId` için N kullanıcıya ayrı satır, biri karar verince diğerleri Expired.
- Role değişikliği: kullanıcı supervisor'lükten düşerse, eski `approval_pending` satırları **olduğu yerde kalır**. Karar verme yetkisi `userIsEligibleApprover`'da re-resolve ile kontrol edilir (mevcut hotfix). Yani inbox'ta görülür ama clickte 403 alınır. Phase 4'te admin "stale clean" cron'u eklenebilir.

---

## 11. Grouping & dedup

### 11.A. Dedup — aynı şey iki kez gelmez

Mevcut `dedupKey` semantiği genişletilir:

| Olay | dedupKey örüntüsü |
|---|---|
| approval_pending (per approver) | `${companyId}:${userId}:approval_pending:${approvalId}` |
| approval_decided (per submitter) | `${companyId}:${submittedByUserId}:approval_decided:${approvalId}` |
| case_returned_to_assignee | `${companyId}:${assigneeUserId}:case_returned:${caseId}:${approvalId}` |
| mention (Phase 2A) | `mention:${caseMentionId}` |
| dispatch_manual_confirm (Phase 2B) | `dispatch:${notificationDispatchId}` |
| case_assigned (Phase 2C) | `case_assigned:${caseId}:${newAssignedPersonId}` |
| case_sla_at_risk (Phase 3) | `case_sla_at_risk:${caseId}:<yyyy-mm-dd>` (günlük çoğullama önleme) |
| pattern_alert (Phase 3) | `pattern_alert:${patternAlertId}` |

### 11.B. Grouping — UI'da kümeleme

`groupKey` ortak satırlar UI'da accordion altına toplanır (Phase 3):

```
┌─ CASE #2415 (4 satır)
│ · Çözüm onayı bekliyor   (action)
│ · @ali yorum yaptı       (mention)
│ · Atandın                 (FYI)
│ · SLA 4 saat              (warn)
└─
```

Default açık. Tek satırlık gruplar kümelenmez. Phase 2'de gruplama yok.

### 11.C. Quiet hours / rate limit

- **Inbox'a rate limit yok.** Inbox audit + iş listesidir, müşteri-facing değildir; bastırma müşteri iletişiminde geçerli (`NotificationDispatch.suppressionReason`).
- Eğer Phase 5+'da push/realtime gelirse, push frekansı için ayrı rate limit.

---

## 12. Migration strategy — eski yüzeylerden yeniye

### 12.A. Geri uyumluluk ilkesi

Her phase **bir önceki phase'in canlı kullanıcısını bozmaz**. Eski yüzey kaybolurken yeni yüzey ona eşdeğer ya da üstün olur. Phase 1 hotfix'in dersi: "yardım drawer'ı UI'yi bozdu" — küçük bir özellik bile pilotu rahatsız edebilir.

### 12.B. Eski mention bell'i ne zaman söndürülür?

- Phase 2A'da bell **gizlenir** (`MentionBellBadge` render edilmez) ancak component dosyası ve service çağrıları kalır.
- Pilot iki haftadan az sürerse, geri açılabilir tek satır feature flag ile: `VITE_LEGACY_MENTION_BELL_ENABLED` (default false).
- Phase 3 başında dosya silinir.

### 12.C. AISuggestionsPanel ne olur?

- Phase 2A'da yeniden adı net olur: "RUNA Önerileri".
- İçeriği: `getDashboard.pendingApprovals` heuristik kalır.
- Inbox'tan tamamen ayrı tutulur; sayaçlara dahil değil.
- Phase 3+'ta RUNA önerileri gerçek AI signal'larla zenginleşebilir; ayrı kart.

### 12.D. Yarım kalmış görünmemek için "minimum complete"

Bir phase canlıya çıktığında "yarım kalmış" hissi vermesin diye her phase'in **görünür değer cümlesi** vardır:

| Phase | Görünür değer cümlesi |
|---|---|
| 2A | "Tek zilim var artık. Bahsetmeler ve aksiyonlarım aynı yerde." |
| 2B | "Müşteriye yazacağım mesajları da Aksiyonlarım'dan görebiliyorum." |
| 2C | "Bir vaka bana atandığında haber alıyorum." |
| 3 | "Inbox'umun tamamını bir sayfada görebiliyorum, klavyeyle yönetiyorum." |
| 4 | "Saved view'lerimi kurdum, toplu işlem yapabiliyorum." |
| 5 | "Realtime — bildirim için sayfayı tazelemiyorum." |

---

## 13. Teknik mimari

### 13.A. API rotaları

Mevcut (Phase 1):
- `GET    /api/action-center` — list (`view`, `state`, `kind`, `limit`, `offset`, `companyId`)
- `GET    /api/action-center/summary` — counts
- `POST   /api/action-center/:id/done`
- `POST   /api/action-center/:id/snooze`
- `POST   /api/action-center/:id/dismiss`

Eklenecek (Phase 2-4):
- `POST   /api/action-center/:id/read` — Phase 2B (FYI explicit read)
- `POST   /api/action-center/bulk/done` — Phase 4 (bulk; idempotent)
- `POST   /api/action-center/bulk/dismiss` — Phase 4
- `GET    /api/action-center/views` — Phase 4 (saved views)
- `POST   /api/action-center/views` — Phase 4
- `DELETE /api/action-center/views/:id` — Phase 4
- `POST   /api/action-center/:id/mute-case` — Phase 4 (mute affected case scope)
- `POST   /api/action-center/preferences/mute-category` — Phase 4
- `WS     /api/action-center/stream` (sub-route) — Phase 5 push

### 13.B. Repository / service katmanı

Mevcut `actionItemRepository.js` korunur. Eklemeler:

- `markRead({ id, userId, allowedCompanyIds })` — FYI explicit read; idempotent.
- `bulkUpdate({ ids, op, userId, allowedCompanyIds })` — Phase 4. Owner-only her id için.
- `listByCategory({ userId, category, ... })` — `category` kolonu eklendikten sonra.

Yeni dosya (Phase 2A):
- `server/db/mentionInboxAdapter.js` — `CaseMention` create hook'unda `emitActionItem({ kind: 'mention', ... })` çağırır.

Yeni dosya (Phase 2B):
- `server/db/dispatchInboxAdapter.js` — `NotificationDispatch` lifecycle hook (state=Pending → manual_confirm gerekli durumlarda emit).

Yeni dosya (Phase 2C):
- `server/db/caseAssignmentInboxAdapter.js` — `caseRepository.update`'te `assignedPersonId` değişikliğinde emit.

Yeni dosya (Phase 3):
- `server/cron/sla-inbox-cron.js` — periyodik tarama, `case_sla_at_risk` / `case_sla_breach` emit. Vercel Cron'a bağlanır (`vercel.json`).

### 13.C. Event emission patterns

Tüm adaptörler tek pattern:
```js
void emitActionItem({
  kind: '<kind>',
  userId: <recipient>,
  companyId: caseRow.companyId,
  objectType: '<table>', objectId: <id>,
  caseId, caseNumber, caseTitle,
  dedupKey: '<deterministic>',
  priority: <50|70|90>,
  actionRequired: <bool>,
  reasonLabel: 'Çünkü ...',
});
```

`void` — fire-and-forget. Hiçbir adapter hata kaynağın hayat döngüsünü bozmaz. (Phase 1'de uygulanan pattern.)

### 13.D. Idempotency

`dedupKey` partial unique index zaten bunu garanti ediyor. Tüm yeni adaptörler dedupKey üretirken **deterministik**: aynı kaynak ID'den aynı dedupKey her zaman çıkmalı.

### 13.E. Race conditions

- **Submit + immediate approve** (PR #271 fan-out yarışı): mevcut `closeActionItemsForApproval` + `expireSiblingActionItemsForApproval` yarış durumlarını kapatıyor.
- **Snooze + lazy wake**: lazy wake `listForUser` çağrısında gerçekleşir, transactional değildir; iki client aynı anda summary çağırırsa snooze'lu satır iki kez Pending'e çekilebilir → idempotent updateMany sorun yapmaz.
- **Multi-approver decide ortak yarışı**: Phase 1 hotfix ile authority re-resolve + ApprovalAccessError zaten correct.

### 13.F. Cache invalidation

Frontend: `app:action-center-changed` custom event mevcut.
- Yeni emit eden adapter eklendiğinde **HTTP response sonrası** UI event dispatch eder (e.g. `caseRepository.update` 200 dönerken).
- Backend WS push (Phase 5'te) bu event'i de yayar.

### 13.G. Polling vs realtime

| Yöntem | Phase | Sebep |
|---|---|---|
| Polling 60s + event-driven invalidate | 1–4 | Vercel serverless ucuz; pilot operatör sayısı düşük |
| WebSocket / SSE push | 5 | Operatör sayısı >50 ve real-time istekleri gelmeye başlarsa |

Polling'in toplam yük tahmini (Phase 2-3): 100 operatör × 60s polling × 2 query (summary + list) = 200 r/s avg. Supabase Postgres + index'lerle altıda biri (~33 r/s) effective. Limit içinde.

### 13.H. Performans bütçesi

- `/summary` ≤ 100ms p50, ≤ 300ms p95.
- `/list` ≤ 250ms p50, ≤ 600ms p95.
- Mevcut 5 index yeterli; `(userId, category, state)` index'i Phase 2B'de eklenecek.
- Inbox satır sayısı bir kullanıcı için tipik 10-50 active; >200 olduğunda performans alarm.

### 13.I. MSSQL / on-prem portability

- Prisma enum'lar MSSQL'de check constraint olarak emit edilir — uyumlu.
- Partial unique `dedupKey` → MSSQL filtered index. Uyumlu.
- `Json?` kolonlar (eklenmesi planlanan `metadata`) MSSQL'de `nvarchar(max)` — kabul edilebilir.
- WS push MSSQL'i etkilemez; transport layer.

### 13.J. KVKK / audit

- `metadata` JSON alanı **PII içeremez**. Adapter sözleşmesi.
- `previewText` müşteri verisi sınırlı: ad-soyad, e-posta hash, vaka konusu kısaltma. KVKK envanterine eklenir.
- `NotificationDispatch` ayrı audit zinciri (operasyon audit).
- `ActionItem` üzerinde değişiklik tarihçesi: state geçişleri `updatedAt` + `doneAt` ile audit'lenir; daha derin audit isteği gelirse `actionItemActivity` ayrı tablosu eklenebilir (Phase 5).

---

## 14. Güvenlik

| Boyut | Kural |
|---|---|
| Tenant isolation | Her okuma `companyId IN allowedCompanyIds`. Her yazma `loadOwnedItemOr403` — owner + tenant double-check (mevcut). |
| User ownership | Mutation = owner only. Cross-user even within tenant 403. |
| Team / role inbox | Phase 3'e kadar yok. Geldiğinde her satır userId'ye yazılır, takım inbox'u read-only projection olur (read scope = takım üyeleri); writeback userId'ye düşer. |
| SystemAdmin | Cross-tenant explicit `?companyId=` ile (mevcut). Default ALL tenant aggregate verir; sayfa başı uyarı: "Cross-tenant görüntü." |
| Stale access | Kullanıcı rolden / şirketten düşürüldüğünde: a) eski inbox satırları kalır (audit); b) UserCompany silinirse `allowedCompanyIds` boşalır → list/summary 0 döner; c) eski snooze/done eylemleri eski tenant'a yazılır ama o tenant artık görünmez. Phase 4'te admin "kullanıcı pasifleştir → inbox'u snooze veya archive" workflow'u. |
| PII in preview | adapter sözleşmesi: `previewText` 200 karakter cap, vaka başlığı kısaltma, kişi adı OK; e-posta / telefon numarası hashlenir veya kesilir. |
| Link auth | Inbox satırından `Vakayı Aç` çağrısı `/api/cases/:id` üzerinden, mevcut `allowedCompanyIds` guard. Inbox satırı varlığı yetki imali etmez. |

---

## 15. In-product help — standart (Phase 1 dersinin uygulaması)

**Kural:** Drawer içine "Yardım" butonu YOK. Phase 1 hotfix bunu çıkardı; geri eklemek bir tasarım gerilemesidir.

**Bunun yerine:**

1. **Empty state copy** = micro-onboarding. Her sekme boşken anlam taşır (§7.F).
2. **`reasonLabel` her satırda** — "neden buradayım?" sorusunun yanıtı zaten satırda.
3. **Tooltip** bell üzerinde; aria-label aynı.
4. **Help registry'de admin topic** — `approval-notifications` ve gelecek `notification-center-admin` topic'leri admin için.
5. **Full-page Inbox'ta header `(?)` küçük popover** (Phase 4+ opsiyonel) — sadece klavye kısayolları cheatsheet'i; "ne demek X kind?" değil.
6. **smoke-help-content** çalışır — eklenen her admin topic için keyword check.

### 15.A. Yeni admin topic adayı

- `topic: 'notification-center-admin'` — admin için: inbox kaynak adaptörleri nelerdir, hangi event hangi inbox row'una düşer, audit hangi tabloda. Phase 2B'de eklenebilir (audience: `admin`).

### 15.B. Operator helpRegistry topic'i

Operator için ayrı topic eklenmez. Phase 1'de pilotluğunu yaptık ve çıkardık. Drawer kendi kendini açıklasın.

---

## 16. Metrikler

| Metrik | Tanım | Hedef (pilot sonrası 30 gün) |
|---|---|---|
| Inbox open rate | DAU üzerinde inbox bell tıklama oranı | ≥ 0.7 (10 günde ortalama) |
| Time to first action | Yeni `actionRequired=true` satırdan ilk state geçişine süre | p50 < 4 saat (business hours), p95 < 24 saat |
| Stale item count | 7 gün üzeri Pending+InProgress satır sayısı | < 5 per active user |
| Snooze rate | Tüm aktif satırlardan snooze'a düşen oran | < %20 (üzerinde olursa "noise" sinyali) |
| Dismiss rate | Aktif satırlardan dismiss'a düşen oran | < %10 |
| Approval time-to-decision | submit → approve/reject süresi | p50 < 8 saat |
| Noise ratio | Tüm satırlardan dismiss + expire + snooze oranı | < %30 |
| FYI read rate (Phase 2B) | FYI satırların readAt set edilme oranı | ≥ %60 (7gün) |
| Manual comm completion | dispatch_manual_confirm → state=Done | ≥ %90 (7gün) |
| Per-role workload | Pending + InProgress avg/role | Agent < 15, Supervisor < 25 |

Metrikler `inbox_metrics` view'ı olarak Phase 4'te eklenir. Phase 1-3'te ad-hoc query.

---

## 17. Riskler ve anti-patterns

| # | Risk / anti-pattern | Hafifletme |
|---|---|---|
| A | **İki bell aynı anda kalır.** Pilot kafa karıştırır. | Phase 2A'da eski bell hemen gizlenir, code dosyası 2 hafta saklanır. |
| B | **Action ve FYI karıştırılır.** Kırmızı sayaç anlamını kaybeder. | İki sayaç kuvvetli görsel ayrım; FYI'ya yanlış `actionRequired:true` atayan adapter unit test ile yakalanır. |
| C | **Unread count anxiety.** Slack-style mavi nokta yığılır. | "Read" semantiği ekstra UI urgency vermez — sayaç düşürür. Tamamlanan sekmesi kullanıcı kontrolünde. |
| D | **Aksiyonsuz satırlar.** "Çağrı kaybedildi" der ama yapacak bir şey yoktur. | Her kind için `Primary action` zorunlu (§7.D); adapter onsuz emit edemez. |
| E | **Duplicate satır.** Aynı şey iki yerden gelir. | `dedupKey` ve adapter sözleşmesi. Yeni adapter PR'ı dedupKey örüntüsünü zorunlu tutar (review). |
| F | **Hidden feature flag.** Phase'lerden biri prod'da OFF kalır, kullanıcı kafası karışır. | `VITE_ACTION_CENTER_ENABLED` zaten doc'lu. Her yeni flag aynı standartla `.env.example` + planning card. |
| G | **Help drawer UI'yi bozar.** | YOK. Tartışılmıyor. §15. |
| H | **Technical kind UI'ya sızar.** Operatör "approval_pending" görür. | Her kind için `KIND_LABEL` map; UI hiçbir yerde enum string'i göstermez. Smoke / lint kuralı: yeni kind eklenirken KIND_LABEL'sız compile fail. |
| I | **Backfill sürprizi.** Phase 2A'da geçmiş bahsetmeler aniden inbox'a yüklenir, kullanıcı 200 satırla karşılaşır. | Backfill `firstSeenAt=now`-set ile sessiz; sayaçlar `Bildirimler`'e gider, `İşler` sekmesi temiz kalır. |
| J | **Eski ve yeni sistem aynı şeye farklı diyor.** | Migration sırasında çift yazma yok — Phase 2A'da emit ETMEYE başlanır + okuma kapatılır (eski bell gizli). Geri çevirme: feature flag. |
| K | **Phase 5 push devreye girince frontend state inconsistent.** | Phase 5'ten önce frontend state management Redux/Zustand ile merkezileştirilir; şu an local useState. |
| L | **SLA bildirimi her saat tekrar.** | dedupKey günlük (`yyyy-mm-dd`) keyleme. |

---

## 18. Açık ürün kararları

Bu kararlar implementation prompt'tan ÖNCE verilmeli. Önerilen default'lar parantezde.

### 18.A. Tek bell vs çift bell — geçiş dönemi

- A1. Phase 2A'da eski bell **anında gizlenir** ve `mention` adapter Backfill çalışır. *(Önerilen)*
- A2. İki bell 2 hafta birlikte kalır, sonra eski kapatılır.
- A3. Tek bell ama eski bell'in içeriği yeni drawer'a "Bahsetmeler" sekmesi olarak Phase 2A'da gelir.

> **Tavsiye: A1.** En düşük çift-okuma riski. Backfill ile geçmiş kaybolmaz. Feature flag ile geri açılabilir.

### 18.B. Türkçe ürün adlandırması

- B1. **"Aksiyonlarım"** mevcut canlı isim. *(Önerilen)*
- B2. "Bildirim Merkezi" — daha klasik, ama "İşler" kavramını altında ezer.
- B3. "Varuna Inbox" — kod adı / satış malzemesi, kullanıcı UI'sinde değil.

> **Tavsiye: B1 kullanıcı UI'sinde, B3 iç kod ve satış malzemesinde.**

### 18.C. Bahsetmeler — FYI mi, ayrı sekme mi?

- C1. Bahsetmeler **FYI içinde**, `mention` kind'ı ile (sayaç gri). *(Önerilen Phase 2A)*
- C2. Ayrı "Bahsetmeler" sekmesi (Phase 3'te eklenir).

> **Tavsiye: Phase 2A'da C1, Phase 3'te C2.** Phase 2A inbox'ı bozmamak için minimum müdahale.

### 18.D. Müşteri iletişim görevleri (dispatch_manual_confirm) actionRequired mı?

- D1. Evet — `actionRequired=true`, "İşler" kırmızı sayacı. *(Önerilen)*
- D2. Hayır — "Bildirimler" gri sayaç; operatör elle açar. UI sürtünmesi düşer ama görev "kaybolur".

> **Tavsiye: D1.** Manuel müşteri iletişimi audit'i kritik — kaybolmamalı.

### 18.E. AI önerileri inbox'ta mı?

- E1. **Hayır** — "RUNA Önerileri" MyHome'da ayrı kart. Inbox sayaçlara dahil değil. *(Önerilen)*
- E2. Inbox'ta `suggestion` kind'ı altında, ayrı kategori.

> **Tavsiye: E1.** Heuristik / AI öneri "neden buradayım?" testini geçemez; her cümlesi "muhtemelen" der. Inbox kesinlikle aksiyon kuyruğudur; öneri belirsizdir.

### 18.F. Retention

- F1. 90 gün sonra Done/Dismissed/Expired satırlar cold storage (audit kaldır). *(Önerilen)*
- F2. Sınırsız — disk büyür ama audit her zaman erişilebilir.

> **Tavsiye: F1.** Cron Phase 4'te. Cold storage = ayrı tablo ya da `archivedAt` alanı + index dışı bırakma.

### 18.G. Takım inbox'u var mı?

- G1. **Yok** — Phase 1-3'te tek alıcı. Multi-approver fan-out gerekli işi görüyor. *(Önerilen)*
- G2. Takım inbox'u — bir takıma düşen iş tek satır olarak takım üyelerinde görülür; biri "claim" eder. Karmaşa yüksek.

> **Tavsiye: G1.** Multi-approver fan-out + dedupKey zaten bunu çözüyor. Takım inbox'u tartışmasını Phase 5'e bırak.

### 18.H. Full-page inbox Phase 1 mi Phase 2 mi?

- H1. **Phase 3'te.** *(Önerilen)* Drawer Phase 2A/B/C'de yeterli olmalı.
- H2. Phase 2A'da `/inbox` rotası açılır.

> **Tavsiye: H1.** Phase 2A/B/C'de görünür müşteri değeri yüksek; full-page olmadan eksik hissedilmez.

### 18.I. Bildirim sesi / toast

- I1. **Yok.** Operasyonel sistem, müzik mağazası değil. Bell sayaç yeter. *(Önerilen)*
- I2. Kritik kind'larda (`case_sla_breach`) küçük toast.

> **Tavsiye: I1.** Toast'lar yorucu. Ekran üstü kritik signal ihtiyacı doğarsa: I2 + opt-in user preference.

### 18.J. Realtime vs polling

- J1. Polling 60s + event-driven invalidate. *(Önerilen Phase 1-4)*
- J2. WS / SSE push Phase 5.

> **Tavsiye: J1 → J2.** Polling cost düşük; push gerekliliği metrik (§16) ile tetiklenir.

### 18.K. Mute / follow / preferences

- K1. Mute case ve mute category Phase 4. *(Önerilen)*
- K2. Phase 2'de mute case → daha az satır → daha az feedback.

> **Tavsiye: K1.** Phase 2 / 3 minimum davranış değişikliği — mute eklemek "noise"'ı yapay düşürür ve metriği yanıltır.

### 18.L. Onboarding panelleri

- L1. **Yok**. Inbox kendini açıklasın. *(Önerilen)*
- L2. İlk login'de small product tour overlay.

> **Tavsiye: L1.** Phase 1 hotfix dersi.

---

## 19. Önerilen implementation yolu

### 19.A. İlk uygulanacak phase

**Phase 2A — Tek Zil**

Kapsam:
1. `MentionBellBadge` UI'dan gizle (feature flag `VITE_LEGACY_MENTION_BELL_ENABLED=false`).
2. `CaseMention` create hook'unda `emitActionItem({ kind:'mention', ... })`.
3. `CaseNotification` (eski) create hook'unda `emitActionItem({ kind:'<eşleşen kind>', ... })`.
4. Backfill scripti: `scripts/backfill-mention-to-inbox.js` (admin'in elle çalıştırdığı dev DB tool; canlıda 1 kez).
5. Drawer'da `mention` kind için `KIND_LABEL`, icon, primary action ("Yorumu Aç").
6. `reasonLabel` template'leri.
7. Smoke: `smoke-mention-inbox-flow.js`.

Kapsam DIŞI:
- Yeni şema kolonu yok.
- Drawer layout değişmez (eskisi gibi 4 sekme).
- Read/unread semantiği (Phase 2B).
- Full-page inbox (Phase 3).

Tahmini iş:
- Backend ~150 satır.
- Frontend ~80 satır (mention KIND_LABEL + icon + primary action).
- Migration: 0.
- Smoke: 5-7 scenario.
- 1 PR, 1 commit yeterli olmalı.

### 19.B. Phase 2A'dan sonra

- **Phase 2B — Müşteri İletişimi**: `dispatch_manual_confirm` adapter + readAt + category kolonu (1 küçük migration).
- **Phase 2C — Atama / transfer**: caseRepository.update hook + iki yeni kind aktif. Migration 0.
- **Phase 3 — Full-page Inbox**: `/inbox` rotası, üçlü kolon, klavye kısayolları, SLA cron. Migration 0–1.
- **Phase 4 — Power Features**: saved view, bulk action, mute, retention cron, severity, undo. Birkaç küçük migration.
- **Phase 5 — Realtime + Watcher**: WS, watcher_event, team-inbox tartışması, push opt-in.

### 19.C. Kaçınılacaklar

- Phase 2A'dan ÖNCE schema değişikliği yapmak — gereksiz.
- Phase 2A'dan ÖNCE drawer redesign — pilot stres yapar.
- Eski mention bell'i Phase 2A'da bırakmak — çift okuma.
- Inbox'a AI suggestion eklemek.
- Toast / sound eklemek.
- Help drawer geri eklemek.

### 19.D. Deprecate edilecekler

- `MentionBellBadge` (Phase 2A gizlenir, Phase 3 silinir).
- MyHome'daki `AISuggestionsPanel`'ın "Önerilen Aksiyonlar" başlığı → "RUNA Önerileri" rebrand (Phase 2A).

### 19.E. Geçici tutulacaklar

- `caseService.listUnreadMentions` ve `listUnreadNotifications` endpoint'leri Phase 2A'da yedek olarak ayakta (yeni adapter çalışmazsa toggle).
- Phase 3'te silinir.

### 19.F. Implementation'dan önce karara bağlanması gerekenler

1. §18.A (tek bell vs çift bell)
2. §18.B (Aksiyonlarım vs Bildirim Merkezi)
3. §18.C (Bahsetmeler FYI mi ayrı sekme mi — Phase 2A için)
4. §18.D (manuel customer comm actionRequired mı)
5. §18.E (AI önerileri inbox'ta mı)
6. §18.H (full-page Phase 1 mi Phase 3 mi)
7. Phase 2A backfill stratejisi: tüm tarihçeyi mi yoksa son 30 günü mü?

Bu 7 karar olmadan implementation prompt yazma.

---

## 20. DO NOT RUN YET — Implementation Prompt Draft

> **NOT:** Aşağıdaki taslak prompt **uygulanmamalıdır**. Önce §18 kararları verilmeli, §19.F'deki 7 madde cevaplanmalı. Sonrasında bu prompt finalize edilip ayrı bir komut olarak verilir.

```
TASK: WR-NOTIFICATION-CENTER Phase 2A — Tek Zil (Mention adapter + legacy bell gizleme)

Source of truth:
docs/planning_cards/WR-NOTIFICATION-CENTER-VARUNA-INBOX.md (özellikle §5.B, §11.A, §17.A, §19.A)

Strict scope:
- Bahsetmeleri ActionItem'a feed eden adapter.
- Eski MentionBellBadge UI'dan gizle (feature flag ile geri açılabilir).
- ActionItemRow'da `mention` kind için KIND_LABEL + icon + primary action ("Yorumu Aç").
- reasonLabel template.
- One-shot backfill scripti — yalnız admin'in elle çalıştırdığı dev DB tool, prod'a default OFF.
- Smoke scenarios: 7 senaryo (emit, idempotent, tenant scope, deduper key, primary action open).
- Phase 2B/2C/3 işine GİRME.
- Şema değişikliği YOK (Phase 2A'da hiçbir kolon eklenmez).
- Drawer layout değişmez (4 sekme aynı).
- helpRegistry değişmez.

Required behaviors:
- CaseMention.create veya equivalent hook → void emitActionItem({ kind: 'mention', ... })
- dedupKey = `mention:${caseMention.id}`
- reasonLabel = `"@${actor.shortName} ${case.caseNumber} yorumunda seni andı."` (Türkçe, "bahsetti" da olabilir; copy review)
- actionRequired = false (FYI default; bahsetme her zaman aksiyon GEREKTİRMEZ; review karar)
- VITE_LEGACY_MENTION_BELL_ENABLED feature flag (default false). True olunca MentionBellBadge eski davranışla render edilir.
- Backfill script: idempotent, paralelleştirilmemiş, `--dry-run` desteği. Var olan ActionItem'lar dedupKey ile çift atılmaz.

Validation:
- smoke-mention-inbox-flow (yeni)
- smoke-action-center-phase1 (regression — 21/21 PASS aynı)
- smoke-help-content (unchanged — 2 topics)
- tsc clean
- vite build clean
- legacy bell hidden (manual check)

Out of scope:
- readAt, category, severity, metadata kolonları (Phase 2B)
- dispatch_manual_confirm (Phase 2B)
- case_assigned/transfer (Phase 2C)
- full-page /inbox (Phase 3)
- bulk / saved views (Phase 4)
- WS push (Phase 5)

Final report: files changed; smoke results; legacy bell deactivation confirmation; backfill script usage; what was NOT touched.
```

> Yine — bu yalnızca taslak. Uygulanmadan önce §19.F'deki kararlar finalize edilmeli.

---

## A. Cross-reference

- `docs/planning_cards/WR-ACTION-CENTER.md` — Phase 0 konsept kartı.
- `docs/planning_cards/WR-ACTION-CENTER-PHASE1-APPROVAL-VISIBILITY.md` — Phase 1 implementation kartı (canlı).
- `docs/qa/WR-ACTION-CENTER-PHASE1-MANUAL-QA.md` — Phase 1 manual QA referansı.
- `docs/WORK_REGISTER.md` — D3/D4 satırları.
- `prisma/schema.prisma` — `ActionItem`, `ActionItemKind` (14 forward-compat), `ActionItemState`.
- `server/db/actionItemRepository.js` — adapter / repo katmanı.
- `server/db/approvalRepository.js` — approval lifecycle (mevcut hook'lar).
- `src/features/action-center/` — bell + drawer + row.
- `src/features/my/PendingApprovalsPanel.tsx` — "Onayımda Bekleyenler".
- `src/features/cases/components/MentionBellBadge.tsx` — Phase 2A'da gizlenecek bileşen.
- `src/features/cases/components/CommunicationDispatchCard.tsx` — Phase 2B'de inbox'a feed olacak.

## B. Glossary

| Terim | Tanım |
|---|---|
| **Inbox** | Birleşik bildirim + iş kuyruğu yüzeyi. Dahili ad: Varuna Inbox. Operatör ad: Aksiyonlarım. |
| **ActionItem** | Veri katmanı tablosu, inbox satırını taşır. Tablo adı korunur (rename yok). |
| **Adapter** | Bir kaynak event'inden ActionItem üreten kod parçası (fire-and-forget). |
| **Kind** | Inbox satırının tipi (approval_pending, mention, sla_at_risk, vs). Operatöre asla string olarak gösterilmez. |
| **Category** | Operatör-facing gruplama (İşler / Bildirimler / Bahsetme / Onaylar / Müşteri / Sistem). Phase 2B'de kolon olarak gelir. |
| **dedupKey** | Aynı kaynak event'in çift inbox satırı doğurmasını engelleyen anahtar. |
| **groupKey** | Aynı vaka / olayın ilgili satırlarını UI'da kümeleme anahtarı. |
| **actionRequired** | true → İşler (kırmızı); false → Bildirimler (gri). |
| **reasonLabel** | "Niçin buradayım?" sorusunun cevabı — ZORUNLU, boş bırakılamaz. |
| **Read vs Done** | Read = FYI gördüm; Done = bilinçli kapattım. Phase 2B'de explicit ayrılır. |
| **Snoozed** | Sonra ele alacağım. snoozedUntil → otomatik Pending'e geri döner. |
| **Suppressed** | Inbox'a hiç yazılmadı. NotificationDispatch'te audit'lenir (operasyon audit). |

---

## C. Versiyon

| Tarih | Versiyon | Not |
|---|---|---|
| 2026-05-26 | v0.1 | İlk plan (Phase 2A öncelikli). |
