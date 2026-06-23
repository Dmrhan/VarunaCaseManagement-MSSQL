# Azure DevOps / TFS Vaka Bağlama — Plan Dokümanı

**Status**: planlama (kod yazılmadı)
**Tarih**: 2026-06-23
**Hedef PR zinciri**: PR-D1 → PR-D2 → PR-D3 (Faz 1) · sync/create/rapor Faz 2

---

## 1. İhtiyaç (neden)

Müşteri Başarı (CS) ekipleri şu an Next4biz (N4B) kullanıyor. N4B'de vaka açtıklarında, konu yazılım tarafına (defect) gidecekse **ek olarak** Azure DevOps (on-prem TFS) üzerinde bir work item açıp case ile DevOps linkini elle bağlıyorlar. Bunu Varuna'nın **kendi Case Detail ekranına** taşımak istiyoruz:

- Vakaya bağlı work item'ı UI-uyumlu bir section'da göster (canlı + fallback)
- Mevcut bir work item'ı bağla (id veya URL girişiyle)
- Bağı kaldır + audit (CaseActivity)

**MVP'de yok** (Faz 2): Varuna'dan defect oluşturma · cron/çift-yön sync · NTLM · per-tenant admin UI · SLA pause on link.

**TFS endpoint**: `https://unitfs.univera.com.tr/tfs/DefaultCollection/Sirius/_apis`
**Auth**: PAT (Personal Access Token) — Basic auth (`Authorization: Basic base64(":" + PAT)`).

---

## 2. Doğrulanmış REUSE Tablosu (file:line ile teyit)

| İddia | Konum | Durum |
|------|-------|------:|
| `ExternalKbSetting` config pattern (baseUrl + authType + apiKeySecretName + timeoutMs) | [prisma/schema.prisma:247-275](../prisma/schema.prisma) | ✅ Doğrulandı |
| Server-side HTTP istemci (native fetch + AbortController timeout + secret-by-ref + ExternalKbConfigError) | [server/lib/externalKbClient.js](../server/lib/externalKbClient.js) (288 satır) | ✅ Doğrulandı (yeniden kullanılacak pattern; `authType: 'basic'` eklenecek — bkz. §3) |
| `PanelSection` component (`title` + `icon` + `badge` + `hidden` + `tint: 'default'\|'violet'\|'rose'\|'amber'`) | [src/features/cases/CaseDetailPage.tsx:2902](../src/features/cases/CaseDetailPage.tsx) | ✅ Doğrulandı (bir görüntü için: line 1252 Müşteri, 1442 SLA, 1468 Atama, 1667 AI Detayları, 1718 AI QA Skoru — hepsi aynı pattern) |
| `externalKbService.ts` UI client pattern (apiFetch sarmalı) | [src/services/externalKbService.ts](../src/services/externalKbService.ts) (5078 byte) | ✅ Doğrulandı |
| `Case.customFields` JSON pattern (smartTicket aynı yerde) | [prisma/schema.prisma:1122](../prisma/schema.prisma) — `customFields String? @db.NVarChar(Max) // json` | ✅ Doğrulandı. UI tarafında parse referansları: [CaseDetailPage.tsx:3106, 3594, 4762, 4783](../src/features/cases/CaseDetailPage.tsx) (smartTicket örneği) |
| Tenant scope + actor/audit altyapısı | [server/lib/actor.js](../server/lib/actor.js) (4869 byte) + CaseActivity `actionType` enum (`NoteAdded`/`CaseCreated`/`Archived`/`StatusChange`/`Transfer`/...) | ✅ Doğrulandı |
| Jira stub (toast-only, data yok) | [CaseDetailPage.tsx:733-737](../src/features/cases/CaseDetailPage.tsx) — kebab menüde `"Jira'ya Aktar"` → `"Jira entegrasyonu FAZ 2 kapsamında."` toast | ✅ Doğrulandı (DevOps section bunun yerini alır; Jira stub aynen kalabilir veya silinir) |

**Sonuç**: 7/7 REUSE iddiası kodda **birebir mevcut**. Yeni helper/lib gerekmiyor; sadece authType genişlemesi.

---

## 3. Eksik / Yeni İhtiyaçlar

### 3.1 `authType: 'basic'` eklenecek

`server/lib/externalKbClient.js:123-132` `buildAuthHeader`:
```js
if (setting.authType === 'apiKey') return { 'X-API-Key': secret };
if (setting.authType === 'bearerToken') return { Authorization: `Bearer ${secret}` };
throw ... 'external_kb_unsupported_auth';
```
**Eksik**: `'basic'` branch'i. TFS PAT için `Authorization: Basic ${Buffer.from(':' + pat).toString('base64')}`.

**Karar**: `externalKbClient.js`'i genişletme (KB ile karışmasın). DevOps için **ayrı `server/lib/devopsClient.js`** modülü yaz; aynı pattern (native fetch + AbortController + secret-by-ref) ama Basic auth + TFS api-version query param + TFS hata sarmalama. KB modülü dokunulmaz.

### 3.2 Case modelinde work item referans alanı YOK

Case modeli üzerinde DevOps link için ayrılmış alan yok. **MVP'de** `Case.customFields.devops` JSON snapshot — migration gerekmez. **Faz 2**: dedicated indexed alan (`devopsWorkItemId Int?`) raporlama gerekirse.

### 3.3 DevOps UI section YOK

CaseDetailPage'de DevOps section'ı yok. PanelSection pattern'i ile eklenecek.

### 3.4 TFS istemci YOK

`server/lib/devopsClient.js` yeni dosya.

---

## 4. MVP Kapsamı (kararlar)

| | İçinde | Dışında (Faz 2) |
|---|--------|------------------|
| Bağlama | ✅ Mevcut work item'ı id/URL ile bağla | ❌ Varuna'dan defect oluşturma |
| Görüntüleme | ✅ 16 alan canlı + son-bilinen fallback | ❌ Otomatik cron sync, çift-yön |
| Kaldırma | ✅ + CaseActivity audit | — |
| Auth | ✅ PAT/Basic | ❌ NTLM |
| Çoklu tenant | ❌ Tek on-prem (.env) | ✅ Per-tenant admin UI |
| Vaka ↔ work item | ✅ 1:1 (MVP) | ✅ 1:N (çoklu defect) — **TBD-5** |
| SLA pause on link | ❌ HAYIR | TBD (öneri: hayır) — **TBD-7** |

---

## 5. Gösterilecek Alan Seti (DevOps'tan dönen — 16 alan)

| # | Alan | Beklenen TFS reference | Tip |
|---|------|------------------------|-----|
| 1 | ID | `System.Id` | int (standart) |
| 2 | State | `System.State` | string (standart) |
| 3 | Proje | `System.TeamProject` | string (standart) |
| 4 | Work Item Type | `System.WorkItemType` | string (standart) |
| 5 | PackageType | **CUSTOM** — PR-D1'de keşfedilecek | string |
| 6 | ProjectLayer | **CUSTOM** — PR-D1'de keşfedilecek | string |
| 7 | Title | `System.Title` | string (standart) |
| 8 | Assigned To | `System.AssignedTo.displayName` | string (standart) |
| 9 | ExtraField4 | **CUSTOM** — PR-D1'de keşfedilecek | string |
| 10 | Found In | muhtemelen `Microsoft.VSTS.Build.FoundIn` veya CUSTOM | string |
| 11 | FoundInRelease | **CUSTOM** — PR-D1'de keşfedilecek | string |
| 12 | Created Date | `System.CreatedDate` | ISO datetime (standart) |
| 13 | Resolved Date | `Microsoft.VSTS.Common.ResolvedDate` | ISO datetime (standart) |
| 14 | Closed Date | `Microsoft.VSTS.Common.ClosedDate` | ISO datetime (standart) |
| 15 | Root Cause | muhtemelen `Microsoft.VSTS.CMMI.RootCause` veya CUSTOM | string |
| 16 | BugGroup | **CUSTOM** — PR-D1'de keşfedilecek | string |

**Kritik not**: 5 alan kesin CUSTOM (PackageType, ProjectLayer, ExtraField4, FoundInRelease, BugGroup); Found In + Root Cause muhtemelen CUSTOM. **Gerçek reference adları PR-D1 çıktısıyla canlı work item'ın tam alan dökümünden çıkarılıp `devopsClient` içinde bir `FIELD_MAP` constant'ına işlenecek.** Plan dokümanı bu noktada tamamlanmadan PR-D2 (saklama) ve PR-D3 (UI) başlatılamaz.

---

## 6. Saklama (MVP)

`Case.customFields.devops` JSON şeması (ÇOKLU — array; TBD-5 onaylı):
```ts
{
  devops?: Array<{
    workItemId: number;
    url: string;                    // tam TFS link (UI'da "DevOps'ta aç")
    linkedAt: string;               // ISO — bağlama anı
    linkedByUserId: string;         // actor.userId
    linkedByUserName: string;       // actor.displayName (audit snapshot)
    lastSyncedAt: string;           // ISO — son başarılı canlı fetch
    snapshot: {                     // 16 alan; live fetch fail → fallback
      id: number;
      state: string;
      project: string;
      workItemType: string;
      packageType?: string;
      projectLayer?: string;
      title: string;
      assignedTo?: string;
      extraField4?: string;
      foundIn?: string;
      foundInRelease?: string;
      createdDate?: string;
      resolvedDate?: string;
      closedDate?: string;
      rootCause?: string;
      bugGroup?: string;
    };
  }>;
}
```

**Migration yok** (smartTicket aynı pattern). **Faz 2**: dedicated `devopsWorkItemId Int?` + index `[companyId, devopsWorkItemId]` (raporlama gerekirse).

---

## 7. Config

### MVP `.env` (tek on-prem tenant)
```
TFS_BASE_URL=https://unitfs.univera.com.tr/tfs/DefaultCollection/Sirius/_apis
TFS_PAT=<personal-access-token>          # 1 yıl expiry; rotate prosedürü doc'a
TFS_API_VERSION=7.0                      # TFS 2019+ standardı
TFS_TIMEOUT_MS=15000                     # KB modülünde 30s default; defect ufak, 15s yeterli
```

### Faz 2 (per-tenant)
`ExternalKbSetting`'in DevOps muadili: `DevOpsSetting` model — aynı pattern (baseUrl + authType=basic + apiKeySecretName + timeoutMs). MVP'de YOK.

---

## 8. PR Planı

### PR-D1 — TFS connectivity + client (UI/DB yazımı yok)

**Kapsam:**
- `.env.example` → 4 yeni satır (`TFS_BASE_URL`, `TFS_PAT`, `TFS_API_VERSION`, `TFS_TIMEOUT_MS`)
- `server/lib/devopsClient.js` — `getWorkItem(id)` + Basic auth header + AbortController + ExternalKbConfigError pattern (yeni `DevOpsConfigError` veya generic)
- `FIELD_MAP` constant (16 alan custom ref name'leri) — **PR-D1 çıktısı**: canlı bir work item çekilip dump → reference adları doğrulanır
- Diagnostic endpoint **opsiyonel**: `GET /api/devops/diag` (SystemAdmin-only) → baseUrl + token validity + sample work item meta
- Smoke (static): devopsClient export shape + Basic auth header pattern + FIELD_MAP 16 alan

**Yok**: DB yazımı, UI, Case bağlama

**Kabul kriterleri**:
- [ ] curl/test ile bir work item çekilebilir
- [ ] 16 alanın gerçek TFS reference adları FIELD_MAP'te belgeli
- [ ] PAT eksik → konfigure hata mesajı (`tfs_pat_missing`)
- [ ] TFS down → timeout sonrası ExternalKbConfigError-benzeri sarmalı hata
- [ ] tsc + smoke clean

**Tahmini efor**: 1.5-2 saat

### PR-D2 — Bağlama veri katmanı

**Kapsam:**
- `server/routes/cases.js` → `POST /:id/devops-link` (input: `{ workItemId?: number, url?: string }` → URL'den id parse) + `DELETE /:id/devops-link`
- `caseRepository.linkDevops(caseId, { workItemId, actor, allowedCompanyIds })` — `devopsClient.getWorkItem` → snapshot oluştur → `customFields.devops` set + CaseActivity `actionType: 'DevopsLinked'`
- `caseRepository.unlinkDevops(caseId, { actor, allowedCompanyIds })` — `customFields.devops` clear + CaseActivity `actionType: 'DevopsUnlinked'`
- `caseService.linkDevops(caseId, idOrUrl)` + `caseService.unlinkDevops(caseId)` — apiFetch wrapper
- URL → id parse util (`server/lib/devopsClient.js` veya `server/lib/devopsUrlParser.js`)
- Smoke (static): endpoint role guard (kim bağlayabilir? Karar §10), URL parser invariants, CaseActivity 2 yeni actionType

**Yok**: UI

**Kabul kriterleri**:
- [ ] `POST /:id/devops-link` `{ url: "https://unitfs.../_workitems/edit/12345" }` → 200, customFields.devops set
- [ ] Aynı + `{ workItemId: 12345 }` → 200 aynı sonuç
- [ ] `DELETE /:id/devops-link` → 200, customFields.devops cleared
- [ ] TFS'te id bulunamadı → 404 + UI'a anlamlı mesaj
- [ ] CaseActivity 2 yeni log satırı
- [ ] tsc + smoke clean

**Tahmini efor**: 2-2.5 saat

### PR-D3 — Case Detail "Azure DevOps" PanelSection

**Kapsam:**
- `src/features/cases/CaseDetailPage.tsx` → DevOps section (RightPanel'de veya Detail tab içinde — karar)
- Section içeriği: 16 alan görüntüleme + "DevOps'ta aç" link + "Bağı Kaldır" buton (yetki gate'li)
- Mount sırasında canlı çek (`devopsClient.getWorkItem` via `GET /api/cases/:id/devops`) → snapshot tazele → fail durumunda son-bilinen + "Sync hatası — son güncelleme X" badge
- Bağla modal (boş case için): id veya URL girişi → submit → caseService.linkDevops
- Smoke (static): section render conditional (devops varsa); modal trigger; bağ kaldır button conditional

**Yok**: Cron sync, Varuna'dan create

**Kabul kriterleri**:
- [ ] Bağlı yok → "DevOps Work Item Bağla" buton (modal açar)
- [ ] Bağlı var → 16 alan görünür, DevOps link tıklanır
- [ ] TFS down → son-bilinen snapshot + uyarı badge
- [ ] "Bağı Kaldır" → confirm → unlink success
- [ ] tsc + build clean + smoke

**Tahmini efor**: 2-3 saat

---

## 9. Faz 2 (post-MVP)

| İçerik | Açıklama |
|--------|----------|
| **Sync** | Cron 15dk: snapshot güncelle; State değişikliklerini Case timeline'a düş |
| **Varuna'dan create** | "DevOps'ta defect aç" buton — Case meta'sını TFS payload'a çevir |
| **Per-tenant admin** | `DevOpsSetting` model + AdminDevOpsPage (ExternalKbSetting pattern) |
| **Dedicated indexed alan** | `Case.devopsWorkItemId Int? @@index` — raporlama hot path |
| **SLA pause** | TBD-7 (öneri: HAYIR; defect bağlama operasyonel atama, SLA durdurmaz) |
| **DevOps dağılım raporu** | Report Studio kolonları: bağlı vaka %, en sık BugGroup, ortalama Resolved gün |
| **NTLM** | Eğer PAT yerine domain auth gerekirse — Faz 3 |

---

## 10. Açık Kararlar (TBD)

| # | Soru | Öneri | Karar |
|---|------|-------|-------|
| **TBD-1** | Auth = PAT/Basic? | Evet — PAT minimum 1 yıl, Basic header | ⏳ Onay bekliyor |
| **TBD-2** | Config `.env` tek tenant yeterli mi? | Evet — Faz 2'ye per-tenant admin | ⏳ Onay bekliyor |
| **TBD-3** | Saklama `customFields` mı dedicated alan mı? | MVP'de `customFields.devops`; rapor gerekirse Faz 2 dedicated | ⏳ Onay bekliyor |
| **TBD-4** | Bağlama girişi id mi URL mi ikisi mi? | İkisi de — frontend Input'a yapıştır, backend parse | ⏳ Onay bekliyor |
| **TBD-5** | Vaka başına 1 mi çok mu work item? | **ÇOKLU (array) — karar verildi**. `customFields.devops` array; her item ayrı snapshot. | ✅ Onaylandı |
| **TBD-6** | Canlı çek mi cache+yenile mi? | Canlı çek her render'da (cache: snapshot fallback) | ⏳ Onay bekliyor |
| **TBD-7** | Bağlanınca SLA dursun mu? | HAYIR | ⏳ Onay bekliyor |
| **TBD-8** | Custom alan referans adları | **PR-D1 çıktısı** ile netleşecek | ⏳ PR-D1'e bağlı |
| **TBD-9** | Yetki: kim DevOps bağlayabilir? | Agent/CSM/Supervisor/Admin/SystemAdmin (atayan kişi). Backoffice: opsiyonel. | ⏳ Onay bekliyor |
| **TBD-10** | Bağı kim kaldırabilir? | Bağlayan + Supervisor/Admin/SystemAdmin | ⏳ Onay bekliyor |
| **TBD-11** | Arşivli case'te DevOps section davranışı | Mevcut soft-archive guard ile uyumlu: SystemAdmin read 200 + write 409 (link/unlink). Otomatik kapsam. | ⏳ Onay bekliyor |
| **TBD-12** | Jira stub silinmeli mi? | DevOps section eklenince Jira menü item kalabilir (toast aynen Faz 2); veya silinir | ⏳ Onay bekliyor |

---

## 11. Riskler / Guardrails

| Risk | Olasılık | Etki | Mitigasyon |
|------|---------:|-----:|------------|
| On-prem TFS'e ağ erişimi (server-side; firewall kuralı) | Orta | Yüksek | `.env`'de baseUrl; deploy doc'ta firewall whitelist notu (PR-D1) |
| PAT secret sızıntısı | Orta | Kritik | `apiKeySecretName` pattern (env-by-ref); UI ASLA çekmez; log'larda mask |
| PAT 1 yıl expiry | Yüksek | Orta | Operatöre uyarı; rotate prosedürü docs/ONPREM_INSTALL.md'ye ek (PR-D1) |
| TFS api-version değişikliği | Düşük | Düşük | `.env.example`'da version açık; client log'a yazsın |
| URL formatı varyasyonu (`_workitems/edit/12345` vs `_workitems?id=12345`) | Orta | Düşük | URL parser regex array (her iki form); fallback "id girin" |
| TFS down | Düşük | Düşük | Son-bilinen snapshot fallback + uyarı badge |
| Tenant scope | Düşük | Yüksek | `assertCaseInScope`/`assertCaseInScopeForRead` mevcut pattern (soft-archive guard otomatik kapsanır) |
| Çoklu defect (MVP'de array) | Düşük | Düşük | `customFields.devops` array; aynı `workItemId` ikinci link → 409 `devops_already_linked` |
| Custom alan ref adı yanlış | Yüksek | Orta | **PR-D1 zorunlu çıktı**: canlı work item alan dökümü + FIELD_MAP onayı |

---

## 12. Workflow

- `feature/devops-d1-client` → PR → dev → onay sonrası `feature/devops-d2-link` → ...
- Main'e dokunma (release flow politikası: feature → PR → dev → release PR → main)
- Her PR sonunda final report: source/base/main-touched/sync durumu

---

## 13. Plan tamamlanma kriterleri (bu doküman)

- [x] REUSE iddiaları doğrulandı (7/7) — §2 file:line referansları
- [x] EKSİK iddialar netleştirildi — §3
- [x] MVP kapsamı sabitlendi — §4
- [x] 16 alan listelendi (custom ref adları PR-D1'e bağlı) — §5
- [x] Saklama şeması belgelendi — §6
- [x] Config envanteri tamam — §7
- [x] PR-D1/D2/D3 kapsamları + kabul kriterleri — §8
- [x] Faz 2 ayrı — §9
- [x] 12 TBD listelendi — §10
- [x] Risk haritası — §11

**Sonraki adım**: TBD-1 → TBD-12 cevapları + onay → PR-D1 başlatılır.

---

## Notlar (geliştirici için)

- Mevcut soft-archive guard ([project_varuna_case_soft_archive memory](file:///Users/demirhan.isbakan/.claude/projects/-Users-demirhan-isbakan/memory/project_varuna_case_soft_archive.md)): DevOps link/unlink yazılı operasyon → otomatik 409 `case_archived_readonly` arşivli case için. Eklenecek bir guard yok.
- `assertCaseInScope` (write) / `assertCaseInScopeForRead` (read) pattern'i otomatik uygulanır.
- Tenant scope için `allowedCompanyIds` mevcut pattern. DevOps env tek tenant olduğu için MVP'de scope ek katman değil — Faz 2'de per-tenant config ile devreye girer.
