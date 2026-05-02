# FAZ 2 — Collab Spec (Varuna 2.0)

**Hedef:** Varuna Case Management'ı **helpdesk ticket sisteminden** çıkarıp, takımların bir vaka üzerinde gerçek anlamda **birlikte çalıştığı collab platformuna** dönüştürmek.

> Bu doküman PRODUCT_SPEC.md'yi tamamlar; çelişki olursa PRODUCT_SPEC kazanır. Burada FAZ 2 collab fazına özel detaylar tanımlanır.

---

## 1. Genel Amaç

### Mevcut durum
Şu an Varuna bir vaka açan, atayan, statüsünü yöneten klasik bir CRM/ticket aracı. Ekipler arası işbirliği zayıf:
- Vakayı kim takip ediyor net değil — sadece "atanan" var.
- İlişkili vakalar manuel hatırlanıyor, sistem bağlamıyor.
- Notlar / dosyalar / çağrılar farklı tablarda dağınık.
- AI tek bir senaryoda çalışıyor (kategori önerisi).
- Bildirimler standart e-mail; anlık operasyonel feedback yok.

### Hedef davranış
Bir vaka açıldığında:
1. AI doğru kişileri otomatik **watcher** olarak ekler ya da önerir.
2. Benzer/bağlı vakaları **AI tespit eder**, link önerir.
3. Tüm aktivite (not, dosya, statü değişimi, çağrı) **tek kronolojik feed'de** akar.
4. Ekip @mention ile birbirini etiketler, reaction ile hızlı iletişim kurar.
5. AI 6 farklı rolde sürekli devrede: triage, detective, scribe, coach, watchman, risk lens.
6. Bildirimler kanal/öncelik/rol/saat matrisinden geçer.
7. Eksik bilgi, sentiment değişimi, durmuş vaka — hepsi proaktif sinyal.

### Başarı kriteri
- Bir vakayı 3 ekibin yönlendirmesi tek arayüzden 5 dakikada tamamlanabilir.
- Yeni gelen ekip üyesi vakayı 30 saniyede özetleyip devralabilir (handoff brief).
- "Bu durum daha önce yaşandı mı?" sorusunun cevabı tıklamadan görünür.
- Bildirim gürültüsü %50 azalır (kategorize, sessize alınabilir, mesai dışı dijest).

---

## 2. Watchers / CC — "Kim haberdar olsun?"

### Amaç
Vakayı atayan kişi tek başına vakayı sahiplenmiyor; ilgili herkes (önceki sahip, supervisor, CSM, mention edilen kişi) **opt-in** olarak takipte. Atanan değişse bile watcher'lar takipte kalır. Bu, "vakayı sadece atanan biliyor, gerisi karanlıkta" sorununu çözer.

### Veri modeli

```
CaseWatcher
─────────────────────────────────────────────────
id                    String   @id @default(cuid())
caseId                String   FK → Case.id (cascade delete)
userId                String   FK → User.id
notificationProfile   ENUM     instant | digest | critical_only | muted
addedBy               String?  FK → User.id (kim ekledi — null=AI)
addedReason           ENUM     manual | mention | ai_suggestion | rule | self_join
createdAt             DateTime
mutedUntil            DateTime?  (geçici sessize alma)

@@unique([caseId, userId])  — bir kullanıcı bir vakaya tek kayıtla watcher olur
@@index([userId, notificationProfile])
```

`notificationProfile` davranışı:
- **instant** — her event'te bildirim (statü, not, dosya, çağrı)
- **digest** — günde 1 kez özet maili (default — fazla bildirimi sevmeyenler için)
- **critical_only** — sadece SLA ihlal, eskalasyon, supervisor onay
- **muted** — bildirim yok ama vaka detayında "watching" rozeti kalır (görsel hatırlatma)

### UI davranışı
- Vaka detay sağ panelde **"Takipte (5)"** kartı — avatar şeritleri + "Sen takipte misin?" toggle.
- "+ Watcher Ekle" → Cmd+K stili kullanıcı arama, ekleme + notification profile seçimi.
- Watcher kartında her satırda küçük "ne zaman / neden eklendi" tooltip (Detective AI önerisi mi, manuel mi).
- Vaka feed'inde "X seni takibe ekledi" event'i (notlar gibi).
- Sidebar **"Takipteki Vakalar" sayfası** — kullanıcı kendi watcher kayıtlarını filtreli görür.
- Bir kullanıcı kendi notification profile'ını her vaka için ayrı ayarlar (varsayılan: digest).
- "Watchıng'i bırak" tek tıkla ayrılma + neden sor (AI öğrensin).

### AI katkısı (Detective rolüyle ilişkili)
- Vaka açılış: müşterinin önceki vakalarına bakar → CSM, eski sahip, ilgili supervisor → öneri.
- "Bu kategori + ürün için son 30 günde en çok bu kişiler etkileşime girdi" — pattern bazlı öneri.
- Mention'da otomatik watcher (rule).
- Çıkış sebebi (leave reason) → AI bir sonraki vakada bu kullanıcıyı önermeyebilir.

---

## 3. Linked Cases — Vaka İlişkileri

### Amaç
Bir vakanın yalnız olmadığı durumlarda — tekrarlayan müşteri sorunu, başka takıma bağımlı, daha büyük bir kampanyanın parçası — ilişkiyi **görsel olarak ifade etmek**. Linked cases kullanıcıyı geçmişe bağlar (duplicate), kapsama bağlar (parent), bağımlılığa bağlar (blocking).

### Veri modeli

```
CaseLink
─────────────────────────────────────────────────
id            String   @id @default(cuid())
caseIdFrom    String   FK → Case.id (cascade)
caseIdTo      String   FK → Case.id (cascade)
linkType      ENUM     duplicate | parent_child | blocking | related
direction     ENUM     symmetric | asymmetric  (parent_child asymmetric, duplicate symmetric)
aiConfidence  Float?   0.0-1.0  (AI önerisi ise; manuel link için null)
createdBy     String   FK → User.id
createdAt     DateTime
note          String?  (kullanıcı notu — neden bağlandı)

@@unique([caseIdFrom, caseIdTo, linkType])
@@index([caseIdFrom])
@@index([caseIdTo])
```

`linkType` semantiği:
- **duplicate** — aynı sorun, aynı müşteri, ayrı vakalar. Sembolik "≡" → birinin çözümü diğerine kopyalanabilir.
- **parent_child** — bir kapsayıcı vaka altında alt vakalar. Parent çözülmeden child kapanamaz (UI uyarısı, sert kural değil).
- **blocking** — A kapanmadan B ilerlemez. B "Beklemede" görsel etiketi alır.
- **related** — gevşek bağ. "İlginç olabilir" — ne UI engeli ne AI tetiği.

### UI davranışı
- Vaka detay üstünde **"Bağlı Vakalar (3)"** chip — tıklayınca expand olur.
- Her link kartında: link tipi ikonu, hedef vaka no + başlık, kısa statü, AI confidence badge (varsa).
- "+ Bağlı Vaka" → arama modalı, link tipi seçimi, opsiyonel not.
- Duplicate link → vaka feed'inde "Bu vakanın çözümünü buraya çekme" hızlı aksiyonu.
- Parent vakada child'ların özeti yan kart (statü/atama mini görünüm).
- Blocking link → vaka header'ında turuncu banner "BLOCKED by VK-1234".
- Vaka silindiğinde link kaydı cascade — orphan kalmasın.

### AI katkısı (Detective rolü)
- Vaka açılışında: aynı müşteri + aynı kategori + son 90 gün + benzer açıklama → duplicate skoru.
  - `aiConfidence > 0.85` → otomatik link (kullanıcıya bildirim)
  - `0.6-0.85` → öneri kartı, kullanıcı onaylar
  - `< 0.6` → "Belki ilgili?" zayıf öneri (related)
- Description embedding similarity (sentence-transformer / OpenAI embedding).
- Kullanıcı linki reddederse AI öğrenir (negative feedback signal).

---

## 4. Case Feed — Tek Kronolojik Akış

### Amaç
Şu an vaka detayında 5 farklı sekme (Detay/Aktivite/Notlar/Dosyalar/Çağrı Logları) var. Bilgi dağınık, "ne zaman ne oldu" cevabı için kullanıcı sekmeler arası geziyor. **Tek bir kronolojik feed** (Slack/Linear pattern) daha az bilişsel yük + daha hızlı handoff sağlar.

### Veri modeli
Yeni tablo gerekmez — mevcut tablolar (CaseActivity, CaseNote, CaseAttachment, CaseCallLog) bir VIEW veya app-level union ile birleştirilir.

**Yeni alanlar mevcut tablolara:**
```
CaseNote
─────────────────────────────────────────────────
+ parentNoteId    String?   FK → CaseNote.id  (reply için)
+ mentions        Json?     [{ userId, position }]  — denormalize
+ reactions       Json?     { "👀": [userId, ...], "✅": [...], ... }

CaseActivity
─────────────────────────────────────────────────
+ reactions       Json?     (sistem event'lerine de reaction olabilir)
```

**Yeni tablo (mention audit + bildirim üretimi için):**
```
CaseMention
─────────────────────────────────────────────────
id           String   @id @default(cuid())
caseId       String
sourceType   ENUM     note | comment_reply
sourceId     String   (CaseNote.id)
mentionedUserId  String  FK → User.id
mentionedBy  String   FK → User.id
seenAt       DateTime?
createdAt    DateTime
```

### UI davranışı
- Feed üstte filtre chip'leri (mevcut Activity tab'ında olan): Hepsi / Statü / Atama / Dosya / Not / Çağrı / Alan / Kontrol. Aynı renk paleti.
- Notlar feed satırında "comment" formunda — avatar + ad + tarih + içerik + reaction satırı.
- Reply: not satırında "↳ Yanıtla" → 1 seviye nested reply (Slack thread değil, daha sade).
- @mention:
  - Yazarken `@` → autocomplete (watcher'lar + yetki sahipleri öncelikli)
  - Mention'lı yayınlanan not → mentioned user otomatik watcher (rule), bildirim alır.
  - Feed'de mention etiketi mavi pill.
- Reaction: 4 emoji sabit — 👀 (gördüm) · ✅ (tamam) · ⚠️ (dikkat) · ❓ (soru). Her event'in altında küçük emoji barı.
- Yazma alanı feed'in altında sabit (Slack pattern) — visibility toggle (Internal/Customer-visible).
- Ses kaydı butonu mevcut VoiceNoteButton entegre.

### AI katkısı (Scribe rolü)
- 10+ event olan vakada üst kısımda **"Live Özet"** card — son 24h olayların 2 cümlelik özeti (1h cache).
- "Devralacağım" butonu → handoff brief: vakanın durumu, kalan iş, dikkat edilecek 3 madde.
- Reaction trendlerinden anlam çıkarma (örn. çok ⚠️ → Risk Lens skoru artar).

---

## 5. AI Rolleri — 6 Asistan

Her AI işlevi tek bir promptla değil, **rol** olarak tanımlanır. Kullanıcı hangi yardımı aldığını bilir; rol bazlı ayar yapabilir (örn. "Watchman'i sustur").

### 5.1 Triage (mevcut, korunuyor)
**Görev:** Yeni vaka açılırken kategori, alt kategori, öncelik, talep türü önerisi.
**Tetik:** Açıklama 20+ karakter, 1.2sn debounce.
**Çıktı:** RunaAiCard, "Uygula/Yoksay".
**Mevcut endpoint:** `/api/ai/suggest-category` (strict JSON Schema, enum kilitli).
**Yeni katkı:** caseType + requestType + suggestedTitle (başlık önerisi).

### 5.2 Detective (yeni)
**Görev:** Linked cases + watcher önerileri + müşteri geçmiş bağlamı.
**Tetik:** Vaka açıldıktan sonra arka planda (5sn delay) + müşteri seçildiğinde.
**Çıktı:** Sağ panelde "🕵 Detective" kartı:
- "Bu müşterinin son 90 günde 3 benzer vakası var" → linkler
- "Bu kategori için en aktif kişi: X (12 çözüm, son 30 gün)"
- "CSM'i: Y — watcher olarak eklemek ister misin?"
**Veri kaynağı:** caseRepository similarity query + AI semantic re-rank.

### 5.3 Scribe (yeni)
**Görev:** Vaka feed'i için canlı özet + handoff brief.
**Tetik:** 10+ event biriktiğinde otomatik, "Devralacağım" tıklandığında manuel.
**Çıktı:**
- **Özet:** "3 gündür açık. Müşteri 2 kez aradı, ödeme sorunu. Backoffice cevap bekliyor (Jira BUS-123)."
- **Handoff brief:** "Şu anki sahip: A. Sıradaki adım: B'den onay. Risk: SLA 12 saat kaldı."
- Cache 1 saat.

### 5.4 Coach (yeni)
**Görev:** "Sıradaki aksiyon ne?" — kullanıcıya bağlama göre öneri.
**Tetik:** Vaka detayına girildiğinde sağ panelde mini kart.
**Çıktı:**
- "Çözüldü'ye geçmek için checklist'te 2 madde kaldı."
- "Bu müşteriyi en son 7 gün önce aradın. Tekrar arama önerilir."
- "Benzer vakalar genelde 'Çözüm önerisi: X' ile kapanmış." → çözüm taslağı tetikler.
**Çıktı format:** Tek cümle + tek aksiyon butonu.

### 5.5 Watchman (yeni)
**Görev:** Durmuş vaka nudge + pattern detection (anomali).
**Tetik:** Cron (saatlik) — son 4 saatte hareket olmayan vakalar.
**Çıktı:**
- Vaka feed'ine sistem mesajı: "Bu vaka 18 saattir hareketsiz. Atanan: X. Hatırlatma gönder?"
- Watchers'a digest mailde "3 vakanız 24 saat hareketsiz".
- Pattern detection: "Bu hafta 'POS bağlanmıyor' kategorisinde %40 artış var" → admin/supervisor bildirimi.

### 5.6 Risk Lens (yeni)
**Görev:** SLA + churn + eskalasyon olasılığı tek skor.
**Tetik:** Her vaka kaydında arka planda hesap.
**Çıktı:** Header'da renkli pill — Yeşil/Sarı/Kırmızı + tooltip detayı:
- SLA kalan süre %
- Müşteri sentiment trendi
- Geçmiş eskalasyon sayısı
- Watcher reactions (⚠️ sayısı)
- Combine → tek skor 0-100.
**Eylem:** Score 75+ ise Coach + Watchman tetiklenir; supervisor bildirimi.

### Ortak altyapı
- `AISuggestion` tablosu (mevcut) tüm rollerin önerilerini kaydeder.
- Her öneride accepted/rejected feedback → AI iyileştirme.
- Rol başına on/off + sıklık ayarı CompanySettings'de.

---

## 6. Bildirim Sistemi

### Amaç
Mevcut: bildirim yok denecek kadar az (sadece toast). Yeni sistem: **doğru kişiye, doğru kanalda, doğru zamanda** — gürültüye girmeden, kaçırmadan.

### Veri modeli (mevcut tabloyla beraber)

```
CaseNotification (mevcut, genişletilecek)
─────────────────────────────────────────────────
id, caseId, eventType, channel, recipient, sentAt, readAt
+ priority         ENUM   info | warning | critical
+ deepLink         String  /cases/:id?focus=event-:activityId
+ batchId          String?  (digest grouplaması için)
+ openedAt         DateTime?
+ actionedAt       DateTime?  (kullanıcı CTA tıkladıysa)
```

### Badge count kuralları
Sidebar'da "Vakalar" yanında badge:
- **Critical-only mod:** Yalnızca SLA ihlal + eskalasyon + supervisor onay bekleyen sayım.
- **All-unread:** Watcher olduğun + mention edildiğin + atandığın tüm okunmamışlar.
- Default: All-unread mode.
- 99+ üstü "99+" gösterir, tooltip detay.

### Deep link
Bildirimden tıklayınca:
- Vakaya gider
- Doğru tab açar (mention → Notlar tab; SLA → Detay tab; dosya → Dosyalar tab)
- İlgili event scroll-into-view + 2 sn highlight pulse.

### Kanal matrisi
| Olay | Mesai içi | Mesai dışı |
|---|---|---|
| Mention (sana) | In-app + Mail (instant) | In-app + SMS (sadece supervisor için) |
| Atama | In-app + Mail | In-app (mail sabaha) |
| SLA %80 | In-app | In-app |
| SLA İhlali | In-app + Mail + (supervisor için SMS) | Hepsi |
| Eskalasyon | In-app + Mail | In-app + SMS (supervisor only) |
| Supervisor onay bekliyor | In-app + Mail (instant) | In-app (sabaha mail) |
| Watcher digest | Mail (saat 09:00) | yok |
| Watchman nudge | In-app | yok |
| AI önerisi | In-app | yok |

Mesai saatleri CompanySettings'de tanımlanır (default 09:00-18:00 Pazartesi-Cuma).

### Self-reminder
Vaka detay header'ında **"Bana Hatırlat"** butonu:
- "1 saat sonra", "Yarın 09:00", "Pazartesi", "Özel tarih"
- Hatırlatma anında in-app bildirim + opsiyonel mail.
- `CaseReminder` tablosu (caseId, userId, remindAt, message, sentAt).

### Bildirim merkezi UI
- Header sağda 🔔 ikon + badge.
- Tıklayınca dropdown — son 20, "Hepsini görüldü işaretle", "Ayarlar".
- Ayarlarda: kanal toggle, sessize alma saati, kategori bazlı opt-out.

### Sağlayıcı
- **Mail:** Resend (Vercel native, Türkçe karakter sorunsuz)
- **SMS:** Twilio veya Türk operatör API'si — kararlandığında
- **In-app:** WebSocket yerine 30sn polling (FAZ başlangıç) → 2.0 sonrası WebSocket.

---

## 7. Sub-tasks — Alt Görevler

### Amaç
Bir vaka birden çok atomic adımla çözülür ("müşteriyi ara → cihaz değişimi planla → kurulum sonrası test"). Bu adımları **tek vaka içinde** takip edebilmek (ayrı vaka açmadan), zorunlu adımları kapatma şartı yapmak.

### Veri modeli

```
CaseSubTask
─────────────────────────────────────────────────
id              String   @id @default(cuid())
caseId          String   FK → Case.id (cascade)
title           String
description     String?
status          ENUM     todo | in_progress | done | cancelled
required        Boolean  default false  (zorunlu mu — kapamayı bloklar)
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
- Vaka detay içinde yeni section: **"Alt Görevler (3/5)"** — progress bar.
- Her satır: checkbox + başlık + atama avatar + due date + drag handle (sıralama).
- "+ Alt Görev" → inline ekleme; "Detay" tıklanınca sağ slide-over.
- Tamamlanan tasklar üstü çizgili gri.
- Status `done` olunca feed'e event yazılır + atanan kişiye bildirim.
- Vaka **Çözüldü**'ye geçişte: tüm `required: true` task'lar `done` olmalı, aksi halde geçiş bloklanır (StatusTransitionPanel'de uyarı).
- Sub-task atanan kişi otomatik watcher.
- Template support: kategori bazında varsayılan sub-task seti (örn. "POS Sorunu" → 4 sub-task pre-fill).

### AI katkısı (Coach rolü)
- Vaka açılışında AI önceki çözümlerinden ortalama 3-5 alt görev önerir.
- Sıradaki sub-task'ı `due` tarihe göre Coach sürekli vurgular.

---

## 8. Sentiment Analysis — Müşteri Tonu

### Amaç
Vaka süresince müşterinin notları/yazışmalarını AI sürekli analiz ederek **tonu izler**. Tonun bozulması erken sinyal — supervisor müdahalesi ya da öncelik artırımı tetikler.

### Veri modeli

```
CaseSentimentSnapshot
─────────────────────────────────────────────────
id           String   @id @default(cuid())
caseId       String   FK → Case.id (cascade)
sentiment    ENUM     positive | neutral | negative | angry
score        Float    -1.0 ... +1.0  (negatif = öfkeli, pozitif = memnun)
sourceType   ENUM     note | call_log | chat
sourceId     String
analyzedAt   DateTime
notes        String?  (AI'ın gerekçesi — short)

@@index([caseId, analyzedAt])
```

`Case` tablosuna eklenecek özet alanlar (denormalized):
- `currentSentiment` (en son snapshot)
- `sentimentTrend` ENUM `improving | stable | worsening`

### UI davranışı
- Vaka detay header'ında küçük yüz ikonu — pozitif (😊 yeşil), nötr (😐 gri), negatif (😟 amber), öfkeli (😡 kırmızı).
- Tooltip: "Son 3 yazışmadan: 1 öfkeli, 2 negatif. Trend: kötüleşiyor."
- Sağ panelde sentiment timeline (sparkline) — son 7 mesaj.
- Trend `worsening` ise üstte amber banner: "Müşteri tonunda kötüleşme — supervisor önerilir."

### AI katkısı
- Her yeni `CaseNote` (visibility=Customer veya call_log) AI'a gider:
  - Score: -1.0 (çok öfkeli) ... +1.0 (çok memnun)
  - Etiket: positive/neutral/negative/angry
- Türkçe prompt → spesifik kalıplar tanır ("hizmetinizden memnun değilim", "iptal etmek istiyorum", "avukatımla görüşürüm", "teşekkür ederim").
- Score Risk Lens'e feed olur (sentiment kötü → risk skoru artar).
- Snapshot'lar saklanır → patternler analiz edilebilir.

---

## 9. Eksik Bilgi Tespiti

### Amaç
Ajan vaka açarken her zaman tam bilgi alamaz; bazı kategoriler kritik bilgi gerektirir ("POS sorunu" → cihaz seri no, hata kodu). AI **eksik bilgileri tespit eder** ve UI'da "şunlar eksik" uyarısı gösterir → vakanın yanlış takıma savrulması, geri dönüşler azalır.

### Veri modeli

```
CategoryRequiredInfo
─────────────────────────────────────────────────
id            String   @id @default(cuid())
companyId     String   FK → Company.id
categoryId    String?  FK → CategoryDef.id  (kategoriye özel)
subCategoryId String?  FK → CategoryDef.id  (daha spesifik)
caseType      CaseType?
fields        Json     [{ key, label, hint, severity: critical|recommended }]
createdAt     DateTime
updatedAt     DateTime

@@index([companyId, categoryId, subCategoryId])
```

`fields` içinde örnek:
```json
[
  { "key": "device_serial", "label": "Cihaz Seri No", "hint": "Cihazın altında etiketli", "severity": "critical" },
  { "key": "error_code", "label": "Hata Kodu", "hint": "Ekrandaki E-XXX kodu", "severity": "recommended" }
]
```

### UI davranışı
- Vaka açma formunda kategori seçilince → eksik alan uyarısı kart belirir:
  - "Bu kategori için şu bilgiler genellikle gerekli: Cihaz Seri No, Hata Kodu"
  - Kullanıcı doldurmazsa engellenmez ama submit'te warning + "Yine de aç" override.
- Vaka detay üstünde: "⚠️ Eksik Bilgi (2)" rozeti — tıklayınca eksik alanlar listesi.
- Eksik alanlar **Custom Field** olarak yapılandırılabilir → existing FieldDefinition tablosu ile bağ.

### Admin yönetimi
- /admin altında yeni ekran: **"Kategori Bilgi Şablonları"** — şirket × kategori × alt kategori için zorunlu/önerilen alan kümesi.

### AI katkısı
- AI, açıklama metnini parse ederek "bu açıklamada cihaz seri no geçmiyor" tespit eder.
- AI, eksik alanlar için müşteriye sorulacak soru taslağı önerir ("Müşteriye 'Cihazın altındaki seri numarayı söyleyebilir misiniz?' diye sor" — ajan kopyalayıp kullanır).

---

## 10. AI Entegrasyon Yönetimi — Tenant-Level

### Amaç
Şu an OpenAI key tüm sistem için ortak. Multi-tenant'da her şirketin **kendi AI bütçesi**, sağlayıcısı, modeli olabilmeli — bazıları Anthropic kullanmak isteyebilir, bazıları aylık 10K token sınırı koymak isteyebilir, bazıları AI'ı tamamen kapatmak isteyebilir.

### Veri modeli — CompanySettings genişlemesi

```
CompanySettings (mevcut, alanlar eklenir)
─────────────────────────────────────────────────
... mevcut alanlar (logoUrl, primaryColor, appName, supportEmail) ...
+ aiProvider          ENUM   openai | anthropic | none  (default openai)
+ aiApiKey            String?  (encrypted at rest)
+ aiModel             String?  (örn. "gpt-4o-mini" / "claude-haiku-4-5")
+ aiEnabled           Boolean  default true
+ aiMonthlyTokenLimit Int?    (null = sınırsız)
+ aiMonthlyTokensUsed Int     default 0  (her ayın 1'inde sıfırlanır)
+ aiLastResetAt       DateTime?
```

**Token usage tracking:**
```
AITokenUsage
─────────────────────────────────────────────────
id           String   @id @default(cuid())
companyId    String   FK
endpoint     String   suggest-category | draft-resolution | ...
inputTokens  Int
outputTokens Int
totalCost    Float    (USD; provider'dan gelen)
usedAt       DateTime
caseId       String?  (varsa)

@@index([companyId, usedAt])
```

### UI davranışı (AdminCompanySettings genişlemesi)
- Şirket Ayarları sayfasına yeni section: **"AI Entegrasyonu"**:
  - Sağlayıcı dropdown: OpenAI / Anthropic / Kapalı
  - API Key input (masked, show toggle)
  - Model dropdown (sağlayıcıya göre filtreli liste)
  - Aylık token limiti input + "Sınırsız" toggle
  - Bu ayki kullanım: progress bar + token + tahmini $ maliyet
  - "Test Et" butonu → suggest-category dummy çağrısı, key doğrulanır.
- BFF her AI çağrısı öncesi:
  1. Vakanın companyId'sinden CompanySettings çek.
  2. `aiEnabled=false` → AI özelliği kapalı, UI'da "AI bu şirkette kapalı" mesajı.
  3. `aiMonthlyTokensUsed >= aiMonthlyTokenLimit` → 429 + "Aylık limit doldu, admin'e başvur".
  4. `aiApiKey` varsa onu kullan; yoksa global default'a düş.
  5. Çağrı sonrası `AITokenUsage` kaydı + `aiMonthlyTokensUsed` increment.

### Güvenlik
- `aiApiKey` DB'de symmetric encryption (Supabase Vault veya app-level AES-256).
- Service role only — frontend asla görmez (admin'in masked input'unda).
- Audit log her key değişikliğinde.

### AI katkısı
- Pattern detection: "Bu ay X şirketinde token kullanımı %200 arttı, supervisor'a bildirim."
- AI, kendi maliyetini takip eder; pahalı çağrıları cache'ler (suggest-category 5dk cache).

---

## Implementasyon sırası (öneri)

| # | Madde | Bağımlılık | Tahmini efor |
|---|---|---|---|
| 1 | Watchers/CC | yok | 2 gün |
| 2 | Linked Cases | yok | 2 gün |
| 3 | Eksik Bilgi Tespiti | CategoryRequiredInfo | 1.5 gün |
| 4 | Bildirim Sistemi (in-app + Resend mail) | Watchers/CC | 3 gün |
| 5 | Case Feed (mention + reaction) | Watchers/CC + Bildirim | 2 gün |
| 6 | AI rolleri — Detective + Risk Lens | Watchers + Linked + DB | 2 gün |
| 7 | Sentiment Analysis | AI altyapı | 1.5 gün |
| 8 | Sub-tasks | yok | 1.5 gün |
| 9 | AI rolleri — Scribe + Coach + Watchman | tüm collab altyapısı | 2 gün |
| 10 | AI Entegrasyon Yönetimi (per-tenant) | CompanySettings | 2 gün |

**Toplam:** ~20 iş günü odaklı çalışma. Aşamalı ship — her madde kendi başına demo edilebilir.

---

## Açık karar noktaları

| Konu | Soru | Karar bekleyen |
|---|---|---|
| WebSocket vs polling | In-app bildirim için 30sn polling yeterli mi, WebSocket mi? | Sen + ürün |
| Mail sağlayıcı | Resend mi, başka? | Sen |
| SMS sağlayıcı | Twilio / NetGSM / İletimerkezi? | Sen |
| Sentiment cache | Her not için AI çağrısı pahalı mı? Batch mi? | Sen + maliyet |
| Tenant AI key encryption | Supabase Vault mı, app-level KMS mi? | Güvenlik |
| Watcher digest saati | Sabit 09:00 mı, kullanıcı tercih mi? | UX |
| Risk Lens skoru | Sabit ağırlıklar mı, ML mi? | İlk versiyon sabit |

---

**Versiyon:** 1.0 — Mayıs 2026
**Bu doküman değiştiğinde:** PRODUCT_SPEC.md'ye referans güncellenmeli.
