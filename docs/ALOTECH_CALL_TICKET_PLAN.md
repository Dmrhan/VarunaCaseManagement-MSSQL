# AloTech — Gelen Çağrı → Ticket Eşleştirme + Çağrı-Merkezi Raporlama (Uygulama Planı)

## 0. Amaç
Gelen çağrıda:
1. **Müşteriyi şifreden kesin tanı** — AloTech IVR'de girilen `CustomerPassword` = Varuna `AccountCompany.externalCustomerCode`. (callerid'den güvenilir; anonim numarada da çalışır.)
2. **Ticket'ı müşteri (+ tek projesi) ön-seçili aç** (mevcut oto-pop zenginleşir).
3. **Çağrıyı kaydet** — `CallLog` (raporlama).
4. **CallID ↔ Ticket bağla** — hangi çağrı hangi ticket ile karşılandı.
5. **Rapor:** müşteri × ticket × agent × süre.

**Mimari ilke:** yeni WebSocket/SSE **YOK**. Webhook şifreyi yakalar + kaydeder; mevcut `/active-call` polling'i şifreyle **zenginleştirilir** (callId join). Pop akışı aynı kalır, sadece daha isabetli.

---

## 1. Veri modeli — Prisma (`prisma/schema.prisma`)

Yeni model **`CallLog`** (çağrı başına 1 satır):

```prisma
model CallLog {
  id                String    @id @default(cuid()) @db.NVarChar(450)
  companyId         String    @db.NVarChar(450)
  callId            String    @db.NVarChar(255)   // call_activecallkey — AloTech çağrı anahtarı (JOIN)
  callerId          String?   @db.NVarChar(64)    // arayan numara
  customerPassword  String?   @db.NVarChar(255)   // IVR şifresi (=externalCustomerCode)
  direction         String    @default("inbound") @db.NVarChar(16) // inbound | outbound
  queue             String?   @db.NVarChar(128)
  agentEmail        String?   @db.NVarChar(255)
  matchedAccountId  String?   @db.NVarChar(450)   // şifreden çözülen müşteri
  caseId            String?   @db.NVarChar(450)   // ★ AÇILAN/BAĞLANAN TICKET
  status            String?   @db.NVarChar(32)
  startedAt         DateTime?
  answeredAt        DateTime?
  endedAt           DateTime?
  durationSec       Int?
  raw               String?   @db.NVarChar(Max)   // ham webhook payload (audit)
  createdAt         DateTime  @default(dbgenerated("sysutcdatetime()"))
  updatedAt         DateTime  @updatedAt

  account Account? @relation(fields: [matchedAccountId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  case    Case?    @relation(fields: [caseId], references: [id], onDelete: NoAction, onUpdate: NoAction)

  @@unique([companyId, callId])   // aynı çağrı tek satır (upsert)
  @@index([companyId, callerId])
  @@index([caseId])
  @@index([matchedAccountId])
  @@index([startedAt])
}
```
- `Account` ve `Case` modellerine ters-relation eklenir (`callLogs CallLog[]`).
- **Migration:** `prisma migrate` (MSSQL) — repo AI_WORKFLOW'a uygun, `dev`'den branch.
- İlişki: **Case 1—N CallLog** (müşteri tekrar arar → aynı ticket'a çok çağrı).

---

## 2. Backend (BFF)

### 2a. Yeni endpoint — `POST /alotech/incoming-call-start` (`server/routes/alotech.js`)
- **Auth:** `verifyJwt` DEĞİL (server-to-server). **Shared-secret** — AloTech "Yetkilendirme" ile header/param token gönderir; endpoint sabit-zamanlı karşılaştırır (`ALOTECH_WEBHOOK_SECRET` env). Değilse 401.
- **Payload (AloTech makroları):** `CustomerPassword`, `call_callerid`, `call_activecallkey` (=callId), `call_agent_email`, `queue?`, `direction?`.
- **İş:**
  1. `companyId` çözümle (tek tenant → env `ALOTECH_COMPANY_ID` = COMP-UNIVERA; ileride agent_email→company).
  2. Müşteri lookup: `externalCustomerCode = CustomerPassword` (exact) → yoksa `callerId` telefon eşleşmesi (fallback).
  3. **CallLog upsert** (`@@unique companyId+callId`): callerId, customerPassword, agentEmail, queue, matchedAccountId, startedAt=now, status='ringing', raw.
  4. 200 `{ ok, accountId }` (AloTech'e minimal cevap; santral API'nin döndürdüğü gibi).
- **Not:** pop'u BURADAN push ETME — polling zenginleştirmesi yapar (2b). Bu endpoint yalnız yakalar+kaydeder.

### 2b. `GET /active-call` zenginleştirme (`server/routes/alotech.js:178`)
- Mevcut `calls` map'ine, `CallLog`'tan **callId ile join** ederek `customerPassword` + `matchedAccountId` ekle:
  ```js
  const keys = calls.map(c => c.callId).filter(Boolean);
  const logs = await callLogRepo.findByCallIds(companyId, keys); // Map<callId, {customerPassword, matchedAccountId}>
  calls.forEach(c => { const l = logs.get(c.callId); c.customerPassword = l?.customerPassword ?? null; c.matchedAccountId = l?.matchedAccountId ?? null; });
  ```
- Böylece frontend polling'i şifreyi + çözülen müşteriyi hazır alır.

### 2c. Account exact-lookup (`server/db/accountRepository.js`)
- Yeni `findAccountByExternalCustomerCode(companyId, code)` — `AccountCompany` üzerinden exact (`@@unique(companyId, externalCustomerCode)`), tenant-scoped, `{ id, name, projects[] }` döner. (Mevcut fuzzy `list` yerine kesin eşleşme.)

### 2d. Repository — `server/db/callLogRepository.js` (yeni)
- `upsertOnStart(...)`, `linkCase(companyId, callId, caseId)`, `updateOnEnd(companyId, callId, {answeredAt, endedAt, durationSec, status})`, `findByCallIds(...)`, `report(filters)`.

### 2e. Case create hook — CallID bağla (`server/db/caseRepository.js` createCase ~1701-1867)
- Create payload'a opsiyonel `alotechCallId` kabul et. Case yazıldıktan sonra:
  - `callLogRepo.linkCase(companyId, alotechCallId, newCase.id)`.
  - (Opsiyonel) `Case.customFields.alotech = { callId }` — ticket üstünden hızlı erişim.

### 2f. Çağrı sonu / süre (KARAR — bkz §5)
- **Seçenek A (önerilen):** ikinci AloTech webhook `POST /alotech/incoming-call-end` → `call_activecallkey`, `call_duration`/talk-time → `callLogRepo.updateOnEnd`.
- **Seçenek B:** AloTech CDR/rapor API'sini `callId` ile periyodik çekip süreyi doldur.

### 2g. Rapor endpoint — `GET /alotech/call-report` (`server/routes/alotech.js`, verifyJwt)
- Filtre: tarih, müşteri, agent, proje. `CallLog` join Case/Account → satırlar + özet (müşteri×toplam dk×çağrı sayısı×agent).

---

## 3. Frontend

### 3a. `src/contexts/SoftphoneContext.tsx`
- `ActiveCall` tipine `customerPassword?`, `matchedAccountId?` ekle (zaten `key`=callId var).
- Polling event detail'ine ekle: `SOFTPHONE_INCOMING/ANSWERED` → `detail: { number: callerId, callId: key, customerPassword, matchedAccountId }`.

### 3b. `src/App.tsx` — `popTicket` genişletme (159-190)
- İmza: `popTicket({ callerId, callId, customerPassword, matchedAccountId })`.
- Müşteri çözümü sırası: **`matchedAccountId` varsa direkt** → yoksa `customerPassword` ile lookup (`accountService.getByExternalCode`) → yoksa `callerId` fuzzy (mevcut).
- Müşterinin **tek projesi** varsa `accountProjectId` de set et.
- `setSmartTicketCallId(callId)` — create'e taşınacak.

### 3c. `src/features/smart-ticket/SmartTicketNewPage.tsx`
- `initialAccountId/Name` yanına `initialAccountProjectId` + `alotechCallId` prop'ları.
- `caseService.create` payload'ına `alotechCallId` ekle. Create başarılı → CallLog.caseId bağlanır (backend 2e).

### 3d. `src/services/caseService.ts` / `softphoneService.ts`
- `create` tipine `alotechCallId?`; `ActiveCall` tipine yeni alanlar; `accountService`'e `getByExternalCode(code)`.

### 3e. Rapor sayfası — `src/features/reporting/CallCenterReport.tsx` (yeni)
- `/alotech/call-report` tüketir; tablo + özet (müşteri×dk×çağrı×agent), tarih/müşteri/agent filtre, Excel export.

---

## 4. AloTech tarafı (kullanıcı yapacak)
1. **Yeni webhook** (mevcut santral webhook'una DOKUNMADAN, paralel): `POST https://csm.varunasolution.com/api/alotech/incoming-call-start` (BFF public yol).
2. Parametreler: `CustomerPassword={{...}}`, `call_callerid={{call_callerid}}`, `CallID={{call_activecallkey}}`, `AgentID={{call_agent_email}}`.
3. **Yetkilendirme:** shared-secret (header `X-Alotech-Signature` veya param) — Varuna `ALOTECH_WEBHOOK_SECRET` ile aynı.
4. (Süre için) **call-end** webhook → `/api/alotech/incoming-call-end` + `{{call_duration}}`.
5. AloTech "Test" sekmesiyle doğrula (200 OK beklenir).

---

## 5. Açık kararlar (default önerili)
| Konu | Seçenekler | Default |
|---|---|---|
| Proje ön-doldurma | (a) müşteri tek-projeliyse doldur / (b) proje-bazlı şifre | **(a)** — çok-projelide boş, agent seçer |
| Süre kaynağı | call-end webhook / CDR pull | **call-end webhook** (gerçek-zaman, basit) |
| Outbound loglama | dahil / hariç | **Faz 2'de dahil** (click2call zaten var) |
| Cevapsız çağrı | logla / atla | **logla** (status='missed', caseId boş) |
| Pop tetikleme | polling-enrichment / yeni SSE | **polling-enrichment** (yeni kanal yok) |

---

## 6. Fazlama (değer sırası)
- **Faz 1 — Backend yakalama + raporlama:** CallLog modeli + migration + `/incoming-call-start` + `/incoming-call-end` + `callLogRepository` + `/call-report`. Pop'a DOKUNMAZ, en yüksek değer (senin istediğin "hangi müşteri kaç dk / hangi ticket"). AloTech webhook'u kurulur.
- **Faz 2 — Pop zenginleştirme:** `/active-call` enrichment + `popTicket` şifre-lookup + proje ön-doldurma + CallID→case bağlama (create hook + frontend).
- **Faz 3 — Rapor UI:** CallCenterReport sayfası + Excel.

---

## 7. Güvenlik / dikkat
- Public webhook endpoint: **shared-secret zorunlu** + rate-limit + strict input validation + sadece bilinen alanlar. Ham payload `raw`'a maskeli.
- **Tenant scope:** `externalCustomerCode` yalnız `companyId` içinde unique — lookup DAİMA companyId-scoped (yanlış tenant müşterisi açılmasın).
- callerId/şifre log'larda PII — maskeli logla.
- `caseId`/`accountId` NoAction FK (silme davranışı yan-etkisiz).

## 8. Doğrulama
- Webhook: AloTech "Test" + `curl` ile 200 + CallLog satırı.
- Pop: test çağrısı → şifreyle doğru müşteri + (tek proje) açılıyor mu.
- Bağ: ticket kaydet → `CallLog.caseId` doluyor mu.
- Rapor: müşteri×dk×agent doğru mu (bilinen bir çağrıyla).

## 9. Deploy notları
- **Backend** (endpoint, model, repo): `git pull` + Prisma migrate + BFF/Node **restart** (`npm run build` gerekmez).
- **Frontend** (pop, rapor): `git pull` + `npm run build` + hard refresh.
- Prod ağ: AloTech → `csm.varunasolution.com/api/alotech/*` (public, secret'lı) erişebilmeli.
