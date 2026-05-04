# Faz 1.5 — Hızlı Kazanımlar Sürüm Notları
**Tarih:** Mayıs 2026
**Durum:** Tamamlandı

---

## Özet

Faz 1.5, FAZ 2 Collab'a (Watchers / Linked Cases / 6 AI rolü) geçmeden önce
**operasyonel hızlı kazanımlar** ve **temel altyapı** olarak planlandı. 7
işlevsel madde + 1 plansız (ama kritik) **multi-tenant izolasyon** çalışması
tamamlandı.

İşlevsel hedefler:
- Vaka yönetiminde günlük operasyonu hızlandıran 4 modül (snooze, bulk, mention, pattern detect)
- Yöneticiye 3 ROI panosu (AI kullanımı, QA skoru, örüntü alarmları)
- AI şeffaflığı için bilgi kaynakları kataloğu

Altyapı hedefi (yol planında olmayan):
- Tek tenant başlayan sistemi multi-tenant'a (UserCompany N:M) taşımak — production öncesi şart koşulan veri ihlali riskinin kapatılması.

Faz 1.5 sonrası sistem, **PARAM/UNIVERA/FINROTA holding modeli** üzerinde her
şirketin kendi takımı, vakası, kategorisi, SLA kuralı ile ayrışmış halde
çalışıyor; AI özellikleri ölçülebilir hale geldi; supervisor'ın "ne işe
yarıyor?" sorularına veri ile cevap üretiliyor.

---

## Tamamlanan Maddeler

### Madde 1 — Erteleme (Conversation Snooze)

**Ne yapıldı:** Bir vakayı belirli bir tarih/saate kadar Inbox'tan kaldırma.
Cron süre dolunca vakayı önceki statüsüne otomatik döndürür. Müşteri tekrar
arayacaksa veya 3. taraf bekleniyorsa "şimdi unutturalım" akışı.

**Teknik detay:**
- `Case` tablosuna `snoozeUntil`, `snoozeReason` (enum), `snoozePreviousStatus` (enum) alanları
- 4 endpoint: `POST/DELETE /api/cases/:id/snooze`, `GET /api/cases/snoozed`, `POST /api/cases/cron/snooze-wakeup`
- UI: `SnoozeModal` (4 preset + 3 sebep radio), Inbox sekmeleri **Açık / Ertelendi / Kapalı**, Case Detail amber banner
- Production: `Authorization: Bearer ${CRON_SECRET}` veya `x-uptime-secret` dual auth — Vercel Hobby cron sınırı nedeniyle GitHub Actions her 5 dk + UptimeRobot yedek

**Demo:** Vaka aç → "Ertele" → Yarın 09:00 + "3. taraf bekleniyor" → Inbox'tan
kaybolur, **Ertelendi** sekmesinde görünür. Yarın 09:00'da cron çalışır,
vaka tekrar Açık'a döner. Süresi geçmiş ertelemeler amber satır + "⏰ X saat önce uyandı" rozetiyle uyarır.

---

### Madde 2 — Toplu İşlemler (Bulk Actions)

**Ne yapıldı:** Vaka listesinde checkbox ile çoklu seçim → 4 alan üzerinde toplu
güncelleme: takım, kişi, öncelik, statü.

**Teknik detay:**
- `POST /api/cases/bulk-update` — body whitelist (4 alan), max 100 vaka/istek
- Cross-tenant atomic reject: caseIds'in **tümü** allowedCompanyIds'te olmalı, yoksa hiçbir vaka güncellenmez (CaseAccessError → 403)
- Status'te kapatma yasak (`Çözüldü`/`İptalEdildi` her vaka için ayrı log gerektirir)
- Activity log: field başına ayrı satır per case ("Toplu işlem: Öncelik → High (5 vakadan biri)")
- UI: floating action bar (bottom-center fixed), 4 buton, >10 seçimde 2 adımlı confirmation modal, indeterminate header checkbox

**Demo:** Listede 5 vaka seç → bottom bar "5 vaka seçildi" → **Öncelik
Değiştir** → High → toast "5 vaka güncellendi" → liste yenilenir,
activity'de 5 ayrı log.

---

### Madde 3 — Kişi Etiketleme (@mention)

**Ne yapıldı:** Vaka notuna `@` yazınca aynı şirketteki kullanıcıları öneren
dropdown. Etiketlenen kişiye header bell badge'i düşer, vakaya tıklayınca
seen yapılır.

**Teknik detay:**
- `CaseMention` tablosu (caseId + noteId + companyId + mentionedUserId/By + seenAt)
- 4 endpoint: `POST /:id/notes` (regex parse + insert), `GET /:id/mentionable-users`, `GET /me/mentions/unread`, `POST /:id/mentions/seen`
- Format: not metninde `@[Demo Supervisor](uuid)` — DB'ye ham metin, UI render'da inline mavi pill
- Cross-tenant: mention edilen User aynı şirkette aktif olmalı; max 10 kişi/note
- UI: `MentionTextarea` (lazy fetch dropdown, ↑↓ Enter Tab Esc), `MentionContent` renderer, header `MentionBellBadge` (60s polling + custom event refresh)

**Demo:** Not yaz → `@su` → "Demo Supervisor" dropdown'da → Enter → tag insert
→ Not Ekle. Supervisor login → header bell'de **kırmızı 1** → tıkla → vakaya
git → bell sayısı düşer.

---

### Madde 4 — Smart QA Lite

**Ne yapıldı:** Kapatılmış vakalara her gece AI 3 kriterde (empati / çözüm netliği
/ yanıt hızı) 1-5 puan + Türkçe feedback üretir. Supervisor'a haftalık agent
breakdown raporu.

**Teknik detay:**
- `Case`'e 5 alan (qa{Empathy,Clarity,Speed}Score + qaFeedback + qaScoredAt)
- `QAScoreLog` tablosu (caseId @unique, audit + zaman bazlı sorgu)
- `runScoreCase` (gpt-4o-mini, strict JSON schema, transaction'la denormalize + log upsert)
- `runQaScoreBatch` — max 10 vaka/run cost control, sıra `resolvedAt desc`
- 3 endpoint: `POST /api/cron/qa-score-batch` + `/qa-score` (manuel) + `GET /api/analytics/qa-scores?period=7d|30d`
- Skip nedenleri: not_closed / already_scored / no_material
- UI: `QAScoresPage` (4 KPI + Top/Bottom highlight + agent table, ≥4 emerald / ≥3 amber / <3 rose); Case Detail sağ panelinde "AI QA Skoru" pill section
- GitHub Actions: `0 2 * * *` her gece 02:00 UTC

**Demo:** Cozuldu vaka detayında sağ panel: 3 pill `Empati 4/5 · Netlik 4/5
· Hız 4/5` + Türkçe feedback. **/analytics-qa-scores** → company avg + top
agent (Burak Demir 4.6) / bottom agent (Cem Ergin 3.4).

---

### Madde 5 — Örüntü Tespiti Canlı Akışı

**Ne yapıldı:** Cron her 15 dk, son 60 dk'da aynı kategoride 5+ vaka açılırsa
yönetici alarmı yaratır. Read-only — otomatik vaka açma yok, sadece sinyal.

**Teknik detay:**
- `PatternAlert` tablosu + `PatternAlertStatus` enum (active/dismissed)
- `runPatternDetect` — `groupBy(companyId, category)`, 5+ eşik, dedupe (aynı window'da active varsa skip)
- 3 endpoint: `POST /api/cron/pattern-detect`, `GET /api/analytics/patterns?status=active|all`, `PATCH /:id/dismiss`
- UI: `PatternsPage` (amber alert cards), sidebar `AlertTriangle` + active count badge (60s polling + custom event), "Vakaları Gör" → vaka listesi caseIds filter banner
- GitHub Actions: `*/15 * * * *`

**Demo:** 5 PARAM vakası "Yazılım" kategorisinde aç → cron tetiklenir →
sidebar AlertTriangle'da kırmızı 1 → /analytics-patterns → amber kart "Son
60 dakikada 5 vaka açıldı" → **Vakaları Gör** → vaka listesinde sadece o
5 vaka + üstte filter banner.

---

### Madde 6 — Bilgi Kaynakları Kayıt Defteri

**Ne yapıldı:** Admin paneline "Bilgi Kaynakları" ekranı: AI'ın hangi veriden
beslendiğinin şeffaf kataloğu. İlk açılışta otomatik 4 default kaynak
(Geçmiş Vakalar, Kategori Tanımları, SLA Kuralları, Kontrol Listeleri)
ilgili tablolardan count alınarak yaratılır.

**Teknik detay:**
- `KnowledgeSource` tablosu + `KnowledgeSourceType` enum (5 değer: PastCases / ProductDocs / SLARules / Checklists / ManualEntry)
- 3 endpoint: `GET / POST / PATCH /api/admin/knowledge-sources`
- `autoPopulateIfEmpty(companyId)` — list ilk çağrıda 0 kayıt görürse 4 default insert
- Otomatik ingestion/embedding YOK — sadece envanter
- UI: 2-column kart grid, tip-bazlı renkli ikon (Archive/FileText/Clock/CheckSquare/PenLine), Aktif/Pasif badge, Pasif Yap toggle, create/edit modal

**Demo:** admin@varuna.dev → Yönetim → Yapılandırma → **Bilgi Kaynakları** →
4 default kart (Geçmiş Vakalar 59 kayıt / SLA 6 / Checklist 3 / Kategori 19).
**Yeni Kaynak** → "Çağrı Notları" / Manuel Giriş / 250 kayıt → 5. kart.

---

### Madde 7 — AI Kullanım Panosu

**Ne yapıldı:** Tüm AI endpoint çağrıları otomatik telemetri kayıt eder.
Supervisor'a 7d/30d ROI panosu: kabul oranı, ortalama yanıt süresi, tahmini
zaman tasarrufu, endpoint kırılım, günlük trend.

**Teknik detay:**
- `AIUsageLog` tablosu (companyId + 3 index)
- `aiHandler` factory enrich edildi: `endpointName` parametresi + `res.on('finish')` ile başarılı (2xx) çağrılarda otomatik log; 6 AI endpoint instrument edildi (suggest-category, draft-resolution, supervisor-summary, churn-conversion, dashboard-chat, call-summary)
- `companyId` resolve: handler'dan `req.aiLog.companyId` → fallback `allowedCompanyIds[0]`
- 2 endpoint: `PATCH /api/ai/usage/:id/accept` (Uygula/Yoksay), `GET /api/analytics/ai-usage?period=7d|30d`
- Tahmini tasarruf: `kabul edilen × 28sn / 60` formülü (manuel aksiyon başına ~28sn baseline)
- UI: `AIUsagePage` (4 KPI + endpoint breakdown table + Recharts BarChart günlük trend, ≥70% emerald / ≥40% amber / <40% rose acceptance badge)

**Demo:** Vaka açılırken AI kategori öneri çağrıldı → log yazıldı. Supervisor
→ /analytics-ai-usage → "Toplam 47 çağrı · Kabul %68 · Ort 412ms · ~22 dk
tasarruf". Tablo: suggest-category 38 / draft-resolution 9. Bar chart son
7 günü gösterir.

---

## Plansız Ama Kritik — Multi-Tenant İzolasyon

### Sorun
Faz 1.5 başlarken yapılan güvenlik audit'i 3 CRITICAL + 6 HIGH izolasyon açığı
buldu:
- `User` tablosunda `companyId` yok → filter bilgisi yok
- `Case`'in `companyId`'si var ama `caseRepository.list()` filtresiz → bir agent tüm şirketlerin vakalarını görüyor
- Bootstrap (lookups) tüm şirketlerin takım/kişi/müşteri verisini her kullanıcıya gönderiyor
- Admin endpoint'leri URL'deki `companyId`'yi doğrulamadan kullanıyor

Yani üretime açıldığı an PARAM agent'ı UNIVERA'nın tüm vakalarını görebiliyordu.

### Çözüm — 5 Phase
Holding modeli (PARAM + UNIVERA + FINROTA tek kullanıcı havuzu, supervisor multi-company görür) ile:

**Phase 1 — Schema:**
- `UserCompany` N:M köprü tablosu + `CompanyRole` enum (Agent/Supervisor/Admin/SystemAdmin per-company)
- `Team.companyId` zorunluya çevrildi (mevcut takımlar PARAM'a backfill)
- `seedAuth.ts` 6 demo user × per-company role atamaları

**Phase 2 — Auth middleware:**
- `verifyJwt` artık `req.user`'a `allowedCompanyIds` + `companyRoles` ekliyor
- SystemAdmin sistem rolü → tüm aktif şirketlere otomatik (yeni şirket eklenince otomatik kapsanır)
- Auto-provision: yeni Supabase Auth user'ı email exact match ile Person'a bağlar

**Phase 3 — Query filters:**
- `caseRepository`: list/get + 15 mutation `allowedCompanyIds` parametresi alır
- `CaseAccessError` → route 403'e çevrilir
- `lookupRepository.bootstrap(allowedCompanyIds)` — 7 lookup tablosu scope filter
- Cross-tenant case ID denenirse 403, hiçbir mutation yapılmaz

**Phase 4 — Admin endpoint security:**
- `requireRole('Admin', 'SystemAdmin')` (eskiden SystemAdmin-only)
- 2 helper: `requireSystemAdminOnly` + `assertCompanyAdmin`
- Sistem-geneli (third-parties, document-types, persons, offered-solutions) vs per-company (teams, sla, checklist, categories, field-definitions, company-settings) ayrımı
- field-definitions `companyId` artık zorunlu

**Phase 5 — Admin UI:**
- 5A: **Şirketler** ekranı — `companyRepo` + 4 endpoint, Yeni Şirket modal (SystemAdmin) + Düzenle (per-company Admin)
- 5B: **Kullanıcılar** ekranı — `userRepo.list/replaceCompanies`, checkbox + per-company role dropdown, en az 1 şirket zorunlu, SystemAdmin user'ları salt-okunur
- Cleanup: eski "Şirket Ayarları" sayfası silindi (Şirketler ekranı kapsıyor)

### Plansız Ama Kritik — Child Tablo Denormalize
Multi-tenant'ın tamamlayıcısı: 8 child tabloya `companyId` denormalize:
`CaseNote`, `CaseAttachment`, `CaseActivity`, `CaseCallLog`,
`CaseOfferedSolution`, `CaseApproval`, `CaseNotification`, `AISuggestion`.

**Sebep:** Faz 2 collab tablolarından (CaseWatcher, CaseLink, AISuggestion
bildirim widget'ları) **top-level scope query** yapılacak — caseId üzerinden
parent'a bağlı kalmak Case JOIN gerektirir. Şimdi her child kendi
`companyId`'sini taşıyor; `where: { companyId: { in: allowedCompanyIds } }`
direkt çalışır.

**Migration:** 3 aşamalı atomik (ADD nullable → UPDATE backfill → ALTER NOT NULL).
1531 satır eşleşti, sıfır mismatch.

### Auto-provisioned User Sınırlaması (bilinçli)
Yeni Google OAuth user'ı ilk login'inde DB'ye yazılır ama `allowedCompanyIds: []`
ile başlar — admin manuel olarak şirket atayana kadar hiçbir veri görmez.
UI'da "yetkilendirme bekleniyor" mesajı UX iyileştirmesi sonraki turda.

---

## Yeni Tablolar

| Tablo | Faz 1.5 Madde / İş | Amaç |
|---|---|---|
| `UserCompany` | Multi-tenant Phase 1 | User ↔ Company N:M köprü |
| `CaseMention` | Madde 3 | Not içinde @mention audit + bell |
| `PatternAlert` | Madde 5 | Örüntü tespit alarmı |
| `KnowledgeSource` | Madde 6 | AI bilgi kaynağı kataloğu |
| `AIUsageLog` | Madde 7 | AI çağrı telemetrisi |
| `QAScoreLog` | Madde 4 | Vaka başına QA skor audit |

**Mevcut tablolara eklenen alanlar:**
- `Case`: `snoozeUntil` / `snoozeReason` / `snoozePreviousStatus` (Madde 1)
- `Case`: `qaEmpathyScore` / `qaClarityScore` / `qaSpeedScore` / `qaFeedback` / `qaScoredAt` (Madde 4)
- `User`: `personId @unique` (auto-provision için)
- `Team`: `companyId` (zorunlu, multi-tenant Phase 1)
- 8 child tablosu: `companyId` (denormalize)

---

## Yeni Endpoint'ler

### Vaka işlemleri
- `POST /api/cases/bulk-update` — 4 alan, max 100 vaka, cross-tenant atomic
- `POST /api/cases/:id/snooze` / `DELETE /api/cases/:id/snooze`
- `GET /api/cases/snoozed` (me)
- `POST /api/cases/:id/notes` (genişletildi: @mention parse)
- `GET /api/cases/:id/mentionable-users`
- `POST /api/cases/:id/mentions/seen`
- `GET /api/cases/me/mentions/unread`

### Cron (uzaktan tetiklenen periyodik)
- `POST /api/cases/cron/snooze-wakeup` — her 5 dk
- `POST /api/cron/pattern-detect` — her 15 dk
- `POST /api/cron/qa-score-batch` — her gece 02:00 UTC
- `POST /api/cron/qa-score` — manuel/test

### Analitik (Supervisor / Admin / SystemAdmin)
- `GET /api/analytics/ai-usage?period=7d|30d`
- `GET /api/analytics/patterns?status=active|all`
- `PATCH /api/analytics/patterns/:id/dismiss`
- `GET /api/analytics/qa-scores?period=7d|30d`

### AI ek
- `PATCH /api/ai/usage/:id/accept` — Uygula/Yoksay sonrası

### Admin (multi-tenant)
- `GET / POST / PATCH / DELETE /api/admin/companies`
- `GET /api/admin/users`
- `PUT /api/admin/users/:id/companies`
- `GET / POST / PATCH /api/admin/knowledge-sources`

---

## Yeni Admin Ekranları

| Ekran | Yetki | Madde |
|---|---|---|
| Şirketler (`/admin/companies`) | SystemAdmin (CRUD) + Admin (own) | Multi-tenant Phase 5A |
| Kullanıcılar (`/admin/users`) | Admin / SystemAdmin | Multi-tenant Phase 5B |
| Bilgi Kaynakları (`/admin/knowledge-sources`) | Admin / SystemAdmin | Madde 6 |

## Yeni Analitik Ekranları (sidebar)

| Ekran | Yetki | Madde |
|---|---|---|
| AI Kullanımı (`/analytics-ai-usage`) | Supervisor / Admin / SystemAdmin | Madde 7 |
| Örüntü Alarmları (`/analytics-patterns`) | Supervisor / Admin / SystemAdmin | Madde 5 |
| QA Skorları (`/analytics-qa-scores`) | Supervisor / Admin / SystemAdmin | Madde 4 |

---

## Açık Konular (Faz 2 Öncesi)

### Phase 5C — Tanım Ekranlarında Şirket Picker
4 admin ekranı backend'de `companyId`'yi zorunlu kıldı ama UI'da seçici yok
→ bugün create yapılırsa 400. Ekranlar:
- Takımlar & Üyeler
- SLA Kuralları
- Kontrol Listesi
- Kategori & Alt Kategori (nullable, sessizce sistem geneli yaratıyor — yanıltıcı)
- Dinamik Alanlar (companyId zorunlu, picker var ama "Tümü" seçeneği kaldırıldı)

Her ekrana **şirket seçici** + form'da zorunlu companyId + tablo'da şirket
sütunu gerekiyor.

### Smart QA Lite — Görünürlüğü Artırılacak
- Frontend AI çağrılarına `caseId` + `companyId` explicit eklenmeli (şu an
  fallback ile çalışıyor; multi-company supervisor için ana şirket
  varsayımı yanıltıcı)
- "Uygula/Yoksay" butonları RUNA AI kartına bağlı değil →
  `PATCH /api/ai/usage/:id/accept` çağrısı henüz tetiklenmiyor → acceptance
  rate panosunda "veri yok"
- `tokenCount` instrument edilmedi (OpenAI response.usage.total_tokens)

### Child Table companyId — TECHNICAL_DEBT
8 child tabloya `companyId` denormalize edildi (Phase 3 ek işi). Bu denorm
**read-side query optimizasyonu** için. Faz 2 collab tabloları yazılırken
aynı pattern korunmalı (CaseWatcher, CaseLink, vb.). `TECHNICAL_DEBT.md`'ye
not düşülecek (henüz oluşturulmadı).

### UX/UI Yenilemesi
- Sidebar accumulate ediliyor — analitik altında 4 öğe (Vaka Raporları, AI
  Kullanımı, QA Skorları, Örüntü Alarmları) için grup/alt-başlık şart
- Pattern alarmı / mention bell / pattern badge — header gürültüsü
- Faz 2 öncesi sidebar/header redesign turunda gözden geçirilecek

### Diğer
- `/api/cases/cron/snooze-wakeup` tarihsel sebeplerle cases router'ında kaldı; yeni cron'lar `/api/cron` prefix'inde
- Vercel Hobby cron sınırı (günde 1) — Pro'ya geçilirse `vercel.json` `crons` config geri eklenebilir, GitHub Actions yedek olarak kalır

---

## Faz 2'ye Hazırlık

Faz 1.5'in en büyük çıktısı **mimari altyapı**: Faz 2 collab spec'inin
(Watchers / Linked Cases / Birleşik Etkinlik Akışı / 6 AI rolü) inşa
edilebileceği taban. Spesifik olarak:

| Faz 2 Özelliği | Faz 1.5'in Hazırladığı |
|---|---|
| Takipçi Alanı (CaseWatcher) | Multi-tenant scope (companyId pattern), bildirim altyapısı (mention bell pattern) |
| Bağlı Vakalar (CaseLink) | Cross-tenant atomic reject pattern (bulk-update'te çalıştı) |
| Birleşik Etkinlik Akışı + @mention + reactions | @mention sistemi (Madde 3) çalışır halde — comment-reply için sourceType+sourceId dönüşümü ileride |
| AI Rolleri (Sınıflandırıcı/Araştırıcı/Yazman/Yönlendirici/Bekçi/Risk Göstergesi) | AI çağrı telemetri (Madde 7) — her rol istatistik üretir; QA skor (Madde 4) Yazman'ın kapatma denetiminin temeli |
| Bildirim Sistemi §6 | mention bell pattern (60s polling + custom event) — WebSocket'e geçiş kolay |
| Vaka Niyeti / Etki Kapsayımı / Başarı Kriteri | Case'e enum/string alan ekleme + AI prompt zenginleştirme; Madde 4 QA pattern'i Başarı Kriteri'nin kontrol mantığı için referans |

**Kiracı bazlı AI yönetimi (§10):** AIUsageLog (Madde 7) ile companyId başına
kullanım izlenebiliyor. `CompanySettings`'e `aiProvider` / `aiApiKey` /
`aiMonthlyTokenLimit` alanları eklenirse limit/budget kontrolü çalışmaya
hazır.

**6 AI Rolü için zemin:** Her rolün çıktısı `AIUsageLog`'a düşer →
acceptance rate, response time, hangi rol en sık çağrılıyor — pano hazır.

---

**Versiyon:** 1.0
**Sonraki güncelleme:** Faz 2 Sprint 1 başlangıcında (Watchers + Linked Cases).
