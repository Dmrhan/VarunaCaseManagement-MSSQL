# Backlog — Kalan İşler

> Bu doküman geliştirme oturumları arasında **unutmamak için** tutuluyor.
> Her madde kendi içinde anlamlı yazılmıştır — başka bir dokümanı açmana gerek
> kalmadan ne yapacağını, neden yapacağını ve kaldığın yeri görebilirsin.

**Son güncelleme:** 2026-05-14
**Kapsam:** Faz 1 / Faz 1.5 hardening + Operations Dashboard kalan fazlar +
Faz 2 Collab eksik bölümleri + Collab Hardening + ileri sprint adayları.

**Renk kodları:**
- 🔴 **Kritik** — production güveni / güvenlik / canlı veriyi etkileyen
- 🟡 **Yüksek değer** — sık talep gören özellik veya temel kalite
- 🟢 **Düşük öncelik** — ileri sprint, ürün kararı bekliyor ya da nice-to-have

---

## 🔴 1) OpenAI API key prefix/suffix loglama — production'da kapat

**Ne yapacağız?**
`server/routes/ai.js:53` startup'ta `[ai] Key format — length=51, prefix=sk-xxxx, suffix=...abcd` formatında konsola yazıyor. Bu satırı **production ortamda yazmayacak şekilde** gate'le (`if (process.env.NODE_ENV !== 'production')`).

**Neden önemli?**
11 karakterlik substring (prefix 7 + suffix 4) sızıntı potansiyeli taşıyor. Vercel log'larında, Sentry'de veya stdout dump'larında görünür. Geliştirme için faydalı, prod için risk.

**Mevcut durum:** Açık. Tek satır değişikliği.
**Çaba:** 15 dakika
**Bağımlılık:** Yok

---

## 🔴 2) Status transition state machine — backend'de illegal geçişleri reddet

**Ne yapacağız?**
`server/db/caseRepository.js:922` içindeki `transitionStatus()` herhangi bir `nextStatus` değerini kabul ediyor; **yasal geçiş kontrolü yok**. State machine ekle:
- `Açık → İncelemede / Eskalasyon / İptalEdildi`
- `İncelemede → Açık / 3rdPartyBekleniyor / Eskalasyon / Çözüldü / İptalEdildi`
- `3rdPartyBekleniyor → İncelemede / Çözüldü / İptalEdildi`
- `Eskalasyon → İncelemede / Çözüldü / İptalEdildi`
- `Çözüldü → YenidenAcildi` (özel kural)
- `YenidenAcildi → İncelemede / Eskalasyon / Çözüldü / İptalEdildi`
- `İptalEdildi → (terminal, hiçbir geçiş yok)`
İllegal geçişte 422 `invalid_transition` dön.

**Neden önemli?**
UI bugün geçişleri engelliyor, ama API'ye doğrudan curl atılırsa "İptalEdildi → Açık" gibi anlamsız atlamalar mümkün. Demo / pen-test riski.

**Mevcut durum:** Açık. UI'da `StatusTransitionPanel` doğru geçişleri zaten biliyor — aynı mantığı backend'e kopyala.
**Çaba:** 2-3 saat
**Bağımlılık:** Yok

---

## 🔴 3) Role permission hardening — merkezi rol matrisi

**Ne yapacağız?**
Cases route'unda yer yer dağınık `elevated = ['Supervisor','Admin','SystemAdmin']` kontrolleri var. Şunlar için **API katmanında rol gate'i**:
- **İptal et** — kim yapabilir? (öneri: atanan kişi + Supervisor+)
- **Yeniden Aç (Çözüldü → YenidenAcildi)** — kim?
- **Eskalasyon başlat/seviye değiştir** — kim?
- **Bulk update** — sadece Supervisor+ mı?
- **Transfer** — atanan + Supervisor+ mı?

Ürün kararı gerek; sen karar verince merkezi bir `server/lib/casePolicy.js` modülüne taşı.

**Neden önemli?**
Bugün UI bu butonları gizliyor ama API'de gate yok. Agent role'lü kullanıcı doğrudan API çağırırsa bypass edebilir.

**Mevcut durum:** Açık + ürün kararı bekliyor.
**Çaba:** Karar sonrası 1 gün
**Bağımlılık:** Senin "kim ne yapabilir?" matris kararın

---

## 🔴 4) AI Accept/Reject — FE telemetri wiring

**Ne yapacağız?**
Backend'de `PATCH /api/ai/usage/:id/accept` endpoint'i hazır (`server/routes/ai.js:1102`), her AI yanıtı `usageLogId` döndürüyor. **AMA hiçbir FE çağırmıyor.**
- `aiService.markAccepted(usageLogId, accepted: boolean)` metodu ekle.
- AI önerisi gösteren her yere (NewCaseForm suggest-category, SupervisorSummary, ChurnConversion, DraftResolution, TransferSuggest, CustomerPulseSummary, Operations brief/insights/explain/report/drilldown-assistant) "Uygula / Yoksay" butonları + PATCH.

**Neden önemli?**
AI Kullanım Panosu'nda `acceptanceRate` şu an sürekli `null` görünüyor. Madde 7 panosu (`/api/analytics/ai-usage`) bu olmadan ölü; AI öneri kalitesini ölçemiyoruz.

**Mevcut durum:** Backend hazır, FE eksik.
**Çaba:** 3-4 saat
**Bağımlılık:** Yok

---

## 🟡 5) SLA edge case smoke

**Ne yapacağız?**
`transitionStatus` pause/resume mantığı çalışıyor (3rdPartyBekleniyor → SLA durur, çıkınca devam eder + `slaResolutionDueAt` kaydırılır). **Smoke edilmeyen senaryolar:**
- Çözüldü/İptal'de SLA gerçekten duruyor mu? (UI'da gösterim ne, DB'de durum ne?)
- Snooze ile SLA ilişkisi (snooze edilen vaka SLA saatini durduruyor mu?)
- Bulk status update SLA pause mantığını bypass ediyor mu? (`bulkUpdateStatus` ayrı kod yolu var: `server/db/caseRepository.js:782`)
- Timezone (`Europe/Istanbul` vs UTC) drift'i var mı?

Tek bir smoke script: `scripts/smoke-sla-edge-cases.js`.

**Neden önemli?**
SLA müşteriye verilen söz; yanlış durup-kalkması ciddi anlaşma riski.

**Mevcut durum:** Pause/resume var; geri kalan kontrolsüz.
**Çaba:** Yarım gün
**Bağımlılık:** Yok

---

## 🟡 6) Multi-tenant isolation smoke (Faz 1 endpoint'leri)

**Ne yapacağız?**
Customer Pulse + Analytics overview/drilldown için smoke var. **Eksik smoke'lar:**
- `/api/cases/*` (list, detail, create, update, transition, notes, watchers, links)
- `/api/lookups/*` (categories, products, teams, etc.)
- `/api/admin/*` (Companies, Categories, Checklist, SLA, Fields, Teams, KnowledgeSources)
- `/api/ai/*` (suggest-category, supervisor-summary, churn, draft, transfer, customer-pulse)
- Attachments / file access (eğer varsa)

Her endpoint için: PARAM kullanıcısı UNIVERA verisine ulaşabiliyor mu? (Hayır olmalı.)

**Neden önemli?**
Çok-tenant ürünün en kritik garantisi. Bir tek endpoint'in `allowedCompanyIds` filtresini atlaması başka müşterinin verisini sızdırır.

**Mevcut durum:** Phase 1/2/3 dashboard endpoint'leri smoke'lu, geri kalan değil.
**Çaba:** Yarım gün
**Bağımlılık:** Yok

---

## 🟡 7) Test framework (Vitest) entegrasyonu

**Ne yapacağız?**
Tek formel test: `server/analytics/__tests__/metricFormulas.test.js` (31/31 paf node-assert ile). Geri kalan her şey ad-hoc smoke script. Vitest kur, temel akışlar için test yaz:
- Case create → assignment → transition akışı
- Note ekleme + mention → CaseMention satırı + bildirim
- Watcher add/remove + scope kontrolü
- SLA pause/resume sayaçları
- AI suggest-category prompt schema doğrulaması
- Auth: Agent ↔ Supervisor ↔ Admin yetki sınırları

CI entegrasyonu için ayrı dilim — şimdilik lokal `npm test`.

**Neden önemli?**
Smoke script'leri elle çağırılıyor; geliştirme hızı arttıkça regresyon yakalama düşük. Test yoksa her PR önce sen son kullanıcı oluyorsun.

**Mevcut durum:** Sıfır framework.
**Çaba:** 1 gün (kurulum + ~10 temel test)
**Bağımlılık:** Yok

---

## 🟡 8) Smart QA — caseId / companyId AI çağrılarında explicit

**Ne yapacağız?**
Bazı AI çağrılarında `caseId` + `companyId` body'de explicit gönderiliyor (suggestCategory ✓), bazılarında implicit fallback'e güveniliyor (multi-company supervisor için "ana şirket" varsayımı yanıltıcı). Tarama:
- `aiService.supervisorSummary` → case objesi geçiyor; içinde companyId var mı kontrol et
- `aiService.churnConversion` → aynı
- `aiService.draftResolution` → aynı
- `aiService.callSummary` → aynı

Eksik olan her birine `caseId` + `companyId` explicit ekle.

**Neden önemli?**
Madde 6 (AI Accept/Reject) ile birlikte AI Kullanım Panosu'nun doğru telemetri üretmesi için. Aksi halde supervisor'ın 3 şirketten birinde yaptığı AI önerisi yanlış şirkete loglanır.

**Mevcut durum:** suggestCategory ✓, geri kalanı şüpheli.
**Çaba:** 2 saat (tarama + düzeltme)
**Bağımlılık:** Yok

---

## 🟡 9) Faz 2 §11/§12/§13 — Sınıflandırıcı AI'a 3 yeni alan

**Ne yapacağız?**
Üçü birlikte iş çıkar (FAZ2 spec, PRD v2 eki):
- **§11 Vaka Niyeti** (caseIntent: Bilgi/Çözüm/Telafi/Eskalasyon/Belirsiz) — `Case` modeline alan + Sınıflandırıcı AI önerisi
- **§12 Müşteri Etki Katsayısı** (impactScope: Tek/Şube/Bayi Ağı) — alan + AI önerisi
- **§13 Başarı Kriteri** (successCriteria: tek cümle metin) — alan + AI varsayılan önerisi

Schema migration + suggest-category response'a 3 alan ekle + UI'da göster.

**Neden önemli?**
§14 Risk Göstergesi'nin 6-sinyal entegrasyonunun ham girdileri. Ayrıca §11/§12 sinyalleri Bekçi AI (örüntü tespiti) ağırlıklandırmasını besler.

**Mevcut durum:** Faz 2 spec'inde tanımlı, kod yok.
**Çaba:** 1.5 gün (migration + AI prompt güncellemesi + UI)
**Bağımlılık:** Yok

---

## 🟡 10) Bundle splitting (Vite chunk warning)

**Ne yapacağız?**
Her build'de Vite uyarı veriyor: tek eager `index-*.js` ~1.4MB (gzip 370KB). Hiçbir `React.lazy` yok, 17+ page eager. `polished-wondering-waffle.md` planı:
- 11 Admin*Page → lazy
- AIUsagePage / PatternsPage / QAScoresPage / CaseAnalyticsPage / MyCalendarPage / RunaAiChatPanel → lazy
- 2 `<Suspense>` boundary (admin block + main content) + `PageFallback` skeleton
- `vite.config.ts` `manualChunks` — recharts/lucide-react vendor chunk'ları, admin/analytics route bazlı chunk'lar

**Neden önemli?**
Frontline kullanıcı (Agent) admin chunk'ını boş yere indiriyor. Hedef: eager bundle ~600-700KB.

**Mevcut durum:** Plan dosyası mevcut, kod değişikliği yok.
**Çaba:** 1 gün
**Bağımlılık:** Yok

---

## 🟡 11) Phase 5b — XLSX / PDF export

**Ne yapacağız?**
Şu an Report Studio sadece **Markdown copy** + **browser print** sunuyor. Gerçek dosya indirme yok. Ekle:
- **XLSX**: `xlsx` veya `exceljs` paketi; KPI + breakdown'lar ayrı sheet; drilldown row dump için ayrı endpoint (paginated)
- **Server-rendered PDF**: `puppeteer` ya da `pdfkit`; Report Studio preview HTML → PDF
- Export dosyasına scope/audit metadata göm (formulaVersion, metricAuditId, asOf)
- Frontend "Export" menüsü Report Studio footer'da

**Neden önemli?**
En sık talep edilen iş çıktısı. Yönetici brief'i için PDF, finans/operasyon için XLSX.

**Mevcut durum:** Phase 5a (Markdown + print) prod'da.
**Çaba:** 2-3 gün
**Bağımlılık:** Yok

---

## 🟡 12) Phase 6 — PPTX export

**Ne yapacağız?**
Yönetici sunumları için PowerPoint export. Her major section = bir slayt:
1. Kapak (title + scope + period)
2. KPI özet
3. Trend grafiği
4. Riskli müşteriler
5. AI özet + öneriler
6. Appendix

`pptxgenjs` paketi.

**Neden önemli?**
Executive lens kullanıcıları yönetim toplantılarına götürüyor. Bugün manuel olarak slayt hazırlanıyor.

**Mevcut durum:** Yok.
**Çaba:** 2 gün
**Bağımlılık:** Phase 5b (PDF) tamamlanırsa altyapı yeniden kullanılır

---

## 🟡 13) firstResponseTimeMin metrik instrumentation

**Ne yapacağız?**
Phase 1'de `notAvailable: ['firstResponseTimeMin']` olarak işaretledik — "ilk yanıt zamanı için case event'i yok" demiştik. Şimdi event yaz:
- Vaka oluştuğunda → `Case.createdAt`
- İlk **dış** not / iletişim event'i → yeni alan `firstAgentResponseAt`
- `metricFormulas.js`'e formül + `operationsAggregator`'a alan ekle

**Neden önemli?**
"Ortalama ilk yanıt süresi" SLA komitelerinin en sevdiği metrik. Çözüm süresi (TTR) çok geç bir sinyal.

**Mevcut durum:** Schema alanı yok, KPI tile null gösteriyor.
**Çaba:** Yarım gün
**Bağımlılık:** Yok

---

## 🟡 14) backlogChangePct — BacklogSnapshot tablosu

**Ne yapacağız?**
Phase 1'de "approximate" olarak işaretledik. Gerçek günlük backlog snapshot tablosu yaz:
- Cron her gün 00:00 (Istanbul) → `BacklogSnapshot { date, companyId, openCount, slaRiskCount, byPriority Json }`
- 90 gün retention
- `backlogChangePct` formülü: (bugün - 7gün önce) / 7gün önce × 100

**Neden önemli?**
"Açık vakalar artıyor mu/azalıyor mu?" — trend olmadan tek nokta sayı yetersiz.

**Mevcut durum:** Approximations listesinde.
**Çaba:** 1 gün
**Bağımlılık:** Yok (cron var)

---

## 🟡 15) METRIC_FIXTURES.md PENDING değerleri

**Ne yapacağız?**
`docs/METRIC_FIXTURES.md` Phase 1 PR review için yazıldı, PENDING değerler kaldı. Smoke verisinden gerçek baseline'ları doldur:
- Per-role openCases / totalCases / slaViolationRatePct (multi-role smoke'tan)
- Beklenen byStatus / byPriority dağılımları

**Neden önemli?**
Regression test temeli — fixture'lar değişirse uyarı.

**Mevcut durum:** Doküman var, sayılar boş.
**Çaba:** 1 saat
**Bağımlılık:** Yok

---

## 🟡 16) Legacy dead code temizliği

**Ne yapacağız?**
Phase 2'de `OperationsDashboardPage`'i `view === 'dashboard'` üzerinde mount ettik; eski iki dosya artık import edilmiyor:
- `src/features/analytics/CaseAnalyticsPage.tsx` (~680 satır, eski in-memory dashboard)
- `src/features/analytics/RunaAiChatPanel.tsx` (~200 satır, eski floating chat panel)

Tek commit: dosyaları sil + git history korur. Phase 4a'da bilerek bırakmıştık.

**Neden önemli?**
TS check + bundle hâlâ bu dosyaları tarıyor. ~880 satır kuru çalışma.

**Mevcut durum:** Tree'de duruyor, kullanım yok.
**Çaba:** 30 dakika
**Bağımlılık:** Yok

---

## 🟡 17) Faz 2 §4 — Tepki + reply threading + Canlı Özet

**Ne yapacağız?**
Etkinlik akışına 3 ekleme:
- **Tepkiler**: notlara ve aktivite satırlarına 4 sabit emoji (👀✅⚠️❓). `CaseNote.reactions Json` + `CaseActivity.reactions Json` alanları (spec'te var). UI'da hover butonları.
- **Reply threading**: notlara `parentNoteId` ile 1-seviye yanıt
- **Canlı Özet kartı** (Yazman AI bölümünde — bkz. madde 19)

**Neden önemli?**
Slack-tarzı collab. Bugün 5 sekme arası dağınık etkileşim; tepki/yanıt = düşük efor, yüksek değer hızlı geri bildirim.

**Mevcut durum:** Mention'lar prod, tepki/threading yok.
**Çaba:** 1.5 gün
**Bağımlılık:** Yok

---

## 🟡 18) Faz 2 §5.2 — Araştırıcı AI

**Ne yapacağız?**
Sağ panelde "🕵 Araştırıcı" kartı, vaka açılış + 5sn arka plan:
- Müşterinin son 90g'deki benzer vakaları → bağlantı önerisi
- Bu kategori için en aktif çözen → takipçi önerisi
- Müşteri temsilcisi → takipçi önerisi

Mevcut `aiService.suggestLinks` zaten bunun bir parçası — paneli inşa et + diğer 2 öneri tipi ekle.

**Neden önemli?**
"Bu müşteriyi daha önce kim çözdü?" — bugün manuel arama.

**Mevcut durum:** suggestLinks endpoint'i var; panel + diğer öneriler yok.
**Çaba:** 1 gün
**Bağımlılık:** §2 (Watcher) ve §3 (Linked Cases) altyapıları zaten prod'da

---

## 🟡 19) Faz 2 §5.3 — Yazman AI

**Ne yapacağız?**
İki çıktı:
- **Canlı Özet kartı** — 10+ olay biriktiğinde akış başında, son 24 saatin 2 cümlelik özeti, 1 saat önbellek
- **Devir notu** — "Devralacağım" butonu basıldığında: "Şu an sahibi X. Sonraki adım Y. Risk Z."

**Neden önemli?**
Yeni gelen ekip üyesi vakayı 30 saniyede özetleyip devralabilsin (Faz 2 başarı kriterinden).

**Mevcut durum:** Yok.
**Çaba:** 1 gün
**Bağımlılık:** §4 etkinlik akışı (öncelikle aynı dilimde gelebilir)

---

## 🟡 20) Faz 2 §5.4 — Yönlendirici AI

**Ne yapacağız?**
Sağ panelde mini kart, tek cümle + tek aksiyon butonu:
- "Çözüldü'ye geçmek için denetim listesinde 2 madde kaldı."
- "Bu müşteriyi son 7g önce aradın. Tekrar arama önerilir."
- "Başarı kriteri: 'Müşteri cihazın çalıştığını teyit eder.' Henüz teyit alınmadı."

**Neden önemli?**
Agent'ın "şu an ne yapsam?" anına net cevap.

**Mevcut durum:** Yok.
**Çaba:** 0.5 gün
**Bağımlılık:** §13 Başarı Kriteri (madde 9) işe yarar kılar

---

## 🟡 21) Faz 2 §5.6 + §14 — Risk Göstergesi (Risk Lens)

**Ne yapacağız?**
Vaka başlığında renkli etiket (Yeşil/Sarı/Kırmızı), tek skor 0-100. Sinyal ağırlık tablosu (spec §14):
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

**Neden önemli?**
Tek bakışta "bu vakayla acil ilgilen / sıraya at" sinyali. Bugün agent her vakayı eşit görüyor.

**Mevcut durum:** Yok.
**Çaba:** 1 gün (madde 9 ve 17 sonrası tüm sinyaller hazır olunca)
**Bağımlılık:** §11/§12 (madde 9) + §8 duygu tonu (madde 24) + §4 tepki (madde 17)

---

## 🟡 22) Faz 2 §6 — Bildirim kanal matrisi + Resend e-posta

**Ne yapacağız?**
Bugün `CaseNotification` modeli var ama dağıtım sadece in-app. Eksik:
- **Kanal matrisi** (spec'teki tablo): mesai içi vs dışı, etiketleme/atama/SLA/eskalasyon her biri için kanal seçimi
- **Resend e-posta entegrasyonu** (sağlayıcı: Resend, karar verilmiş)
- **Günlük digest** (09:00 e-posta) takipçi profili `digest` olanlar için
- **Mesai saatleri** ayarı CompanySettings'te (varsayılan 09:00-18:00 Pzt-Cuma)
- SMS sağlayıcısı (NetGSM/İletimerkezi) — ileri sprint

**Neden önemli?**
Bildirim gürültüsünü %50 azaltmak (Faz 2 başarı kriteri). Bugün ya hiçbir şey ya her şey.

**Mevcut durum:** Model var, dağıtım yok.
**Çaba:** 2 gün
**Bağımlılık:** Resend API key + CompanySettings extension

---

## 🟡 23) Faz 2 §7 — Alt Görevler (CaseSubTask)

**Ne yapacağız?**
Vaka detayına yeni bölüm: "Alt Görevler (3/5)" ilerleme çubuğu. Her satır: onay kutusu, başlık, atama, son tarih.
- `CaseSubTask` modeli (status: todo/in_progress/done/cancelled, required: bool, displayOrder, assignedUserId)
- "Çözüldü"ye geçişte tüm `required: true` görevler `done` olmalı (yoksa engelle)
- Alt göreve atanan kişi otomatik watcher
- Kategori bazında şablon önerisi (Yönlendirici AI)

**Neden önemli?**
Karmaşık vakalarda atomik adımlar görünür olur. "Çözüm öncesi şu 3 şey yapılmış olmalı" enforcement'ı sağlar.

**Mevcut durum:** Yok.
**Çaba:** 1.5 gün
**Bağımlılık:** Yok

---

## 🟡 24) Faz 2 §8 — Duygu Tonu Analizi

**Ne yapacağız?**
- `CaseSentimentSnapshot` modeli (sentiment: positive/neutral/negative/angry, score -1.0..+1.0, sourceType: note/call_log/chat)
- Her not/çağrı geldiğinde toplu (5dk gecikme) AI sentiment çağrısı
- Vaka kartında ton trendi göster (önceki snapshot vs son)
- Negative/angry → Risk Göstergesi (madde 21) ağırlığa katkı

**Neden önemli?**
Müşterinin tonu bozuluyor sinyali, agent farkına varmadan yönetici müdahalesi tetikler.

**Mevcut durum:** Yok.
**Çaba:** 1.5 gün
**Bağımlılık:** §6 toplu cron işleyici altyapısı

---

## 🟡 25) Faz 2 §9 — Eksik Bilgi Tespiti (CategoryRequiredInfo)

**Ne yapacağız?**
Her kategori için "şu alanlar olmadan vaka açılamaz/kapanamaz" tanımı:
- `CategoryRequiredInfo` modeli (categoryId, fieldName, requiredFor: open/resolve, prompt)
- Vaka açılışında AI eksik bilgileri tespit eder, agent'a sorar
- Çözüm öncesi denetim — eksik varsa engelle (veya uyar — karar gerek)

**Neden önemli?**
"Müşterinin telefon numarasını sormayı unutmak" gibi tekrar eden açıklar. Knowledge debt kategori bazında saklanır.

**Mevcut durum:** Yok.
**Çaba:** 1.5 gün
**Bağımlılık:** Admin'de CategoryRequiredInfo CRUD ekranı

---

## 🟡 26) Faz 2 §10 — Kiracı bazlı AI ayarları

**Ne yapacağız?**
Bugün tek global `OPENAI_API_KEY`. CompanySettings'e ekle:
- `aiProvider` (OpenAI/Anthropic/disabled)
- `aiApiKey` (Supabase Vault ile şifreli)
- `aiMonthlyTokenLimit` (companyId başına)
- Limit aşılırsa AI çağrıları 503 + dashboard'da uyarı

`AIUsageLog`'tan companyId başına aylık token toplamı zaten alınabiliyor (madde 6 hazırsa) — kontrol mantığı oradan geçer.

**Neden önemli?**
Multi-tenant SaaS olarak satılırken her müşteri kendi AI bütçesini yönetmeli. Bugün global key tüm müşteriler arasında paylaşılıyor.

**Mevcut durum:** Yok.
**Çaba:** 2 gün
**Bağımlılık:** Supabase Vault entegrasyonu

---

## 🟡 27) Watcher permissions matrisi (Collab Hardening)

**Ne yapacağız?**
Bugün:
- Kim watcher ekleyebilir? (Şu an: route'ta gate yok — herkes ekleyebilir)
- Kim başkasını watcher'dan çıkarabilir? (Self + Supervisor+ — bu var)
- Kim başkasını watcher olarak ekleyebilir? (Belirsiz)
- Atanan kişi otomatik watcher mı? (Spec evet diyor — kontrol et)
- Mention edilen kişi otomatik watcher mı? (Spec evet — kontrol et)

Net policy + smoke testi.

**Neden önemli?**
"Vakayı kim takip ediyor" şeffaflığı; kötü niyetli watcher ekleme/çıkarma engeli.

**Mevcut durum:** Hiç kayıtlı değil; smoke yapılmamış.
**Çaba:** 0.5 gün
**Bağımlılık:** Yok

---

## 🟡 28) Mention notification deep-link

**Ne yapacağız?**
`CaseNotification.deepLink` alanı Faz 2 spec'inde tanımlı (`/cases/:id?focus=event-:activityId`) ama mention bildirimi üretildiğinde **doldurulmuyor**. Mention oluştuğunda CaseNotification yarat, deepLink alanını doldur, bell drawer'da tıklayınca vakaya gidip ilgili not'u vurgula (2sn flash).

**Neden önemli?**
"Beni etiketlemişler" → 5 tıklama sonra notu buluyorsun. Deep-link tek tık.

**Mevcut durum:** Schema alanı var, üretim yok.
**Çaba:** 0.5 gün
**Bağımlılık:** Yok

---

## 🟡 29) CaseNote.authorId backfill cron

**Ne yapacağız?**
PR #68'de `CaseNote.authorId` alanı eklendi (nullable). Eski notlar `authorId=NULL` taşıyor — reaksiyon eklenirse not sahibine bildirim üretilmez.
- Tek seferlik backfill: `CaseActivity` (note_added event'i) üzerinden eski notların yazarını eşle, `CaseNote.authorId`'yi doldur
- Tek script: `scripts/backfill-note-author.js`

**Neden önemli?**
Tepki bildirimleri (madde 17) tüm tarihçede çalışsın.

**Mevcut durum:** Yeni notlar tamam, eski notlar boş.
**Çaba:** 2 saat
**Bağımlılık:** Madde 17 öncesi yapılmalı

---

## 🟡 30) Linked case symmetric — Parent/Related/Blocking

**Ne yapacağız?**
Duplicate symmetric çalışıyor (test senaryosunda doğrulanmış). Diğer 3 tip için:
- **Parent**: A parent of B ise B'de "Üst vaka: A" görünmeli (asymmetric ama iki uçtan da görünür)
- **Related**: symmetric (A related B = B related A) — kontrol et
- **Blocking**: asymmetric (A blocks B; B is blocked by A) — iki uçtan farklı etiket göstermek lazım

`linkRepo.list`'in döndürdüğü görünümler iki uç için tutarlı mı?

**Neden önemli?**
"Bu vaka neyle bağlı?" — sadece bir uçtan görünürse ilişki yarıda kaldı izlenimi.

**Mevcut durum:** Duplicate ✓, diğerleri belirsiz.
**Çaba:** 0.5 gün
**Bağımlılık:** Yok

---

## 🟡 31) Transfer watcher notification

**Ne yapacağız?**
Vaka aktarıldığında:
- Eski atanan kişi (transfer öncesi sahibi) otomatik watcher olur
- Tüm watcher'lara "Vaka X takıma/kişiye aktarıldı" bildirimi gider
- Yeni atanan kişi otomatik watcher
- CaseActivity'de transfer event'i (zaten var mı kontrol et)

**Neden önemli?**
Transfer "vakanın bana ait olmadığı" anı; eski sahip bilgisini kaybetmemeli.

**Mevcut durum:** Hiç kayıtlı değil.
**Çaba:** 0.5 gün
**Bağımlılık:** Madde 22 (kanal matrisi) idealdir ama olmadan da çalışır

---

## 🟡 32) Mobile / dark mode polish turu

**Ne yapacağız?**
ROADMAP'ta "General flow works, not mobile-first" notuyla geçiyor. Spesifik polish:
- Modal/popover overflow (KeyboardShortcutsModal, CustomerCardModal, ReportStudioModal mobile)
- Drilldown drawer mobile (genişlik kontrolü)
- Sidebar collapse/expand mobile geçişi
- Dashboard FilterBar wrap davranışı dar ekranda
- Dark mode legibility audit (Operations Dashboard, Report Studio, AI surfaces tek tek gez)

**Neden önemli?**
Yöneticinin telefondan kontrol etmesi temel senaryo.

**Mevcut durum:** Çalışıyor ama çatlaklar var.
**Çaba:** 1 gün
**Bağımlılık:** Yok

---

## 🟢 33-46) Düşük öncelik / ileri sprint

Bu kalemler ürün kararı, ileri sprint ya da yeterli talep gelmedikçe ertelenir:

- **33. Audit replay UI** — `MetricQueryAudit` tablosunu görüntüleyen admin sayfası
- **34. Scheduled reports** — cron + e-posta ile haftalık/aylık otomatik rapor
- **35. Public share links** — read-only token ile dış kullanıcıya rapor paylaşımı
- **36. Report history** — kim ne zaman hangi raporu üretti, indirilebilir geçmiş
- **37. Real-time refresh** — 30sn polling yerine WebSocket / SSE
- **38. Drilldown row inline aksiyonlar** — drawer'da satırdan assign/escalate/yorum
- **39. Karşılaştırmalı period selector** — "geçen hafta vs bu hafta" yan yana
- **40. Pinned / saved dashboard view'leri** — kullanıcı favori filtre setini kaydeder
- **41. A11y / klavye navigasyon audit** — WCAG / screen reader uyumu
- **42. snooze-wakeup cron route'unu `/api/cron` prefix'ine taşı** — tarihsel sebep
- **43. Vercel Hobby → Pro cron geçişi** — günde 1 sınırını aşmak için
- **44. Persona enum (CSLeadership/ProductManager/CustomerSuccessLead)** — Phase 5+'da deferred edildi, gerekirse iste
- **45. Sidebar/header redesign turu** — Faz 2 öncesi planlanmıştı, kısmen yapıldı
- **46. 50 design-question karara bağlama** — `docs/OPERATIONS_DASHBOARD_DESIGN.md §7`'deki açık karar listesi (delta 7g/30g, byTeam avg/median, retention payda Churn-only mi tüm vakalar mı, vs.)

---

## Önerilen sıralama

**Hafta 1 — Hardening sprint:**
1. Madde 1 (key logging gate) — 15dk
2. Madde 4 (AI Accept/Reject FE) — 3sa
3. Madde 8 (Smart QA explicit) — 2sa
4. Madde 16 (legacy temizlik) — 30dk
5. Madde 2 (transition state machine) — 3sa
6. Madde 3 (role permissions — ürün kararı sonrası) — 1 gün
7. Madde 5 (SLA edge case smoke) — yarım gün
8. Madde 6 (multi-tenant smoke) — yarım gün

**Hafta 2 — Ürün ileri:**
1. Madde 9 (Faz 2 §11/§12/§13) — 1.5 gün
2. Madde 17 (§4 tepki + threading) — 1.5 gün
3. Madde 29 (note authorId backfill) — 2sa
4. Madde 28 (mention deep-link) — 0.5 gün

**Hafta 3 — Operations Dashboard ileri:**
1. Madde 11 (Phase 5b XLSX/PDF) — 2 gün
2. Madde 10 (bundle splitting) — 1 gün
3. Madde 13 (firstResponseTime) — yarım gün

Sonrası: §5.x AI rolleri (madde 18-21), §6 bildirim kanal matrisi (22), §7-§8 (Alt Görev + Duygu Tonu)...

---

## Bu listeyi güncel tutmak

- Bir madde shipped olunca üstüne `~strikethrough~` ya da satırı sil
- Yeni iş geldiğinde uygun renk koduyla ekle
- Her dilim PR'ı bu dokümana referans verebilir
- Auto-memory'ye bu dosyanın varlığı not düşülmeli; gelecek oturum "neler eksik?" sorusunda buradan baksın
