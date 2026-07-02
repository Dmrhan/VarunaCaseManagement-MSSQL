# Operasyon Panosu v2 — Müşteri Lensi + AI Görüş + Ops Derinliği

**Durum:** 📋 SPEC (2026-07-02) — implementasyon "başla" onayına bağlı.
**Feature Freeze:** Aktif (go-live ~2026-07-04). Bu spec **fazlara ayrıldı**;
her faz tek başına shippable ve bugfix/minor scope'unda değerlendirilir.
Kullanıcı GO-LIVE sonrası hangi fazı ne zaman başlatacağını seçer.

---

## Amaç

Bugünkü Operasyon Panosu **yalnız vaka aggregate'lerini** (sayı, kırılım,
trend) gösteriyor. Üç şikayet üretti:

1. **Müşteri gözünden bakılamıyor** — "X müşterisinde ne oluyor?" sorusu
   dashboard'dan yanıtlanamıyor. Panonun MÜŞTERİ (accountId) filtresi yok.
2. **RUNA AI görüşleri sığ** — "KB kullanımı", "akıllı ticket taksonomileri",
   "pattern alarm", "mail operasyonu", "QA skoru" gibi verileri
   YORUMLAMIYOR. Sebep: aggregate payload'ına bu veriler HİÇ girmiyor.
3. **Ops derinliği eksik** — backlog aging, medyan/P90, agent workload
   gibi klasik ops metrikleri yok; ortalamalar aldatıcı olabiliyor.

Bu spec üç şikayeti fazlar halinde çözer. Yeni motor YOK — mevcut
`operationsAggregator` genişletilir; RUNA prompt'ları yeni alanları
yorumlar.

---

## Ground-truth (koddan doğrulandı, 2026-07-02)

### Aggregator BİLİYOR (`server/analytics/operationsAggregator.js`)
- `computeOperationsOverview({scope, filters})` (line 67)
- Kırılımlar: `byStatus / byPriority / byCaseType / byCompany / byTeam /
  byCategory / byRequestType / byOrigin / topAtRiskAccounts` (line 87-116)
- **Filter'da `accountId` HAZIR** (line 302-309, Aylık Bülten A4'ten):
  `filters.accountId → [accountId] = @P<n>`.
  Frontend'den gönderilmiyor — sadece bültenin backend orchestrator'ı
  kullanıyor. **UI wiring bir sonraki fazın işi.**

### Aggregator BİLMİYOR (0 referans)
- Akıllı Ticket taksonomileri (`TaxonomyDef` — Platform / İş Süreci / …)
- KB / `kbArticle` kullanım metrikleri
- `CaseSolutionStep` (çözüm kaynak dağılımı — AI / KB / Benzer Vaka / Manuel)
- `PatternAlert` (aktif alarm sayısı, spike özeti)
- QA skoru (`qaEmpathy/Clarity/Speed`, `qaFeedback`)
- `CaseEmail` (mail hacmi, pending customer reply, first response time
  medyanı)

### RUNA görüşleri (`server/routes/ai.js`)
- `/api/ai/operations-brief` (line 1276-1310) + `/api/ai/operations-insights`
  (line 1312-1330) endpoint'leri var. Payload'a AGGREGATOR ÇIKTISI verilir.
- **Prompt'lar sadece aggregator alanlarını yorumluyor** — o alanlarda ne
  yoksa yorumda da o yok. "KB'den yararlanılıyor mu" sorusuna yanıt gelmiyor
  çünkü **payload'da KB verisi yok**.

### Dashboard UI (`src/features/analytics/OperationsDashboardPage.tsx`)
- Filter state: `dateFrom / dateTo / companies / statuses / caseTypes /
  granularity` (line 204-268)
- **MÜŞTERİ (accountId) filtresi YOK** — asıl şikayetin kökü.
- `AccountSearchPicker` component mevcut (SmartTicket + NewCaseForm reuse
  target); server-side arama destekli.

### Formatters + TR etiketler
- `CASE_REQUEST_TYPES`, `CASE_ORIGINS` — Türkçe zaten enum'da.
- `caseReport/formatters.js` TR label reuse hazır.

---

## 🔒 Sabit Kurallar (pazarlıksız)

1. **PII:** `Case.customerContact*`, `customerCompanyName` **AI payload'ına
   GİRMEZ**. Tüm yeni veriler AGGREGATE-ONLY (sayı, oran, dağılım). Kişi
   adı, mail içeriği, vaka başlığı **hiçbir yeni alanda YER ALMAZ**.
   İlgili memory: [[feedback-privacy-requester-fields]] +
   [[project-runa-ai-enrichment]].
2. **RUNA commentary-only:** taksonomi/kategori üretmez, sadece **dağılımı
   YORUMLAR**. Kullanıcı kararı: RUNA "en fazla platform iOS'ta
   yoğunlaşmış" der; RUNA "iOS'a yeni taksonomi kategorisi ekle" DEMEZ.
3. **Geriye uyum:** mevcut pano davranışı korunur — yeni alanlar
   **additive**. Eski consumer (varsa) kırılmaz.
4. **Scope guard pariteti:** yeni aggregate/endpoint'ler mevcut
   `scope.companyIds + canCrossCompanyAgg + baseWhere` desenini **birebir
   kopyalar**. `accountId` filtresi kullanıcının scope'undaki bir account
   olmalı (bülten account-scope guard REUSE).

---

## Fazlar

Her faz **ayrı PR seti** ve tek başına shippable. Fazlar arası zorunlu
bir sıra yok — kullanıcı önceliği kendi seçer. Aşağıda önerilen sıra
"görünen değer/efor" oranına göredir.

---

### FAZ 1 — Quick wins (2-3 gün, düşük risk)

**Amaç:** UI'da gözle görünür değer — müşteri lensi + hazır aggregate'lerin
karta dönüşü.

#### 1a. Müşteri filtresi
- Filtre çubuğuna `AccountSearchPicker` ekle (server-side arama; 5000
  müşteride düz dropdown olmaz).
- Seçilince tüm kart/kırılım/trend `accountId`-scoped.
- Drilldown state'e taşınır (mevcut drilldown pattern reuse).
- "Temizle" → genel görünüme döner.
- **Backend HAZIR** — sadece `body.accountId` field'ı forward etmek yeter.
- **Guard:** account kullanıcının scope'undaysa geç, aksi halde 403
  (bülten guard REUSE).
- **Hint:** "Müşteri seçince tüm görselgede yalnız o müşterinin vakaları
  sayılır."

**Değişen dosyalar:**
- `src/features/analytics/OperationsDashboardPage.tsx` — filter state +
  UI + accountId body forward
- `server/routes/analytics.js` — overview endpoint'inde body.accountId
  scope guard (bülten pattern REUSE)

#### 1b. Tür + Kanal kartları
- `byRequestType` + `byOrigin` **panoda gösterilmiyor** — aggregate hazır.
- İki mini kart (kırılım grafiği + top-3 liste) ekle. TR etiketler
  `CASE_REQUEST_TYPES` + `CASE_ORIGINS` enum'undan.
- Renkler mevcut recharts palette REUSE.

**Değişen dosyalar:**
- `src/features/analytics/OperationsDashboardPage.tsx` — 2 yeni Card
- `src/services/analyticsService.ts` — response type genişletmesi (opt.,
  şu an TS'de zaten olabilir; teyit)

**Kabul kriterleri (FAZ 1):**
- [ ] Filtresiz pano eski sonucun aynısını verir (regresyon)
- [ ] Müşteri seçilince tüm kartlar accountId-scoped (spot-check 2 müşteri)
- [ ] Cross-tenant guard: başka tenant müşterisi 403
- [ ] Tür + Kanal kartları TR etiketle + doğru toplam
- [ ] Boş dönem: hepsi 0, hata YOK
- [ ] Bundle etkisi < 5KB (yeni component yok, mevcut reuse)

**Efor:** 2-3 gün · **Risk:** DÜŞÜK (backend hazır, sadece UI wiring +
2 kart).

---

### FAZ 2 — AI görüş alanı (asıl şikayetin çözümü, 5-7 gün)

**Amaç:** RUNA'nın veri erişimini genişlet — yeni **5 aggregate ailesi**
+ prompt güncellemesi. Panoda karşılığı mini kartlar.

Tüm aggregate'ler **count/oran** — PII yok.

#### 2a. Akıllı Ticket taksonomi dağılımı
Kırılım: Platform / İş Süreci / İşlem Tipi / Etkilenen Nesne / Etki top-N.
`Case.customFields.smartTicket.<field>` ve `TaxonomyDef` label join.

Kod:
- Yeni aggregate helper: `queryBySmartTicketTaxonomy(scope, filters,
  baseWhere, taxonomyType)`
- Response'a: `bySmartTicketPlatform`, `bySmartTicketBusinessProcess`,
  `bySmartTicketOperationType`, `bySmartTicketAffectedObject`,
  `bySmartTicketImpact`

#### 2b. Çözüm kaynağı oranları
Kırılım: `CaseSolutionStep.source` (enum: `ai_suggestion / kb / similar_case
/ manual / …`) — dönemde çözülen vakaların adım kaynaklarının dağılımı.
Türetilmiş metrik: **"KB-destekli çözüm %"** = (kb kaynak sayısı /
toplam çözüm adımı sayısı).

Kod:
- `queryBySolutionStepSource(scope, filters, from, to, baseWhere)`
- Response'a: `bySolutionStepSource`, `kbAssistedResolutionRate` (float
  0-1)

#### 2c. Mail operasyonu
Kırılım:
- Aktif `pendingCustomerReply=true` vaka sayısı (snapshot)
- Dönemde inbound + outbound `CaseEmail` hacmi (adet)
- **First response time MEDYAN** (`slaResponseMetAt - createdAt`
  dakika); ortalama yerine medyan (Faz 3 P90 ile birlikte açılır).

Kod:
- `queryMailOpsSnapshot(scope, filters, baseWhere)` +
  `queryMailOpsVolume(scope, filters, from, to, baseWhere)` +
  `queryFirstResponseMedian(scope, filters, from, to, baseWhere)`
- Response'a: `mailOps: { pendingCustomerReply, inboundVolume,
  outboundVolume, firstResponseMedianMin }`

#### 2d. Pattern alarm özeti
- Aktif `PatternAlert.state='active'` sayısı
- En büyük spike (kategori adı + kaç kat; **başlık YOK**)

Kod:
- `queryPatternAlertSummary(scope, filters, baseWhere)`
- Response'a: `patternAlerts: { activeCount, largestSpike: {category,
  multiplier} | null }`

#### 2e. QA ortalamaları
- `qaEmpathyScore`, `qaClarityScore`, `qaSpeedScore` ortalamaları (aynı
  zamanda min sample violation kontrol — <10 vaka aggregate DÖNMEZ,
  mevcut minSample pattern REUSE)

Kod:
- `queryQaAverages(scope, filters, from, to, baseWhere)`
- Response'a: `qaAverages: { empathy, clarity, speed, sampleCount }`

#### 2f. RUNA prompt güncellemesi
- `server/routes/ai.js:1276+` `operations-brief` prompt — yeni alanlar
  için Türkçe rehber cümleler ekle.
- `operations-insights` prompt — yeni alanları yorumlama şablonu:
  "KB-destekli çözüm oranı düştüyse neden düşmüş olabilir?" gibi
  yönlendirici sorular.
- Payload'da yeni alanlar → LLM sadece sayıları yorumlar (commentary-only
  kural).

**UI:** Panoya "AI Görüş" seksiyonu altına 5 mini kart. RUNA çıktısı bu
kartların üstünde bir paragraf halinde görünür (mevcut `AiSummaryBlock`
reuse).

**Kabul kriterleri (FAZ 2):**
- [ ] `AI payload snapshot` testinde PII (`customerContact*`) YOK
- [ ] Boş dönem: her yeni alan 0 veya null, hata YOK
- [ ] Cross-tenant: her yeni aggregate `scope.companyIds` filter'ında
- [ ] RUNA "KB-destekli çözüm oranı" fiili sayıyı **hem cümle içinde
  atıfla söyler**
- [ ] AI fail (LLM 500) → pano AI'sız çalışır (mevcut fallback)
- [ ] Regresyon: mevcut kartlar (Status/Priority/…) aynen çalışır

**Efor:** 5-7 gün · **Risk:** ORTA (5 yeni SQL, prompt tuning gerek).

---

### FAZ 3 — Ops derinliği (3-4 gün)

**Amaç:** klasik ops metrikleri — dashboarda profesyonel derinlik.

#### 3a. Backlog aging kartı
Açık vakaların yaş kovaları: **0-1g / 1-3g / 3-7g / 7g+**. Kart + drilldown
(seçilen kova → filtrelenmiş case list).

Kod:
- `queryBacklogAging(scope, filters, baseWhere)`
- Response'a: `backlogAging: { bucket0_1: n, bucket1_3: n, bucket3_7: n,
  bucket7plus: n }`

**Hint:** "7g+ kovası büyükse eskimiş vaka birikimi var — atama veya
öncelik gözden geçir."

#### 3b. Medyan + P90
Ortalama yanına **medyan** + **P90** — `resolutionTimeMin` +
`firstResponseTimeMin`.

- P90: `PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY <col>)` (MSSQL native)
- Ortalama yanında küçük satır: "medyan Xm · P90 Ym"

**Hint:** "Ortalama uzun ama medyan kısa ise az sayıda çok-uzun vaka
ortalamayı çekiyor demek — kuyruğa bak."

Kod:
- Mevcut `queryPeriodMetrics` genişlet — SQL'e median + p90 alanları ekle.
- Response'a: `kpis.resolutionTimeMedianMin`,
  `kpis.resolutionTimeP90Min`, aynı ikili `firstResponse` için.

#### 3c. Agent workload tablosu
Kişi başına: **açık / dönemde çözülen / ort. çözüm süresi / QA ort.**

Yetki paritesi (`memory `feedback_release_flow` +
`project_actor_identity_hardening`):
- **Supervisor+** tabloyu görür (tenant içi tüm agent).
- **Agent** yalnız kendi satırını görür — diğer satırlar 403.

Kod:
- `queryAgentWorkload(scope, filters, from, to, baseWhere, actorRole,
  actorPersonId)`
- Response'a: `agentWorkload: Array<{personId, personName, openCount,
  resolvedCount, avgResolutionMin, qaAvg}>`

**Kabul kriterleri (FAZ 3):**
- [ ] Aging kova toplamı = snapshot açık vaka sayısı
- [ ] P90 hesaplaması `PERCENTILE_CONT` ile — spot-check 3 dönem
- [ ] Agent workload — Agent yalnız kendi satırını görür (yetki testi)
- [ ] Boş dönem: hepsi 0/null
- [ ] Regresyon: FAZ 1+2 kartları etkilenmez

**Efor:** 3-4 gün · **Risk:** DÜŞÜK-ORTA (SQL median/P90 native destek,
agent workload yetki gate'i sıkı).

---

### FAZ 4 — Konfor (ayrı onay, planlama aşamasında)

**Amaç:** günlük kullanım konforu. Bu fazın implementasyonu **ayrı bir
karar** — kullanıcı ihtiyaç olduğunda başlatır.

#### 4a. SavedView (kayıtlı görünümler)
- Kullanıcı filtre kombinasyonunu isim vererek kaydeder ("Bu Ay Univera
  L2", "Geçen Hafta Yüksek Öncelik", …).
- Load / delete / rename.
- Model: `ReportView` mevcut (memory
  `project_report_studio_roadmap`). REUSE — yeni model yaratma.

#### 4b. Haftalık zamanlanmış özet
- Cron job (`server/cron/`) haftanın kapanışında pano özetini oluşturur;
  `mailProvider` REUSE ile ilgili kullanıcılara mail atar.
- Alıcı listesi: SavedView sahipleri (opt-in flag).

#### 4c. Auto-refresh
- Toggle: 60s / 5m / kapalı.
- `useEffect` timer + `refetchTick` REUSE.

**Kabul kriterleri (FAZ 4):**
- [ ] SavedView per-kullanıcı; başka kullanıcının view'ını göremez
- [ ] Haftalık mail: alıcı opt-in yoksa gönderim YOK
- [ ] Auto-refresh: kullanıcı sekmesinde değilse (page hidden) durdurulur

**Efor:** 3-4 gün · **Risk:** DÜŞÜK (mevcut alt yapı REUSE).

---

## Toplam efor + sıra önerisi

| Faz | Süre | Risk | Değer | Öneri |
|---|---|---|---|---|
| 1 | 2-3 gün | Düşük | Yüksek (görünür) | GO-LIVE + 1 hafta sonra ilk PR |
| 2 | 5-7 gün | Orta | Çok yüksek (RUNA görüş) | Faz 1 sonrası |
| 3 | 3-4 gün | Düşük-orta | Orta | Faz 2 sonrası |
| 4 | 3-4 gün | Düşük | Orta | İhtiyaç oluşunca |

**Kümülatif:** ~15 gün (tek dev), 4 PR seti.

---

## Cross-cutting kalite maddeleri

Her faz için ortak:

1. **Reuse-first (memory `feedback_reuse_before_rewrite`):** yeni motor
   YOK. Aggregator + `AccountSearchPicker` + `AiSummaryBlock` +
   `mailProvider` + `ReportView` reuse.
2. **Guard pariteti:** yeni endpoint/aggregate'ler mevcut
   `scope.companyIds + canCrossCompanyAgg + baseWhere` desenini birebir
   kopyalar. Divergence yasak.
3. **Kenar durumlar:** boş dönem · null SLA/yanıt · AI fail (fallback) ·
   accountId + diğer filtre kombinasyonu (spot-check).
4. **Kontrat doğrulama (memory
   `feedback_prompt_quality_standards`):** her fazın implement PR'ında
   payload snapshot testi (PII yok) + FAZ 1 regresyon (mevcut kartlar).
5. **Help/explainability (memory `feedback_self_explanatory_screens`):**
   yeni kart/filtreler tek satır hint — kullanıcı yardımsız anlar.

---

## Smoke (davranış kriterleri)

Her fazın PR'ında:

### FAZ 1
- accountId filtresi: seçili müşteri dışı vaka **hiçbir kartta** sayılmaz
- Scope dışı account 403 (guard testi)
- Filtresiz pano regresyon (eski sonuç)
- Tür + Kanal kartları TR etiket + doğru toplam

### FAZ 2
- Cross-tenant: her yeni aggregate `companyIds` filter'lı
- **AI payload snapshot: PII alanları YOK** (kritik — snapshot testi)
- Boş dönem: her yeni alan 0/null, hata YOK
- RUNA fail: pano AI'sız çalışır

### FAZ 3
- Aging kova toplamı = snapshot açık vaka sayısı
- P90 hesap doğrulaması (3 dönem spot-check)
- Agent workload: Agent yalnız kendi satırını görür (yetki gate)

### FAZ 4
- SavedView per-kullanıcı isolation
- Auto-refresh: page hidden → durdurulur

---

## Kontrat doğrulama (ground-truth teyit)

Bu spec 2026-07-02'te aşağıdaki kod noktalarından doğrulandı; sapma
implementasyonda düzeltilir:

| İddia | Kanıt |
|---|---|
| Aggregator byRequestType + byOrigin biliyor | `operationsAggregator.js:113-114` |
| Aggregator accountId filter biliyor | `operationsAggregator.js:302-309` |
| Aggregator KB/solutionStep/patternAlert/qaScore/caseEmail = 0 ref | `grep -c` → 0 |
| RUNA operations-brief + insights endpoint'leri | `server/routes/ai.js:1276, 1312` |
| Dashboard UI: accountId filter YOK | `OperationsDashboardPage.tsx:204-268` |
| AccountSearchPicker mevcut (reuse target) | `src/features/cases/AccountSearchPicker.tsx` |
| Formatters TR: CASE_REQUEST_TYPES + CASE_ORIGINS enum | `caseService.ts:64` |

---

## Karar noktaları — implementasyon başlarken

Kullanıcı "başla" derken şunları netleştirir:

1. **Faz sırası** — önerilen 1 → 2 → 3 → 4. Farklı sıra istenirse
   söylenir.
2. **PR boyutu tercihi** — FAZ 2 tek PR mı, 5 alt PR mı? Öneri: **1 PR
   (5 aggregate + 1 prompt update + UI mini kartlar) tek release**.
   Codex round'larını azaltmak için birlikte gitmesi mantıklı.
3. **RUNA prompt kalibrasyonu** — FAZ 2 sonrası kullanıcı test edip
   prompt tonu (uzun/kısa, spekülatif/temkinli) hakkında geri bildirim
   verir; 1-2 tur kalibrasyon beklenir.
4. **FAZ 4 tetiği** — konfor fazı ihtiyaç oluşunca; şu an planlama.

---

## Ek notlar

- Feature freeze bittiğinde bu spec **onaya sunulmuş** olacak. Kullanıcı
  fazlara "başla" onayı vermeden hiçbir implementasyon PR'ı açılmaz.
- Her faz kendi PR set'iyle bağımsız shippable; hiç 4 fazın hepsi
  yapılmadan da FAZ 1 tek başına değer üretir.
- Kayıtlı görünümler (FAZ 4a) `ReportView` model'i ile
  [[project_report_studio_roadmap]]'e yakın; ileride tek ekranda
  birleştirilebilir.

---

**İlgili memory kayıtları:**
- [[project_varuna_golive_freeze]] — feature freeze context
- [[feedback_privacy_requester_fields]] — PII kuralı
- [[project_runa_ai_enrichment]] — RUNA commentary-only
- [[feedback_reuse_before_rewrite]] — reuse-first
- [[feedback_prompt_quality_standards]] — kontrat doğrulama
- [[feedback_self_explanatory_screens]] — help metinleri
- [[project_varuna_monthly_bulletin]] — bülten A1/A4 (byRequestType,
  accountId filter kaynağı)
- [[project_varuna_pattern_triage]] — PatternAlert veri modeli
