Varuna CRM — AI-Assisted Case Management
PRODUCT_SPEC.md — Claude Code için Tek Kaynak Doküman
Versiyon: 2.0 | Güncelleme: Nisan 2025

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
BFF      : Node.js + Express — port 3101
DB       : SQLite (varuna.db) — MSSQL uyumlu şema
State    : USE_MOCK flag → src/services/caseService.ts
Mock     : src/mocks/caseMockData.ts
Routing  : key-based (URL routing yok)
UI Kit   : Tailwind + lucide-react + clsx
Deploy   : Vercel — varuna-case-management.vercel.app
AI Servisi:
Model    : gpt-4o-mini (OpenAI)
SDK      : openai (server/node_modules)
Key      : process.env.OPENAI_API_KEY (.env dosyasında)
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
FAZ 0 — Mock UI              ✅ TAMAMLANDI
FAZ 1 — Tanım Ekranları      ✅ TAMAMLANDI
FAZ 2 — BFF + DB             ❌ BAŞLANMADI
FAZ 3 — Dosya Yükleme        ❌ BAŞLANMADI
FAZ 4 — Drawer İyileştirme   🟡 KISMİ (Transfer + Checklist tamamlandı)
FAZ 5 — KPI Dashboard        ✅ TAMAMLANDI
Auth/RBAC                    ❌ BAŞLANMADI

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

FAZ 1'de Financial Status + Product Usage manuel girilir.
FAZ 2'de İ-Şube entegrasyonuyla otomatik dolar.

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

10. AI Davranış Matrisi (FAZ 1)
SenaryoAI RolüOnay?Yeni vaka — açıklama (debounce 800ms, min 20 karakter)Kategori + öncelik önerisi (RUNA AI kartı)HayırDuplicateBenzerlik skoru + özetHayırÇözüldü geçişi"✦ Taslak Üret" → resolution_note dolarHayırVaka analizi (sağ panel)"✦ Analiz Et" → özet + SLA bilgisiHayırYeni call logcallSummary otomatik → aiCallBriefHayırChurn dönüşüm"✦ Değerlendir" → risk + öneriEvet — AgentDashboard chattop 30 + KPI context ile soru-cevapHayır

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
Kullanım noktaları (5):

NewCaseForm → kategori önerisi
StatusTransitionPanel → Çözüldü → taslak
CaseDetailPage sağ panel → vaka özeti
CaseDetailPage ProactiveTracking → churn risk
CaseAnalyticsPage → floating chat


12. Ekran Mimarisi
Cases Listesi (page key: "cases")

Header: [Müşteri Ara] [⚡ Hızlı Vaka] [+ Yeni Vaka]
Filtreler: CaseType / Status chip / Priority chip / DateRange / Team / Person / Sırala
Kolonlar: Vaka No | Başlık | Müşteri | Tip | Statü | Öncelik | Atama | SLA | Açılış | Son Güncelleme
Sıralama: tüm kolonlar tıklanabilir, default: Son Güncelleme azalan

CaseDetailPage — Full Page 3 Kolon
NOT: Drawer değil. currentPage='case-detail' → CaseDetailPage render.
[Sol 320px] | [Ana flex-1] | [Sağ 360px — aiGeneratedFlag=true ise]
Sol panel: Müşteri kartı, SLA, atama, hızlı aksiyonlar, KPI tile'lar
Ana içerik: StatusTransitionPanel (üstte sabit) + 5 sekme (Detay/Aktivite/Notlar/Dosyalar/Çağrı Logları)
Sağ panel: RUNA AI özet + tip bağımlı detay
Dashboard AI Chat (RunaAiChatPanel)
Konum  : CaseAnalyticsPage — sağ alt fixed
Buton  : 56x56px #4B0FAE daire, R ikonu
Panel  : 380x500px, border-radius:16px
Context: Top 30 vaka snapshot + 9 KPI + SLA durumu
Endpoint: POST /api/ai/dashboard-chat
Hazır sorular: 5 adet chip

13. Tanım Ekranları (Admin — 7 ekran)
EkranPage KeyKategori & Alt Kategoriadmin-categoriesSLA Kuralları (5-tuple)admin-sla3rd Party Tanımlarıadmin-thirdpartyEvrak Tipi Tanımlarıadmin-evrakKontrol Listesi (3-tuple+items)admin-checklistTakım Tanımları + Üye Yönetimiadmin-teamsTeklif Tanımlarıadmin-offered-solutions
Her ekranda HelpDrawer: "? Yardım" butonu, sağdan 320px, ESC kapanır.

14. AI Endpoint'leri (BFF — /api/ai/*)
suggest-category   → kategori + öncelik + güven skoru (JSON)
draft-resolution   → çözüm notu taslağı
supervisor-summary → özet + SLA bilgisi (JSON)
churn-conversion   → risk değerlendirmesi (JSON)
call-summary       → çağrı notu özeti (otomatik)
dashboard-chat     → top 30 + KPI context soru-cevap

15. Açık Karar Noktaları
KonuDurumSLA 7/24✅ KararlandıAI modeli (OpenAI)✅ AktifJira → SLA pause⚠️ NetleştirilmeliDuplicate override✅ KararlandıFAZ 2 DB stack⚠️ Vercel Postgres önerisi — karar bekleniyorAuth çözümü⚠️ Clerk önerisi — karar bekleniyorDosya storage⚠️ Vercel Blob önerisi — karar bekleniyorOpenAI DPA (KVKK)⚠️ Hukuk ekibi

16. Değişiklik Kaydı
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


Son güncelleme: Nisan 2025 | Versiyon: 2.0
Bu dosya değiştirildiğinde Claude Code'a yeni oturumda bildir.
