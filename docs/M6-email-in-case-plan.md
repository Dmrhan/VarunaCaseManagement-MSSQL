# M6 — Vaka İçi E-Posta İstemcisi (Plan)

> **Statü**: PLAN (kod yok) — n4b parite revizyonu
> **Hazırlık tarihi**: 2026-06-26 (n4b parite revizyonu)
> **Bağımlı milestone'lar**: M1 (send) · M2/M2.1 (intake) · M2.2/M2.3 (match) · M3 (IMAP) · M4 (dispatch + threading) · M5 (per-tenant config) — **hepsi prod'da** (release #205, 2026-06-25)
> **Kapsam**: Case Detail içinde **İletişim/E-Posta** sekmesi. Vaka kapanana kadar gelen + giden + otomatik mailleri TEK thread olarak göster; agent vaka içinden mail yaz/gönder. Composer: From/To/Cc/Bcc, **rich-text**, ek, imza.

---

## 0. n4b Parite Kuralı (öncelikli)

> Memory: `feedback_n4b_email_parity.md` — next4biz'de ne varsa AYNEN; sadeleştirme/ekleme yapma; belirsizse SOR (kullanıcı n4b doğruluk kaynağı); destek ekibi alışkanlığı bozulmasın.

**Bu plan REVİZYON sonrası şu kurallara bağlı**:
1. Aşağıdaki **AÇIK KARARLAR** (K1–K7) artık "önerim + flag" değil; her biri **n4b davranışını bire-bir kopyalama sorusudur**. Cevap geldikten sonra plan o yönde sabitlenir.
2. Tasarım/UX kararları (visibility toggle var mı, From dropdown nasıl, footer çiftlenmesi nasıl önleniyor, vs.) **n4b davranışı + screenshot referansı** üzerinden onaylanır.
3. Plan'da "önerim" geçen yerler **n4b'de ne ise o** ile değişir; benim önerilerim sadece **default fallback** (n4b'de hiç olmayan yan-uç edge case'ler için).
4. Implementation sırasında her PR'da **n4b parite check** smoke'u: ekran-davranış kıyaslı.

**Kapsamı bozar mı?**: Hayır. M6.1 (model + read-only thread) ve M6.2 (composer + send) **n4b bağımsız temel altyapı** içerir; n4b davranış kararları yalnızca UI mikro-kararları (toggle pozisyonu, etiket dili, default visibility, vs.) ve K1-K7'yi etkiler.

**Belirsizlik kuralı**: n4b'de bir davranış belirsizse plan'da o noktaya `[N4B-SOR: ...]` etiketi konur; implementation öncesi cevap beklenir.

---

## 0. Ön-koşul: REUSE envanteri (KOD'DAN TEYİTLİ)

| Mevcut yapı | Konum | M6'da nasıl reuse | Teyit |
|---|---|---|---|
| Case Detail tab sistemi (`TabKey`) | `src/features/cases/CaseDetailPage.tsx:127-137` | Yeni `'communication'` tab | ✓ enum |
| Tab render bloğu | `CaseDetailPage.tsx:1090` (notes) | `{tab === 'communication' && <CommunicationTab ... />}` | ✓ |
| NotesTab composer + thread pattern | `src/features/cases/components/CaseNotes.tsx:678` | UX deseni reuse (composer üstte/altta + reply thread) | ✓ |
| Mail intake → mevcut akış | `server/lib/inboundMailIntake.js:422` `caseRepository.addNote(...)` ve :495 `caseRepository.create(...)` | **Değişecek** — note yerine `CaseEmail` yazılacak | ⚠ migration |
| Outbound dispatch (M4) | `server/db/notificationRepository.js:948` `executeOutboundEmailDispatch` | Aynen; bizim composer **paralel** path → mailProvider.sendMail | ✓ |
| `mailProvider.sendMail` | `server/lib/mailProvider.js:207` | Agent gönderiminde direkt çağrı | ✓ |
| `[VK-xxx]` subject token | `notificationRepository.js:879` build · `inboundMailIntake.js:179` parse | M6 composer da aynı token uygular → round-trip | ✓ |
| M5 per-tenant from | `ExternalMailSetting.fromAddress` (`schema.prisma:373`) | Composer From default: tenant fromAddress | ✓ (M6.1) |
| `caseRepository.addNote` server-authoritative | `server/db/caseRepository.js:2354` | Reply path için reuse **değil** — mail için yeni `caseEmailRepository.append` | (yeni) |
| CaseAttachment + upload whitelist | `server/lib/uploadWhitelist.js:86` `isAcceptedUpload`, `server/db/storage.js` | Mail eki için reuse — `kind: 'mail-attachment'` | ✓ |
| MentionTextarea | `src/features/cases/components/MentionTextarea.tsx` | İç-mail audience'sinde @mention dahil tutulabilir (kararla) | ✓ |
| İletişim-override alanları | `schema.prisma:563-564` `AccountCompany.preferredResponseChannel/responseEmail`, `schema.prisma:1232-1235` `Case.communicationChannelOverride`, `:1256` `Case.customerContactEmail` | Müşteri-adres fallback zinciri (aşağıda) | ✓ — **alanlar GERÇEKTEN VAR** |
| AccountContact email | `schema.prisma:656` model, `:661` `email String?` | ContactPicker'ın veri kaynağı | ✓ |
| `notify` toast | `caseService` apiFetch deseni | `caseEmailService` aynı patern | ✓ |
| Frontend WYSIWYG | yok (package.json'da tiptap/ckeditor/quill **YOK**) | **Yeni dependency** (TipTap önerisi — aşağıda) | ⚠ yeni |

---

## 1. Mimari

```
Case Detail
└── tab="communication"  ← yeni
    ├── CommunicationTab (sayfa)
    │   ├── (üst) MailThread
    │   │   ├── ThreadHeader   (Konu, katılımcılar, son aktivite)
    │   │   ├── MailMessageCard × N   (yön ikonu + from/to/cc/bcc + body + ekler + zaman)
    │   │   └── EmptyState
    │   └── (alt, sticky) MailComposer
    │       ├── ContactPicker (To/Cc/Bcc)
    │       ├── RichTextEditor (gövde, imza vurgulu)
    │       ├── AttachmentUploader (mevcut drag-drop reuse)
    │       ├── Templates / Quick Replies (M6.3)
    │       └── Send butonu — busy state, error toast
    └── (sağ) RightPanel (mevcut RUNA + summary, dokunulmaz)
```

**Akış**:
1. Mail gelir → IMAP polling (M3) → `inboundMailIntake.js` → **CaseEmail satırı** (eski: not).
2. Agent vaka içinden composer'da Yanıt → `caseEmailService.send` → backend `mailProvider.sendMail` (M5 per-tenant from + `[VK-]` token + In-Reply-To/References) → DB'ye `direction='outbound', source='manual_send'` CaseEmail satırı.
3. Otomatik notification (M4 `executeOutboundEmailDispatch`) Active+email tetiklendiğinde → mevcut `NotificationDispatch` akışına **paralel** bir CaseEmail satırı (`source='notification_dispatch'`) yazılır (dispatch'ın `providerMessageId`'siyle linklenir). Thread'de görünür.
4. Müşteri yanıt verir → `[VK-xxx]` token / In-Reply-To match → `inboundMailIntake` mevcut vakaya **CaseEmail** olarak append; M2.3 learned sender mantığı korunur.
5. Round-trip kapanır; agent yine yanıt yazar.

**Görünürlük matrisi** (`CaseEmail.visibility`):
- `Customer` — müşteriye gönderilen / müşteriden gelen
- `Internal` — iç-mail (agent-to-agent veya BCC notları)
- (default = `Customer`; intake = direction'a göre)

---

## 2. Veri modeli

### 2.1. Yeni `CaseEmail` modeli

```prisma
model CaseEmail {
  id        String   @id @default(cuid()) @db.NVarChar(450)
  caseId    String   @db.NVarChar(450)
  companyId String   @db.NVarChar(450)

  /// 'inbound' | 'outbound'
  direction String   @db.NVarChar(20)

  /// 'imap_intake' | 'manual_send' | 'notification_dispatch'
  source    String   @db.NVarChar(50)

  /// Gönderici tek adres (RFC 5322 mailbox).
  fromAddress String  @db.NVarChar(320)
  fromName    String? @db.NVarChar(Max)

  /// Alıcılar — adres array'i JSON-as-string ('[{"address":"...","name":"..."}]').
  /// MSSQL'de json native değil, string olarak tutarız (caseRepository.notes paterniyle aynı).
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

  /// References zinciri — boşluklu liste; intake parse / outbound build aynı.
  /// String tutulur (parsing app-layer).
  refs      String? @db.NVarChar(Max)

  /// İlgili NotificationDispatch (source='notification_dispatch' için);
  /// notification path'inin ikinci-kaynak ile uyumu (paralel kayıt).
  dispatchId String? @db.NVarChar(450)

  /// Visibility — 'Customer' | 'Internal'. Internal e-postalar müşteriye
  /// görünmez, customer roller listeden filtreler (gelecek müşteri portal'ı).
  visibility String @default("Customer") @db.NVarChar(50)

  /// Agent gönderiminde Varuna user — audit.
  authorUserId String? @db.NVarChar(450)
  authorName   String? @db.NVarChar(Max)

  /// IMAP polling sırasında her mail için stored raw size (telemetri / debug).
  rawSize Int?

  /// Mail metadata (envelope ham JSON-as-string — opsiyonel).
  headersJson String? @db.NVarChar(Max)

  sentAt     DateTime? // outbound: ne zaman gönderildi
  receivedAt DateTime? // inbound: ne zaman alındı / sunucu işledi
  createdAt  DateTime  @default(dbgenerated("sysutcdatetime()"))
  updatedAt  DateTime  @updatedAt

  case          Case                @relation(fields: [caseId], references: [id], onDelete: Cascade)
  company       Company             @relation(fields: [companyId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  author        User?               @relation("CaseEmailAuthor", fields: [authorUserId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  dispatch      NotificationDispatch? @relation(fields: [dispatchId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  attachments   CaseEmailAttachment[]

  /// Dedup — aynı tenant'ta aynı Message-ID tekrar gelirse yazılmaz.
  /// Inbound: IMAP retry idempotency. Outbound: yan-etkili double-send guard.
  @@unique([companyId, messageId])
  @@index([caseId, sentAt])
  @@index([caseId, receivedAt])
  @@index([caseId, createdAt])
  @@index([companyId, direction])
  @@index([dispatchId])
}
```

### 2.2. `CaseEmailAttachment` modeli

CaseAttachment'tan ayrı bir tablo — çünkü:
- mail eklerinin **inline / cid** semantiği var
- mail eki orijinal Content-ID korumalı
- inbound: müşteriden gelen, outbound: agent eklediği → yön bilgisi

```prisma
model CaseEmailAttachment {
  id          String   @id @default(cuid()) @db.NVarChar(450)
  emailId     String   @db.NVarChar(450)
  /// Ham dosya — storage.saveObject ile yazılır (M2.1 desenli).
  storageKey  String   @db.NVarChar(Max)
  fileName    String   @db.NVarChar(Max)
  mimeType    String   @db.NVarChar(255)
  fileSize    Int
  /// CID (inline görsel) — varsa 'cid:foo@bar' referansı bodyHtml içinde.
  contentId   String?  @db.NVarChar(Max)
  /// true = HTML body içinde inline kullanılıyor; false = ek olarak gönder.
  isInline    Boolean  @default(false)
  createdAt   DateTime @default(dbgenerated("sysutcdatetime()"))

  email CaseEmail @relation(fields: [emailId], references: [id], onDelete: Cascade)

  @@index([emailId])
}
```

> **Not**: `CaseAttachment` (Case-level "Dosyalar" sekmesi) ile **birleştirilmez**. Mail eki ayrı tutulur — UI'da "Dosyalar" sekmesinde ayrıca listeleme opsiyonel (M6.3).

### 2.3. Migration

**M6.1 migration** — `00000000000016_case_email`:
1. `CaseEmail` tablosu + index'ler + `@@unique([companyId, messageId])`
2. `CaseEmailAttachment` tablosu
3. `Case` modeline:
   - `lastEmailAt DateTime?` — thread'de son aktivite (sort/UI sinyali)
   - `pendingCustomerReply Boolean @default(false)` — "dönüş yapıldı mı" sinyali (M6.3 ayrıntı)
4. (Opsiyonel M6.3) `Case.communicationChannelOverride` zaten var → kullanılır

**Veri taşıma** — INBOUND mail intake'in eski not yazımı:
- Geriye dönük backfill **yok** — eski not'lar `kind='Email'` olarak değil, normal not olarak kaldıkları için "mail kaynaklı" olduğu schema'da işaretlenmedi.
- Cut-over: M6.1 deploy edildikten sonra **yeni** gelen mailler CaseEmail'a; eski mailler not olarak tarihte kalır.
- (Opsiyonel) Eski not'larda `[VK-]` token / sender pattern'ından tahminle backfill — **kapsam dışı**, kullanıcı isterse M6.4 olarak.

### 2.4. Intake taşıması (kritik)

`server/lib/inboundMailIntake.js`:
- Şu an `caseRepository.addNote(...)` çağrısı → CaseEmail.append(...) olur.
- `caseRepository.create(newCaseInput, actor)` yeni vaka açma yolu aynı (Case satırı oluşturur), ardından paralel olarak ilk inbound mail için CaseEmail satırı yazılır.
- M2.3 learned sender + auto-link bozulmaz — match engine intake'in dışında çalışır.
- Idempotency: `messageId` @@unique guard → IMAP poll retry'larında tekrar yazılmaz.

---

## 3. REUSE haritası (özet)

| Reuse | Yeni |
|---|---|
| `CaseDetailPage.tsx` tab sistemi + `TabButton` | `<CommunicationTab>` component + alt-componentler |
| `NotesTab` composer/thread görsel patternleri | rich-text editor (TipTap) |
| `inboundMailIntake.js` (parse/match/link mantığı) | intake çıkışı: CaseEmail (not değil) |
| `mailProvider.sendMail` (`server/lib/mailProvider.js:207`) | `caseEmailRepository.send(caseId, draft)` |
| `executeOutboundEmailDispatch` (`notificationRepository.js:948`) | dispatch sırasında CaseEmail paralel satır |
| `[VK-xxx]` subject token (build + parse) | composer subject pre-fill + token korunumu |
| `In-Reply-To` / `References` thread zinciri | composer reply mod — son inbound CaseEmail.messageId al |
| M5 `ExternalMailSetting.fromAddress` | Composer From default (tek mailbox — M6.3'te çoklu opsiyonu) |
| `storage.saveObject` + `isAcceptedUpload` | mail eki upload (CaseEmailAttachment) |
| `caseService` apiFetch + toast deseni | `caseEmailService` |
| Case için role guards (`assertCaseInScope*`) | tüm CaseEmail route'larında reuse |
| AccountContact.email + Account.email | ContactPicker veri kaynağı |

---

## 4. Yeni parçalar — sorumluluklar

### Backend
| Dosya | Sorumluluk |
|---|---|
| `server/db/caseEmailRepository.js` (yeni) | `appendInbound(...)`, `appendOutbound(...)`, `list(caseId, ...)`, `get(id)`, dedup, threading helper'ları |
| `server/lib/caseEmailSender.js` (yeni) | Composer'ın çağırdığı orkestrasyon: `prepareOutgoing(draft)` → subject token + Message-ID + In-Reply-To + sanitize HTML + ek'leri storage'a yaz → `mailProvider.sendMail` → DB satırı |
| `server/lib/htmlSanitizer.js` (yeni) | XSS sanitizasyon — sanitize-html lib reuse (dependency); outbound HTML body için zorunlu (XSS'i kendi gönderdiğimiz mail içinde de filtreleyelim — agent input). Inbound için zaten `inboundMailIntake` parse edilmiş gövdeyi alır; HTML body olarak render edilecekse aynı sanitizer'dan geçer |
| `server/routes/caseEmails.js` (yeni) | REST: `GET /api/cases/:id/emails`, `GET /api/cases/:id/emails/:emailId`, `POST /api/cases/:id/emails` (send), `GET /api/cases/:id/emails/:emailId/attachments/:fileId/raw`, `GET /api/contacts/suggest?accountId=...` (ContactPicker) |
| `server/lib/inboundMailIntake.js` (değişen) | addNote yerine `caseEmailRepository.appendInbound(...)`; M2.3 learned sender + auto-link mantığı korunur |
| `server/db/notificationRepository.js` (değişen) | `executeOutboundEmailDispatch` sonrası `caseEmailRepository.appendOutbound({ source: 'notification_dispatch', dispatchId })` — paralel kayıt |

### Frontend
| Dosya | Sorumluluk |
|---|---|
| `src/features/cases/components/CommunicationTab.tsx` (yeni) | Tab container — thread + composer + state mgmt |
| `src/features/cases/components/MailThread.tsx` (yeni) | Mail listesi — `MailMessageCard × N` + scroll + lazy load |
| `src/features/cases/components/MailMessageCard.tsx` (yeni) | Tek mail — yön ikonu (↓ inbound / ↑ outbound / ⚙ auto), from/to/cc/bcc, body (HTML render), ekler, zaman, source rozeti |
| `src/features/cases/components/MailComposer.tsx` (yeni) | Yanıt yaz: ContactPicker × 3 (To/Cc/Bcc), Subject, RichTextEditor, AttachmentUploader, Send/Draft/Discard |
| `src/features/cases/components/ContactPicker.tsx` (yeni) | Combobox: AccountContact.email öner + manuel entry (RFC 5322 mail validation) |
| `src/features/cases/components/RichTextEditor.tsx` (yeni) | TipTap wrapper — toolbar (bold/italic/link/list/quote) + paste-as-plain seçeneği + HTML export + sanitize-on-output |
| `src/services/caseEmailService.ts` (yeni) | apiFetch wrapper'ları + ContactPicker.suggest |

---

## 5. Rich-text editor: lib + entegrasyon + sanitizasyon

### 5.1. Kütüphane seçimi

**Öneri**: **TipTap** (`@tiptap/react` + `@tiptap/starter-kit` + opsiyonel `@tiptap/extension-link`, `@tiptap/extension-image`).

**Neden TipTap**:
| Kriter | TipTap | CKEditor | Quill | Lexical |
|---|---|---|---|---|
| Bundle (min+gz, core) | ~50–80KB | ~250KB+ | ~45KB | ~80KB |
| React integration native | ✓ | ✓ (wrapper) | (3rd party) | ✓ (Meta) |
| @mention extension | ✓ (mature) | ✓ | (3rd) | (custom) |
| MIT lisans | ✓ | LGPL/GPL | BSD | MIT |
| HTML serialize | ✓ | ✓ | (delta→HTML) | (JSON) |
| Sanitize-friendly | ✓ (ProseMirror schema) | ✓ | ⚠ | ✓ |
| Mevcut ecosystem (mention, link, image) | zengin | zengin | zayıf | erken |

CKEditor 5 bundle/lisans, Quill mention extension olgun değil, Lexical erken — TipTap dengeli.

**Bundle cap**: M6.2'de toplam delta < **120 KB gzip** (TipTap + starter-kit + link + sanitize-html'in browser tarafı). Aşılırsa `@tiptap/extension-image` opsiyonel.

### 5.2. Entegrasyon yaklaşımı

```tsx
// RichTextEditor.tsx (sketch)
<EditorProvider
  extensions={[StarterKit, Link.configure({ autolink: true, protocols: ['http','https','mailto'] })]}
  content={initialHtml}
  onUpdate={({ editor }) => onChange(editor.getHTML())}
>
  <Toolbar />
</EditorProvider>
```

- `getHTML()` → composer state.
- Submit'te sanitize → `sendMail({ html, text })`.
- `getText()` → plain-text fallback (mail gövdesinin `text/plain` parça).

### 5.3. Sanitizasyon (KRİTİK)

**`sanitize-html`** (npm, mature, conf-driven). Outbound + inbound render iki path'te:

```js
const SAFE_TAGS = ['p','br','strong','em','u','a','ul','ol','li','blockquote','pre','code','span','div','img','table','thead','tbody','tr','td','th'];
const SAFE_ATTR = { '*': ['style','class'], 'a': ['href','title','target','rel'], 'img': ['src','alt','width','height'] };
const SAFE_SCHEMES = ['http','https','mailto','cid'];

// outbound: agent input
htmlSanitize(composerHtml, { ... });
// inbound: müşteriden gelen
htmlSanitize(inboundHtmlBody, { ... });
```

**Style attr** — sadece allowlisted CSS prop'lar (color, background, font-weight, font-style, text-decoration, margin, padding). `position`, `behavior`, `expression` engellenir.

**Script / iframe / form** — kesin yasak.

**Link rel** — gönderilen ve render edilen tüm `<a>`'lara otomatik `rel="noopener noreferrer"`.

**cid:** image referansı sadece `CaseEmailAttachment.contentId` ile eşleşen ek'e dönüştürülür; aksi halde silinir.

### 5.4. HTML imza

**M6.2 (basit)**: Tenant-bazlı sabit imza — `ExternalMailSetting` modeline `signatureHtml String? @db.NVarChar(Max)` eklenir. Composer açılınca otomatik append edilir, agent silebilir.

**M6.3 (gelişmiş)**: Per-agent imza (`User.signatureHtml`) + tenant fallback. Variables: `{agentName}`, `{agentRole}`, `{companyName}`.

**Görsel imzalar**: ilk fazda **hosted** (URL'li `<img>`) — basit. CID/inline ileri faz (M6.3).

**Footer çiftlenmesi koruması**: Workspace'in default footer'ı varsa (M5'te yok ama gelebilir), composer içine gömüldüğünde "Workspace footer otomatik eklenmeyecek" guard'ı koyulmalı. Şu an risk yok.

---

## 6. Faz planı

### M6.1 — Read-only thread (foundation)
**Çıktı**: Case Detail'de "İletişim" sekmesi var; gelen + giden + dispatch mailler thread olarak görünür. Composer YOK.

**Kapsam**:
- Prisma model: `CaseEmail` + `CaseEmailAttachment` + migration
- `caseEmailRepository.append/list/get`
- `inboundMailIntake.js` taşıması: addNote → caseEmailRepository.appendInbound (M2.3 learned sender mantığı korunur)
- `notificationRepository.executeOutboundEmailDispatch` sonrası paralel CaseEmail satırı (source='notification_dispatch')
- Backend route: `GET /api/cases/:id/emails` + `/:emailId/attachments/:fileId/raw`
- Frontend `CommunicationTab` + `MailThread` + `MailMessageCard` (read-only HTML render + sanitize)
- TabKey enum'a `'communication'` ekle + TabButton

**Bağımlılık**: yok (mevcut M2-M5 üzerine)

**Tahmin**: 1 PR (orta-büyük)

**Smoke**:
- IMAP intake → CaseEmail satırı oluşuyor (eski `addNote` çağrısı yok)
- Notification dispatch → paralel CaseEmail satırı (dispatchId linkli)
- Thread UI tüm 3 source'u (`imap_intake`, `manual_send`, `notification_dispatch`) doğru render ediyor
- M2.3 learned sender 25/25 hala yeşil
- Phase D 8/8 hala yeşil
- **n4b parite check**: tab adı + thread render (mesaj başlığı / yön ikonu / zaman damgası / source rozeti) n4b ile bire-bir kıyas → screenshot diff

### M6.2 — Composer + send + rich-text + ek + basit imza
**Çıktı**: Agent vaka içinden mail yazıp gönderebiliyor; ek ve rich-text destekli; tenant-imza otomatik.

**Kapsam**:
- Yeni dependency: `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `sanitize-html`
- `RichTextEditor` + toolbar + sanitize
- `MailComposer` + `ContactPicker` (`/api/contacts/suggest?accountId=...`)
- `caseEmailSender.js` orchestration — subject token + Message-ID gen + In-Reply-To zinciri + sanitize + storage upload + `mailProvider.sendMail` çağrısı + DB CaseEmail satırı (source='manual_send')
- `POST /api/cases/:id/emails` route + scope guard (`assertCaseInScope`)
- `ExternalMailSetting.signatureHtml` alanı + composer append
- AttachmentUploader (mevcut drag-drop reuse)

**Bağımlılık**: M6.1

**Tahmin**: 1-2 PR (composer + sender ayrı PR daha güvenli — composer UX, sender backend)

**Smoke**:
- Composer'dan mail gönder → DB satırı + mail teslim (Ethereal probe)
- Subject token `[VK-xxx]` korunuyor; In-Reply-To önceki inbound CaseEmail'a bağlı
- Müşteri yanıt → IMAP intake → aynı thread'e ekleniyor
- Sanitize: `<script>alert(1)</script>` filtreleniyor, görsel `<b>kalın</b>` korunuyor
- AccountContact.email öneri listesi geliyor
- M2.3 + Phase D regression yeşil
- **n4b parite check**: composer (From/To/Cc/Bcc layout + toolbar + ek dropzone + Gönder butonu + imza yerleşimi) n4b ile screenshot diff
- **n4b parite check**: gönderilen mail subject/body/imza HTML formatı n4b'nin gönderdiği örnek bir maille kıyas

### M6.3 — Yönetim: per-agent imza · From dropdown · iletişim takip
**Çıktı**: Agent imzasını yönetir; tenant çoklu mailbox seçer; "dönüş yapıldı mı" sinyalleri ve şablonlar.

**Kapsam**:
- `User.signatureHtml` alanı + admin UI (per-user)
- (Açık karar) Çoklu mailbox: `ExternalMailSetting` → `ExternalMailSettingFromAlias` (1:N) — composer'da dropdown
- `Case.lastEmailAt` + `Case.pendingCustomerReply` (M6.1'de eklenip burada UI'da kullanılır):
  - Outbound CaseEmail → `pendingCustomerReply=true` + `lastEmailAt`
  - Inbound CaseEmail → `pendingCustomerReply=false`
  - List/board "dönüş bekleyen" filtresi
- Hızlı yanıt şablonları — `EmailTemplate` modeli (tenant-bazlı, plain → render)
- Inline CID görsel imza opsiyonu (M6.2'deki hosted'a alternatif)

**Bağımlılık**: M6.2

**Tahmin**: 1-2 PR

**Smoke**:
- Per-agent imza override tenant'tan üstte
- From dropdown 2+ adres → seçilen adres ile gönderim
- pendingCustomerReply state'i intake/send döngüsüyle senkron
- **n4b parite check**: imza yönetim ekranı + From dropdown + şablon seçim + "Yanıt bekliyor" rozeti — her biri n4b ile screenshot diff

---

## 7. AÇIK KARARLAR — n4b parite soruları

> n4b parite kuralı gereği bu kararlarda **benim önerim yok**. Her madde için kullanıcının **n4b davranışını bire-bir aktarması** ve plan'ı o yönde sabitlemesi beklenir. Belirsizse `[N4B-SOR]`.
>
> Her karara: **n4b'de ne var?** → kullanıcı cevabı → plan sabit. Yan-bilgiler (mevcut M5/Case alanları, default fallback) sadece **referans** olarak verilmiştir.

### K1. Çoklu From / mailbox
- **Soru**: n4b'de agent mail yazarken **"Gönderen" alanı dropdown mı, sabit tek adres mi?**
  - Eğer dropdown → kaç adres? Hangi seviyede tanımlanıyor (tenant / takım / agent)?
  - Eğer sabit → hangi kaynağa bağlı (tenant default mailbox)?
- **Bizdeki yan-bilgi**: M5'te `ExternalMailSetting.fromAddress` **tek değer**. Çoklu için `ExternalMailSettingFromAlias` 1:N gerekecek.
- **Default fallback** (n4b cevabı belirsizse): M6.2'de tek (M5 reuse), M6.3'te çoklu opsiyonel.
- **Kullanıcı cevabı**: `[N4B-SOR: From dropdown screenshot / akış]`

### K2. İç-mail (agent-to-agent) görünürlüğü
- **Soru**: n4b'de **"İç Mail / Customer Mail"** ayrımı VAR MI?
  - Varsa → composer'da nasıl gözüküyor (toggle / radio / ayrı buton)?
  - Varsa → iç mail thread'de nasıl render ediliyor (renk / rozet / ayrı bölüm)?
  - Yoksa → tüm gönderimler customer kabul ediliyor, BCC ile agent ekleniyor mu?
- **Bizdeki yan-bilgi**: NotesTab Internal/Customer toggle var; bu paterni reuse etmek bizim için ucuz.
- **Default fallback**: `CaseEmail.visibility` field model'de zaten var, n4b'de yoksa sadece 'Customer' default kalır.
- **Kullanıcı cevabı**: `[N4B-SOR: Iç-mail UX davranışı + screenshot]`

### K3. Kapalı vakaya müşteri yanıtı
- **Soru**: n4b'de **kapalı vakaya müşteri yanıt yazınca ne oluyor?**
  - Otomatik reopen (Çözüldü→YnAç) mı?
  - Yeni vaka mı açılıyor?
  - Sadece thread'e ek not olarak mı düşüyor (status değişmez)?
  - Reopen ise hangi statüye? (YnAç vs İncelemede vs Açık)
- **Bizdeki yan-bilgi**: Şu an intake `[VK-]` token'lı yanıtı mevcut vakaya not olarak ekliyor; status değişmez.
- **Default fallback**: Mevcut davranış (manuel reopen).
- **Kullanıcı cevabı**: `[N4B-SOR: Kapalı vakaya yanıt akışı]`

### K4. İletişim takip alanları (Case-level)
- **Soru**: n4b'de **"Müşteriye dönüş yapıldı mı / yanıt bekliyor"** sinyali listede/board'da var mı?
  - Varsa → Case modelinde ne tutuluyor (boolean / timestamp / kompleks state)?
  - Listede nasıl gözüküyor (rozet / kolon / filtre)?
  - SLA ile entegre mi (yanıt süresi)?
- **Bizdeki yan-bilgi**: M6.1 migration'da `Case.lastEmailAt` + `Case.pendingCustomerReply` adayım. Eklemek ucuz, eklenmemesi gelecekte refactor.
- **Default fallback**: Ekle (M6.1), UI M6.3'te kullan.
- **Kullanıcı cevabı**: `[N4B-SOR: Case list/board "yanıt bekliyor" UI/data]`

### K5. Tab ismi / kapsamı
- **Soru**: n4b'de **"İletişim" sekmesi nasıl adlandırılmış**?
  - "E-Posta" / "İletişim" / "Mesajlar" / başka?
  - Sadece mail mi içeriyor, yoksa SMS/çağrı/web chat birlikte mi?
- **Bizdeki yan-bilgi**: CallLogs zaten ayrı tab; `'communication'` ismi gelecek için yer açar.
- **Default fallback**: Adı + kapsamı n4b'den birebir kopyala.
- **Kullanıcı cevabı**: `[N4B-SOR: Tab adı + içeriği]`

### K6. Müşteri-adres fallback zinciri (composer To prefill)
- **Soru**: n4b'de **composer "Kime" alanı default ne ile dolu** geliyor?
  - Müşterinin ana iletişim e-postası mı? Vakanın requester'ı mı? Açıkçası boş mu?
  - Override mekanizması var mı?
- **TEYİT (koddan)**: `AccountCompany.preferredResponseChannel + responseEmail` (`schema.prisma:563`), `Case.communicationChannelOverride` (`:1232`), `Case.customerContactEmail` (`:1256`) — **HEPSİ VAR**.
- **Bizdeki yan-bilgi fallback zinciri** (referans):
  1. `Case.customerContactEmail` (intake-set, M2 alanı)
  2. `AccountCompany.responseEmail` (per-tenant-account override)
  3. `Account.email`
  4. `AccountContact[isPrimary].email`
  5. `AccountContact[*].email` (uyarı, manuel seçim)
- **Default fallback**: Yukarıdaki zincir; n4b'de farklı sıra varsa o uygulanır.
- **Kullanıcı cevabı**: `[N4B-SOR: "Kime" prefill davranışı]`

### K7. Rich-text editörü
- **Soru**: n4b'de **hangi editor kullanılıyor**?
  - Önceki konuşmadan: referans ekranda "CKEditor sınıfı" görülmüş → muhtemelen CKEditor 4/5.
  - Hangi versiyon? Hangi feature setlerle (mention, image, table)?
  - Müşteriye gönderilen mail HTML'i nasıl sanitize ediliyor?
  - İmza HTML olarak nasıl saklanıyor (mock-up var mı)?
- **Bizdeki yan-bilgi karşılaştırma** (eğer n4b CKEditor sabitlemezse fallback):
  | Kriter | TipTap | CKEditor5 | Quill | Lexical |
  |---|---|---|---|---|
  | Bundle (gz, core) | ~50–80KB | ~250KB+ | ~45KB | ~80KB |
  | React native | ✓ | wrapper | 3rd party | ✓ |
  | @mention | ✓ olgun | ✓ | (3rd) | (custom) |
  | Lisans | MIT | LGPL/GPL/Commercial | BSD | MIT |
- **Default fallback**: n4b CKEditor ise CKEditor; aksi belirtilirse TipTap (lisans + bundle).
- **Kullanıcı cevabı**: `[N4B-SOR: Editor identifikasyonu + sanitize/imza davranışı]`

---

## 8. Güvenlik / gizlilik

| Kategori | Önlem |
|---|---|
| **PII (mail içerikleri)** | `CaseEmail.bodyHtml` PII içerebilir. Mevcut "customerContact*/customerCompanyName analytics/AI'a girmez" kuralı buraya genişler: **CaseEmail içeriği AI/analytics/RUNA payload'larına EKLENMEZ**. RUNA commentary-only kuralı (memory: project_runa_ai_enrichment.md) korunur. |
| **Scope** | Tüm CaseEmail route'ları `assertCaseInScope(allowedCompanyIds)` üzerinden. Cross-tenant sızıntı imkânsız — companyId @@unique guard + scope assert. |
| **XSS** | sanitize-html iki yönde: outbound (agent input) ve inbound (müşteriden HTML). Render daima `dangerouslySetInnerHTML` ile değil, sanitize edilmiş string'le. Script/iframe/form yasak. |
| **CID görsel** | Sadece `CaseEmailAttachment.contentId` ile eşleşen CID'ler render edilir; bilinmeyen CID `<img>` silinir. |
| **External image** | Inbound HTML body'deki `<img src="https://...">` opsiyon: M6.1'de gizle (tracking pixel önleme), agent "Resimleri göster" tıklarsa render et. Sade gizleme yeterli; remote-proxy gerekirse M6.3. |
| **Workspace footer çiftlenmesi** | Mevcut M5'te otomatik footer yok. M6.3'te footer eklenirse: composer içine eklenmiş olabilecek footer'ı algılayıp tekrar eklememe (regex/marker) — guard. |
| **Threading bütünlüğü** | `References` zinciri korunur (intake parser + sender builder); yanlış In-Reply-To bütün thread'i parçalar. Mevcut M4 patern'i (`providerMessageId` zincirleme) reuse. |
| **Audit** | `CaseEmail.authorUserId` set + `actor-identity hardening` (memory: project_actor_identity_hardening.md): server-authoritative author. Mock author kayıt YASAK. |
| **Dedup** | `@@unique([companyId, messageId])` + idempotent intake. IMAP poll retry → tek satır. |
| **Soft-archive** | Soft-archived vakada (memory: project_varuna_case_soft_archive.md) CaseEmail listesi read-only — write path 409 (assertCaseInScope yine SystemAdmin için izinli, ama composer disabled). |
| **Secret/credential** | SMTP/IMAP secret'lar M5 paterni — AES-256-GCM, DEVOPS_PAT_ENC_KEY reuse. CaseEmail body'de credential geçerse (oltalama) — agent UX uyarısı? Kapsam dışı. |

---

## 9. Riskler + faz-bazlı test stratejisi

### Riskler

| # | Risk | Mitigasyon |
|---|------|------------|
| R1 | Eski "not olarak mail" backfill yok → eski mailler thread'de yok | Cut-over kabul; "Vaka geçmişi (eski not)" toggle ile notları görünür tut |
| R2 | Sanitize edilmemiş HTML XSS | sanitize-html zorunlu; render asla raw HTML değil; sanitize testleri smoke'a |
| R3 | Threading kopması — yanlış In-Reply-To | Test: round-trip senaryosu (composer send → IMAP poll → composer reply → İncelemede) — References zinciri korunduğunu doğrula |
| R4 | Bundle size (TipTap + sanitize-html) | Bundle cap 120 KB gzip; aşılırsa lazy-load tab değişince |
| R5 | M2.3 learned sender regresyon | Smoke 25/25 her PR'da; Phase D 8/8 |
| R6 | NotificationDispatch paralel satır çiftlenmesi | dispatchId @@unique partial index opsiyonu; idempotent ekleme: aynı dispatch için 1 CaseEmail satırı |
| R7 | M5 tek-from kısıtı agent rolüne uymayabilir | M6.3 çoklu from (flag) |
| R8 | Inbound HTML body'sindeki external image tracking | Default gizle + "Resimleri göster" toggle |
| R9 | Composer ek boyutu × mail boyut limiti | M2.1 attachment cap reuse (FILE_MAX_COUNT=20) + per-mail boyut guard |
| R10 | Agent yanlış To/Cc'ye gönderir | Composer "Gönder" öncesi confirmation modal (kritik alıcı sayısı > 3 ise) |
| R11 | Kapalı vakaya yanlış yanıt | K3 kararı; default = manuel reopen |
| R12 | Cross-tenant Account.email reuse | ContactPicker sadece `Case.companyId` scope'undaki account/contact'ları döner |

### Test stratejisi (faz-bazlı)

**M6.1** (read-only):
- Smoke: `scripts/smoke-case-email-intake.js` — IMAP intake yeni CaseEmail satırı oluşturuyor, eski not akışı yok
- Smoke: `scripts/smoke-case-email-thread-render.js` — 3 source da render edilir (imap_intake / manual_send / notification_dispatch)
- Regression: M2.3 learned sender 25/25 + Phase D 8/8 + mail:inbound 60/60
- Manuel: notification dispatch (M4 Active) tetikle → thread'de görünmesi

**M6.2** (composer):
- Smoke: `scripts/smoke-case-email-send.js` — composer'dan send → mailProvider çağrısı + CaseEmail satırı + Message-ID üretildi
- Smoke: `scripts/smoke-case-email-sanitize.js` — `<script>`/`<iframe>` filtrelendi, `<b>` korundu, CID inline match
- Smoke: round-trip — send → IMAP poll → reply → CaseEmail thread'de doğru sırada
- Regression: önceki M6.1 smoke'ları yeşil
- Manuel: ContactPicker autocompletion + manuel mail girişi + RFC 5322 validation

**M6.3** (yönetim):
- Smoke: `scripts/smoke-case-email-signature-resolve.js` — per-user > tenant fallback
- Smoke: `scripts/smoke-case-email-from-dropdown.js` — alias seçimi → outgoing from korundu
- Smoke: `pendingCustomerReply` lifecycle
- Manuel: per-agent imza editör + tenant imza fallback senaryoları

---

## Özet

- **n4b parite kuralı**: tüm UX/davranış kararları next4biz'i bire-bir kopyalar; benim önerilerim sadece edge case fallback
- **Yeni model**: `CaseEmail` + `CaseEmailAttachment` (mail'e özgü metadata)
- **Intake taşıması**: `inboundMailIntake.js` artık not değil CaseEmail yazar
- **Notification dispatch**: paralel CaseEmail satırı (dispatchId linkli)
- **Rich-text**: n4b'de hangi editor varsa o (CKEditor şüphesi yüksek); TipTap fallback
- **3 faz**: M6.1 read-only thread → M6.2 composer + send + ek → M6.3 imza/from/şablon/iletişim takip — her fazda **n4b parite check** smoke'u
- **REUSE-first**: M1-M5 mail altyapısı, Case Detail tab sistemi, NotesTab UX, storage/upload, scope guards
- **7 açık karar (K1-K7)**: artık öneri değil, n4b davranışını bire-bir aktarma soruları. Cevap geldikten sonra plan sabit; belirsiz noktalar `[N4B-SOR]` etiketli, implementation öncesi kullanıcıdan netleştirme bekler

## Sıradaki

1. Kullanıcı K1-K7 sorularını n4b davranışı + screenshot/akış ile yanıtlasın
2. Plan sabitlenir → M6.1 implementation PR'ı (model + intake + read-only thread)
3. Her fazın sonunda n4b screenshot diff PR'a iliştirilir
