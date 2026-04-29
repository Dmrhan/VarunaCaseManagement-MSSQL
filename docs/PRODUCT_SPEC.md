Varuna CRM — AI-Assisted Case Management
PRODUCT_SPEC.md — Claude Code için Tek Kaynak Doküman
Bu dosya Claude Code'un her oturumda önce okuması gereken ürün spesifikasyonudur. İş kuralları, alan tanımları, durum makinesi, SLA mantığı ve AI davranışı burada tanımlıdır. Kodlama kararı verirken bu dosyayı referans al. Çelişki olursa bu dosya geçerlidir.


1. Modül Amacı
Müşteri taleplerini, proaktif takip süreçlerini ve churn yönetimini tek bir vaka (Case) yapısında toplamak.

Hedefler:

Ortalama çözüm süresini (TTR) kısaltmak
SLA ihlallerini azaltmak
Müşteri memnuniyetini artırmak
Churn sinyallerini erken yakalamak

Bu bir helpdesk ticket sistemi DEĞİLDİR. 3 farklı iş sürecini (destek, proaktif takip, churn) tek denetlenebilir yapıda birleştirir.


2. Teknik Altyapı
Frontend : React + TypeScript + Vite — port 5273
BFF      : Node.js + Express — port 3101
DB       : SQLite (varuna.db) — MSSQL uyumlu şema
State    : USE_MOCK flag → src/services/caseService.ts
Mock     : src/mocks/caseMockData.ts
Routing  : key-based (URL routing yok)
UI Kit   : Tailwind + lucide-react + clsx

Faz planı:

FAZ 0 — Mock UI          ← ŞU AN BURADA
FAZ 1 — Tanım Ekranları
FAZ 2 — BFF + DB
FAZ 3 — Liste/Form iyileştirmeleri
FAZ 4 — Drawer iyileştirmeleri
FAZ 5 — KPI Dashboard


3. Vaka Tipleri (CaseType)
3.1 GeneralSupport — Genel Destek
Müşteri sorun yaşadığında, bilgi istediğinde veya şikayet ilettiğinde.

Akış:

Açılış → Duplicate Kontrol → Havuz/Atama → İnceleme
→ 3rd Party / Eskalasyon → Çözüm → Supervisor Onayı (koşullu)
→ Müşteri Bildirimi → Kapatma / Yeniden Açılma
3.2 ProactiveTracking — Proaktif Takip
Kullanım düşüşü, finansal risk veya davranışsal sinyal olduğunda.

Tetikleyici: Sistem alarmı veya agent manuel seçimi

Akış:

Tetiklenme → Veri Hazırlığı → Agent Atama → Outbound Call Log
→ Disposition/Outcome → Follow-up → Hedef Değerlendirme
→ Kapatma VEYA Churn'e Dönüşüm

FAZ 1'de Financial Status + Product Usage manuel girilir. FAZ 2'de İ-Şube entegrasyonuyla otomatik dolar.
3.3 Churn — Churn Yönetimi
Müşteri iptal sinyali verdiğinde veya ProactiveTracking'den dönüşüm olduğunda.

Akış:

Açılış → Cancellation Reason → Teklif Döngüsü → Offer Outcome
→ Supervisor Onayı (koşullu) → Retention Follow-up → Kapatma

ProactiveTracking → Churn dönüşümünde: Tüm notlar ve çağrı logları yeni vakaya taşınır.


4. Durum Makinesi
Statüler ve Geçiş Matrisi
Mevcut Durum
Geçilebilecek
Kim
Ön Koşul
SLA
Açık
İncelemede
Agent, Backoffice
Vaka üstlenildi
Aktif
Açık
İptalEdildi
Agent, Supervisor
İptal gerekçesi zorunlu
Durur
İncelemede
3rdPartyBekleniyor
Agent, Backoffice
3rd party tanımı seçilmeli
DURAKSATILIR
İncelemede
Eskalasyon
Supervisor, Backoffice
EscalationLevel + gerekçe
Aktif
İncelemede
Çözüldü
Agent, Backoffice
Çözüm Notu zorunlu + koşullu Supervisor onayı
Durur
İncelemede
İptalEdildi
Supervisor
Gerekçe zorunlu
Durur
3rdPartyBekleniyor
İncelemede
Agent, Backoffice
Cevap geldi
Devam eder (durak süresi eklenmez)
3rdPartyBekleniyor
Eskalasyon
Supervisor
Level + gerekçe
Aktif
3rdPartyBekleniyor
İptalEdildi
Supervisor
Gerekçe zorunlu
Durur
Eskalasyon
İncelemede
Backoffice, Supervisor
Eskalasyon tamamlandı
Aktif
Eskalasyon
Çözüldü
Backoffice, Supervisor
Çözüm Notu + Supervisor onayı
Durur
Eskalasyon
İptalEdildi
Supervisor
Gerekçe zorunlu
Durur
Çözüldü
YenidenAcildi
Sistem / Agent
Müşteri memnun değil
YENİDEN BAŞLAR
YenidenAcildi
İncelemede
Agent, Supervisor
—
Aktif
İptalEdildi
(geçiş yok)
—
Terminal durum
—

Kritik İş Kuralları
✅ Çözüldü geçişi → ResolutionNote ZORUNLU
✅ Supervisor onayı zorunlu koşullar:
   - Priority = Critical
   - SLAViolation = true
   - EscalationLevel IN ['Direktör', 'ÜstYönetim']
✅ İptalEdildi → iptal gerekçesi ZORUNLU
✅ 3rdPartyBekleniyor → hangi 3rd party olduğu ZORUNLU seçilmeli
✅ SLA sayacı 3rdPartyBekleniyor'da duraksatılır, çıkınca kaldığı yerden devam eder
Her Geçişte Yapılacaklar
Her geçiş → CaseActivity tablosuna log at (kim, ne zaman, hangi durumdan → hangisine)
Eskalasyon geçişi → ayrıca EscalationLog kaydı (level, gerekçe, kim eskale etti)
SLA %80 dolduğunda → Vaka Sahibi + Atanan Kişi'ye bildirim
SLA ihlal → Vaka Sahibi + Atanan Kişi + Supervisor'a bildirim


5. Alan Tanımları
5.1 Tüm Vaka Tiplerine Ortak Alanlar
Alan
Tip
Zorunlu
Notlar
case_number
VARCHAR
Otomatik
Format: YYYYMM-NNNNN
case_type
ENUM
Evet
GeneralSupport / ProactiveTracking / Churn
case_request_type
ENUM
Evet
Bilgi / Öneri / Talep / Şikayet / Hata
case_subject
VARCHAR(255)
Yetki ile
AI öneri üretir
description
TEXT(4000)
Hayır
Zengin metin
status
ENUM
Otomatik
Başlangıç: Açık
priority
ENUM
Evet
Low / Medium / High / Critical. Default: Medium
origin
ENUM
Evet
Telefon / E-posta / Web / Chatbot / Diğer
origin_description
TEXT
Koşullu
origin = 'Diğer' ise ZORUNLU
company_id
FK
Evet
Agent'ın şirketi default gelir
product_group_id
FK
Evet
Şirkete göre filtreli
category_id
FK
Evet
AI öneri üretir
sub_category_id
FK
Evet
Kategoriye göre filtreli
account_id
FK
Yetki ile
Müşteri
case_owner_id
FK
Otomatik
Login user
assigned_person_id
FK
Hayır
Takım seçilince o takımın üyeleri filtrelenir
assigned_team_id
FK
Hayır
—
escalation_level
ENUM
Hayır
Yok / TakımLideri / Direktör / ÜstYönetim
resolution_note
TEXT
Koşullu
Çözüldü geçişinde ZORUNLU
cancellation_reason
TEXT
Koşullu
İptalEdildi geçişinde ZORUNLU
sla_violation
BOOL
Otomatik
Default: false
sla_response_time
DATETIME
Otomatik
Hesaplanmış
sla_resolution_time
DATETIME
Otomatik
Hesaplanmış
sla_paused_at
DATETIME
Otomatik
3rd Party'ye girince set edilir
sla_paused_duration_min
INT
Otomatik
Toplam durak süresi
sla_third_party_wait_min
INT
Otomatik
Ayrı takip — SLA hesabına dahil değil
third_party_id
FK
Koşullu
3rdPartyBekleniyor statüsünde ZORUNLU

5.2 ProactiveTracking'e Özel Alanlar
Alan
Tip
Notlar
financial_status
ENUM
Müşteri finansal risk seviyesi
product_usage
ENUM
Kullanım yoğunluğu
usage_change_alert
ENUM
Artış / Azalma / Sabit
response_level
ENUM
Yüksek / Orta / Düşük Öncelik


Outbound Call Log (alt tablo — CaseCallLog):

Alan
Tip
Notlar
call_date
DATETIME
—
duration_min
INT
—
call_disposition
ENUM
Cevapladı / Cevaplamadı / NumaraHatalı / GörüşmekIstemedi / TekrarAranacak
call_outcome
ENUM
Memnun / MemnunDeğil / Tarafsız / Ulaşılamadı
description
TEXT
Arama notu
caller_id
FK
Arayan kişi
next_followup_date
DATETIME
Cevaplamadı → zorunlu
last_interaction_date
DATETIME
Son etkileşim

5.3 Churn'e Özel Alanlar
Alan
Tip
Zorunlu
Notlar
cancellation_request
BOOL
Hayır
İptal talebi var mı
cancellation_reason
TEXT
Koşullu
İptal varsa zorunlu
offered_solutions
JSON
Hayır
Çoklu seçim (tanım ekranından)
offer_expiry_date
DATETIME
Hayır
Teklif geçerlilik tarihi
offer_outcome
ENUM
Hayır
KabulEdildi / Reddedildi / Beklemede
offer_rejection_reason
TEXT
Koşullu
Reddedildi ise zorunlu
action_taken
TEXT
Hayır
Zengin metin
churn_result
ENUM
Hayır
İptalEdildi / DevamEdiyor / TeklifKabulEdildi
retention_status
ENUM
Hayır
Başarılı / Başarısız / DevamEdiyor
follow_up_date
DATE
Koşullu
Teklif sonrası ~7 gün — ZORUNLU

5.4 AI Alanları (tüm vaka tipleri)
Alan
Tip
Açıklama
ai_summary
TEXT
AI tarafından üretilen vaka özeti
ai_category_prediction
VARCHAR
Önerilen kategori
ai_priority_prediction
ENUM
Önerilen öncelik
ai_duplicate_score
FLOAT
0-1 benzerlik skoru
ai_confidence_score
FLOAT
AI güven skoru
ai_generated_flag
BOOL
AI önerisi içeriyor mu
ai_reject_reason
TEXT
Kullanıcı öneriyi neden reddetti
ai_call_brief
TEXT
Outbound arama özeti
ai_followup_recommendation
TEXT
Takip önerisi
ai_retention_offer_suggestion
TEXT
Churn teklif önerisi



6. SLA Motoru
Hesaplama Kuralı
Giriş kombinasyonu:
  company_id + product_group_id + category_id + sub_category_id + case_request_type
  → SLAPolicy tablosundan eşleşen kural çekilir

Hesaplama:
  sla_response_time   = vaka_açılış_zamanı + policy.response_hours
  sla_resolution_time = vaka_açılış_zamanı + policy.resolution_hours

Mevcut karar: 7/24 (mesai ayrımı yok)
Uyarı ve İhlal
%80 uyarısı  → sla_resolution_time'a kalan süre < %20 olduğunda
               → Vaka Sahibi + Atanan Kişi'ye bildirim
SLA ihlali   → sla_resolution_time geçti, vaka hâlâ açık
               → sla_violation = true
               → Vaka Sahibi + Atanan Kişi + Supervisor'a bildirim
Duraklatma Mantığı
3rdPartyBekleniyor'a GİRİŞ:
  sla_paused_at = now()
  SLA sayacı dondurulur

3rdPartyBekleniyor'dan ÇIKIŞ:
  pause_duration = now() - sla_paused_at
  sla_paused_duration_min += pause_duration
  sla_resolution_time += pause_duration  ← çözüm tarihi uzar
  sla_third_party_wait_min += pause_duration  ← ayrı takip
Örnek SLA Kuralları
Şirket
Ürün
Kategori
Talep Türü
Yanıt
Çözüm
Duraklatma
PARAM
POS
Fiziki POS Başvuru
Bilgi
1 saat
4 saat
Jira
PARAM
POS
Fiziki POS Başvuru
Talep
12 saat
48 saat
3rdPartyBekleniyor
PARAM
POS
Fiziki POS Başvuru
Şikayet
12 saat
24 saat
3rdPartyBekleniyor
PARAM
POS
Fiziki POS Başvuru
Hata
12 saat
24 saat
3rdPartyBekleniyor
UNIVERA
QUEST
Route Atama
Şikayet
6 saat
12 saat
3rdPartyBekleniyor
FINROTA
NETAHSILAT
Ürün Bilgi
Talep
12 saat
24 saat
3rdPartyBekleniyor



7. Form İş Kuralları (UI Seviyesinde Zorunlu)
KURAL-1: origin = 'Diğer' seçilince origin_description alanı görünür ve ZORUNLU olur.

KURAL-2: assigned_team_id seçilince assigned_person listesi yalnızca
         o takımın üyelerini gösterir. (dependent dropdown)

KURAL-3: case_type değiştirilince daha önce girilen veriler SİLİNMEZ.
         Yalnızca o tipe özel section'ların görünürlüğü değişir.
         State temizleme yapma — sadece conditional render.

KURAL-4: Yeni vaka kaydedilirken:
         account_id + case_type kombinasyonu için status IN
         (Açık, İncelemede, 3rdPartyBekleniyor, Eskalasyon) olan vaka varsa
         → uyarı toast: "Bu müşteri için açık vaka mevcut."
         → Kullanıcı "Yine de Aç" ile devam edebilir.

KURAL-5: Çözüldü statüsüne geçişte resolution_note input'u inline açılır.
         Boş bırakılamaz — kaydet butonu disabled kalır.

KURAL-6: Supervisor onayı gerektiren geçişlerde (Critical / SLA ihlali /
         Direktör eskalasyonu → Çözüldü):
         Faz 0'da: uyarı banner göster, kullanıcı yine de onaylayabilir.
         Faz 4'te: gerçek supervisor onay workflow'u devreye girer.


8. Duplicate Kontrol
Kural Tabanlı (Sistem)
Koşul: aynı account_id + aynı case_type + status IN (Açık, İncelemede, 3rdPartyBekleniyor, Eskalasyon)
Sonuç: Sarı uyarı kutusu → "Bu müşteri için açık [tip] vakası mevcut. [Mevcut Vakayı Gör]"
       Kullanıcı "Yine de Devam Et" ile geçebilir.
AI Tabanlı (Benzerlik Skoru)
ai_duplicate_score > 0.75 → Mavi bilgi kutusu:
  "Bu vakaya çok benzer bir açık vaka var: [VAKA-XXXX — özet]"
  Kullanıcı bağlantıya tıklayıp görebilir veya devam edebilir.

Merge (vaka birleştirme) → FAZ 1 KAPSAM DIŞI


9. Atama ve Eskalasyon
Havuz      → Vaka atanmadan Açık durumda bekler. Supervisor veya agent alabilir.
Takım      → assigned_team_id. Kişi listesi o takımla filtrelenir.
Kişi       → assigned_person_id. Atanınca mail + in-app bildirim.
Devir      → transfer_note ZORUNLU. CaseActivity'ye loglanır.
Eskalasyon → escalation_level ZORUNLU + gerekçe. EscalationLog tablosuna ayrıca yazılır.
AI Önerisi → "Bu tür vakalar genellikle X takımına atanıyor" — FAZ 1'de öneri, kesinleştirme kullanıcıya ait.


10. AI Davranış Matrisi (FAZ 1)
Senaryo
AI Rolü
İnsan Rolü
Onay Gerekli?
Yeni vaka açılışı
Konu, kategori, öncelik önerisi
Onaylar / düzenler
Hayır
Duplicate şüphesi
Benzerlik skoru + özet gösterir
Devam mı, mevcut vakaya ekle mi
Hayır
3rd Party bekleme
Aktif rol yok
3rd party seçer, durum değiştirir
Hayır
Kritik vaka çözümü
Supervisor özeti üretir
Supervisor inceler, onaylar/reddeder
Evet — Supervisor
Proaktif arama sonrası
Çağrı özeti + follow-up önerisi
Özeti onaylar, tarihi set eder
Hayır
Churn dönüşüm önerisi
"Churn'e dönüşmeli mi?" önerisi
Dönüşüm kararını verir
Evet — Agent/CSM
Teklif sunma
Geçmiş verilere göre teklif önerisi
Teklifi seçer, müşteriye iletir
Evet — Agent onayı
Teklif kabulü
Supervisor review özeti
Supervisor onaylar
Evet — Supervisor
Çözüm notu
Taslak üretir
Yazar / düzenler / onaylar
Hayır
Müşteri maili
Taslak üretir
Gönderir
Hayır


FAZ 1'de AI YAPAMAZ:

Vaka açamaz (tam otonom)
Vaka kapatamazr
Finansal / hukuki karar alamaz
Churn teklifini otomatik optimize edemez


11. Ekran Mimarisi
11.1 Cases Listesi (page key: "cases")
Filtreler: CaseType / Status (multi) / Priority / DateRange / Team / Person

Tablo kolonları:

Vaka No | Müşteri | Tip | Durum (tint badge) | Öncelik (tint badge) |
SLA Durumu (sayaç / ihlal ikonu / duraklatıldı ikonu) | Atanan | Tarih

Status badge renkleri:

Açık              → blue tint
İncelemede        → amber tint
Çözüldü           → green tint
Eskalasyon        → red tint
3rdPartyBekleniyor→ gray tint
YenidenAcildi     → purple tint
İptalEdildi       → gray tint (muted)

Aksiyonlar: [+ Yeni Vaka] butonu sağ üst. Satıra tıkla → CaseDetailDrawer açılır.
11.2 Yeni Vaka Formu (NewCaseForm)
Layout: 2 sütun

Sol/Ana alan: Case Information section
Sağ panel: SLA Bilgisi (salt okunur, otomatik hesaplanmış)

Dinamik section'lar (case_type'a göre):

GeneralSupport    → Sadece Case Information + SLA
ProactiveTracking → + Proactive Monitoring section + Outbound Call Logs sub-tablosu
Churn             → + Churn Management section

KURAL-3 uygula: Tip değişince state temizleme — YOK. Sadece conditional render.
11.3 Case 360 Detay Drawer (CaseDetailDrawer)
Üst şerit: Vaka No | Müşteri (link → müşteri kartı) | Durum badge (tıklanabilir) | Öncelik | SLA sayacı (canlı)

Collapsible section'lar:

▼ Case Information      — düzenlenebilir
▼ [Tip Bağımlı Bölüm]  — ProactiveTracking VEYA Churn
▼ SLA Bilgisi          — sağ panel
▼ KPI İzleme           — İlk Temas Çözüm / Yeniden Açılma / Müdahale Süresi / Çözüm Süresi
▼ AI Paneli            — Vaka özeti + öneri kutusu + taslak üret
▼ Tarihçe              — Düzenleyen | Tarih | İşlem | Alan | Eski → Yeni
▼ Notlar               — İç Not (gri tint) / Müşteriye Görünür (mavi tint) + [+ Ekle]
▼ Dosyalar             — max 25MB/dosya, max 20 dosya/vaka + [+ Yükle]

Durum değişikliği: Badge'e tıklanınca küçük popover açılır. Sadece geçiş matrisindeki izinli geçişler gösterilir. Çözüldü seçilince inline ResolutionNote input açılır (zorunlu).
11.4 Supervisor İnceleme Paneli
Liste: Onay bekleyen vakalar — Vaka No / Müşteri / Agent / Gerekçe / SLA Durumu

Detay: AI tarafından üretilen supervisor özeti (müşteri geçmişi, vaka özeti, çözüm notu)

Aksiyonlar: [✅ Onayla + Not] / [❌ Reddet + Gerekçe] / [↪ Yeniden Ata]


12. Tanım Ekranları (Admin — FAZ 1)
Sidebar'da "Tanımlar" alt menüsü altında. Tüm ekranlar: liste + inline ekle/düzenle + aktif/pasif toggle.

Ekran
Page Key
Etkilediği Yer
Kategori / Alt Kategori
case-categories
Vaka formu kategori cascade, SLA eşleştirme
SLA Kuralları
case-sla-rules
Vaka açılışında otomatik SLA hesaplama
3rd Party Tanımları
case-3rdparty
3rdPartyBekleniyor statüsünde seçim
Evrak Tipi Tanımları
case-evrak-types
Case detay evrak listesi
Kontrol Listesi
case-checklists
Şirket+Ürün+Kategori kombinasyonuna göre otomatik
Takım Tanımları
case-teams
Atama dropdown + kişi filtreleme


SLA Kuralları ekranı kolonları:

Şirket | Ürün Grubu | Kategori | Alt Kategori | Talep Türü |
Yanıt Süresi (saat) | Çözüm Süresi (saat) | Duraklatma Statüsü (çoklu seçim)


13. Yetki Matrisi
Aksiyon
Agent
Backoffice
Supervisor
CSM
Admin
Vaka Açma
✅
✅
✅
✅
✅
Vaka Atama (kendi)
✅
✅
✅ (hepsi)
✅ (portföyü)
❌
Durum Değiştirme (standart)
✅
✅
✅
✅
❌
Jira'ya Aktarma
❌
✅
✅
❌
❌
Vaka İptal Etme
❌
❌
✅
❌
❌
Supervisor Onayı
❌
❌
✅
❌
❌
Tanım Ekranları
❌
❌
❌
❌
✅



14. Bildirim Kuralları
Olay
Alıcı
Kanal
Vaka atandı
Atanan kişi
Mail + in-app
SLA %80 doldu
Vaka Sahibi + Atanan Kişi
Mail + in-app
SLA ihlal
Vaka Sahibi + Atanan Kişi + Supervisor
Mail + in-app
Supervisor onayı gerekiyor
Supervisor
Mail + in-app
Vaka devredildi
Yeni atanan kişi
Mail + in-app
Vaka çözüldü
Müşteri (FAZ 2)
Mail



15. Veri Modeli — Tablo Listesi
Case                  -- Ana vaka tablosu (tüm alanlar yukarıda)
CaseActivity          -- Her değişiklik: changed_by, changed_at, field_name, old_value, new_value
CaseNote              -- note_text, is_internal (bool), created_by, created_at
CaseAttachment        -- file_name, file_size_kb, file_url, uploaded_by, uploaded_at
CaseCallLog           -- ProactiveTracking outbound arama kayıtları
CaseOfferedSolution   -- Churn teklif kayıtları
CaseApproval          -- Supervisor onay akışı kayıtları
CaseNotification      -- Bildirim logları
SLAPolicy             -- company+product+category+subcategory+requesttype → response/resolution hours
CaseCategory          -- category_id, name, parent_category_id, company_id, is_active
CaseTeam              -- team_id, name, company_id, members(json), is_active
CaseThirdParty        -- id, name, description, is_active
CaseEvrakType         -- id, name, description, is_active
CaseChecklist         -- id, name, company+product+category kombinasyonu, items(json), is_active
CaseOfferedSolutionDef-- Offered solutions tanım tablosu (admin)
AISuggestion          -- suggestion_type, suggested_value, confidence_score, accepted, reject_reason


16. Mock Data Gereksinimleri (FAZ 0)
src/mocks/caseMockData.ts şunları içermeli:

- En az 15 mock vaka:
  - 3 vaka tipinin tümü temsil edilmeli
  - Tüm status değerleri en az bir vakada bulunmalı
  - SLA ihlalli ve ihlalsiz vakalar karışık
  - SLA'ya yaklaşan (kritik) vakalar
  - 3 mock şirket (PARAM, UNIVERA, FINROTA)
  - 8 mock agent, 4 mock takım
  - ProactiveTracking vakaları: outbound call log kayıtları
  - Churn vakaları: teklif geçmişi
  - Her vaka için 5+ history log kaydı
  - Her vaka için notlar (iç + görünür karışık)
  - File referansları


17. Açık Karar Noktaları (Geliştirme Sırasında Sor)
Konu
Mevcut Karar
Durum
SLA 7/24 mü iş günü mü?
7/24
✅ Kararlandı
Jira → SLA pause mı?
Evet, 3rd Party gibi davran
⚠️ Netleştirilmeli
Duplicate → kullanıcı override edebilir mi?
Evet
✅ Kararlandı
Proaktif → Churn otomatik dönüşüm eşiği
FAZ 1'de manuel
✅ Kararlandı
Teklif kabul → abonelik sistemi aksiyonu
Backoffice bildirimi
⚠️ Netleştirilmeli
Mail entegrasyonu
FAZ 2
✅ Kararlandı
Merge (vaka birleştirme)
FAZ 2
✅ Kararlandı



18. Faz 0 Teslim Kriterleri
Faz 0 tamamlanmış sayılır:

✅ Cases listesi çalışıyor (filtre, pagination, status badge, SLA ikonu)
✅ [+ Yeni Vaka] → NewCaseForm açılıyor
✅ 3 vaka tipi için dinamik form çalışıyor
✅ Tip değişince state temizlenmiyor (KURAL-3)
✅ origin='Diğer' → açıklama alanı açılıyor (KURAL-1)
✅ Takım seçince kişi listesi filtreleniyor (KURAL-2)
✅ Duplicate uyarısı çalışıyor (KURAL-4)
✅ Mock submit → in-memory array'e ekleniyor
✅ Liste satırına tıklayınca CaseDetailDrawer açılıyor
✅ Tüm section'lar collapsible
✅ Durum badge tıklanınca geçiş popover'ı açılıyor
✅ Sadece geçiş matrisindeki izinli durumlar gösteriliyor
✅ Çözüldü seçilince ResolutionNote input açılıyor
✅ Tarihçe, Notlar, Dosyalar section'ları mock data gösteriyor
✅ Sidebar'da "Case Management > Vakalar" navigasyonu çalışıyor



Son güncelleme: Nisan 2025 Versiyon: FAZ 0 — Mock UI Bu dosya değiştirildiğinde Claude Code'a yeni oturumda bildir.

