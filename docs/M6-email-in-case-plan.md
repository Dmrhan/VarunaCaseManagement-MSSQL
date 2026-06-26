# M6 — Vaka İçi E-Posta İstemcisi (Plan — FİNAL)

> **Statü**: **PLAN FİNAL** (kod yok, 7 karar kilitli)
> **Hazırlık tarihi**: 2026-06-26 (ilk plan) · finalize 2026-06-26
> **Bağımlı milestone'lar**: M1 (send) · M2/M2.1 (intake) · M2.2/M2.3 (match) · M3 (IMAP) · M4 (dispatch + threading) · M5 (per-tenant config) — **hepsi prod'da** (release #205, 2026-06-25)
> **Kapsam**: Case Detail içinde **İletişim** sekmesi (görünen ad "İletişim", tab key `'communication'`). Vaka kapanana kadar gelen + giden + otomatik mailleri TEK thread; agent vaka içinden mail yaz/gönder. Composer: From dropdown (çoklu adres) / To/Cc/Bcc, rich-text (TipTap), ek, imza.

---

## 0. Temel İlke — n4b Paritesi

> Memory: `feedback_n4b_email_parity.md`

**next4biz (n4b) PARİTESİ** — n4b'de ne varsa AYNEN; sadeleştirme/ekleme/çıkarma yapma. Belirsiz davranış n4b'den teyit edilir (kullanıcı n4b doğruluk kaynağı). Destek ekibinin alışkanlığı bozulmaz.

Aşağıdaki **Kararlar (final)** bölümü 7 kararın **kilitlenmiş hâlidir**. K3 altında tek açık alt-soru (`K3-link`) var; implementation öncesi kullanıcı n4b davranışını teyit edecek.

---

## 1. Kararlar (final — 7 madde kilitli)

| # | Karar | Sonuç |
|---|-------|-------|
| **K1** | **From** | **ÇOKLU adres (dropdown)**. M5'i `ExternalMailSetting.fromAddress` (tek) → **çoklu mailbox/alias'a genişlet**. Dropdown bunu besler. |
| **K2** | **İç/dış toggle** | **YOK**. Composer SADECE müşteriye gönderim (visibility='Customer' sabit). İç yorum/iletişim **Notlar sekmesinde** kalır (mevcut NotesTab Internal/Customer paterni dokunulmaz). |
| **K3** | **Kapalı vakaya müşteri yanıtı** | **YENİ TICKET** (mevcuda iliştirme YAPMA). Mevcut M2.1 davranışı OVERRIDE edilir. Yeni kural: inbound thread-match → vaka **Açık/İncelemede/3rdParty/Eskalasyon/YenidenAcildi** ise iliştir; **Çözüldü/İptal Edildi** (terminal) ise **YENİ vaka aç**. |
| **K3-link** | **Yeni ticket eski ticket'a link'lensin mi?** | **ÖNERİ: EVET** (önceki-ticket referansı). **AÇIK** — n4b'den teyit edilecek; cevap geldikten sonra `Case.parentCaseId` (veya benzer FK) konur. |
| **K4** | **İletişim takip alanları** | **EKLE (M6.1 migration)**: `Case.lastEmailInboundAt` + `Case.lastEmailOutboundAt` + `Case.pendingCustomerReply Boolean @default(false)`. Müşteri yanıt bekliyor = en son inbound var VE sonrasında outbound yok. |
| **K5** | **Tab adı / kapsam** | Tab key `'communication'`, görünen ad **"İletişim"**. **ÇOK-KANAL iskelet**: alt-bölümler Web · E-Posta · SMS · Gelen Aramalar. Şimdilik E-Posta dolu, diğerleri **placeholder** (boş state, "yakında" rozeti). |
| **K6** | **Yanıtla** | **REPLY-ALL**. To = (orijinal inbound'un From) + (önceki To); Cc = (önceki Cc). Bizim agent adresimiz To/Cc'den filtrelenir (dup engelleme). |
| **K7** | **Editor** | **TipTap** (kilit). MIT, ~50-80KB gz, React-native, mention extension olgun. Toolbar yetenekleri (bold/italic/underline/list/link/quote/image-url) + **sanitize-html** korunur (in/out iki yön). |

### K3 — açık alt-soru: `K3-link`

Mevcut kapalı vakaya `[VK-]` tokenlı müşteri yanıtı gelirse → **yeni vaka açılır** (kilitli). Yeni vakanın eskisine **referansı/link'i** olmalı mı?

- **Önerimiz**: EVET (`Case.parentCaseId String?` + UI'da "Önceki vaka: VK-XXX" rozeti)
- **n4b'den teyit edilecek**:
  - n4b'de kapalı vakaya yanıt sonrası açılan yeni ticket eskisine link'li mi?
  - Link iki yönlü mü, tek yönlü mü (child→parent)?
  - "Önceki ticket" görsel olarak nerede?
  - Eskisinin durumu (Çözüldü/İptal) yeniden tetiklenir mi? (önerimiz: hayır)

> **Implementation öncesi M6.1 PR'ı bu cevabı bekler**. M6.1 model'de FK alanı opsiyonel olarak EKLEYECEĞİZ (geri-dönüşsüz refactor yapmayalım); UI/auto-link davranışı n4b cevabına göre sonradan açılır.

---

## 2. Ön-koşul: REUSE envanteri (KOD'DAN TEYİTLİ)

| Mevcut yapı | Konum | M6'da nasıl reuse | Teyit |
|---|---|---|---|
| Case Detail tab sistemi (`TabKey`) | `src/features/cases/CaseDetailPage.tsx:127-137` | Yeni `'communication'` tab | ✓ enum |
| Tab render bloğu | `CaseDetailPage.tsx:1090` (notes) | `{tab === 'communication' && <CommunicationTab ... />}` | ✓ |
| NotesTab composer + thread pattern | `src/features/cases/components/CaseNotes.tsx:678` | Thread UX deseni reuse; **K2: iç/dış toggle KOPYALANMAZ** (composer sadece outbound→customer) | ✓ |
| Mail intake → mevcut akış | `server/lib/inboundMailIntake.js:422` `caseRepository.addNote(...)` ve :495 `caseRepository.create(...)` | **Değişecek** — note yerine `CaseEmail` yazılacak + **K3 davranış override** | ⚠ migration + akış değişikliği |
| Outbound dispatch (M4) | `server/db/notificationRepository.js:948` `executeOutboundEmailDispatch` | Aynen; bizim composer **paralel** path → mailProvider.sendMail | ✓ |
| `mailProvider.sendMail` | `server/lib/mailProvider.js:207` | Agent gönderiminde direkt çağrı | ✓ |
| `[VK-xxx]` subject token | `notificationRepository.js:879` build · `inboundMailIntake.js:179` parse | M6 composer da aynı token uygular → round-trip | ✓ |
| M5 per-tenant from | `ExternalMailSetting.fromAddress` (`schema.prisma:373`) | **K1 ile genişler**: per-company çoklu alias modeli + composer dropdown | ⚠ M5-extension (M6.2 önce) |
| `caseRepository.addNote` server-authoritative | `server/db/caseRepository.js:2354` | Mail için **reuse değil** — yeni `caseEmailRepository.append` | (yeni) |
| CaseAttachment + upload whitelist | `server/lib/uploadWhitelist.js:86` `isAcceptedUpload`, `server/db/storage.js` | Mail eki için reuse — `CaseEmailAttachment` ayrı tablo | ✓ |
| MentionTextarea | `src/features/cases/components/MentionTextarea.tsx` | **K2 gereği composer'da YOK** (composer salt müşteriye); Notlar tab'ında kalır | ✓ |
| İletişim-override alanları | `schema.prisma:563-564` `AccountCompany.preferredResponseChannel/responseEmail`, `:1232-1235` `Case.communicationChannelOverride`, `:1256` `Case.customerContactEmail` | K6 reply-all + (yeni vaka) müşteri-adres prefill zinciri | ✓ alanlar VAR |
| AccountContact email | `schema.prisma:656` model, `:661` `email String?` | K6 reply-all expand + manuel ContactPicker | ✓ |
| `notify` toast | `caseService` apiFetch deseni | `caseEmailService` aynı patern | ✓ |
| Frontend WYSIWYG | yok (package.json'da tiptap/ckeditor/quill YOK) | **K7 kararı: TipTap** + sanitize-html — yeni dependency'ler | ⚠ yeni |

---

## 3. Mimari

```
Case Detail
└── tab="communication" (görünen: "İletişim")
    └── CommunicationTab
        ├── Üst sekme bar — çok-kanal iskelet (K5)
        │   ├── E-Posta      ← DOLU (M6.1-M6.3)
        │   ├── Web          ← placeholder ("Yakında")
        │   ├── SMS          ← placeholder
        │   └── Gelen Arama  ← placeholder (CallLogs tab'ı zaten var; bu link/önizleme olur)
        └── E-Posta panel
            ├── (üst) MailThread
            │   ├── ThreadHeader (Konu, katılımcılar, son aktivite, "Önceki vaka: VK-XXX" — K3-link onaylanırsa)
            │   ├── MailMessageCard × N (yön ikonu + from/to/cc/bcc + body + ekler + zaman + source rozeti)
            │   └── EmptyState
            └── (alt, sticky) MailComposer
                ├── From dropdown (K1 — çoklu alias)
                ├── To/Cc/Bcc — K6 reply-all prefill + ContactPicker manuel ekle
                ├── Subject — `[VK-]` token korunumlu
                ├── RichTextEditor (TipTap — K7)
                ├── AttachmentUploader (mevcut drag-drop reuse)
                ├── İmza preview (M6.2 tenant; M6.3 per-agent)
                └── Gönder — busy state, error toast
```

**Akış (K3 OVERRIDE dahil)**:

1. Mail gelir → IMAP polling (M3) → `inboundMailIntake.js`:
   - `[VK-xxx]` token / In-Reply-To match → vaka bulunur
   - **Vaka durumu kontrol** (K3 yeni davranış):
     - **Açık/İncelemede/3rdParty/Eskalasyon/YenidenAcildi** → mevcut vakaya `CaseEmail.appendInbound` (eski davranış sürer; eski-adı "addNote" akışı kaldırıldı)
     - **Çözüldü/İptal Edildi** (terminal) → **YENİ vaka aç** (`caseRepository.create`) + ilk inbound CaseEmail satırı + (K3-link onaylanırsa) `parentCaseId = eski.id`
2. Agent vaka içinden composer'da Yanıt → `caseEmailService.send` → backend `caseEmailSender.prepareOutgoing(draft)`:
   - K6 reply-all prefill — composer açılışında
   - K1 seçilen From alias
   - `[VK-]` subject token + Message-ID + In-Reply-To/References (son inbound CaseEmail)
   - HTML sanitize-html'den geçer
   - `mailProvider.sendMail({ from, to, cc, bcc, subject, html, text, attachments, headers })`
   - DB satırı: `direction='outbound', source='manual_send'`
   - K4 alanlar güncellenir: `Case.lastEmailOutboundAt = now`, `Case.pendingCustomerReply = false`
3. Otomatik notification (M4 `executeOutboundEmailDispatch`) Active+email tetiklendiğinde → mevcut `NotificationDispatch` akışına paralel CaseEmail satırı (`source='notification_dispatch'`) + dispatchId linkli + K4 güncelleme (`lastEmailOutboundAt`)
4. Müşteri yanıt verir → akış 1'e döner; vaka durumuna göre append veya yeni vaka.
5. K4 `pendingCustomerReply` türetimi: inbound olduğunda `true`, outbound olduğunda `false`. Composer "Gönder" → false; intake "Açık vakaya append" → true.

---

## 4. Veri modeli

### 4.1. Yeni `CaseEmail` modeli

```prisma
model CaseEmail {
  id        String   @id @default(cuid()) @db.NVarChar(450)
  caseId    String   @db.NVarChar(450)
  companyId String   @db.NVarChar(450)

  /// 'inbound' | 'outbound'
  direction String   @db.NVarChar(20)

  /// 'imap_intake' | 'manual_send' | 'notification_dispatch'
  source    String   @db.NVarChar(50)

  /// K1 — gönderici tek adres (RFC 5322 mailbox). Outbound'da seçilen
  /// FromAlias.address. Inbound'da parse edilmiş from.
  fromAddress String  @db.NVarChar(320)
  fromName    String? @db.NVarChar(Max)

  /// Alıcılar — JSON-as-string array ('[{"address":"...","name":"..."}]').
  /// K6 reply-all: outbound oluştururken composer prefill mantığıyla
  /// türetilir; persist edilen son hali burada saklanır.
  toAddresses  String  @db.NVarChar(Max)
  ccAddresses  String? @db.NVarChar(Max)
  bccAddresses String? @db.NVarChar(Max)

  subject String  @db.NVarChar(Max)
  bodyHtml String @db.NVarChar(Max)
  /// Düz metin türevi (search / preview / a11y).
  bodyText String? @db.NVarChar(Max)

  /// RFC 5322 Message-ID — `<...@host>` formatında. Outbound için üretilir,
  /// inbound için parse edilir. companyId + messageId @@unique → dedup.
  messageId String? @db.NVarChar(998)

  /// Threading (RFC 5322): bu mailin yanıt verdiği Message-ID.
  inReplyTo String? @db.NVarChar(998)

  /// References zinciri — boşluklu liste.
  refs      String? @db.NVarChar(Max)

  /// İlgili NotificationDispatch (source='notification_dispatch' için).
  dispatchId String? @db.NVarChar(450)

  /// K2 gereği composer her zaman 'Customer' yazar; field model'de KALIR
  /// (gelecek değişiklik için), default 'Customer'. Şu an kullanılan tek
  /// yer: inbound = 'Customer'. Notlar tab'ındaki Internal/Customer
  /// AYRI — CaseNote.visibility ile karışmaz.
  visibility String @default("Customer") @db.NVarChar(50)

  /// Agent gönderiminde Varuna user — audit.
  authorUserId String? @db.NVarChar(450)
  authorName   String? @db.NVarChar(Max)

  /// Telemetri / debug.
  rawSize Int?

  /// Envelope ham JSON-as-string (opsiyonel).
  headersJson String? @db.NVarChar(Max)

  sentAt     DateTime? // outbound
  receivedAt DateTime? // inbound
  createdAt  DateTime  @default(dbgenerated("sysutcdatetime()"))
  updatedAt  DateTime  @updatedAt

  case          Case                @relation(fields: [caseId], references: [id], onDelete: Cascade)
  company       Company             @relation(fields: [companyId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  author        User?               @relation("CaseEmailAuthor", fields: [authorUserId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  dispatch      NotificationDispatch? @relation(fields: [dispatchId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  attachments   CaseEmailAttachment[]

  @@unique([companyId, messageId])
  @@index([caseId, sentAt])
  @@index([caseId, receivedAt])
  @@index([caseId, createdAt])
  @@index([companyId, direction])
  @@index([dispatchId])
}
```

### 4.2. `CaseEmailAttachment` modeli

```prisma
model CaseEmailAttachment {
  id          String   @id @default(cuid()) @db.NVarChar(450)
  emailId     String   @db.NVarChar(450)
  storageKey  String   @db.NVarChar(Max)
  fileName    String   @db.NVarChar(Max)
  mimeType    String   @db.NVarChar(255)
  fileSize    Int
  contentId   String?  @db.NVarChar(Max) // cid: inline ref
  isInline    Boolean  @default(false)
  createdAt   DateTime @default(dbgenerated("sysutcdatetime()"))

  email CaseEmail @relation(fields: [emailId], references: [id], onDelete: Cascade)

  @@index([emailId])
}
```

### 4.3. `Case` model'e K4 + K3-link alanları (migration 16)

```prisma
model Case {
  // ... mevcut alanlar ...

  /// K4 — son inbound mail zamanı. UI: thread sort + "yanıt bekliyor" badge.
  lastEmailInboundAt   DateTime?
  /// K4 — son outbound mail zamanı.
  lastEmailOutboundAt  DateTime?
  /// K4 — müşteri yanıt bekliyor mu? Türetim:
  ///   inbound geldi → true; outbound gönderildi → false.
  /// Türetim caseEmailRepository.append* içinde set edilir; ayrıca
  /// caseRepository.transitionStatus terminal'e geçince false yapılır.
  pendingCustomerReply Boolean @default(false)

  /// K3-link (önerilen, AÇIK) — yeni ticket eskisini referans alır.
  /// Implementation öncesi n4b teyit; field hazır, UI ON/OFF n4b'ye göre.
  parentCaseId String? @db.NVarChar(450)
  parentCase   Case?   @relation("CaseParent", fields: [parentCaseId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  childCases   Case[]  @relation("CaseParent")

  @@index([pendingCustomerReply])
  @@index([parentCaseId])
}
```

### 4.4. M5 genişlemesi (K1) — `ExternalMailSettingFromAlias`

K1 gereği per-company çoklu mailbox/alias. Mevcut `ExternalMailSetting.fromAddress` **deprecate** edilmez ama default-alias işaretiyle korunur (geri dönük uyum).

```prisma
model ExternalMailSettingFromAlias {
  id          String  @id @default(cuid()) @db.NVarChar(450)
  settingId   String  @db.NVarChar(450)
  /// "Univera Destek <support@univera.com.tr>" gibi RFC 5322 mailbox.
  address     String  @db.NVarChar(Max)
  /// UI'da gözüken etiket — agent dropdown'da bunu görür ("Destek", "Satış").
  displayName String? @db.NVarChar(Max)
  /// Default alias işareti — composer açılışında ön-seçili.
  isDefault   Boolean @default(false)
  isActive    Boolean @default(true)
  sortOrder   Int     @default(0)

  setting ExternalMailSetting @relation(fields: [settingId], references: [id], onDelete: Cascade)

  @@index([settingId, isActive])
}
```

`ExternalMailSetting.fromAddress` davranışı:
- **M6.1 (read-only)**: dokunulmaz; mevcut single-from akışı sürer.
- **M5-extension PR (M6.2 öncesi)**: Migration ile mevcut `fromAddress` → karşılığında bir `FromAlias(isDefault=true)` satırı oluşturulur (backfill).
- **M6.2 composer**: dropdown sadece `FromAlias`'tan beslenir; `fromAddress` legacy fallback.

### 4.5. Migration sırası

| # | Migration | İçerik |
|---|-----------|--------|
| **16** | `_case_email` (M6.1) | CaseEmail + CaseEmailAttachment + Case'e K4 + K3-link alanları + index'ler |
| **17** | `_external_mail_from_alias` (M5-extension; M6.2 öncesi) | ExternalMailSettingFromAlias tablosu + backfill (mevcut `fromAddress` → default alias) |

Hepsi additive, breaking change yok.

---

## 5. Inbound intake — K3 OVERRIDE detayı

`server/lib/inboundMailIntake.js` mevcut akış (özet):
1. `[VK-]` token / In-Reply-To → vaka bul (yoksa yeni vaka aç)
2. `caseRepository.addNote(...)` ile not olarak ekle

**M6.1 yeni akış**:
1. `[VK-]` token / In-Reply-To → vaka bul
2. **Token bulundu** AND **vaka.status terminal değil** (`Çözüldü`, `İptalEdildi` HARİÇ) → `caseEmailRepository.appendInbound(caseId, ...)`
3. **Token bulundu** AND **vaka.status terminal** → **YENİ vaka aç** (`caseRepository.create`) + `parentCaseId = bulunan.id` (K3-link onaylanırsa) + ilk `caseEmailRepository.appendInbound(yeniCaseId, ...)`
4. **Token yok** → mevcut "yeni vaka" akışı (intake'in M2.3 learned sender + auto-link kısımları aynen)

**K4 yan-etkileri**:
- `appendInbound` çağrılırsa → `Case.lastEmailInboundAt = receivedAt`, `Case.pendingCustomerReply = true`
- `appendOutbound` çağrılırsa → `Case.lastEmailOutboundAt = sentAt`, `Case.pendingCustomerReply = false`

**Terminal tanımı** (sabit, types.ts'den): `Çözüldü`, `İptalEdildi`. `YenidenAcildi` terminal **değildir** → buna gelen yanıt mevcuda iliştirilir.

**M2.3 learned sender etkisi**: korunur. Sender→account eşlemesi durumdan bağımsız çalışır. Yeni vaka açılırsa o vakaya auto-link uygulanır.

**Smoke** (M6.1):
- (a) Açık vakaya `[VK-]` yanıt → CaseEmail append
- (b) Çözüldü vakaya `[VK-]` yanıt → YENİ vaka açıldı + parentCaseId set
- (c) İptal vakaya `[VK-]` yanıt → YENİ vaka açıldı
- (d) Token yok + bilinmeyen gönderen → mevcut M2 davranışı (yeni vaka, parentCaseId YOK)
- (e) M2.3 learned sender 25/25 yeşil kalır

---

## 6. Composer detayları (K1 + K6)

### 6.1. K1 — From dropdown
- Açılışta: `GET /api/external-mail/from-aliases?companyId=...` → `[{id, address, displayName, isDefault}, ...]`
- Default seçili: `isDefault=true` olan; yoksa ilk satır.
- Dropdown 1 satırsa otomatik gizli + seçili.
- `caseEmailSender.prepareOutgoing` seçilen alias'ı kullanır; mailProvider'a `from: alias.address` geçer.

### 6.2. K6 — Reply-All prefill

Composer "Yanıtla" tetiklendiğinde **son inbound** CaseEmail referans:
```
To  = uniq( [inbound.fromAddress] + parse(inbound.toAddresses) ) − tüm tenant From alias'larımız
Cc  = uniq( parse(inbound.ccAddresses) ) − tüm tenant From alias'larımız
Bcc = boş (agent manuel ekler)
Subject = inbound.subject zaten `[VK-]` token içerir; başına "Re: " yoksa eklenir
```

- "Tüm tenant From alias'larımız" filtresi: ExternalMailSettingFromAlias.address listesi. Bizim adreslere reply göndermeyiz (loop koruması).
- Agent isterse To/Cc'den isim silebilir (manuel düzenleme açık).
- ContactPicker manuel ekleme: AccountContact + Account email öneri (mevcut M5/M2 desenleri).

### 6.3. Subject token korunumu

`[VK-<caseNumber>]` korunur:
- Inbound subject `Re: [VK-ABC] foo` → reply subject `Re: [VK-ABC] foo` (zaten var, dokunma)
- Token yoksa (örn. yeni dış kanal yanıtı) → prepend `[VK-<caseNumber>] `

### 6.4. İmza

- M6.2 (basit): `ExternalMailSetting.signatureHtml` (yeni alan) — tenant-bazlı tek imza, composer açılışında append.
- M6.3 (gelişmiş): `User.signatureHtml` per-agent override; variables `{agentName}` `{agentRole}` `{companyName}`.

---

## 7. Rich-text editor (K7 — kilit: TipTap)

### 7.1. Paketler
- `@tiptap/react`
- `@tiptap/starter-kit` (paragraph, bold/italic/underline, lists, blockquote, code, heading, hard-break)
- `@tiptap/extension-link` (autolink + protocols: http/https/mailto)
- `@tiptap/extension-image` (M6.2'de hosted URL; M6.3'te cid)
- `sanitize-html` (hem outbound hem inbound HTML)

### 7.2. Toolbar (M6.2)
Bold · Italic · Underline · Strikethrough · Heading (H1-H3) · Ordered/Unordered list · Link · Blockquote · Code · Image (URL) · Horizontal rule · Undo/Redo

### 7.3. Sanitize (KRİTİK — iki yönde)

```js
// SAFE_TAGS, SAFE_ATTR, SAFE_SCHEMES — outbound + inbound aynı config
const SAFE_TAGS = ['p','br','strong','em','u','s','a','ul','ol','li','blockquote','pre','code',
                   'span','div','img','table','thead','tbody','tr','td','th','h1','h2','h3','hr'];
const SAFE_ATTR = {
  '*': ['style','class'],
  'a': ['href','title','target','rel'],
  'img': ['src','alt','width','height']
};
const SAFE_SCHEMES = ['http','https','mailto','cid'];
```

- Style attr — sadece allowlist (color, background, font-weight/style, text-decoration, margin, padding). Yasak: `position`, `behavior`, `expression`, `url(...)`.
- Script/iframe/form/object/embed yasak.
- Link `rel="noopener noreferrer"` zorla.
- `cid:` sadece `CaseEmailAttachment.contentId` ile eşleşene → diğeri silinir.
- Inbound HTML body'deki external `<img>` → M6.2'de gizle, "Resimleri göster" toggle.

---

## 8. REUSE haritası (özet)

| Reuse | Yeni |
|---|---|
| `CaseDetailPage.tsx` tab sistemi + TabButton | `<CommunicationTab>` + ChannelTabs (K5 iskelet) |
| `NotesTab` thread görsel paterni | composer/iç-dış toggle KOPYALANMAZ (K2) |
| `inboundMailIntake.js` parse/match/M2.3 learned sender | intake çıkışı: CaseEmail (K3 override dahil) |
| `mailProvider.sendMail` | composer send |
| `executeOutboundEmailDispatch` | paralel CaseEmail satırı (source='notification_dispatch') |
| `[VK-xxx]` subject token | composer build + intake parse |
| `In-Reply-To` / `References` | composer reply mod |
| M5 `ExternalMailSetting.fromAddress` | M5-extension ile `FromAlias` (K1) |
| `storage.saveObject` + `isAcceptedUpload` | mail eki upload |
| `caseService` apiFetch + toast | `caseEmailService` |
| `assertCaseInScope` | tüm CaseEmail route'larında |
| AccountContact.email + Account.email | ContactPicker veri kaynağı (K6 expand sonrası) |
| `Case.customerContactEmail` + `AccountCompany.responseEmail` | yeni vaka açılırsa (K3) müşteri-adres prefill zinciri |

---

## 9. Yeni parçalar (sorumluluk)

### Backend
| Dosya | Sorumluluk |
|---|---|
| `server/db/caseEmailRepository.js` (yeni) | `appendInbound`, `appendOutbound`, `list(caseId, ...)`, `get(id)`; K4 türetimi; dedup |
| `server/lib/caseEmailSender.js` (yeni) | Composer orkestrasyon: K1 from + K6 reply-all + subject token + Message-ID + In-Reply-To + sanitize + storage upload + `mailProvider.sendMail` |
| `server/lib/htmlSanitizer.js` (yeni) | sanitize-html config + iki yönlü kullanım |
| `server/routes/caseEmails.js` (yeni) | REST: `GET /api/cases/:id/emails`, `GET /api/cases/:id/emails/:emailId`, `POST /api/cases/:id/emails` (send), `GET /api/cases/:id/emails/:emailId/attachments/:fileId/raw`, `GET /api/contacts/suggest?accountId=...` |
| `server/routes/externalMailFromAliases.js` (yeni — M5-extension) | `GET /api/external-mail/from-aliases?companyId=...`, admin CRUD |
| `server/db/externalMailSettingRepository.js` (değişen) | FromAlias CRUD helper'ları + backfill |
| `server/lib/inboundMailIntake.js` (değişen) | K3 override + addNote→appendInbound |
| `server/db/notificationRepository.js` (değişen) | dispatch sonrası `appendOutbound({source:'notification_dispatch', dispatchId})` |
| `server/db/caseRepository.js` (değişen) | `transitionStatus` terminal'e geçince `pendingCustomerReply=false` |

### Frontend
| Dosya | Sorumluluk |
|---|---|
| `src/features/cases/components/CommunicationTab.tsx` | Tab container — kanal seçici + state |
| `src/features/cases/components/ChannelTabs.tsx` | K5 iskelet — Web/E-Posta/SMS/Gelen Arama |
| `src/features/cases/components/MailThread.tsx` | Mail listesi |
| `src/features/cases/components/MailMessageCard.tsx` | Tek mail + yön ikonu + source rozeti + sanitize HTML render |
| `src/features/cases/components/MailComposer.tsx` | K1 From dropdown + K6 reply-all + RichTextEditor + AttachmentUploader |
| `src/features/cases/components/ContactPicker.tsx` | To/Cc/Bcc combobox |
| `src/features/cases/components/RichTextEditor.tsx` | TipTap wrapper |
| `src/features/cases/components/ParentCaseBadge.tsx` | K3-link onaylanırsa "Önceki vaka: VK-XXX" rozeti |
| `src/services/caseEmailService.ts` | apiFetch wrapper'lar |
| `src/services/externalMailAliasService.ts` | From dropdown veri |

---

## 10. Faz planı

### M6.1 — Model + intake + read-only thread (foundation)

**Çıktı**: CaseEmail model + migration; intake K3 override; "İletişim" sekmesi (e-posta panel read-only); takip alanları (K4)

**Kapsam**:
- Prisma model: `CaseEmail` + `CaseEmailAttachment` + `Case.lastEmailInboundAt/lastEmailOutboundAt/pendingCustomerReply/parentCaseId` + migration `00000000000016_case_email`
- `caseEmailRepository.append*` + K4 türetimi
- `inboundMailIntake.js` taşıması + **K3 override** (terminal→yeni vaka, parentCaseId set)
- `notificationRepository.executeOutboundEmailDispatch` sonrası paralel CaseEmail
- `caseRepository.transitionStatus` terminal geçişinde `pendingCustomerReply=false`
- Backend route: `GET /api/cases/:id/emails` + raw attachment
- Frontend: TabKey'e `'communication'`, `<CommunicationTab>` + `<ChannelTabs>` (K5 iskelet — sadece E-Posta dolu), `<MailThread>` + `<MailMessageCard>` (sanitize-html ile read-only render)
- (K3-link onaylanırsa) `<ParentCaseBadge>` render

**Bağımlılık**: yok

**Tahmin**: 1 PR (orta-büyük)

**Smoke**:
- M6.1 fonksiyonel: CaseEmail satırı (3 source) + K3 override (a-d senaryo) + K4 türetim
- M2.3 learned sender 25/25 yeşil
- Phase D 8/8 yeşil
- mail:inbound + outbound regression
- **n4b parite check**: tab adı + thread render + parent-case rozeti

### M5-extension — FromAlias (M6.2 öncesi ara PR)

**Çıktı**: Per-company çoklu FromAlias; admin CRUD; mevcut `fromAddress` backfill

**Kapsam**:
- Prisma: `ExternalMailSettingFromAlias` + migration `00000000000017_external_mail_from_alias` + backfill
- Backend route: alias CRUD + GET liste
- Admin UI: alias yönetimi (mevcut `AdminExternalMailPage` genişler)

**Bağımlılık**: M5 prod'da (var)

**Tahmin**: 1 PR (küçük-orta)

**Smoke**:
- Backfill: mevcut tenant'ta fromAddress → 1 default alias
- M6.2 composer öncesi alias dropdown beslemesi hazır
- Mevcut mail send/dispatch regression yeşil

### M6.2 — Composer + send + ContactPicker + rich-text + ek + basit imza

**Çıktı**: Agent vaka içinden mail gönderir; TipTap rich-text; K1 From dropdown; K6 reply-all; sanitize-html; tenant imza

**Kapsam**:
- Dependency: `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-image`, `sanitize-html`
- `RichTextEditor` + toolbar + sanitize
- `MailComposer` — K1 From dropdown + K6 reply-all prefill + ContactPicker
- `caseEmailSender.js` orchestration
- `POST /api/cases/:id/emails` + scope guard
- `ExternalMailSetting.signatureHtml` alanı + composer append
- AttachmentUploader (mevcut drag-drop reuse)

**Bağımlılık**: M6.1 + M5-extension

**Tahmin**: 1-2 PR (composer UX + sender backend ayrı PR daha güvenli)

**Smoke**:
- Composer'dan mail gönder → DB + mailProvider (Ethereal probe)
- K6 reply-all: To/Cc doğru türetim; agent adresimiz filtreleniyor
- Subject `[VK-xxx]` korunuyor; In-Reply-To önceki inbound CaseEmail'a bağlı
- Round-trip: send → IMAP poll → reply → CaseEmail thread'de doğru sırada
- Sanitize: `<script>` filtreleniyor, `<b>` korunuyor
- AccountContact öneri listesi
- M2.3 + Phase D regression yeşil
- **n4b parite check**: composer layout + gönderilen mail HTML formatı n4b ile screenshot diff

### M6.3 — Yönetim: per-agent imza + şablon + iletişim takip UI + (opsiyonel) çok-kanal aktif placeholder geliştirmesi

**Çıktı**: Agent imzasını yönetir; hızlı yanıt şablonları; "yanıt bekliyor" rozeti list/board'da; inline CID görsel imza (opsiyonel)

**Kapsam**:
- `User.signatureHtml` + admin UI (per-user)
- `EmailTemplate` modeli (tenant-bazlı plain + variables) + composer "Şablon seç"
- Case list/board'da `pendingCustomerReply` rozeti + filter param
- Inline CID görsel imza (M6.2 hosted'ın yanında)

**Bağımlılık**: M6.2

**Tahmin**: 1-2 PR

**Smoke**:
- Per-agent imza override tenant'tan üstte
- Şablon seçim composer'a inject ediyor
- pendingCustomerReply UI rozeti
- **n4b parite check**: imza yönetimi + şablon seçim + "Yanıt bekliyor" rozeti

---

## 11. Güvenlik / gizlilik

| Kategori | Önlem |
|---|---|
| **PII (mail içerikleri)** | `CaseEmail.bodyHtml` PII içerebilir. **AI/analytics/RUNA payload'larına EKLENMEZ** (mevcut customerContact* kuralı genişler). RUNA commentary-only kuralı (memory: project_runa_ai_enrichment.md) korunur. |
| **Scope** | Tüm CaseEmail route'ları `assertCaseInScope(allowedCompanyIds)` üzerinden. companyId @@unique + scope assert → cross-tenant sızıntı imkânsız. |
| **XSS** | sanitize-html iki yönde (outbound agent input + inbound müşteri HTML). `dangerouslySetInnerHTML` daima sanitize edilmiş string'le. Script/iframe/form yasak. |
| **CID görsel** | `CaseEmailAttachment.contentId` allowlist; bilinmeyen CID `<img>` silinir. |
| **External image** | Inbound HTML body external `<img>` — M6.2'de gizle (tracking pixel önleme), agent "Resimleri göster" toggle. |
| **Workspace footer** | Workspace footer eklemiyor (M5'te yok). M6.3'te eklenirse: composer içine eklenmiş footer'ı algılayıp tekrar eklememe (marker guard). |
| **Threading bütünlüğü** | References zinciri korunur (intake parser + sender builder). |
| **Audit** | `CaseEmail.authorUserId` server-authoritative; actor-identity hardening (memory: project_actor_identity_hardening.md). Mock author kayıt YASAK. |
| **Dedup** | `@@unique([companyId, messageId])` + idempotent intake. |
| **Soft-archive** | Soft-archived vakada (memory: project_varuna_case_soft_archive.md) CaseEmail listesi read-only; write path 409. |

---

## 12. Riskler + faz-bazlı test stratejisi

### Riskler

| # | Risk | Mitigasyon |
|---|------|------------|
| R1 | **K3 prod inbound davranış değişikliği** — kapalı vakaya yanıtın yeni ticket açması destek ekibinde kafa karışıklığı yaratabilir | M6.1 deploy öncesi destek ekibine duyuru + (K3-link onaylanırsa) UI rozeti net. Roll-back: env flag `M6_K3_NEW_TICKET_ON_TERMINAL=false` → eski davranışa dön |
| R2 | **Thread bütünlüğü** — yeni ticket eskisine bağlıysa kullanıcı "neresi devam ediyor?" karışabilir | parentCaseId iki yönlü UI: eskisinde "Devam vaka: VK-Y", yenisinde "Önceki vaka: VK-X" |
| R3 | M2.3 learned sender + K3 etkileşimi | Yeni vakaya M2.3 auto-link uygulanır (engine durumdan bağımsız); smoke'la doğrula |
| R4 | Eski "not olarak mail" geçmişi thread'de yok | Cut-over kabul; "Vaka geçmişi (eski not)" toggle ile notlar görünür |
| R5 | XSS — sanitize edilmemiş HTML | sanitize-html zorunlu; sanitize smoke |
| R6 | Threading kopması — yanlış In-Reply-To | round-trip smoke (M6.2) |
| R7 | Bundle size (TipTap + sanitize-html) | Cap 120 KB gzip; aşılırsa lazy-load tab değişince |
| R8 | NotificationDispatch paralel satır çiftlenmesi | dispatchId @@unique partial / idempotent ekleme |
| R9 | K1 FromAlias backfill başarısız tenant'lar | Migration script idempotent + dry-run admin UI |
| R10 | K6 reply-all yanlış kişiye gönderim | "Tüm tenant From alias filtresi" + composer'da 4+ alıcı confirmation modal |
| R11 | Inbound external image tracking | Default gizle |
| R12 | K4 türetimi senkron olmazsa "yanıt bekliyor" yanlış kalır | `caseEmailRepository.append*` ATOMIC update (transaction) + transitionStatus terminal geçişi de set eder |

### Test stratejisi

**M6.1** (read-only + K3 + K4):
- `scripts/smoke-case-email-intake-k3.js` — 5 senaryo (açık append + 2 terminal yeni vaka + token yok + M2.3 etkileşim)
- `scripts/smoke-case-email-thread-render.js` — 3 source render
- `scripts/smoke-case-email-k4-derive.js` — pendingCustomerReply + lastEmail* türetim + transition reset
- Regression: M2.3 25/25 + Phase D 8/8 + mail:inbound 60/60

**M5-extension** (FromAlias):
- `scripts/smoke-from-alias-backfill.js` — backfill dry-run + idempotency
- mail send/dispatch regression yeşil

**M6.2** (composer):
- `scripts/smoke-case-email-send.js` — send → DB + mailProvider
- `scripts/smoke-case-email-reply-all.js` — K6 prefill (To/Cc + agent adres filtresi)
- `scripts/smoke-case-email-sanitize.js` — XSS testleri
- `scripts/smoke-case-email-roundtrip.js` — send → IMAP poll → reply → thread
- ContactPicker manuel + RFC 5322 validation
- Regression: önceki smoke'lar yeşil
- n4b parite check screenshot diff

**M6.3** (yönetim):
- `scripts/smoke-case-email-signature-resolve.js` — per-user > tenant fallback
- `scripts/smoke-case-email-template.js` — şablon seçim + variables
- `scripts/smoke-case-email-pending-badge.js` — list/board rozet

---

## Özet — neler değişti (finalize özeti)

| Bölüm | Değişiklik |
|-------|-----------|
| **0** | Yeni "Temel İlke — n4b Paritesi" bölümü |
| **1** | Eski "Açık Kararlar" → **"Kararlar (final)"** tablosu (K1-K7 kilit + K3-link açık alt-soru) |
| **3 Mimari** | K5 çok-kanal iskelet (Web/E-Posta/SMS/Gelen Arama); E-Posta dolu, diğerleri placeholder. Composer'dan iç/dış toggle kaldırıldı (K2) |
| **4 Veri modeli** | Case'e K4 alanları (`lastEmailInboundAt/lastEmailOutboundAt/pendingCustomerReply`) + K3-link `parentCaseId` (FK) + yeni `ExternalMailSettingFromAlias` (K1 multi-from) |
| **5 Inbound akış** | K3 OVERRIDE detayı: terminal → yeni vaka + parentCaseId; K4 yan-etkileri |
| **6 Composer** | K1 From dropdown + K6 reply-all prefill (agent adres filtresi); subject token korunumu |
| **7 Editor** | K7 TipTap kesinleşti; sanitize-html iki yönlü |
| **10 Faz planı** | **3 faz + 1 ara PR**: M6.1 → **M5-extension (FromAlias)** → M6.2 → M6.3 |
| **12 Riskler** | R1 (K3 davranış değişikliği) + R2 (thread bütünlüğü) + R9 (backfill) + R10 (reply-all yanlış kişi) + R12 (K4 senkronizasyon) eklendi |
| **K3-link** | TEK AÇIK ALT-SORU — n4b'den teyit edilecek; field hazır, UI/auto-link n4b cevabına göre |

---

## Sıradaki

1. **K3-link** sorusu kullanıcıdan teyit (n4b davranışı)
2. **M6.1 prompt'una** geç: CaseEmail model + K3 intake değişikliği + K4 alanları + İletişim sekmesi (read-only) — tek PR
3. M6.1 merged → **M5-extension PR** (FromAlias backfill)
4. M5-extension merged → **M6.2 prompt** (composer + send + reply-all + rich-text + sanitize + imza)
5. M6.2 merged → M6.3 yönetim katmanı
