Varuna CRM — AI-Assisted Case Management
PRODUCT_SPEC.md — Claude Code için Tek Kaynak Doküman
Versiyon: 2.1 | Güncelleme: Mayıs 2026

Bu dosya Claude Code'un her oturumda önce okuması gereken ürün spesifikasyonudur.
İş kuralları, alan tanımları, durum makinesi, SLA mantığı ve AI davranışı burada tanımlıdır.
Kodlama kararı verirken bu dosyayı referans al. Çelişki olursa bu dosya geçerlidir.


1. Modül Amacı
Müşteri taleplerini, proaktif takip süreçlerini ve churn yönetimini tek bir vaka (Case) yapısında toplamak.
Hedefler:

Ortalama çözüm süresini (TTR) kısaltmak
SLA ihlallerini azaltmak
Müşteri memnuniyetini artırmak
Churn sinyallerini erken yakalamak

Bu bir helpdesk ticket sistemi DEĞİLDİR.
3 farklı iş sürecini (destek, proaktif takip, churn) tek denetlenebilir yapıda birleştirir.

2. Teknik Altyapı
Frontend : React + TypeScript + Vite — port 5273
BFF      : Node.js + Express — port 3101 (local) / Vercel serverless (prod)
DB       : Supabase Postgres (Frankfurt EU) — MSSQL portable şema (cuid, Json, repository pattern)
ORM      : Prisma 6 — schema.prisma + prisma/migrations/
Auth     : Supabase Auth (email/password + Google OAuth) — verifyJwt middleware (server/db/auth.js)
Storage  : Supabase Storage — case-attachments private bucket, 3-step signed upload URL (Vercel 4.5MB body limit bypass)
State    : /api/lookups/bootstrap (LookupGate + AuthContext) — USE_MOCK kaldırıldı
Routing  : key-based (URL routing yok)
UI Kit   : Tailwind + lucide-react + clsx
Deploy   : Vercel — varuna-case-management.vercel.app
CI       : GitHub Actions — type check + Prisma validate + Vite build (.github/workflows/ci.yml)
AI Servisi:
Model    : gpt-4o-mini (OpenAI) — structured output (JSON Schema strict mode, enum constraints)
SDK      : openai (server/node_modules)
Key      : process.env.OPENAI_API_KEY (Vercel env vars)
BFF      : /api/ai/* endpoint'leri (server/routes/ai.js)
Rate     : IP başına 20 istek/dakika
Timeout  : 30 saniye

NOT: Başlangıçta Anthropic claude-haiku planlandı. Billing aktivasyon sorunu nedeniyle
OpenAI gpt-4o-mini kullanıldı. Anthropic sorunu çözülünce server/routes/ai.js'te
tek satır değişiklikle geri dönülebilir — UI değişmez.

Dark Mode:
Sistem   : Tailwind darkMode: 'class'
Palet    : Navy Dark
bg       : #0D1117 / surface: #161B22 / kart: #1C2128 / border: #30363D
text     : primary #E6EDF3 / secondary #7D8590 / link #58A6FF
Toggle   : Sidebar altında Sun/Moon butonu
Storage  : localStorage key: 'varuna-theme'
Faz planı:
FAZ 0 — Mock UI                       ✅ TAMAMLANDI
FAZ 1 — Tanım Ekranları               ✅ TAMAMLANDI
FAZ 2 — BFF + DB                      ✅ TAMAMLANDI (Supabase Postgres + Prisma 6, ~50 tablo)
FAZ 3 — Dosya Yükleme                 ✅ TAMAMLANDI (Supabase Storage, signed upload URL)
FAZ 4 — CaseDetailPage (3-kolon full page) ✅ TAMAMLANDI (Drawer konsepti yerine full page; Transfer + Checklist + Resolution Approval entegre)
FAZ 5 — Operations Dashboard + Report Studio + Action Center ✅ TAMAMLANDI
Auth/RBAC                             ✅ TAMAMLANDI (Supabase Auth + 6 rol)
Custom Fields + Şirket Ayarları       ✅ TAMAMLANDI (FieldDefinition + CompanySettings)

> **2026-05 ship dalgası** (Master Data Decision Sprint + Notification/Approval Level A): Account customerType + VKN/TCKN privacy + Multi-address + AccountProject Phase 1 + SupportLevel L1/L2 + Person.isTeamLead + Product/Package catalog + Case product/package integration + Import Studio Phase 1 + Customer 360 Phase 2a Foundation + Resolution Approval flow + Notification rules/templates/customer response channel Level A + Action Center / Aksiyonlarım inbox + Watcher Inbox UI + Reply threading + reactions + Customerless flow + Customer Pulse + AI Status Report + deterministic Customer Match. Detaylı liste: [docs/ROADMAP.md](ROADMAP.md) §"Recent Ships / Platform Capabilities".
>
> **2026-05-28 → 2026-06-05 ship dalgası** (post-cleanup): Action Center UX redesign + mention inline reply; case notes safety (submit guard / dup prevention / own-note delete); L1 Case Resolution Console (Phase 1 + 2A-CommandBar + 2B-Workbench + 2C-DecisionRail + 2D-Notes + 2E-Files + 2F-Status + 2G-Transfer); Quick Case V2 (L1 intake + Çözümle oluştur); Customer 360 Phase 2b commit + rollback UI + Phase 2c iterative (template download authed, relationship keys + persistent child IDs, **Phase B server-side XLSX dry-run** 25 MB multipart köprü, truthful 413 + preflight, import-friendly identity warnings); Account ID standardization (`cus_<22 char Crockford>`); international phone input + 3 dynamic slot + primary + type/extension metadata; corporate `taxOffice`; Turkish-aware customer search (İ↔i case-fold). Smoke data hygiene (GNF/ACP1).

3. Vaka Tipleri (CaseType)
3.1 GeneralSupport — Genel Destek
Müşteri sorun yaşadığında, bilgi istediğinde veya şikayet ilettiğinde.
Akış:
Açılış → Duplicate Kontrol → Havuz/Atama → İnceleme
→ 3rd Party / Eskalasyon → Çözüm → Supervisor Onayı (koşullu)
→ Müşteri Bildirimi → Kapatma / Yeniden Açılma
3.2 ProactiveTracking — Proaktif Takip
Kullanım düşüşü, finansal risk veya davranışsal sinyal olduğunda.
Akış:
Tetiklenme → Veri Hazırlığı → Agent Atama → Outbound Call Log
→ Disposition/Outcome → Follow-up → Hedef Değerlendirme
→ Kapatma VEYA Churn'e Dönüşüm

Bugün: Financial Status + Product Usage **manuel** girilir. İ-Şube veya benzeri dış sistem entegrasyonu **planlanmadı** — ROADMAP.md "Future Product Direction" veya OPEN_DECISIONS.md'ye eklenmeden committed sayılmaz. Yeni paying tenant data-source entegrasyonu isterse OPEN_DECISIONS'ta açık karar olarak izlenecek.

3.3 Churn — Churn Yönetimi
Müşteri iptal sinyali verdiğinde veya ProactiveTracking'den dönüşüm olduğunda.
Akış:
Açılış → Cancellation Reason → Teklif Döngüsü → Offer Outcome
→ Supervisor Onayı (koşullu) → Retention Follow-up → Kapatma
ProactiveTracking → Churn dönüşümünde: Tüm notlar ve çağrı logları yeni vakaya taşınır.

4. Durum Makinesi
Statüler ve Geçiş Matrisi
Mevcut DurumGeçilebilecekKimÖn KoşulSLAAçıkİncelemedeAgent, BackofficeVaka üstlenildiAktifAçıkİptalEdildiAgent, Supervisorİptal gerekçesi zorunluDururİncelemede3rdPartyBekleniyorAgent, Backoffice3rd party tanımı seçilmeliDURAKSATILIRİncelemedeEskalasyonSupervisor, BackofficeEscalationLevel + gerekçeAktifİncelemedeÇözüldüAgent, BackofficeÇözüm Notu zorunlu + koşullu Supervisor onayıDururİncelemedeİptalEdildiSupervisorGerekçe zorunluDurur3rdPartyBekleniyorİncelemedeAgent, BackofficeCevap geldiDevam eder3rdPartyBekleniyorEskalasyonSupervisorLevel + gerekçeAktif3rdPartyBekleniyorİptalEdildiSupervisorGerekçe zorunluDururEskalasyonİncelemedeBackoffice, SupervisorEskalasyon tamamlandıAktifEskalasyonÇözüldüBackoffice, SupervisorÇözüm Notu + Supervisor onayıDururEskalasyonİptalEdildiSupervisorGerekçe zorunluDururÇözüldüYenidenAcildiSistem / AgentMüşteri memnun değilYENİDEN BAŞLARYenidenAcildiİncelemedeAgent, Supervisor—AktifİptalEdildi(geçiş yok)—Terminal durum—
Kritik İş Kuralları
✅ Çözüldü geçişi → ResolutionNote ZORUNLU
✅ Supervisor onayı zorunlu:
   - Priority = Critical
   - SLAViolation = true
   - EscalationLevel IN ['Direktör', 'ÜstYönetim']
✅ İptalEdildi → iptal gerekçesi ZORUNLU
✅ 3rdPartyBekleniyor → 3rd party tanımı ZORUNLU seçilmeli
✅ SLA sayacı 3rdPartyBekleniyor'da duraksatılır
✅ Kontrol listesinde zorunlu maddeler tamamlanmadan Çözüldü DISABLED
Statü Geçişi UI — StatusTransitionPanel
Statü badge'e tıklanınca StatusTransitionPanel açılır (dropdown DEĞİL).
Her statü görsel kart. Geçilemeyen kartlar disabled+soluk.
Seçilen karta göre inline alanlar:

3rdPartyBekleniyor → 3rd party select
Eskalasyon → EscalationLevel select + gerekçe textarea
Çözüldü → ResolutionNote textarea + RUNA AI "✦ Taslak Üret"
İptalEdildi → cancelReason textarea

CaseHistoryActionType Enum
Transfer / StatusChange / FieldUpdate / ChecklistToggle /
NoteAdded / CallLogAdded / CaseCreated / SLAApplied

5. Alan Tanımları
5.1 Ortak Alanlar
AlanTipZorunluNotlarcase_numberVARCHAROtomatikYYYYMM-NNNNNcase_typeENUMEvetGeneralSupport / ProactiveTracking / Churncase_request_typeENUMEvetBilgi / Öneri / Talep / Şikayet / Hatacase_subjectVARCHAR(255)Yetki ileAI öneri üretirdescriptionTEXT(4000)Hayır—statusENUMOtomatikBaşlangıç: AçıkpriorityENUMEvetLow / Medium / High / CriticaloriginENUMEvetTelefon / E-posta / Web / Chatbot / Diğerorigin_descriptionTEXTKoşulluorigin='Diğer' ise ZORUNLUcompany_idFKEvet—category_id / sub_category_idFKEvetAI öneri üretiraccount_idFKYetki ileMüşteriassigned_person_id / team_idFKHayırTakım seçilince kişi filtrelerescalation_levelENUMHayırYok / TakımLideri / Direktör / ÜstYönetimresolution_noteTEXTKoşulluÇözüldü geçişinde ZORUNLUcancellation_reasonTEXTKoşulluİptalEdildi geçişinde ZORUNLUsla_response_timeDATETIMEOtomatik5-tuple SLA policy'densla_resolution_timeDATETIMEOtomatik5-tuple SLA policy'densla_violationBOOLOtomatikDefault: falsesla_paused_atDATETIMEOtomatik3rd Party girişindesla_paused_duration_minINTOtomatikToplam durakthird_party_idFKKoşullu3rdPartyBekleniyor'da ZORUNLUchecklist_itemsJSONOtomatikcreate() 3-tuple snapshotupdated_atDATETIMEOtomatikHer güncellemede
5.2 ProactiveTracking Özel
financial_status, product_usage, usage_change_alert, response_level
CaseCallLog: call_date, duration_min, call_disposition, call_outcome, description, caller_id, next_followup_date
→ Yeni log kaydedilince aiService.callSummary() otomatik → aiCallBrief alanına yazılır
5.3 Churn Özel
cancellation_request, offered_solutions(JSON), offer_expiry_date, offer_outcome,
offer_rejection_reason, action_taken, churn_result, retention_status, follow_up_date
5.4 AI Alanları
ai_summary, ai_category_prediction, ai_priority_prediction, ai_duplicate_score,
ai_confidence_score, ai_generated_flag, ai_reject_reason, ai_call_brief,
ai_followup_recommendation, ai_retention_offer_suggestion

6. SLA Motoru
5-tuple match: company_id + product_group_id + category_id + sub_category_id + case_request_type
→ getSlaPolicyFor() → SLAPolicy tablosundan kural çekilir

Eşleşme varsa: policy.response_hours / policy.resolution_hours
Fallback: Critical=4h / High=24h / Medium=72h / Low=168h

%80 uyarısı → kalan < %20 → Vaka Sahibi + Atanan Kişi bildirimi
SLA ihlal   → sla_violation=true → + Supervisor bildirimi

3rdPartyBekleniyor:
  GİRİŞ: sla_paused_at = now()
  ÇIKIŞ: pause_duration hesaplanır, sla_resolution_time uzar

7. Form Kuralları
KURAL-1: origin='Diğer' → origin_description ZORUNLU
KURAL-2: Takım seçilince kişi listesi o takıma filtreler
KURAL-3: case_type değişince data SİLİNMEZ, sadece visibility değişir
KURAL-4: Aynı account+type açık vaka varsa → uyarı, override mümkün
KURAL-5: Çözüldü → ResolutionNote boşsa disabled
KURAL-6: Supervisor gereken geçişlerde amber banner, kullanıcı devam edebilir
KURAL-7: Zorunlu checklist maddesi eksikse Çözüldü disabled

8. Duplicate Kontrol
Kural: aynı account_id + case_type + status IN (Açık/İncelemede/3rdParty/Eskalasyon)
→ Sarı uyarı + "Mevcut Vakayı Gör" + "Yine de Devam Et"

AI: ai_duplicate_score > 0.75 → Mavi bilgi kartı

9. Atama ve Devir
Havuz   : Atanmadan Açık bekler
Takım   : assigned_team_id — kişi listesi filtreler
Kişi    : Atanınca bildirim
Devir   : TransferCaseModal
          - Yeni kişi dropdown (mevcut atanan hariç)
          - Devir Notu textarea (min 10 karakter, ZORUNLU, VoiceNoteButton)
          - caseService.addActivity(actionType:'Transfer')
          - ActivityTab: amber tint "↪ Devredildi: X → Y"
          - İç not olarak da kaydedilir

10. AI Davranış Matrisi (vaka iş akışı)
SenaryoAI RolüOnay?Yeni vaka — açıklama (debounce 800ms, min 20 karakter)Kategori + öncelik önerisi (RUNA AI kartı)HayırDuplicateBenzerlik skoru + özetHayırÇözüldü geçişi"✦ Taslak Üret" → resolution_note dolarHayırVaka analizi (sağ panel)"✦ Analiz Et" → özet + SLA bilgisiHayırYeni call logcallSummary otomatik → aiCallBriefHayırChurn dönüşüm"✦ Değerlendir" → risk + öneriEvet — AgentTransfer önerisitransfer-suggest → uygun ekip/kişi önerisiHayırBenzer vakalar (Linked Cases)suggest-links → son 30g geçmiş benzeri vakaHayırMüşteri özeti (Customer Pulse)customer-pulse-summary → risk + tavsiyeHayır

> Operations Dashboard / Report Studio AI yüzeyleri (Brief / Insights / Explain Metric / Drilldown Assistant / Report Draft) ayrı bir analitik yüzey ailesidir; vaka iş akışı dışındadır. Bkz. §12 "Ekran Mimarisi" ve §14 AI Endpoint'leri.

11. RUNA AI Marka Kimliği
src/components/ui/RunaAiCard.tsx
İkon    : R monogram SVG — inline, dış bağımlılık yok
Tema    : Sol kenar vurgu (açık arka plan)
bg      : var(--color-background-primary)
border  : borderLeft 3px solid #4B0FAE + diğer 0.5px
brand   : #4B0FAE (PARAM moru)
badge   : bg #F0EAFF, text #4B0FAE
btn-p   : { background: '#4B0FAE', color: '#FFFFFF' }  ← inline style
btn-s   : { background: 'transparent', border: '1px solid #9B7FD4', color: '#E0D0FF' }
btn-d   : { background: '#E24B4A', color: '#FFFFFF' }
loading : "✦ RUNA AI analiz ediyor..." + pulse skeleton

Kullanım noktaları (vaka iş akışı):
- NewCaseForm → kategori + öncelik önerisi (suggest-category)
- NewCaseForm → başlık önerisi (suggest-title)
- StatusTransitionPanel → "Çözüldü" taslağı (draft-resolution)
- CaseDetailPage sağ panel → supervisor özeti (supervisor-summary)
- CaseDetailPage ProactiveTracking → churn değerlendirmesi (churn-conversion)
- CaseDetailPage call log → otomatik call özet (call-summary)
- CaseDetailPage Linked Cases → benzer vakalar (suggest-links)
- TransferCaseModal → uygun ekip önerisi (transfer-suggest)
- Customer Pulse panel (case detail + new case flow) → müşteri durumu (customer-pulse-summary)

Kullanım noktaları (analitik / dashboard):
- Operations Dashboard → AI Brief kartı (operations-brief)
- Operations Dashboard → Insights tile'ları (operations-insights)
- Operations Dashboard → "Explain Metric" modal (operations-explain-metric)
- Operations Dashboard → Drilldown Assistant kartı (operations-drilldown-assist)
- Report Studio → AI Report Draft (operations-report-draft)

**NOT:** Eski `CaseAnalyticsPage` floating chat (`RunaAiChatPanel`) bugün **dead code** — BACKLOG P1 "Legacy dead code cleanup" altında silinmek üzere bekliyor. Analitik AI yüzeyleri yukarıdaki Operations Dashboard / Report Studio surface'leri tarafından devralındı.


12. Ekran Mimarisi
Cases Listesi (page key: "cases")

Header: [Müşteri Ara] [⚡ Hızlı Vaka] [+ Yeni Vaka]
Filtreler: CaseType / Status chip / Priority chip / DateRange / Team / Person / Sırala
Kolonlar: Vaka No | Başlık | Müşteri | Tip | Statü | Öncelik | Atama | SLA | Açılış | Son Güncelleme
Sıralama: tüm kolonlar tıklanabilir, default: Son Güncelleme azalan

CaseDetailPage — Full Page 3 Kolon
NOT: Drawer değil. currentPage='case-detail' → CaseDetailPage render.
[Sol 320px] | [Ana flex-1] | [Sağ 360px — aiGeneratedFlag=true ise]
Sol panel: Müşteri kartı (Customer Pulse panel dahil), SLA, atama, hızlı aksiyonlar, KPI tile'lar, deterministic customer-match suggestions (customerless flow için)
Ana içerik: StatusTransitionPanel (üstte sabit, Resolution Approval gate dahil) + 5 sekme (Detay/Aktivite/Notlar+Reply threading+reactions/Dosyalar/Çağrı Logları) + Linked Cases sekmesi
Sağ panel: RUNA AI özet (supervisor-summary) + tip bağımlı detay (churn için churn-conversion, vb.)

Operations Dashboard / Report Studio (page key: "dashboard")
- 11 KPI tile + breakdown + drilldown drawer
- AI Brief kartı + Insights tile'ları + "Explain Metric" modal + Drilldown Assistant
- Report Studio modal: AI Report Draft + Markdown copy + browser print (XLSX/PDF/PPTX → REPORT_STUDIO_BACKLOG)

Action Center / Aksiyonlarım (sağ-üst bell + drawer)
- Unified inbox: `kind ∈ {approval, mention, watcher_event, system_alert}`
- "İşler" (actionRequired=true, kırmızı sayaç) ve "Bildirimler" (FYI, gri sayaç) sekmeleri
- Snooze / Done / Dismiss + dedupKey
- Phase 3 ileride wide-surface `/inbox` planlanıyor (OD-070/071/072 PENDING)

Watcher Inbox UI (sidebar > Çalışma Alanım > İzleyici Inbox)
- İzlenen vakalar kart grid + son okunmamış generic CaseNotification'lar (top 10) + statü/zaman filtreleri

13. Tanım Ekranları (Admin — 9 ekran, /admin layout, SystemAdmin gate)
EkranPage KeyKategori & Alt Kategoriadmin-categoriesSLA Kuralları (5-tuple)admin-sla3rd Party Tanımlarıadmin-thirdpartyBelge Türü Tanımlarıadmin-documentsKontrol Listesi (3-tuple+items)admin-checklistTakım Tanımları + Üye Yönetimiadmin-teamsTeklif Tanımlarıadmin-offered-solutionsDinamik Alanlar (Custom Fields)admin-fieldsŞirket Ayarlarıadmin-company-settings
Her ekranda HelpDrawer: "? Yardım" butonu, sağdan 320px, ESC kapanır.
/admin layout SystemAdmin rolüne kapalı; AdminLayout.tsx role gate uygular.

14. AI Endpoint'leri (BFF — /api/ai/*)

**Vaka iş akışı:**
- `suggest-category`         → kategori + öncelik + güven skoru (JSON Schema strict)
- `suggest-title`            → başlık önerisi
- `draft-resolution`         → çözüm notu taslağı
- `supervisor-summary`       → vaka özeti + SLA durumu (JSON)
- `churn-conversion`         → churn risk değerlendirmesi (JSON)
- `call-summary`             → çağrı notu özeti (yeni log oluştuğunda otomatik tetiklenir)
- `transfer-suggest`         → uygun ekip/kişi önerisi (TransferCaseModal)
- `suggest-links`            → benzer geçmiş vakalar (30g pencere; OD-018 spec'i 90g öneriyor — PENDING)
- `customer-pulse-summary`   → müşteri durumu özet + tavsiye

**Operations Dashboard / Report Studio:**
- `operations-brief`             → dashboard AI Brief kartı
- `operations-insights`          → KPI insight tile'ları
- `operations-explain-metric`    → "Bu metrik ne anlama geliyor?" modal
- `operations-drilldown-assist`  → drilldown drawer AI yardımcı
- `operations-report-draft`      → Report Studio AI taslağı

**Telemetri:**
- `PATCH /usage/:id/accept`  → AI önerisi Accept/Reject feedback (BACKLOG P2 "AI Accept/Reject FE telemetry wiring" item'i FE caller'larını ekleyecek)

**Deprecated:**
- ~~`dashboard-chat`~~ → `CaseAnalyticsPage` RunaAiChatPanel için tasarlandı; surface bugün dead code (BACKLOG P1 cleanup). Endpoint kodda hâlâ duruyor; legacy cleanup PR'ında silinir.

15. Açık Karar Noktaları → [docs/OPEN_DECISIONS.md](OPEN_DECISIONS.md)

Açık ürün/teknik kararlar canonical olarak `docs/OPEN_DECISIONS.md`'de izlenir. Bu spec içindeki ürün davranışına etki eden iki açık karar:

- **OD-001 Jira → SLA pause politikası** (PENDING) — Jira'ya devredilen vakada SLA durur mu?
- **OD-021 OpenAI DPA (KVKK)** (PENDING) — Hukuk ekibi onayı production rollout öncesi gerekli.

Diğer kararlar (kararlandı sayılanlar — SLA 7/24, AI modeli OpenAI, Duplicate override, DB/Auth/Storage stack) bu spec içinde yansıyor; ayrı bir karar listesi tutulmuyor.

16. Değişiklik Kaydı
v2.2 — Mayıs 2026 sonu (PR-D PRODUCT_SPEC refresh)

- Faz planı güncellendi: "FAZ 4 — Drawer İyileştirme KISMİ" → "FAZ 4 — CaseDetailPage 3-kolon full page TAMAMLANDI"; FAZ 5 "KPI Dashboard" → "Operations Dashboard + Report Studio + Action Center"
- §3.2 İ-Şube auto-fill cümlesi düzeltildi: committed plan değil, gelecek karar olarak işaretlendi
- §10 AI Davranış Matrisi'nden dead `dashboard-chat` satırı kaldırıldı; transfer-suggest + suggest-links + customer-pulse-summary eklendi
- §11 RUNA AI surface listesi 5 → 14 surface (9 yeni: suggest-title, transfer-suggest, suggest-links, customer-pulse-summary, operations-brief/insights/explain/drilldown/report); `CaseAnalyticsPage` dead-code referansı kaldırıldı
- §12 Ekran Mimarisi: dead `RunaAiChatPanel` sub-section kaldırıldı; Operations Dashboard / Report Studio / Action Center / Watcher Inbox UI eklendi
- §14 AI Endpoint'leri 6 → 15 endpoint + telemetry + deprecated section (dashboard-chat)
- §15 Açık Karar Noktaları tablosu OPEN_DECISIONS.md'ye işaret eden kısa pointer'a indirgendi
- 2026-05 Master Data Decision Sprint shipped wave envanteri Faz planı altına satır olarak eklendi (detay → ROADMAP §"Recent Ships")

v2.1 — Mayıs 2026

FAZ 2 BFF + DB tamamlandı: Supabase Postgres (Frankfurt EU) + Prisma 6, 19 tablo, repository pattern (MSSQL portable)
FAZ 3 Dosya Yükleme tamamlandı: Supabase Storage 3-step signed upload URL pattern (Vercel 4.5MB body limit bypass)
Auth/RBAC tamamlandı: Supabase Auth (email/password + Google OAuth), 6 rol (Agent/Backoffice/Supervisor/CSM/Admin/SystemAdmin), verifyJwt middleware
Custom Fields + Şirket Ayarları eklendi: FieldDefinition (per-company, 6 tip) + CompanySettings, /admin layout (SystemAdmin gate)
AI structured output: response_format JSON Schema strict mode (enum constraints) — null/empty alan sorunu çözüldü
GitHub Actions CI eklendi: type check + Prisma validate + Vite build
Yeni Ekran Standartları bölümü eklendi (5 zorunlu madde + kanonik wiring pattern)
USE_MOCK kaldırıldı, lookupService bootstrap pattern (LookupGate) ile çalışıyor

v2.0 — Nisan 2025

AI modeli: Anthropic → OpenAI gpt-4o-mini
RUNA AI marka kimliği eklendi (Bölüm 11)
Dashboard AI Chat eklendi (Bölüm 12)
Vaka Devir Akışı (TransferCaseModal) eklendi
CaseHistoryActionType enum eklendi
SLA Runtime Motoru (5-tuple + fallback) eklendi
Kontrol listesi snapshot mantığı eklendi
Cases listesi: sıralama + updatedAt kolonu
Dark Mode eklendi (Navy Dark paleti)
Faz planı güncellendi
Açık karar noktaları güncellendi

v1.0 — Nisan 2025

İlk versiyon oluşturuldu


Yeni Ekran Standartları (zorunlu kontrol listesi)

Her yeni ekran (admin tanım, vaka tabı, dashboard widget, modal, drawer)
canlıya alınmadan önce aşağıdaki 5 maddenin tamamını sağlamalıdır.
Eksik olan ekran review'dan geçmez.

1. Sayfa başlığı + açıklama
   - Üstte tek satırlık başlık (sayfanın amacını net söyleyen).
   - Altında 1-2 cümlelik kısa açıklama (kim, neden kullanır).
   - Sayım gerektiren ekranlarda başlığın yanında count badge.

2. Help dokümanı
   - "?" ikonu ile açılan HelpDrawer (helpContents.ts içinde HelpContent objesi).
   - 3 alt başlık zorunlu:
       a) "Bu ekran ne işe yarar?" — net amaç tanımı
       b) "Nasıl yapılandırılır / kullanılır?" — adım adım
       c) Örnek kutu (example) — somut bir kullanım senaryosu
   - Opsiyonel: tip (yeşil), warning (sarı), gotcha (kırmızı).
   - Help olmayan ekran "tamamlanmamış" sayılır.

3. Empty state
   - Liste boşken (henüz veri yok / aramaya uyan kayıt yok) anlamlı mesaj.
   - Empty state ikon + başlık + açıklama + (mümkünse) primary action.
   - "Henüz X yok. İlk X'i oluşturarak başla." formatı tercih edilir.
   - Bileşen: src/components/ui/EmptyState.tsx

4. Error state
   - Veri yüklemesi başarısızsa inline gösterim (toast yetmez).
   - Bileşen: ListErrorState (AdminListLayout) veya benzeri inline kart.
   - Mesaj + "Yeniden dene" butonu.
   - Toast ek olarak çıkar (apiFetch otomatik) ama ekranın kendisi de
     hatayı yansıtmalı, "boş gibi" görünmemeli.

5. Loading state
   - İlk yükleme sırasında skeleton veya spinner.
   - Boş listeyle karıştırılamaz — kullanıcı "veri yok" sanmamalı.
   - Mutation sırasında ilgili buton disabled + spinner ikonu.
   - Bileşen: ListLoadingSkeleton (AdminListLayout) veya Loader2 (lucide).

Wiring pattern (admin liste ekranları için kanonik):

```tsx
const [items, setItems] = useState<T[]>([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);

async function refresh() {
  setLoading(true);
  setError(null);
  try {
    setItems(await adminService.X.list());
  } catch (e) {
    setError((e as Error).message ?? 'Bilinmeyen hata');
  } finally {
    setLoading(false);
  }
}
useEffect(() => { void refresh(); }, []);

return (
  <AdminListLayout
    title="..."
    description="..."
    helpTitle={X_HELP.title}
    helpSections={X_HELP.sections}
    loading={loading}
    error={error}
    onRetry={() => void refresh()}
    ...
  >
    {items.length === 0 ? <EmptyState ... /> : <table>...</table>}
  </AdminListLayout>
);
```

Bu pattern AdminListLayout kullanan tüm ekranlara uygulandı (FAZ 2 sonu).
Custom layout kullanan ekranlar (örn. AdminCompanySettingsPage form ekranı)
HelpButton + HelpDrawer'ı manuel telleyip aynı 5 kuralı sağlamalı.

Yeni özellik geliştirmeye başlamadan önce bu listeyi kontrol et — sonradan
eklemek 3-5 kat daha pahalı.


Son güncelleme: Mayıs 2026 | Versiyon: 2.1
Bu dosya değiştirildiğinde Claude Code'a yeni oturumda bildir.
