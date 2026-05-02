# FAZ 2 — Collab Spec (Varuna 2.0)

**Hedef:** Varuna Case Management'ı **helpdesk ticket sisteminden** çıkarıp, takımların bir vaka üzerinde gerçek anlamda **birlikte çalıştığı collab platformuna** dönüştürmek.

> Bu doküman PRODUCT_SPEC.md'yi tamamlar; çelişki olursa PRODUCT_SPEC kazanır.
> Burada FAZ 2 collab fazına özel detaylar tanımlanır.
> **Versiyon 2.0 — PRD v2 ile senkronize** (6.8 / 6.9 / 6.10 / 6.11 eklendi)

---

## 1. Genel Amaç

### Mevcut durum
Şu an Varuna bir vaka açan, atayan, statüsünü yöneten klasik bir CRM/ticket aracı. Ekipler arası işbirliği zayıf:
- Vakayı kim takip ediyor net değil — sadece "atanan" var.
- İlişkili vakalar manuel hatırlanıyor, sistem bağlamıyor.
- Notlar / dosyalar / çağrılar farklı tablarda dağınık.
- AI tek bir senaryoda çalışıyor (kategori önerisi).
- Bildirimler standart e-posta; anlık operasyonel geri bildirim yok.

### Hedef davranış
Bir vaka açıldığında:
1. AI doğru kişileri otomatik **takipçi** olarak ekler ya da önerir.
2. Benzer/bağlı vakaları **AI tespit eder**, ilişki önerir.
3. Tüm aktivite (not, dosya, statü değişimi, çağrı) **tek kronolojik akışta** görünür.
4. Ekip kişi etiketleme ile birbirini çağırır, tepki ile hızlı iletişim kurar.
5. AI 6 farklı rolde sürekli devrede: Sınıflandırıcı, Araştırıcı, Yazman, Yönlendirici, Bekçi, Risk Göstergesi.
6. Bildirimler kanal/öncelik/rol/saat matrisinden geçer.
7. Eksik bilgi, duygu tonu değişimi, durmuş vaka — hepsi proaktif sinyal üretir.

### Başarı kriterleri
- Bir vakayı 3 ekibin yönetmesi tek arayüzden 5 dakikada tamamlanabilir.
- Yeni gelen ekip üyesi vakayı 30 saniyede özetleyip devralabilir (devir notu).
- "Bu durum daha önce yaşandı mı?" sorusunun cevabı tıklamadan görünür.
- Bildirim gürültüsü %50 azalır (kategorize, sessize alınabilir, mesai dışı günlük özet).

---

## 2. Takipçi Alanı — "Kim haberdar olsun?"

### Amaç
Vakayı atayan kişi tek başına vakayı sahiplenmiyor; ilgili herkes (önceki sahip, yönetici, müşteri temsilcisi, etiketlenen kişi) **gönüllü olarak** takipte. Atanan değişse bile takipçiler takipte kalır. Bu, "vakayı sadece atanan biliyor, gerisi karanlıkta" sorununu çözer.

### Veri modeli

```
CaseWatcher
─────────────────────────────────────────────────
id                    String   @id @default(cuid())
caseId                String   FK → Case.id (cascade delete)
userId                String   FK → User.id
notificationProfile   ENUM     instant | digest | critical_only | muted
addedBy               String?  FK → User.id (null = AI)
addedReason           ENUM     manual | mention | ai_suggestion | rule | self_join
createdAt             DateTime
mutedUntil            DateTime?

@@unique([caseId, userId])
@@index([userId, notificationProfile])
```

`notificationProfile` davranışı:
- **instant** — her olayda bildirim (statü, not, dosya, çağrı)
- **digest** — günde 1 kez özet e-posta (varsayılan)
- **critical_only** — yalnızca SLA ihlali, eskalasyon, yönetici onayı
- **muted** — bildirim yok ama vaka detayında "takipte" rozeti görünür

### UI davranışı
- Vaka detayı sağ panelde **"Takipte (5)"** kartı — avatar şeridi + "Sen takipte misin?" geçişi.
- "+ Takipçi Ekle" → Cmd+K stili kullanıcı arama, ekleme + bildirim profili seçimi.
- Takipçi kartında her satırda "ne zaman / neden eklendi" ipucu (Araştırıcı AI önerisi mi, manuel mi).
- Etkinlik akışında "X seni takibe ekledi" olayı görünür.
- Kenar çubuğunda **"Takipteki Vakalar"** sayfası — kullanıcı kendi takipçi kayıtlarını filtreli görür.
- "Takibi bırak" tek tıkla + neden sor (AI öğrensin).
- **Sınır:** Tavsiye sınırı 8 kişi, sert sınır 20. 20'yi aşan vakalarda "Dağıtım Listesi" yapısı önerilir.

### AI katkısı (Araştırıcı rolüyle ilişkili)
- Vaka açılışında müşterinin önceki vakalarına bakar → CSM, eski sahip, ilgili yönetici → öneri.
- "Bu kategori + ürün için son 30 günde en çok bu kişiler etkileşime girdi" — örüntü bazlı öneri.
- Etiketlemede otomatik takipçi ekleme (kural).
- Çıkış sebebi (ayrılma nedeni) → AI bir sonraki vakada bu kullanıcıyı önermeyebilir.

---

## 3. Bağlı Vakalar

### Amaç
Bir vakanın yalnız olmadığı durumlarda — tekrarlayan müşteri sorunu, başka takıma bağımlı, daha büyük bir sorunun parçası — ilişkiyi **görsel olarak ifade etmek**. Bağlı vakalar kullanıcıyı geçmişe (yinelenen), kapsama (üst-alt) ve bağımlılığa (engelliyor) bağlar.

### Veri modeli

```
CaseLink
─────────────────────────────────────────────────
id            String   @id @default(cuid())
caseIdFrom    String   FK → Case.id (cascade)
caseIdTo      String   FK → Case.id (cascade)
linkType      ENUM     duplicate | parent_child | blocking | related
direction     ENUM     symmetric | asymmetric
aiConfidence  Float?   0.0-1.0
createdBy     String   FK → User.id
createdAt     DateTime
note          String?

@@unique([caseIdFrom, caseIdTo, linkType])
@@index([caseIdFrom])
@@index([caseIdTo])
```

`linkType` anlamları:
- **duplicate** — aynı sorun, aynı müşteri, ayrı vakalar. Birinin çözümü diğerine kopyalanabilir.
- **parent_child** — kapsayıcı vaka altında alt vakalar. Üst kapanmadan alt kapanamaz (UI uyarısı).
- **blocking** — A kapanmadan B ilerleyemez. B "Beklemede" etiketi alır.
- **related** — gevşek bağ. Ne UI engeli ne AI tetikleyicisi.

### UI davranışı
- Vaka detayı üstünde **"Bağlı Vakalar (3)"** etiketi — tıklayınca genişler.
- Her bağlantı kartında: tür simgesi, hedef vaka no + başlık, kısa statü, AI güven rozeti (varsa).
- "+ Bağlı Vaka" → arama modalı, tür seçimi, opsiyonel not.
- Yinelenen bağlantı → etkinlik akışında "Bu vakanın çözümünü buraya çek" hızlı aksiyonu.
- Üst vakada alt vakaların özeti yan kart (statü/atama mini görünüm).
- Engelliyor bağlantısı → vaka başlığında turuncu şerit "VK-1234 tarafından engellendi".

### AI katkısı (Araştırıcı rolü)
- Vaka açılışında: aynı müşteri + aynı kategori + son 90 gün + benzer açıklama → yinelenen skoru.
  - `aiConfidence > 0.85` → otomatik bağlantı (kullanıcıya bildirim)
  - `0.60-0.85` → öneri kartı, kullanıcı onaylar
  - `< 0.60` → "Belki ilgili?" zayıf öneri (related)
- Açıklama gömme benzerliği (sentence-transformer / OpenAI embedding).
- Kullanıcı bağlantıyı reddederse AI öğrenir (olumsuz geri bildirim sinyali).

---

## 4. Birleşik Etkinlik Akışı

### Amaç
Şu an vaka detayında 5 farklı sekme (Detay/Aktivite/Notlar/Dosyalar/Çağrı Kayıtları) var. Bilgi dağınık. **Tek kronolojik akış** daha az bilişsel yük + daha hızlı devir sağlar.

### Veri modeli
Yeni tablo gerekmez — mevcut tablolar (CaseActivity, CaseNote, CaseAttachment, CaseCallLog) uygulama katmanında birleştirilir.

**Mevcut tablolara yeni alanlar:**
```
CaseNote
─────────────────────────────────────────────────
+ parentNoteId    String?   FK → CaseNote.id  (yanıt için)
+ mentions        Json?     [{ userId, position }]
+ reactions       Json?     { "👀": [userId, ...], "✅": [...], ... }

CaseActivity
─────────────────────────────────────────────────
+ reactions       Json?
```

**Yeni tablo (etiketleme denetimi + bildirim üretimi):**
```
CaseMention
─────────────────────────────────────────────────
id                  String   @id @default(cuid())
caseId              String
sourceType          ENUM     note | comment_reply
sourceId            String
mentionedUserId     String   FK → User.id
mentionedBy         String   FK → User.id
seenAt              DateTime?
createdAt           DateTime
```

### UI davranışı
- Akış üstünde filtre sekmeleri: Hepsi / Statü / Atama / Dosya / Not / Çağrı / Alan / Denetim.
- Notlar akış satırında "yorum" formatında — avatar + ad + tarih + içerik + tepki satırı.
- Yanıt: not satırında "↳ Yanıtla" → 1 seviye iç içe yanıt.
- Kişi etiketleme:
  - Yazarken `@` → otomatik tamamlama (takipçiler + yetkili kişiler öncelikli)
  - Etiketlenen kullanıcı otomatik takipçi olur, bildirim alır.
  - Akışta etiket mavı etiket olarak görünür.
- Tepkiler: 4 sabit simge — 👀 gördüm · ✅ tamam · ⚠️ dikkat · ❓ soru.
- Yazma alanı akışın altında sabit (Slack örüntüsü) — görünürlük seçimi (İç/Müşteriye Görünür).
- Sesli not butonu mevcut VoiceNoteButton ile entegre.

### AI katkısı (Yazman rolü)
- 10+ olaylı vakada üst kısımda **"Canlı Özet"** kartı — son 24 saatin 2 cümlelik özeti (1 saat önbellek).
- "Devralacağım" butonu → devir notu: vakanın durumu, kalan iş, dikkat edilecek 3 madde.
- Tepki eğilimlerinden anlam çıkarma (çok ⚠️ → Risk Göstergesi skoru artar).

---

## 5. Yapay Zekâ Rolleri — 6 Asistan

Her AI işlevi tek bir komutla değil, **rol** olarak tanımlanır. Kullanıcı hangi yardımı aldığını bilir; rol bazlı ayar yapabilir.

### 5.1 Sınıflandırıcı (Triage — mevcut, korunuyor)
**Görev:** Yeni vaka açılırken kategori, alt kategori, öncelik, talep türü, **vaka niyeti (6.8)** ve **etki kapsayımı (6.9)** önerisi.
**Tetik:** Açıklama 20+ karakter, 1.2 sn gecikme.
**Çıktı:** AI öneri kartı, "Uygula/Yoksay".
**Mevcut uç nokta:** `/api/ai/suggest-category`
**Yeni katkı:** caseType + requestType + suggestedTitle + **case_intent** + **impact_scope** önerisi.

### 5.2 Araştırıcı (Detective — yeni)
**Görev:** Bağlı vakalar + takipçi önerileri + müşteri geçmiş bağlamı.
**Tetik:** Vaka açıldıktan 5 saniye sonra arka planda + müşteri seçildiğinde.
**Çıktı:** Sağ panelde "🕵 Araştırıcı" kartı:
- "Bu müşterinin son 90 günde 3 benzer vakası var" → bağlantılar
- "Bu kategori için en aktif kişi: X (12 çözüm, son 30 gün)"
- "Müşteri temsilcisi: Y — takipçi olarak eklemek ister misin?"

### 5.3 Yazman (Scribe — yeni)
**Görev:** Etkinlik akışı için canlı özet + devir notu.
**Tetik:** 10+ olay biriktiğinde otomatik, "Devralacağım" tıklandığında manuel.
**Çıktı:**
- **Özet:** "3 gündür açık. Müşteri 2 kez aradı, ödeme sorunu. Backoffice cevap bekliyor."
- **Devir notu:** "Şu an sahibi: A. Sonraki adım: B'den onay. Risk: SLA 12 saat kaldı."
- **Başarı kriteri denetimi (6.10):** Kapatma anında kriterin karşılanıp karşılanmadığını sorgular.
- Önbellek 1 saat.

### 5.4 Yönlendirici (Coach — yeni)
**Görev:** "Sıradaki aksiyon ne?" — kullanıcıya bağlama göre öneri.
**Tetik:** Vaka detayına girildiğinde sağ panelde mini kart.
**Çıktı:**
- "Çözüldü'ye geçmek için denetim listesinde 2 madde kaldı."
- "Bu müşteriyi en son 7 gün önce aradın. Tekrar arama önerilir."
- "Başarı kriteri: 'Müşteri cihazın çalıştığını teyit eder.' Henüz teyit alınmadı."
**Çıktı formatı:** Tek cümle + tek aksiyon butonu.

### 5.5 Bekçi (Watchman — yeni)
**Görev:** Durmuş vaka hatırlatıcısı + örüntü tespiti.
**Tetik:** Saatlik zamanlayıcı — son 4 saatte hareket olmayan vakalar.
**Çıktı:**
- Etkinlik akışına sistem mesajı: "Bu vaka 18 saattir hareketsiz. Atanan: X. Hatırlatma gönder?"
- Takipçilere günlük özet: "3 vakanız 24 saat hareketsiz".
- Örüntü tespiti: "Bu hafta 'POS bağlanmıyor' kategorisinde %40 artış var" → yönetici bildirimi.
- **Etki kapsayımı sinyali (6.9):** Bayi ağı kapsamlı vakalar örüntü tespitinde ağırlıklandırılır.

### 5.6 Risk Göstergesi (Risk Lens — yeni) ⬆ Güncellendi
**Görev:** SLA + müşteri kaybı + eskalasyon + memnuniyet olasılığı + etki kapsayımı + vaka niyeti → tek skor.
**Tetik:** Her vaka kaydında arka planda hesap.
**Çıktı:** Başlıkta renkli etiket — Yeşil/Sarı/Kırmızı + ipucu detayı:
- SLA kalan süre %
- Müşteri duygu tonu eğilimi
- Geçmiş eskalasyon sayısı
- Takipçi tepkileri (⚠️ sayısı)
- **Etki kapsayımı** (Bayi Ağı → +30 puan, Şube → +15 puan)
- **Vaka niyeti** (Eskalasyon → +20 puan, Telafi → +15 puan)
- Birleşik → tek skor 0-100.

**Skor ağırlık tablosu:**

| Sinyal Kaynağı | Katkı |
|---|---|
| SLA riski | 0-25 puan |
| Müşteri kaybı riski | 0-20 puan |
| Memnuniyet riski / duygu tonu | 0-15 puan |
| Geçmiş eskalasyon | 0-10 puan |
| Etki kapsayımı (Bayi Ağı) | +30 puan |
| Etki kapsayımı (Şube) | +15 puan |
| Niyet: Eskalasyon | +20 puan |
| Niyet: Telafi | +15 puan |
| Takipçi ⚠️ tepkileri | +5 puan / adet, max 15 |

**Eylem:** Skor 75+ ise Yönlendirici + Bekçi tetiklenir; yönetici bildirimi.

### Ortak altyapı
- `AISuggestion` tablosu (mevcut) tüm rollerin önerilerini kaydeder.
- Her öneride kabul/red geri bildirimi → AI iyileştirme.
- Rol başına açık/kapalı + sıklık ayarı Şirket Ayarları'nda.

---

## 6. Bildirim Sistemi

### Amaç
Mevcut: bildirim yok denecek kadar az (yalnızca kısa bildirim). Yeni sistem: **doğru kişiye, doğru kanalda, doğru zamanda** — gürültüye girmeden, kaçırmadan.

### Veri modeli

```
CaseNotification (mevcut, genişletilecek)
─────────────────────────────────────────────────
id, caseId, eventType, channel, recipient, sentAt, readAt
+ priority         ENUM   info | warning | critical
+ deepLink         String  /cases/:id?focus=event-:activityId
+ batchId          String?
+ openedAt         DateTime?
+ actionedAt       DateTime?
```

### Rozet sayacı kuralları
Kenar çubuğundaki rozet:
- **Yalnızca kritik mod:** SLA ihlali + eskalasyon + yönetici onayı bekleyen.
- **Tüm okunmamışlar:** Takipçi olduğun + etiketlendiğin + atandığın.
- Varsayılan: Tüm okunmamışlar modu.
- 99+ üstü "99+" gösterir.

### Doğrudan bağlantı
Bildirimden tıklayınca:
- Vakaya gider
- İlgili sekmeyi açar (etiketleme → Notlar; SLA → Detay; dosya → Dosyalar)
- İlgili olay ekrana kaydırılır + 2 sn vurgu efekti.

### Kanal matrisi

| Olay | Mesai içi | Mesai dışı |
|---|---|---|
| Etiketleme (sana) | Uygulama içi + E-posta (anlık) | Uygulama içi + SMS (yalnızca yönetici) |
| Atama | Uygulama içi + E-posta | Uygulama içi (sabah e-posta) |
| SLA %80 | Uygulama içi | Uygulama içi |
| SLA ihlali | Uygulama içi + E-posta + SMS (yönetici) | Hepsi |
| Eskalasyon | Uygulama içi + E-posta | Uygulama içi + SMS (yalnızca yönetici) |
| Yönetici onayı | Uygulama içi + E-posta (anlık) | Uygulama içi (sabah e-posta) |
| Takipçi günlük özeti | E-posta (09:00) | yok |
| Bekçi hatırlatıcısı | Uygulama içi | yok |
| AI önerisi | Uygulama içi | yok |

Mesai saatleri Şirket Ayarları'nda tanımlanır (varsayılan: 09:00-18:00 Pazartesi-Cuma).

### Kişisel hatırlatıcı
Vaka detayı başlığında **"Bana Hatırlat"** butonu:
- "1 saat sonra", "Yarın 09:00", "Pazartesi", "Özel tarih"
- Hatırlatma anında uygulama içi bildirim + opsiyonel e-posta.

```
CaseReminder
─────────────────────────────────────────────────
id          String   @id @default(cuid())
caseId      String   FK → Case.id
userId      String   FK → User.id
remindAt    DateTime
message     String?
sentAt      DateTime?
```

### Sağlayıcılar
- **E-posta:** Resend
- **SMS:** NetGSM / İletimerkezi (karar verilecek)
- **Uygulama içi:** 30 sn yoklama (Faz 2) → Faz 3'te WebSocket

---

## 7. Alt Görevler

### Amaç
Bir vaka birden çok atomik adımla çözülür. Bu adımları **tek vaka içinde** takip edebilmek, zorunlu adımları kapatma şartı yapmak.

### Veri modeli

```
CaseSubTask
─────────────────────────────────────────────────
id              String   @id @default(cuid())
caseId          String   FK → Case.id (cascade)
title           String
description     String?
status          ENUM     todo | in_progress | done | cancelled
required        Boolean  default false
assignedUserId  String?  FK → User.id
displayOrder    Int      default 0
dueAt           DateTime?
completedAt     DateTime?
completedBy     String?  FK → User.id
createdAt       DateTime
createdBy       String   FK → User.id

@@index([caseId, status])
```

### UI davranışı
- Vaka detayında yeni bölüm: **"Alt Görevler (3/5)"** — ilerleme çubuğu.
- Her satır: onay kutusu + başlık + atama avatarı + son tarih + sürükle tutamacı.
- "+ Alt Görev" → satır içi ekleme.
- Vaka **Çözüldü**'ye geçişte: tüm `required: true` görevler `done` olmalı, aksi halde geçiş engellenir.
- Alt göreve atanan kişi otomatik takipçi olur.
- Şablon desteği: kategori bazında varsayılan alt görev seti.

### AI katkısı (Yönlendirici rolü)
- Vaka açılışında AI önceki çözümlerden ortalama 3-5 alt görev önerir.
- Sıradaki alt görevi son tarihe göre Yönlendirici sürekli vurgular.

---

## 8. Duygu Tonu Analizi

### Amaç
Vaka süresince müşterinin yazışmalarını AI sürekli analiz ederek **tonu izler**. Tonun bozulması erken sinyal — yönetici müdahalesi ya da öncelik artırımı tetikler.

### Veri modeli

```
CaseSentimentSnapshot
─────────────────────────────────────────────────
id           String   @id @default(cuid())
caseId       String   FK → Case.id (cascade)
sentiment    ENUM     positive | neutral | negative | angry
score        Float    -1.0 ... +1.0
sourceType   ENUM     note | call_log | chat
sourceId     String
analyzedAt   DateTime
notes        String?

@@index([caseId, analyzedAt])
```

`Case` tablosuna özet alanlar:
- `currentSentiment` (en son anlık görüntü)
- `sentimentTrend` ENUM `improving | stable | worsening`

### UI davranışı
- Vaka detayı başlığında küçük yüz simgesi — olumlu (😊 yeşil), yansız (😐 gri), olumsuz (😟 amber), öfkeli (😡 kırmızı).
- İpucunda: "Son 3 yazışmadan: 1 öfkeli, 2 olumsuz. Eğilim: kötüleşiyor."
- Sağ panelde duygu tonu zaman çizelgesi — son 7 mesaj.
- Eğilim `worsening` ise üstte amber şerit: "Müşteri tonunda kötüleşme — yönetici önerilir."

### AI katkısı
- Her yeni `CaseNote` (görünürlük=Müşteri veya çağrı kaydı) AI'ya gider.
- Türkçe komut → özel kalıplar tanır ("hizmetinizden memnun değilim", "iptal etmek istiyorum", "avukatımla görüşürüm").
- Skor Risk Göstergesi'ne beslenir (duygu tonu kötü → risk skoru artar).
- **Kapsam:** Yalnızca müşteri mesajları. İç notlar duygu tonu analizine girmez.

---

## 9. Eksik Bilgi Tespiti

### Amaç
Ajan vaka açarken her zaman tam bilgi alamaz; bazı kategoriler kritik bilgi gerektirir. AI **eksik bilgileri tespit eder** ve UI'da uyarı gösterir → yanlış takıma yönlendirme ve geri dönüşler azalır.

### Veri modeli

```
CategoryRequiredInfo
─────────────────────────────────────────────────
id            String   @id @default(cuid())
companyId     String   FK → Company.id
categoryId    String?  FK → CategoryDef.id
subCategoryId String?  FK → CategoryDef.id
caseType      CaseType?
fields        Json     [{ key, label, hint, severity: critical|recommended }]
createdAt     DateTime
updatedAt     DateTime

@@index([companyId, categoryId, subCategoryId])
```

`fields` örneği:
```json
[
  { "key": "device_serial", "label": "Cihaz Seri No", "hint": "Cihazın altında etiketli", "severity": "critical" },
  { "key": "error_code", "label": "Hata Kodu", "hint": "Ekrandaki E-XXX kodu", "severity": "recommended" }
]
```

### UI davranışı
- Kategoride eksik alan uyarısı belirir: "Bu kategori için şu bilgiler genellikle gerekli."
- Kullanıcı doldurmadan da kaydedebilir ama kayıtta uyarı + "Yine de aç" geçersizliği.
- Vaka detayında "⚠️ Eksik Bilgi (2)" rozeti.

### Yönetici yönetimi
- `/admin` altında: **"Kategori Bilgi Şablonları"** — şirket × kategori × alt kategori için zorunlu/önerilen alan kümesi.

### AI katkısı (Araştırıcı + Yazman rolleri)
- Araştırıcı: Açıklama metnini ayrıştırarak eksikleri tespit eder, önem sınıflandırır.
- Yazman: "Müşteriden İste" seçilince müşteriye gönderilecek e-posta taslağı üretir.

---

## 10. Yapay Zekâ Entegrasyon Yönetimi — Kiracı Bazlı

### Amaç
Her şirketin **kendi AI bütçesi**, sağlayıcısı, modeli olabilmeli. Bazıları Anthropic kullanmak isteyebilir, bazıları aylık jeton sınırı koymak, bazıları AI'ı tamamen kapatmak isteyebilir.

### Veri modeli — Şirket Ayarları genişlemesi

```
CompanySettings (mevcut, alanlar eklenir)
─────────────────────────────────────────────────
+ aiProvider          ENUM   openai | anthropic | none
+ aiApiKey            String?  (şifreli)
+ aiModel             String?
+ aiEnabled           Boolean  default true
+ aiMonthlyTokenLimit Int?
+ aiMonthlyTokensUsed Int     default 0
+ aiLastResetAt       DateTime?
```

**Jeton kullanım takibi:**
```
AITokenUsage
─────────────────────────────────────────────────
id           String   @id @default(cuid())
companyId    String   FK
endpoint     String
inputTokens  Int
outputTokens Int
totalCost    Float
usedAt       DateTime
caseId       String?

@@index([companyId, usedAt])
```

### UI davranışı (Yönetici Şirket Ayarları)
- Sağlayıcı seçimi: OpenAI / Anthropic / Kapalı
- API anahtarı girişi (gizlenmiş, göster geçişi)
- Model seçimi (sağlayıcıya göre filtreli)
- Aylık jeton limiti + "Sınırsız" geçişi
- Bu ayki kullanım: ilerleme çubuğu + jeton + tahmini $ maliyet
- "Test Et" butonu → geçici kategori önerisi çağrısı

### Güvenlik
- `aiApiKey` DB'de şifreli (Supabase Vault veya uygulama katmanı AES-256).
- Yalnızca servis rolü — arayüz asla görmez.
- Her anahtar değişikliğinde denetim günlüğü.

---

## 11. Vaka Niyeti (YENİ — PRD v2 6.8)

### Amaç
Talep Türü alanı (Bilgi/Şikâyet/Hata/Öneri/Talep) müşterinin ne yaptığını sınıflar, ancak müşterinin ne **istediğini** yüzeysel tutar. Vaka Niyeti bu boşluğu kapatır: Sınıflandırıcı rolü açıklama metninden niyeti tahmin eder, ajan onaylar. Bu niyet aşağı yönde şablon seçimini, eskalasyon eşiğini ve memnuniyet anketi formunu otomatik belirler.

### Veri modeli

```
Case tablosuna eklenen alan:
─────────────────────────────────────────────────
case_intent   ENUM   bilgi | cozum | telafi | eskalasyon | belirsiz
              default: belirsiz
```

### Niyet türleri ve sistem davranışı

| Niyet | Anlamı | Tetiklediği Davranış |
|---|---|---|
| Bilgi | Müşteri yanıt veya açıklama bekliyor | SLA süresi gevşek; SSS şablonu önerilir |
| Çözüm | Teknik sorun giderilsin istiyor | Standart SLA; teknik şablon |
| Telafi | Geri ödeme, indirim veya jest bekliyor | Yönetici onayı zorunlu; telafi teklif şablonu açılır; Risk Göstergesi +15 puan |
| Eskalasyon | Üst yetkili veya resmi şikâyet başlatmak istiyor | Öncelik otomatik Yüksek; yönetici takipçi olarak eklenir; Risk Göstergesi +20 puan |
| Belirsiz | AI tahmin edemedi | Sınıflandırıcı ajan onayı ister |

### UI davranışı
- Vaka formunda Talep Türü'nün hemen altında **"Müşteri Niyeti"** alanı.
- Açıklama yazılırken Sınıflandırıcı rolü 1.2 sn gecikmeli tahmin üretir.
- Ajan onaylar veya değiştirir; red nedeni CaseActivity'ye loglanır.
- Niyet değiştirildiğinde Aşağı Yön Etkisi Göstergesi (Bölüm 6.6) güncellenir: "Niyet Telafi seçildi → Yönetici onayı zorunlu olacak."

### AI katkısı (Sınıflandırıcı rolü)
- `/api/ai/suggest-category` uç noktası genişletilir: mevcut çıktılara `case_intent` ve `intent_confidence` (0.0-1.0) eklenir.
- Güven 0.7 altında → "Belirsiz" döner, ajan seçim yapar.
- Niyet, Risk Göstergesi'ne doğrudan sinyal olarak iletilir.

---

## 12. Müşteri Etki Katsayısı (YENİ — PRD v2 6.9)

### Amaç
Tek bir vakanın kaç müşteriyi etkilediğini ölçer. Bu bilgi öncelik kararını, eskalasyon eşiğini ve Risk Göstergesi skorunu doğrudan etkiler. Ayrıca Bekçi rolünün "filo alarmı" kararına sinyal besler: etki kapsayımı yüksek vakalar örüntü tespitinde ağırlıklandırılır.

### Veri modeli

```
Case tablosuna eklenen alan:
─────────────────────────────────────────────────
impact_scope  ENUM   tek | sube | bayi_agi | belirsiz
              default: belirsiz
```

### Kapsam değerleri ve sistem davranışı

| Kapsam | Öncelik / Eskalasyon Etkisi | Yapay Zekâ Katkısı |
|---|---|---|
| Tek müşteri | Değişmez | Standart akış |
| Şube / lokasyon | Öncelik önerisi Yüksek'e çıkar | Aynı lokasyondaki açık vakaları listeler |
| Bayi ağı / segment | Kritik öncelik; yönetici otomatik takipçi; SLA süresi yarıya iner | "Son 2 saatte 7 müşteri aynı sorunu açtı" uyarısı + örüntü alarmı tetikler |

### UI davranışı
- Vaka formunda Öncelik alanının yanında **"Etki Kapsayımı"** seçimi.
- Sınıflandırıcı rolü açıklama metninden kapsam tahmin eder ("tüm bayilerimizde", "şubemizde").
- Kapsam seçildiğinde Aşağı Yön Etkisi Göstergesi güncellenir: "Bayi Ağı seçildi → Öncelik Kritik'e yükseltilecek; Risk Göstergesi +30 puan."
- Yönetici ekranında: etki kapsayımına göre filtrelenebilir vaka listesi.

### AI katkısı (Sınıflandırıcı + Bekçi rolleri)
- Sınıflandırıcı: `impact_scope` ve `scope_confidence` çıktısı `/api/ai/suggest-category` uç noktasına eklenir.
- Bekçi: Bayi Ağı kapsamlı vakalar örüntü tespiti algoritmasında 3x ağırlık alır — tek müşteri vakasına göre çok daha hızlı örüntü alarmı tetikler.
- Risk Göstergesi: `impact_scope` değerine göre eskalasyon skoru +15 veya +30 puan.

---

## 13. Başarı Kriteri (YENİ — PRD v2 6.10)

### Amaç
Kapatma kararı şu an sübjektiftir: ajan "çözüldü" diyince vaka kapanır. Başarı Kriteri alanı bunu net bir sınıra taşır: vakanın başarılı sayılması için ne olması gerekir? Yapay zekâ vaka tipine göre varsayılan öneri doldurur; kapanma anında Yönlendirici rolü "kritere ulaşıldı mı?" denetimi yapar.

### Veri modeli

```
Case tablosuna eklenen alan:
─────────────────────────────────────────────────
success_criteria  TEXT   max 300 karakter, opsiyonel
```

### Yapay zekâ varsayılan önerileri

| Vaka Tipi | Yapay Zekâ Varsayılan Kriter Önerisi |
|---|---|
| Teknik Hata | Müşteri cihazın hatasız çalıştığını teyit eder ve onaylar |
| Fatura Sorunu | Düzeltilmiş fatura veya iade müşteriye iletilir ve müşteri onaylar |
| Müşteri Kaybı Yönetimi | Müşteri elde tutuldu ve iptal talebi geri çekildi |
| Proaktif Takip | Müşteri ile bağlantı kuruldu, hedef eylem gerçekleştirildi |
| Genel Destek | Müşteri sorununun çözüldüğünü teyit eder |

### UI davranışı
- Vaka formunda Açıklama alanının altında **"Başarı Kriteri"** (opsiyonel) tek satırlık metin girişi.
- Yapay zekâ kategori + talep türü seçilince `placeholder` olarak varsayılan önerisini gösterir.
- Vaka Çözüldü'ye geçiş ekranında kriter tekrar gösterilir: "Şu kriter belirlenmişti: [kriter]. Karşılandı mı?"
- Kriter değiştirildiğinde CaseActivity'ye loglanır.

### AI katkısı (Yazman + Yönlendirici rolleri)
- **Yazman:** Kapatma anında etkinlik akışının son notları ve duygu tonu analizi ile kriteri karşılaştırır. Uyumsuzluk varsa sorgulama notunu gösterir: "Başarı kriteri 'müşteri onayı' gerektiriyor ancak son 3 notta müşteri teyidi görünmüyor."
- **Yönlendirici:** Vaka detayında "Başarı kriterinden şu kadar kaldı" mini kartı — kriteri bölümlere ayırarak ilerleme gösterir.
- Kriter CaseActivity'ye her değişimde loglanır — denetlenebilirlik için.

---

## 14. Risk Göstergesi — 6 Sinyal Entegrasyonu (YENİ — PRD v2 6.11)

### Amaç
Bölüm 5.6'daki Risk Göstergesi rolü orijinal olarak 4 sinyal kaynağıyla çalışıyordu: SLA, müşteri kaybı, eskalasyon, memnuniyet. Müşteri etki katsayısı (Bölüm 12) ve vaka niyeti (Bölüm 11) iki ek sinyal olarak eskalasyon risk skoru hesabına eklenir. Artık Risk Göstergesi **6 sinyal kaynağıyla** çalışır.

### Güncel skor ağırlık tablosu

| Sinyal Kaynağı | Alan | Katkı |
|---|---|---|
| SLA riski | `ai_sla_risk_score` | 0-25 puan |
| Müşteri kaybı riski | `ai_churn_risk_score` | 0-20 puan |
| Memnuniyet riski / duygu tonu | `ai_satisfaction_risk_score` | 0-15 puan |
| Geçmiş eskalasyon | CaseActivity sayımı | 0-10 puan |
| Etki kapsayımı: Bayi Ağı | `impact_scope = bayi_agi` | +30 puan |
| Etki kapsayımı: Şube | `impact_scope = sube` | +15 puan |
| Niyet: Eskalasyon | `case_intent = eskalasyon` | +20 puan |
| Niyet: Telafi | `case_intent = telafi` | +15 puan |
| Takipçi ⚠️ tepkileri | Reaction sayımı | +5/adet, max 15 |

### Skor → renk etiket eşlemesi

| Skor Aralığı | Renk | Eylem |
|---|---|---|
| 0-30 | Yeşil | Standart akış |
| 31-74 | Sarı | Yönlendirici hatırlatıcı üretir |
| 75+ | Kırmızı | Yönlendirici + Bekçi tetiklenir; yönetici bildirimi |

### Güncellenen uç nokta
`/api/ai/risk-score-update` (cron) → çıktıya `impact_scope_bonus` ve `intent_bonus` alanları eklenir.

---

## Uygulama Sırası (Öneri)

| # | Madde | Bağımlılık | Tahmini Efor |
|---|---|---|---|
| 1 | Takipçi Alanı | yok | 2 gün |
| 2 | Bağlı Vakalar | yok | 2 gün |
| 3 | Vaka Niyeti (11) | Sınıflandırıcı uç noktası | 1 gün |
| 4 | Müşteri Etki Katsayısı (12) | Sınıflandırıcı uç noktası | 1 gün |
| 5 | Başarı Kriteri (13) | yok | 0.5 gün |
| 6 | Eksik Bilgi Tespiti | CategoryRequiredInfo | 1.5 gün |
| 7 | Bildirim Sistemi (uygulama içi + Resend) | Takipçi Alanı | 3 gün |
| 8 | Birleşik Etkinlik Akışı (etiketleme + tepki) | Takipçi + Bildirim | 2 gün |
| 9 | Yapay Zekâ Rolleri — Araştırıcı + Risk Göstergesi (14) | Takipçi + Bağlı Vakalar + DB | 2 gün |
| 10 | Duygu Tonu Analizi | Yapay zekâ altyapısı | 1.5 gün |
| 11 | Alt Görevler | yok | 1.5 gün |
| 12 | Yapay Zekâ Rolleri — Yazman + Yönlendirici + Bekçi | Tüm collab altyapısı | 2 gün |
| 13 | Yapay Zekâ Entegrasyon Yönetimi (kiracı bazlı) | Şirket Ayarları | 2 gün |

**Toplam:** ~23 iş günü odaklı çalışma.

---

## Açık Karar Noktaları

| Konu | Soru | Öneri | Öncelik |
|---|---|---|---|
| WebSocket vs yoklama | Uygulama içi bildirim için 30 sn yoklama yeterli mi? | Faz 2: yoklama → Faz 3: WebSocket | Sen + ürün |
| E-posta sağlayıcısı | Resend mi, başka? | Resend | Sen |
| SMS sağlayıcısı | NetGSM / İletimerkezi? | Yerel operatör tercih edilmeli | Sen |
| Duygu tonu önbelleği | Her not için AI çağrısı pahalı mı? Toplu mu? | Toplu (5 dk gecikme) | Sen + maliyet |
| Kiracı AI anahtarı şifreleme | Supabase Vault mı, uygulama KMS mi? | Supabase Vault | Güvenlik |
| Takipçi günlük özet saati | Sabit 09:00 mu, kullanıcı tercihi mi? | Varsayılan 09:00, kullanıcı override | UX |
| Risk Göstergesi ağırlıkları | Sabit ağırlıklar mı, makine öğrenmesi mi? | İlk versiyon sabit; Faz 3'te ML | Teknik |
| Niyet güven eşiği | 0.7 altında "Belirsiz" mi? | Evet — kullanıcı seçim yapar | Orta |
| Etki katsayısı örüntü ağırlığı | Bayi Ağı 3x mi, daha fazla mı? | 3x — A/B testle iyileştirilir | Orta |
| Başarı kriteri zorunluluğu | Kriter olmadan vaka kapanabilir mi? | Evet — opsiyonel, yalnızca uyarı | UX |

---

**Versiyon:** 2.0 — Mayıs 2026
**Değişiklik:** Bölüm 11-14 eklendi (Vaka Niyeti, Müşteri Etki Katsayısı, Başarı Kriteri, Risk Göstergesi 6 sinyal entegrasyonu). Risk Göstergesi skor tablosu güncellendi.
**Bu doküman değiştiğinde:** PRODUCT_SPEC.md referansı güncellenmeli.
