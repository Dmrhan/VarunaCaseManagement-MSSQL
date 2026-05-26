# WR-D4/D3 Level A — Demo Senaryosu

> **Kim için:** Ürün direktörü / genel müdür / pilot ekip sunumu.
> **Süre:** ~12-15 dakika.
> **Çıktı:** İzleyici, vaka kapama akışının artık yönetilebilir + denetlenebilir + müşteri iletişiminin operatör onaylı olduğuna ikna olur.
> **Son güncelleme:** 2026-05-27

---

## Demo'nun mesajı (3 cümle ile)

1. **Çözüm kapama artık yönetilebilir.** Hangi vakaların hangi kurallarda onay gerektireceğini tenant kendisi tanımlar; onayı verilmeden vaka Çözüldü'ye geçemez.
2. **Müşteriye dönüş kanalı görünür.** Vaka kapanış mesajı tasarlandı, kime hangi kanaldan gideceği önceden çözüldü; müşteri "bildirim almak istemiyorum" diyebiliyor ve sistem buna uyuyor.
3. **Kim neyi onayladı ve müşteriye ne söylendi audit'lenir.** Otomatik mail yok; her müşteri iletişimi operatör tarafından *manuel olarak* gönderiliyor ve teslimat notu ile audit'e kapatılıyor.

> **Önemli çerçeveleme:** Level A bilinçli olarak otomatik gönderim içermez. Aktif e-posta sağlayıcı kararı (Level B) ileride ürün tarafından alındığında devreye girer; o güne kadar Level A operasyonel olarak yeterli.

---

## Hazırlık (demo öncesi 5 dk)

- [ ] Pilot tenant'a `Admin` rolüyle giriş yapılmış olmalı (sunum makinasında session açık)
- [ ] Aynı tenant'ta hızlıca açabilecek bir test vakası (örn. *"Müşteri raporlama ekranında yavaşlık bildirdi"*)
- [ ] Onaylayıcı hesap (`Team Lead` veya `Supervisor`) için ikinci pencere/tab — gizli sekme önerilir
- [ ] Demo tenant'ında PARAM/UNIVERA/FINROTA seçeneklerinden biri sabit kalsın
- [ ] (Opsiyonel) Müşterinin "responseEmail" alanına demo sırasında gönderilen mesajı görmek isterseniz kendi e-postanızı koyun; ama bu mesaj operatör tarafından *manuel* gönderilir, sistem otomatik göndermez

---

## Demo akışı — 9 adım

### Adım 1 — "Bugün neyi çözmüş olduk?" (1 dk, slayt veya konuşma)

Konu: **"Bir vakanın Çözüldü'ye geçmesi artık bir yönetim kararıdır."**

Sun:
- Önce yalnız Agent tek başına kapatıyordu — yanlış kapatma riski yüksek.
- Artık tenant **politika** tanımlayabiliyor: hangi tür vakalar onaya tabi, kim onaylar, reddedildiğinde ne olur.
- Onay verilmeden Çözüldü'ye geçilemiyor; onay verildikten sonra müşteriye gidecek mesaj **operatör onayı** ile audit altına giriyor.

> **Sade cümle:** *"Çözüm kapama artık yönetilebilir."*

---

### Adım 2 — Çözüm Onayı Politikası (1 dk)

Ekran: `/admin` → **Çözüm Onayı Politikaları**

Göster:
- Boş ekran (yeni tenant'larda varsayılan politika yok)
- Bir politika aç (önceden hazırlanmış): *"Yüksek öncelik onayı"*
- Kapsam alanları: kategori / alt kategori / öncelik / destek seviyesi / takım
- Onaylayıcı tipi: **Takım Lideri** / Süpervizör / Spesifik kişi
- Red davranışı: **ReturnToAssignee** / ReturnToTeam / Escalate
- `allowSelfApprove` toggle'ı — Agent kendi çözümünü onaylayabilir mi?

> **Söyle:** *"Her tenant kendi onay kurallarını tanımlar. Default politika yok — sistem kasıtlı olarak sessiz; admin neyi kontrol etmek istiyorsa onu açar."*

---

### Adım 3 — Bildirim Şablonu (1 dk)

Ekran: `/admin` → **Bildirim Şablonları**

Göster:
- Konu + Gövde, içinde `{{case.number}}`, `{{account.name}}` gibi değişkenler
- Sağ paneldeki **Önizle** butonu — örnek vaka verisiyle render edilen sonuç
- **Eksik değişken uyarısı** — tanımsız bir değişken yazılırsa "[yok eksik]" placeholder + uyarı çıkar
- "Müşteriye Gider" rozeti — şablonun kullanım amacını işaretler
- Versiyonlama — şablon güncellenirse versiyon artar; geçmiş dispatch'ler eski versiyon snapshot'ını korur

> **Söyle:** *"Müşteriye gidecek metni admin önceden yazıyor. Operatör mesajı serbest yazmıyor; tutarlı, marka uyumlu ve denetlenebilir."*

---

### Adım 4 — Bildirim Kuralı (1 dk)

Ekran: `/admin` → **Bildirim Kuralları**

Göster:
- **Event** dropdown: Çözüm onaya gönderildi / Onaylandı / Reddedildi / Vaka Kapatıldı / Vaka Yeniden Açıldı
- **Filtre**: hangi vakalarda eşleşecek (kategori, öncelik, vb.)
- **"Her vakaya uygula"** güvenlik onayı — filtre boşken bilinçli onay zorunlu (yanlış broadcast koruması)
- **Hedef Kitle**: Atanan kişi / Takım Lideri / Süpervizör / **Müşteri (birincil kontak)** / Sabit e-posta
- **Kanal**: In-App / **E-posta** / Manuel Görev — *aktif gönderim seçeneği yok*, kasıtlı
- **Mode**: **LogOnly** veya **Manual** — Active yok (Phase 4 ile gelecek)

> **Söyle:** *"Kural tetiklendiğinde sistem mesajı kendisi göndermez. Yalnız operatöre 'şu mesaj, şu kişiye gitmeli' diyor; operatör manuel onaylayana kadar müşteriye hiçbir şey gitmez."*

---

### Adım 5 — Müşteri Cevap Kanalı (1.5 dk)

Ekran: Müşteriler → bir müşteri → "Şirketler" sekmesi → AccountCompany "Düzenle"

Göster:
- Yeni alt-bölüm: **"İletişim Tercihleri"**
- `preferredResponseChannel` (E-posta / Telefon / Manuel)
- `responseEmail` ve `responsePhone` — fallback zincirinin başında
- `allowCustomerNotifications` — **opt-out** kutusu

> **Söyle:** *"Müşteri 'bana e-posta atın' veya 'beni telefonla arayın' diyebilir. Hatta 'bana otomatik bildirim göndermeyin' diyebilir — bu kutuyu kapatınca sistem o müşteriye giden tüm dispatch'leri 'opt-out' olarak işaretler ve operatöre 'manuel iletişim teklif etme' diye uyarı verir."*

**Bonus mini demo (opsiyonel):** Vaka detayında Cevap Kanalı badge'inde "kaynak: şirket tercihi" yazıyor → admin'in yaptığı seçim doğru çözümlenmiş.

---

### Adım 6 — Vaka açma + Çözüm Onayına Gönderme (1.5 dk)

Yeni vaka aç (Agent perspektifi):
- Müşteri seç (Adım 5'teki müşteri)
- Kategori "Yazılım", öncelik "Yüksek"
- Atama: Agent kendine (üstlen)

CaseDetail'de:
- **Çözüm Onayı** kartı görünüyor — politika eşleşti
- "Çözüm Onayına Gönder" → modal: çözüm özeti zorunlu, opsiyonel müşteri mesajı taslağı
- Gönder → badge **"Çözüm Onayı Bekliyor"**
- Vaka şu an Çözüldü'ye geçemez

> **Söyle:** *"Agent vakayı tek başına kapatamaz. Önce çözümünü kimin onaylayacağına politika karar veriyor."*

---

### Adım 7 — Onaylayıcı onaylar (1 dk)

İkinci pencerede Team Lead/Supervisor hesabına geç:
- Aynı vakaya gir
- "Onayla" / "Reddet" butonları görünür
- "Onayla" → kart rozeti **"Çözüm Onaylandı"**
- CaseActivity timeline'da: *"Çözüm onayı verildi"* satırı, kim onayladığı + zaman

> **Söyle:** *"Onay tek tıkla; ama denetim izi kalıcı. 6 ay sonra biri 'bu vaka neden bu zaman kapatıldı?' diye sorarsa cevap audit'te var."*

---

### Adım 8 — Bildirim dispatch'i + cevap kanalı çözünürlüğü (2 dk)

Vakanın CaseDetail'inde "İletişim Bildirimleri" kartı:

Göster:
- **"Cevap Kanalı"** banner'ı: *"Cevap Kanalı: E-posta (ornek@firma.com) — kaynak: şirket tercihi"*
- Pending dispatch satırı: Konu + Gövde'nin render edilmiş hali
- Rozet: **"otomatik gönderim yok"**
- Mavi info bandı: *"Varuna mesajı kendiliğinden göndermez..."*

3 eylemi sırayla göster:

#### 8a — Mesajı Kopyala
- Tıkla → pano kopyalandı
- Boş bir editöre yapıştır (test için) — Konu + Gövde alt alta
- Dispatch hâlâ **Pending** (kopyalama audit'i kapatmaz)

#### 8b — Mail Taslağı Aç
- Tıkla → varsayılan mail uygulaması alıcı/konu/gövde dolu açılır
- Operatör gönderecek, sistem değil

#### 8c — Manuel Olarak Hallettim
- Tıkla → modal
- **Teslimat notu** zorunlu — boş geçilmiyor (audit invariantı)
- Açıklayıcı not yaz: *"14:32'de e-posta gönderildi, müşteri kabul etti."*
- Onayla → dispatch **Sent**, mode **Manual**

> **Söyle:** *"Bir kayıt 'gönderildi' olarak işaretlenmesi için operatörün açıklayıcı bir not yazmış olması ZORUNLU. Bu, denetim sırasında 'ne yapıldı, ne zaman, hangi kanaldan?' sorusunun yanıtıdır."*

---

### Adım 9 — Audit + kapanış (1 dk)

Göster:
- `/admin` → **Bildirim Kayıtları**
- Demo'da oluşan satır görünür: state=Sent, mode=Manual, kim onayladı, ne zaman
- "Görüntüle" → snapshot subject/body + Teslimat notu
- Bu kayıt **değiştirilemez** — yanlış onay verilmiş olsa bile audit izi kalır

**Kapanış konuşması:**

> *"Bu kapasiteyi Level A diye adlandırıyoruz. Bugün sahip olduğumuz şey:*
> *1) Politika ve onay akışı — kim neyi onaylar, ne zaman onaylar*
> *2) Şablon ve kural yönetimi — mesaj ne diyor, kime gider*
> *3) Cevap kanalı çözümü — müşteri tercihi okunuyor*
> *4) Manuel iletişim kapama — operatör onaylı, audit'lenmiş*
>
> *Aktif e-posta gönderimi (Level B) bir sonraki adım. Üretim e-posta sağlayıcı kararı sonrası Phase 4 olarak devreye alınır. O güne kadar Level A operasyonel olarak yeterli — hiçbir sessiz e-posta gitmiyor, müşteri iletişimi her zaman operatör kararıyla kapanıyor."*

---

## Soru-cevap için hazırlık notları

### "Bu otomatik mail göndermiyor mu?" — **Doğru. Bilinçli karar.**
Üretim e-posta sağlayıcı kararı verilene kadar (Resend, SMTP, vb.) Varuna otomatik müşteri e-postası göndermez. Bu, kullanıcı davetiye akışında da yaşadığımız aynı sınır. Level A bu sınırın etrafında bile değer üretiyor: politika + onay + audit + cevap kanalı.

### "WhatsApp / SMS ne zaman gelir?" — **Level C, talep oluşunca.**
Kapsam dışı. Üretim e-posta bile yokken WhatsApp/SMS sağlayıcı entegrasyonu yatırım hatası olur. Talep gerçekten oluşunca kanalı en başa eklemeyiz; Level B (e-posta) sonrası Level C tarafında planlanır.

### "Manuel onay her seferinde not yazmak hızı düşürmez mi?" — **Hayır, audit invariantı.**
Notunuz 3-5 kelime de olabilir ("phone: tamam"). Önemli olan **boş bırakılamamasıdır**, çünkü:
- Düzenleyici denetim sorusu: *"Müşteriye ne söylediniz, ne zaman?"*
- Notun olmaması = audit izi yok = veri kalitesi sorunu

Hız kaybı min, kalite kazancı yüksek.

### "Reddedilen bir onay vakaya ne yapıyor?" — **3 davranıştan biri.**
- `ReturnToAssignee` — atayan kişiye geri döner, vaka durumu değişmez (varsayılan)
- `ReturnToTeam` — atayan kişi temizlenir, vaka takıma geri düşer
- `Escalate` — vaka **Eskalasyon** durumuna geçer, gerekçe escalation reason'a yazılır

Tenant politika başına seçer.

### "Bir mesaj iki kez tetiklenirse?" — **Suppressed/dedup.**
`suppressDuplicateWithinMinutes` penceresinde aynı (vaka, alıcı, şablon) ikinci kez fire ederse ikinci kayıt `Suppressed/duplicate_within_window` yazılır — operatör çift mesaj göndermek zorunda kalmaz, audit görünür.

### "Saatlik üst sınır ne işe yarar?" — **Rate limit.**
Bir kural saatte en fazla N kez fire eder. N aşılırsa kalan `Suppressed/rate_limit_exceeded`. Hızlı kapanma akışlarında müşteriye spam atmayı engeller.

### "Müşteri opt-out demişse iç ekip de bilgilendirilmez mi?" — **Sadece müşteri etkilenir.**
Opt-out yalnız `customer_primary_contact` audience'ını etkiler. İç audiences (assignee / team_lead / supervisor / admin) her halükarda bildirim alır — opt-out müşteri-facing değildir.

---

## Demo sonrası eylem önerileri

- [ ] Pilot tenant ile **2 hafta** Level A canlı kullanımı (operatör + supervisor)
- [ ] Manuel iletişim akışında **kullanım metriği** topla: kaç kez Manuel Olarak Hallettim tıklandı, ortalama teslimat notu uzunluğu, Suppressed oranı
- [ ] Pilot tenant'tan **opt-out kullanımı** geri bildirim — gerçek hayatta KVKK senaryolarında çalışıyor mu?
- [ ] Üretim e-posta sağlayıcı kararı için **Phase 4 kapsamlı planning card** hazırla (Resend mi, in-house SMTP mi, multi-tenant ne olur, retry/failure)

---

## Bonus — "Üzerine ne koyabiliriz?" konuşması

Müşteri/yönetim sorarsa:

- **Level B (Phase 4)** — Aktif e-posta. Mode=Active rule'lar; kuyruğa düşer, cron worker provider'a gönderir, gönderim hatası retry'a girer. **Provider seçimi ürün direktörü kararı.**
- **Phase 5 hatırlatmalar** — Cron: onay bekliyor > X saat → kuralları olan stakeholder'a hatırlatma; müşteri cevap bekleniyor > X gün → operatöre hatırlatma.
- **Phase 6 i18n** — Şablon dil seçimi (TR/EN/RU). UNIVERA gibi çoklu dil müşteri tabanı için.
- **Phase 6+ webhook** — Outbound webhook → tenant'ın kendi sistemine (Slack, Teams, custom CRM).
- **Level C portal** — Müşteri Varuna içinde mesajı görür ve "kabul" / "yeniden bakın" diyebilir; case_reopened olayı tetiklenir.
- **Analytics dashboard** — Hangi kural saatte kaç kez tetiklendi, hangi onaylar geç verildi, müşteri opt-out trendleri.

Hepsi **Level A'nın üstüne** koyulan katmanlar. Level A bunlara dayanmıyor — Level B/C devreye girmese de Level A kendi başına işliyor.
