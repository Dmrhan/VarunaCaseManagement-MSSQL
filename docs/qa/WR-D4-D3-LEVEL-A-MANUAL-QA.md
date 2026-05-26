# WR-D4/D3 Level A — Manuel QA Çek-listesi

> **Kapsam:** Çözüm Onayı (D4) + Bildirim Kuralları / Şablonlar / Dispatch / Müşteri Cevap Kanalı (D3) — Level A.
> **Hedef:** Tek bir QA operatörünün/admin'in baştan sona akışı yaşaması ve Level A iddialarının doğru olduğunu doğrulaması.
> **Ortam:** Dev veya pilot tenant. Production'a manuel test yapılmaz (mevcut müşteri verisi).
> **Son güncelleme:** 2026-05-27

---

## Ön koşullar

- [ ] Pilot tenant'a `Admin` veya `SystemAdmin` rolünde erişim
- [ ] Aynı tenant'ta bir `Agent` ve bir `Supervisor`/`Team Lead` hesabı (onaylayıcı için)
- [ ] Çözülebilecek aday bir test vakası açılabiliyor (tenant'ın açık vaka oluşturma akışı çalışır durumda)
- [ ] En az bir `Account` + `AccountCompany` ilişkisi mevcut (yoksa kur)

---

## A. Admin kurulumu

### A.1 Çözüm Onayı Politikası oluştur

`/admin` → **Çözüm Onayı Politikaları** → "Yeni Politika"

- [ ] Şirket seçildi (pilot tenant)
- [ ] `name`: örn. *"Yazılım — yüksek öncelik onayı"*
- [ ] `approverType`: **AssignedTeamLead** (test için)
- [ ] `rejectionBehavior`: **ReturnToAssignee**
- [ ] `allowSelfApprove`: **kapalı** (test için)
- [ ] `matchScope.category` veya `priority` doldurulabildi
- [ ] Kayıt sonrası listede satır göründü, "Aktif" rozetli

### A.2 Bildirim Şablonu oluştur

`/admin` → **Bildirim Şablonları** → "Yeni Şablon"

- [ ] Şirket seçildi
- [ ] `key`: küçük harf + alt çizgi formatında (örn. `approval_pending_lead`)
- [ ] Konu (Subject) `{{case.number}}` gibi en az 1 değişken içeriyor
- [ ] Gövde (Body) çoklu değişken kullanıyor (`{{case.number}}`, `{{account.name}}`, `{{assignee.name}}`)
- [ ] Önizleme paneli açıldı; eksik değişken yoksa uyarı yok
- [ ] Şablonu kasıtlı olarak bozulmuş bir değişken eklemek (örn. `{{yok.bilinmeyen}}`) ile test ettim → **"Eksik değişken"** uyarısı çıktı
- [ ] Şablon kaydedildi; versiyon **1**, "Aktif" rozeti

### A.3 Bildirim Kuralı oluştur (resolution_approved → customer)

`/admin` → **Bildirim Kuralları** → "Yeni Kural"

- [ ] Şirket seçildi
- [ ] `event`: **Çözüm onaylandı (resolution_approved)**
- [ ] Filtre alanlarını boş bıraktım → **"Her vakaya uygula"** onay kutusu zorunlu olarak çıktı (kapalıyken Kaydet çalışmıyor)
- [ ] "Her vakaya uygula" işaretlenince Kaydet aktif oldu
- [ ] Audience: **Müşteri (birincil kontak)**
- [ ] Şablon seçildi (A.2'de oluşturulan)
- [ ] Kanal: **E-posta**, Mode: **Manual**
- [ ] Tekrar bastırma (dakika) ve saatlik üst sınır boş bırakıldı (Phase 2 davranışı için yeterli)
- [ ] Kayıt sonrası listede aktif kural göründü

### A.4 AccountCompany Cevap Kanalı yapılandırması

Müşteriler → ilgili Account → "Şirketler" sekmesi → AccountCompany kaydı → "Düzenle"

- [ ] "İletişim Tercihleri" fieldset görüldü
- [ ] `preferredResponseChannel`: **E-posta** seçildi
- [ ] `responseEmail`: geçerli bir test e-postası girildi (örn. kendi gmail/outlook adresin)
- [ ] `responsePhone`: opsiyonel — boş bırakılabildi
- [ ] `allowCustomerNotifications`: işaretli (default) → opt-in
- [ ] Kayıt sonrası AccountCompany detayında yeni alanlar göründü (verify endpoint: `GET /api/accounts/:id`)

### A.5 Seed varsayım kontrolü

- [ ] Yeni bir tenant'a Politika, Şablon, Kural seed edilmedi (her ekranda "Henüz X yok" boş hali görüldü)
- [ ] Sistem otomatik default şablon veya kural oluşturmuyor — admin'in kasıtlı kurması gerekiyor
- [ ] Politika yokken, kapatma akışı önceki davranışıyla aynı (vaka direkt Çözüldü'ye gidebiliyor)

---

## B. Vaka akışı — happy path

### B.1 Eşleşen vaka aç

- [ ] Pilot tenant'ta yeni vaka açıldı
- [ ] `category`/`priority` A.1'deki `matchScope` ile uyumlu
- [ ] Vaka `Agent` hesabına atandı (veya kendine üstlendi)

### B.2 Çözüm onaya gönder

CaseDetail → **Çözüm Onayı** kartı

- [ ] Kart görünüyor (matched policy var); rozet: yok / Beklemiyor
- [ ] "Çözüm Onayına Gönder" butonu Agent'ta etkin
- [ ] Modal açıldı; **`resolutionSummary` zorunlu** alanı yazıldı
- [ ] `customerMessageDraft` opsiyonel olarak doldurulabildi
- [ ] Gönder → kart rozeti **"Çözüm Onayı Bekliyor"** oldu, `Case.approvalState=Pending` denorm güncellendi

### B.3 Onaylayıcı onaylar

`Supervisor`/`Team Lead` hesabıyla aynı vakaya gir:

- [ ] Çözüm Onayı kartı pending göründü; "Onayla" + "Reddet" butonları görünür
- [ ] "Onayla" tıklandı; modal yoksa direkt onaylandı, rozet **"Çözüm Onaylandı"**
- [ ] CaseActivity log'unda "Çözüm onayı verildi" satırı görüldü
- [ ] `Case.approvalState=Approved` denorm güncellendi

### B.4 Bildirim dispatch'i oluştu

Aynı vakanın CaseDetail'inde "İletişim Bildirimleri" kartını kontrol et:

- [ ] Kart görünür (≥1 dispatch oluşmuş)
- [ ] **"Cevap Kanalı"** banner'ı görüldü: kanal=**email**, kaynak=**şirket tercihi** (account_company), identifier=A.4'te girilen e-posta
- [ ] Pending dispatch satırı görünür: audienceType=`customer_primary_contact`, channel=Email, mode=Manual
- [ ] Snapshot subject/body değişkenleri doğru render olmuş (vaka numarası, müşteri adı vs.)
- [ ] "otomatik gönderim yok" rozeti header'da görünür
- [ ] Pending row'un üstündeki mavi info bandı görüldü: *"Varuna mesajı kendiliğinden göndermez..."*

### B.5 Cevap kanalı çözünürlüğü doğrula

- [ ] `GET /api/approvals/cases/:caseId/customer-channel` (browser DevTools network) çağrısı görüldü
- [ ] Response: `channel="email"`, `source="account_company"`, `identifier=A.4 email`, `suppressionReason=null`
- [ ] CaseDetail'de banner kanal kaynağını net gösteriyor (örn. "kaynak: şirket tercihi")

### B.6 Manuel iletişim akışı — 3 eylem

Pending dispatch'in altındaki 3 buton ile test:

#### B.6.a "Mesajı Kopyala"
- [ ] Butona tıklandı
- [ ] Toast: *"Mesaj kopyalandı."*
- [ ] Test için boş bir editöre yapıştır: Konu + Gövde alt alta var
- [ ] Dispatch satırı hâlâ **Pending** durumunda (sadece pano kopyalandı, audit kapanmadı)

#### B.6.b "Mail Taslağı Aç"
- [ ] Sadece audienceIdentifier email formatındaysa görünür (✓ B.5'te email)
- [ ] Tıklandı → varsayılan mail uygulaması açıldı
- [ ] Taslakta alıcı, konu, gövde otomatik dolu
- [ ] Geri Varuna'ya dönüldü; dispatch hâlâ Pending

#### B.6.c "Manuel Olarak Hallettim"
- [ ] Tıklandı → modal açıldı
- [ ] **Teslimat notu** alanı boşken Onayla butonu **disabled**
- [ ] Açıklayıcı not yazıldı (örn. *"14:32'de e-posta gönderildi, müşteri kabul etti."*)
- [ ] Onayla tıklandı; modal kapandı
- [ ] Dispatch satırı **Sent** durumuna geçti, mode=**Manual**
- [ ] Toast: *"Manuel onay kaydedildi."* (veya benzer)

### B.7 Audit / CaseActivity / timeline kontrolü

- [ ] CaseActivity log'unda yeni satır görüldü: *"Bildirim manuel olarak gönderildi"* (actor=onaylayıcı, note=rule + audience)
- [ ] `/admin/notification-dispatches` ekranında pilot tenant filtreli, dispatch görünür: state=Sent, mode=Manual
- [ ] Dispatch detayı (Görüntüle) snapshot subject/body + Teslimat notu gösteriyor
- [ ] `Case.communicationState` artık **Manual** (DevTools veya `GET /api/cases/:id` ile doğrula)

---

## C. Negatif kontroller

### C.1 Agent kendi vakasını onaylayamaz (self-approval kapalı)

- [ ] A.1'deki politikada `allowSelfApprove=false`
- [ ] Agent kendi çözdüğü vakayı kendi onayına göndermek isterse → backend `400 self_approval_blocked`
- [ ] UI'da hata toast/banner görüldü

> **Not:** Bu test, politikanın `approverType` çözünürlüğünün submitter == approver olduğu duruma denk gelmesi gerektiği anlamına gelir. Örn. submitter Team Lead ise ve `approverType=AssignedTeamLead` ise, self-approval engellenmeli.

### C.2 Yanlış onaylayıcı onaylayamaz

- [ ] Onay bekleyen bir vakaya farklı bir `Agent` (kendisi onaylayıcı olmayan biri) ile gir
- [ ] "Onayla" butonu görünmüyor / etkin değil
- [ ] Doğrudan API çağrısı denenirse → `403 APPROVAL_FORBIDDEN`

### C.3 Pending onay kapatma akışını engelliyor

- [ ] Onayı henüz alınmamış vakada "Çözüldü" geçişi denenir → `400 approval_required`
- [ ] UI'da hata mesajı: *"Bu vaka için çözüm onayı zorunlu..."* veya benzeri
- [ ] Sadece `approvalState=Approved` olduktan sonra Çözüldü geçişi serbest

### C.4 Suppressed dispatch manuel-onaylanmaz

Önkoşul: bir Suppressed dispatch elde et (en kolay yol: ardışık iki kez aynı kuralı tetikle, suppressDuplicateWithinMinutes ile dedup → ikincisi Suppressed/duplicate_within_window).

- [ ] Suppressed satır admin viewer'da görüldü
- [ ] CaseDetail'de bu satır geçmiş listesinde görünür ama "Manuel Olarak Hallettim" butonu **yok** (Pending değil)
- [ ] Doğrudan API çağrısı (`POST /api/approvals/dispatches/:id/manual-confirm`) denenirse → `409 dispatch_already_finalized`
- [ ] Dispatch state hâlâ **Suppressed** (değişmedi)

### C.5 Boş condition kural — "Her vakaya uygula" gerektirir

- [ ] Yeni kural editöründe filtreleri boş bırak
- [ ] "Her vakaya uygula" kutusu işaretsiz → kaydet butonu çalışmıyor ya da inline hata: *"Filtre vermediysen 'Her vakaya uygula' onayı zorunlu."*
- [ ] Kutu işaretlenince kaydet aktifleşiyor
- [ ] Backend test (`mode=Manual`, `conditions={}`, `isMatchAll=false`) → `400 match_all_confirm_required`

### C.6 allowCustomerNotifications=false → customer_opted_out

- [ ] A.4'teki AccountCompany'de checkbox'ı kapat (opt-out)
- [ ] B.1-B.3'ü tekrar et (yeni vaka aç, onaya gönder, onayla)
- [ ] Bildirim dispatch'i oluştu mu kontrol et: `customer_primary_contact` audience için **Suppressed**
- [ ] suppressionReason=**`customer_opted_out`**
- [ ] CaseDetail kartında kırmızı banner: *"Müşteri otomatik bildirim almak istemiyor..."*
- [ ] Manuel iletişim teklif edilmiyor (Mesajı Kopyala / Mail Taslağı / Onayla butonları yok)
- [ ] **İç audiences** (assignee / team_lead / supervisor / admin) bu opt-out'tan etkilenmedi — kendi dispatch'leri normal yazıldı

### C.7 Eksik kanal/identifier — manual fallback

Önkoşul: AccountCompany'de `preferredResponseChannel='email'` ama `responseEmail` boş ve Account.email/AccountContact.email yok.

- [ ] B.1-B.3'ü tekrar et
- [ ] `customer_primary_contact` dispatch'i: state=**Pending**, suppressionReason=`no_channel_available`, audienceIdentifier=`manual`
- [ ] CaseDetail kart banner'ı: *"Yapılandırılmış bir e-posta/telefon yok; operatör mesajı manuel olarak iletir."*
- [ ] "Manuel Olarak Hallettim" butonu görünür ve Teslimat notu ile kapatılabiliyor

### C.8 Aktif gönderim yok — UI ve API kontrolü

- [ ] Yeni kural editöründe **Mode** dropdown'unda sadece **LogOnly** ve **Manual** görünüyor (Active yok)
- [ ] Backend test: `POST /api/approvals/notification-rules` body'sinde `mode='Active'` → `400 mode_active_not_allowed`
- [ ] CaseDetail kartında "Gönder şimdi" / "Sistemden mail gönder" gibi buton yok
- [ ] Bildirim Kayıtları viewer'ında `state=Sent` satırları yalnız mode=Manual ile gelmiş (mode=Active satırı yok)

---

## D. Üretim güvenliği — kapsam dışı (negative product safety)

### D.1 Otomatik müşteri e-postası yok

- [ ] Vaka onaylandıktan sonra (B.3) müşterinin gerçek e-postasına **hiçbir mesaj gitmedi**
- [ ] Sunucu log'larında (deploy ortamında) SMTP/Resend/Mailgun çağrısı yok
- [ ] Dispatch state=Sent yalnız manuel onay sonrası, otomatik değil

### D.2 SMTP / Resend / Provider config yok

- [ ] Admin panelinde "E-posta Sağlayıcı", "SMTP Ayarları", "API Key" benzeri ekran/buton yok
- [ ] `process.env.RESEND_API_KEY`, `SMTP_HOST` gibi env var beklentisi runtime'da yok (deploy edildiğinde sıcak yüklü değiller)
- [ ] `git grep -i "resend\|smtp\|nodemailer"` kapsamlı kod araması: yalnız docs/planning kart referansları çıkar; runtime client kodu yok

### D.3 WhatsApp / SMS / portal / cron / analytics yok

- [ ] Bildirim Kuralları kanal seçeneklerinde **WhatsApp**, **SMS** seçeneği yok
- [ ] Müşteri portal acceptance ekranı yok
- [ ] Pending onay/dispatch için cron hatırlatma yok (planlı bir job çalışmıyor)
- [ ] Bildirim analytics dashboard'u yok

### D.4 Tek müşteri iletişim tamamlama yolu

- [ ] Müşteriye gönderilen bir mesajın audit'i SADECE **"Manuel Olarak Hallettim" + Teslimat notu** yolu ile kapatılabilir
- [ ] Pano kopyalama veya mail taslağı açma kayıt durumunu değiştirmez (state=Pending kalır)
- [ ] Teslimat notu boş bir manuel onay verilemiyor (audit invariantı)

---

## Sonuç değerlendirmesi

- [ ] **A. Admin kurulumu** — 5/5 alt-bölüm geçti
- [ ] **B. Vaka akışı happy path** — 7/7 adım geçti
- [ ] **C. Negatif kontroller** — 8/8 senaryo geçti
- [ ] **D. Üretim güvenliği** — 4/4 negatif kontrol geçti

**Toplam:** 24/24 → **Level A operasyonel olarak doğrulandı.**

> Bir alt-bölüm geçmiyorsa: hangi adımda kaldığını, beklenen vs gözlemlenen davranışı not edip ürün direktörüne escalate et. Schema veya runtime fix gerektiren bir bulgu varsa **bu çek-listesi içinde değil**, ayrı bir bug raporu açılır.

---

## Ekler

### Referans dispatch state semantiği

| state | Anlam | Manuel onay alabilir mi? |
|---|---|---|
| `Pending` | Operatör eylem bekliyor | ✅ (Teslimat notu zorunlu) |
| `Sent` | Manuel onaylandı veya in-app yazıldı | ❌ (zaten Sent) |
| `Failed` | Phase 4 active gönderim hatası — Level A'da görülmez | ❌ |
| `Suppressed` | Dedup / rate-limit / opt-out / no-channel — audit-only | ❌ (`409 dispatch_already_finalized`) |

### Suppression reason'lar — tek bakışta

| reason | Nedir |
|---|---|
| `duplicate_within_window` | `suppressDuplicateWithinMinutes` penceresi içinde aynı (vaka, alıcı, şablon) ikinci kez tetiklendi |
| `rate_limit_exceeded` | Kural saatlik üst sınırını aştı; pencere sıfırlanana kadar bastırılır |
| `customer_opted_out` | AccountCompany.allowCustomerNotifications=false |
| `no_channel_available` | Yapılandırılmış email/phone yok; manuel fallback |
| `audience_unresolvable` | Atanan kişi / takım lideri / supervisor çözülemedi |

### Sırada ne var? (kapsam dışı — sadece bağlam)

- **Level B (Phase 4):** Aktif e-posta sağlayıcısı (Resend / SMTP / vb.). Üretim e-posta altyapısı kararı sonrası planlanır. Şu an scope dışı.
- **Level C (Phase 5+):** Hatırlatma cron'ları, i18n, webhook, SMS/WhatsApp, müşteri portalı, bildirim analytics. Hiçbiri Level A için zorunlu değil.
