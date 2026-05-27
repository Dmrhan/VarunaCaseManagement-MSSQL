# Backlog — Active Work

**Last audited:** 2026-05-27

Sahiplik:
- Report Studio'ya özgü backlog → [docs/REPORT_STUDIO_BACKLOG.md](REPORT_STUDIO_BACKLOG.md)
- Gelecek ürün yönü + shipped capability envanteri → [docs/ROADMAP.md](ROADMAP.md)
- Teknik borç + temizlik riskleri → [docs/TECHNICAL_DEBT.md](TECHNICAL_DEBT.md)

Bu liste **aktif** iştir — 2–4 hafta içinde dokunulabilir kalemler. Shipped özellikler ve uzak-gelecek planları burada görünmez; bunlar yukarıdaki canonical dokümanlarda.

Öncelik modeli:
- **P0 Production Trust** — güvenlik / veri bütünlüğü açıkları
- **P1 Scale / Reliability** — güvenli büyümenin temeli
- **P2 Product Value** — kullanıcıya görünür iyileştirmeler
- **P3 AI Fabric Expansion** — Faz 2 AI rolleri + sinyalleri
- **P4 Future / Decision-blocked** — nice-to-have veya trigger-bekleyen

---

## P0 — Production Trust

### Status transition state machine (önceki #2)

`server/db/caseRepository.js:1808` `transitionStatus()` herhangi bir `nextStatus`'u kabul ediyor; **yasal-geçiş kontrolü yok**. UI'daki `StatusTransitionPanel` doğru kuralları biliyor — aynı matrisi backend'e taşı, illegal geçişte 422 `invalid_transition` dön.

**Çaba:** 2-3 saat (Vitest landed sonrası 1 günlük test ekle).
**Risk:** Demo / pen-test riski; agent rol'lü kullanıcı doğrudan API çağırırsa `İptalEdildi → Açık` gibi atlamalar mümkün.

### Multi-tenant isolation smoke (önceki #6)

`/api/cases/*`, `/api/lookups/*`, `/api/admin/*`, `/api/ai/*` için cross-tenant denial smoke yok. Phase 1/2/3 dashboard endpoint'leri smoke-covered, geri kalan backbone değil.

**Çaba:** Yarım gün (Vitest geldikten sonra `tenant-isolation.test.js` matrisi olarak yaz).
**Risk:** Bir tek endpoint `allowedCompanyIds` filtresini atlarsa başka müşterinin verisini sızdırır — en yıkıcı bug sınıfı.

### Role permission centralization — `casePolicy.js` (önceki #3)

`server/routes/cases.js` içinde 19 ayrı `elevated`/`Supervisor`/`Admin`/`SystemAdmin` kontrolü var (lines 556, 590, 656 + `requireRole` listeleri 305, 333, 362). `CUSTOMER_MATCH_QUEUE_ROLES` (line 76) gibi subtly different sets var.

Eylemler:
- (a) Bekleyen ürün kararı: kim İptalEder/YenidenAçar/Eskalasyon başlatır/Bulk update/Transfer eder?
- (b) Karar sonrası `server/lib/casePolicy.js` modülüne tüm matris taşınır
- (c) Mevcut dağınık liste'ler tarama + drift düzeltme

**Çaba:** Karar sonrası 1 gün.

---

## P1 — Scale / Reliability

### Vitest framework + first critical tests (önceki #7)

`package.json` no vitest/jest. Tek formel test `server/analytics/__tests__/metricFormulas.test.js`. Bu meta-prerequisite — P0 #2/#5/#6 burayı bekliyor.

İlk test setresi (kurulum sonrası):
- Case create → assignment → transition akışı
- Mention → CaseMention + ActionItem emit
- Watcher add/remove + scope kontrolü
- SLA pause/resume sayaçları
- Tenant isolation matrix (P0 #6 ile birlikte)
- Auth: Agent ↔ Supervisor ↔ Admin yetki sınırları

**Çaba:** 1 gün (kurulum + ~10 test).

### SLA edge case tests (önceki #5)

Pause/resume var, ama smoke yapılmamış edge case'ler:
- Çözüldü/İptal'de SLA gerçekten duruyor mu (UI vs DB)?
- Snooze SLA saatini durduruyor mu?
- `bulkUpdateStatus` (`caseRepository.js:782`) pause mantığını bypass ediyor mu?
- Timezone (`Europe/Istanbul` vs UTC) drift'i var mı?

Vitest landed sonrası tek dosya: `server/__tests__/sla-edge-cases.test.js`.

**Çaba:** Yarım gün.

### AI cost guard / per-company token cap (yeni)

`server/lib/aiClient.js` ve `server/routes/ai.js` tek global `OPENAI_API_KEY` üzerinden çalışıyor; `AIUsageLog.tokenCount` post-hoc kaydediliyor ama kimse okumuyor. Runaway loop veya compromised key bütçeyi yakabilir.

Eylem:
- Per-companyId günlük token cap + 80% threshold admin alert
- `AIUsageLog` üzerinden cron-based daily spend digest
- Limit aşımı: 503 + dashboard uyarısı

**Çaba:** 1 gün.

### Observability stub (yeni)

Sıfır Sentry/Datadog/Prometheus. AIUsageLog dışında kimse hatayı/metriği okumuyor. QA Score Batch cron sadece console'a log atıyor. No `/metrics` endpoint, no synthetic checks.

Önerilen ilk dilim:
- Sentry/Logflare entegrasyonu (prod errors)
- AIUsageLog daily spend digest endpoint
- Cron health log endpoint (`/api/cron/health` — son N saatte kim ne çalıştı?)

**Çaba:** 1 gün.

### Legacy dead code cleanup (önceki #16)

Faz 4a'da bilerek bırakılan iki dosya artık import edilmiyor:
- `src/features/analytics/CaseAnalyticsPage.tsx` (678 satır)
- `src/features/analytics/RunaAiChatPanel.tsx` (459 satır)

Toplam: 1137 satır dead. Grep ile cross-src import check: 0 hit.

**Çaba:** 30 dakika — quick win.

---

## P2 — Product Value

### Bundle splitting (önceki #10)

Vite tek eager `index-*.js` ~1.4MB (gzip 370KB). Hiçbir `React.lazy` yok, 17+ page eager. `polished-wondering-waffle.md` planı:
- 11 Admin*Page → lazy
- AIUsagePage/PatternsPage/QAScoresPage/CaseAnalyticsPage/MyCalendarPage → lazy
- 2 `<Suspense>` boundary + `PageFallback` skeleton
- `vite.config.ts` `manualChunks` — recharts/lucide-react vendor + admin/analytics route chunks

Hedef: eager bundle ~600-700KB.

**Çaba:** 1 gün.

### firstResponseTimeMin metric instrumentation (önceki #13)

`server/analytics/metricFormulas.js:13` Phase 1'de `notAvailable` listesinde. Event yaz:
- Vaka oluştuğunda → `Case.createdAt`
- İlk **dış** not/iletişim event'i → yeni alan `firstAgentResponseAt`
- Formula + `operationsAggregator` alanı

**Çaba:** Yarım gün.

### Auto-watcher on assign / mention / transfer (yeni — önceki #27 + #31 birleşik)

Spec der ki atanan kişi + mention edilen kişi otomatik watcher olur; kod hiç yapmıyor. Ayrıca transfer'de eski atanan kişi otomatik watcher olmuyor.

- `emitMentionsForNote` (`actionItemRepository.js:173-236`) sadece ActionItem yazıyor, `watcherRepo.add` çağırmıyor
- Transfer (`caseRepository.js:1944-2065`) assignment'ı değiştiriyor ama eski sahibi CaseWatcher'a eklemiyor
- `notifyWatchers` zaten transfer event'i emit ediyor (`caseRepository.js:2049`); sadece auto-watcher eksik

**Çaba:** 0.5 gün.

### CaseLink incoming edges fix (yeni — önceki #30 split-a)

`server/db/caseRepository.js:2929-2966` `linkRepo.list` yalnız `where: { caseId }` filtreliyor — Parent/Related linkleri hedef vakadan **görünmez**. Duplicate symmetric ✓; diğer 2 tip için tek-uçtan görünüm bug'ı.

Eylem: union query (`caseId OR linkedCaseId`) + her dönüş satırına `direction: 'outgoing' | 'incoming'` etiketi.

**Çaba:** 0.5 gün.

### Watcher permissions doc + smoke matrix (önceki #27 kalanı)

Route-layer kuralları kodda mevcut ama undocumented. Self-add unrestricted, other-add `Supervisor+|assigned owner`, delete `self|elevated only` (`cases.js:546-605`).

- Doc: `docs/PRODUCT_SPEC.md`'ye matrix ekle
- Smoke: 8 hücreli (self/other × add/remove × Agent/Supervisor) test scripti
- Yukarıdaki "Auto-watcher" kalemiyle birleşik kapatılabilir

**Çaba:** 0.5 gün.

### Resend email MVP (önceki #22 split-a)

Şu an tüm `CaseNotification`/`ActionItem` rows `channel='InApp'`. `server/db/notificationRepository.js:15` "no SMTP" explicit not. Approval/mention/SLA breach gibi yüksek-değer event'ler için e-posta tetikleme MVP'si:

- Resend SDK entegrasyonu
- Transactional template (basit Turkish)
- `ActionItem.kind IN ('approval', 'mention')` veya `priority>=70` için email send
- channel matrix + businessHours + günlük digest → ROADMAP "Notification — Channel matrix + businessHours + daily digest" altına taşındı (MVP-sonrası follow-up)

**Çaba:** 1 gün.

### AI Accept/Reject FE telemetry wiring (önceki #4)

Backend hazır: `PATCH /api/ai/usage/:id/accept` (`server/routes/ai.js:1133`), `acceptanceRate` hesaplaması (`server/routes/analytics.js:127`). FE'de hiçbir caller yok — `usageLogId` UI'larda debug label olarak görünüyor sadece. Sonuç: AIUsagePage'de `acceptanceRate` sürekli `null`.

- `aiService.markAccepted(usageLogId, accepted: boolean)` ekle
- 8 AI surface'e "Uygula / Yoksay" butonu: NewCaseForm suggest-category, SupervisorSummary, ChurnConversion, DraftResolution, TransferSuggest, CustomerPulseSummary, Operations brief/insights/explain/report/drilldown-assistant

**Çaba:** 3-4 saat.

### Smart QA — explicit caseId/companyId in AI calls (önceki #8)

`aiService.ts` interfaces 4'te eksik: `ResolutionDraftInput`, `SupervisorSummaryInput`, `ChurnConversionInput`, `CallSummaryInput`. Sunucu yan `c.id`/`c.companyId` fallback'e güveniyor — multi-company supervisor için "ana şirket" varsayımı yanıltıcı.

**Çaba:** 2 saat (4 interface + 4 caller).

### Customer disambiguation fields in agent search (Müşteri Eşleştirme #2 split-a)

Aynı müşteri için iki kayıt açılması, müşteri verisinin en hızlı kirlendiği nokta. Account search sonuçlarında her satırda:
- Bağlı şirket chip'leri
- `externalCustomerCode` (Müşteri Dış Kodu)
- Maskeli VKN, telefon, e-posta
- `isActive`, `openCaseCount`, `lastCaseAt`

Agent merge yapmıyor; sadece görünür kıl. (Supervisor review queue ayrı kalem → P3.)

**Çaba:** 1 gün.

### Drilldown row inline actions (önceki #38)

`OperationsDashboardPage.tsx:1795-1846` `DrilldownRow` sadece "open case" navigation sunuyor. Drawer'da satırdan: assign/escalate/comment hızlı aksiyonu.

**Çaba:** 1 gün.

### 50 OPS design-question continuous decision log (önceki #46)

`docs/OPERATIONS_DASHBOARD_DESIGN.md §7` (3173-3232) 50 numbered open question. Bir kısmı zaten dolaylı karara bağlanmış (Q11 ✓, Q26 persona enum ✓ — kod açıkça reddediyor).

Bu tek bir backlog item değil — **continuous design-debt log**. Her soruya R(esolved)/P(ending)/D(efer) etiketi at; karar verilenleri PR'lerle silmemek için ayrı section'a taşı. #13 firstResponseTime, #14 backlogChangePct, #38 drilldown gibi backlog kalemleri bu §7 sorularına bağlı.

**Çaba:** Yarım gün (taram + etiketleme).

---

## P3 — AI Fabric Expansion

### §11/§12/§13 — 3 classifier fields (önceki #9)

Sınıflandırıcı AI'a `caseIntent` (Bilgi/Çözüm/Telafi/Eskalasyon/Belirsiz) + `impactScope` (Tek/Şube/Bayi Ağı) + `successCriteria` (tek cümle metin) ekle.

Schema migration + `/suggest-category` response'a 3 alan + UI'da göster.

**Neden P3:** Risk Lens (#aşağı) ve Yönlendirici AI tarafından tüketilir. Bu olmadan §14 Risk Score eksik kalır.

**Çaba:** 1.5 gün.

### §5.2 Araştırıcı AI — additional suggestions (önceki #18)

`/suggest-links` (`ai.js:932`) zaten benzer geçmiş vakaları öneriyor (30g window — spec 90g; karar gerek). Sağ panel "🕵 Araştırıcı" kartı + 2 yeni öneri:
- Bu kategori için en aktif çözen → takipçi önerisi
- Müşteri temsilcisi → takipçi önerisi

**Çaba:** 1 gün.

### §5.3 Yazman AI + Canlı Özet (önceki #19 + #17 alt-kalem)

İki çıktı:
- **Canlı Özet kartı** — 10+ olay biriktiğinde akış başında, son 24 saat 2 cümle özet, 1 saat önbellek (önceki #17 alt-kalem buraya birleştirildi)
- **Devir notu** — "Devralacağım" butonunda: "Şu an sahibi X. Sonraki adım Y. Risk Z."

**Çaba:** 1 gün.

### §5.4 Yönlendirici AI (önceki #20)

Sağ panelde mini kart, tek cümle + tek aksiyon butonu:
- "Çözüldü'ye geçmek için denetim listesinde 2 madde kaldı."
- "Bu müşteriyi son 7g önce aradın. Tekrar arama önerilir."

**Çaba:** 0.5 gün.

**Bağımlılık:** §11/§12/§13 classifier fields (#9) işe yarar kılar.

### §8 Duygu Tonu Analizi (önceki #24)

`CaseSentimentSnapshot` modeli (sentiment: positive/neutral/negative/angry, score -1.0..+1.0, sourceType). Her not/çağrı geldiğinde 5dk gecikmeli toplu AI sentiment. Vaka kartında ton trendi.

**Çaba:** 1.5 gün.

**Bağımlılık:** Risk Lens'in §14 sinyal ağırlık tablosunu beslemek için zorunlu.

### §7 Alt Görevler (CaseSubTask) (önceki #23)

`CaseSubTask` modeli (status: todo/in_progress/done/cancelled, required: bool, displayOrder, assignedUserId). "Çözüldü"ye geçişte tüm `required` görevler `done` olmalı.

**Tech-design Q:** Yeni `CaseSubTask` tablosu mu yoksa mevcut `checklistItems Json` (`schema.prisma:1059`) extend mi? Kickoff'ta karara bağla.

**Çaba:** 1.5 gün.

### §9 Eksik Bilgi Tespiti (CategoryRequiredInfo) (önceki #25)

`CategoryRequiredInfo` modeli (categoryId, fieldName, requiredFor: open/resolve, prompt). Vaka açılışında AI eksik bilgileri tespit eder, agent'a sorar.

**NEEDS_PRODUCT_DECISION:** Çözüm öncesi denetim — eksik varsa **engelle** mi yoksa **uyar** mı? (backlog'da zaten not vardı, karar bekliyor.)

**Çaba:** 1.5 gün.

### §14 Risk Lens — 0-100 score (önceki #21)

Vaka başlığında renkli etiket (Yeşil/Sarı/Kırmızı), tek skor. Spec §14 sinyal ağırlıkları:

| Sinyal | Katkı |
|---|---|
| SLA riski | 0-25 |
| Müşteri kaybı | 0-20 |
| Memnuniyet riski / duygu tonu | 0-15 |
| Geçmiş eskalasyon | 0-10 |
| Etki kapsayımı (Bayi Ağı) | +30 |
| Etki kapsayımı (Şube) | +15 |
| Niyet: Eskalasyon | +20 |
| Niyet: Telafi | +15 |
| Takipçi ⚠️ tepkileri | +5/adet, max 15 |

Skor 75+ ise Yönlendirici + Bekçi tetiklenir.

**Bağımlılık (bloklu):** Bu kalem son AI Fabric dilimi — tüm sinyaller (#9, #24, varlık §4 reactions) hazır olunca uygulanabilir.

**Çaba:** 1 gün (signal aggregator + UI).

### backlogChangePct — BacklogSnapshot tablosu (önceki #14)

`server/analytics/operationsAggregator.js:149` `approximations: []`. Gerçek günlük snapshot:
- Cron her gün 00:00 (Istanbul) → `BacklogSnapshot { date, companyId, openCount, slaRiskCount, byPriority Json }`
- 90 gün retention
- Formula: (bugün - 7gün önce) / 7gün önce × 100

**Çaba:** 1 gün.

**Bağımlılık:** OPS §7 Q14 karar (Phase 5 optional flag).

### suggestedDuplicateOf supervisor review queue (Müşteri Eşleştirme #2 split-b)

Agent merge yapmıyor (yetkisi yok); ama "Mükerrer olabilir" flag bırakabilmeli. Yeni alan + supervisor review queue UI.

**NEEDS_PRODUCT_DECISION:** flag mekanizması — `AccountFlag` ayrı tablo mı yoksa `Account.suspectedDuplicateOf` self-FK mı?

**Çaba:** 1 gün (karar sonrası).

### Blocking link type decision (önceki #30 split-b)

`linkRepo.add` (`caseRepository.js:2972`) yalnız `Related|Duplicate|Parent` kabul ediyor. Spec'te "Blocking" tipi geçiyor ama kod hiç yok.

**NEEDS_PRODUCT_DECISION:** Blocking gerçekten gerekli mi yoksa spec'ten çıkar mı?

**Çaba:** Karar + 0.5 gün kod.

---

## P4 — Future / Decision-blocked

### externalCustomerCode tenant-configurable validation (önceki externalCustomerCode item)

`/^\d{5}$/` 3 yerde hard-coded (`accountRepository.js:669`, `AccountCompanyEditor.tsx:42`, `AccountFormModal.tsx:34`). `CompanySettings.externalCustomerCodePattern` benzeri tenant-config gerek.

**Trigger:** Yeni paying tenant 5-hane rakam dışı format ister.

**Çaba:** 1 gün.

### Mention notification — scroll-to-note focus highlight (önceki #28 — küçültülmüş)

Aksiyonlarım inbox `ActionItem.caseId` üzerinden navigation zaten tek tık çözüyor. Geriye kalan: vakaya gidince ilgili notu 2sn highlight ile vurgulama (URL hash fragment).

**Not:** Önceki #28'in "deepLink field doldur" premise'i artık geçersiz — `CaseNotification.deepLink` field hiç yokmuş, ActionItem akışı bu kontekstte odaklı navigation'ı zaten sunuyor.

**Çaba:** 1-2 saat.

---

## Closed / Obsolete / Moved

Bu kalemler ya shipped, ya canonical başka dokümanda, ya karar verildi.

### Shipped — ROADMAP "Recent Ships / Platform Capabilities"

Bu shipped iş envanteri artık `docs/ROADMAP.md`'de "Recent Ships / Platform Capabilities" altında:

- ~~#1 OpenAI API key prefix/suffix logging~~ — shipped 2026-05-15 (`server/routes/ai.js:54` NODE_ENV gate)
- **#17 (kısmı)** §4 Tepkiler + reply threading — `CaseNoteReaction` tablosu + `CaseNote.parentNoteId` + `ReplyItem`. (Alt-kalem "Canlı Özet kartı" → P3 Yazman AI'a foldlandı.)
- **#45** Sidebar/header redesign — commits `52bfdb6`, `dc47b6d`, `921f2d3` ile shipped
- **Müşteri Eşleştirme — Müşterisiz vaka akışı** — `customerMatchPending` field + filter + `CaseDetailPage:2546` match suggestions

Audit gap detection — daha önce backlog/roadmap'ta hiç yer almayan major ship'ler de ROADMAP'a eklendi:
- Action Center / Aksiyonlarım inbox (WR-NOTIFICATION-CENTER Phase 1/2A/2B/2C)
- Resolution Approval flow (kind=approval, `approvalRepository.js`)
- Customer 360 Phase A/B/C2 + deterministic Customer Match (`customerMatchRepository.js`)
- External KB console
- Watcher Inbox UI (zaten ROADMAP'taydı — Phase 5c)
- AI Status Report / Durum Raporu

### Moved — Report Studio'ya özgü

Şu 4 kalem `docs/REPORT_STUDIO_BACKLOG.md`'de zaten canonical olarak var:

- **#11** Phase 5b XLSX/PDF → RSB P1 "XLSX/CSV Export" + "Server-side PDF"
- **#34** Scheduled reports → RSB P2 "Scheduled Reports"
- **#35** Public share links → RSB P2 "Email / Share" altında
- **#36** Report history → RSB P2 "Report History"

### Moved — ROADMAP (future product direction / cross-cutting)

- **#12** Phase 6 PPTX export → OPS §6 zaten out-of-scope; ROADMAP "future export formats"
- **#26** Faz 2 §10 Kiracı bazlı AI ayarları → ikinci paying tenant'a kadar gate; ROADMAP "Commercialization"
- **#32** Mobile / dark mode polish turu → ongoing quality posture, ROADMAP "Known Limitations"
- **#33** Audit replay UI (MetricQueryAudit) → admin convenience; ROADMAP "Admin Tooling"
- **#37** Real-time refresh (WebSocket/SSE) → OPS §6 out-of-scope; ROADMAP "Scale"
- **#39** Karşılaştırmalı period selector → ROADMAP "Operations Dashboard polish"
- **#40** Pinned / saved dashboard view'leri → ROADMAP "Operations Dashboard polish"
- **#41** A11y / klavye navigasyon audit → cross-cutting quality bar; ROADMAP "Known Limitations"
- **#43** Vercel Hobby → Pro cron geçişi → infra/billing karar; ROADMAP "Infra"
- **Müşteri Eşleştirme — ileri faz** (matching queue / duplicate detection / account merge) → ROADMAP "Customer Context Intelligence — Phase F (Account Merge)"

### Moved — TECHNICAL_DEBT

- **#15** METRIC_FIXTURES.md PENDING values
- **#29** CaseNote.authorId backfill cron
- **#42** snooze-wakeup cron route `/api/cron` prefix taşıma

Yanı sıra audit gap detection sonucu doğan yeni borç maddeleri:
- Phase 2C dual-write / legacy CaseNotification deprecation timeline
- ActionItem.objectType/Id polymorphism (FK olmaması) referansiyel bütünlük riski

### Closed — Decision-recorded

- **#44** Persona enum (CSLeadership/ProductManager/CustomerSuccessLead) — `server/analytics/scopeDerivation.js:14` "EKLENMEZ" karar zaten kodda. Bu roller flag/scope ile yönetiliyor, enum ile değil.

---

## Bu listeyi güncel tutmak

- Aktif madde shipped olunca: BACKLOG'dan sil + ROADMAP'a "Recent Ships" satırı düş (1 cümle, planning_card link)
- Yeni iş geldiğinde: uygun P-priority altına ekle; eski numara/etiket gerekmiyor — sadece kısa açıklama + dosya:satır kanıt
- 50 OPS design-question (#46) cevaplandıkça → ilgili backlog kalemi açılabilir/kapatılabilir
- Audit cycle önerisi: her major release sonrası 5-10 dakikalık reality check (backlog vs git log)
