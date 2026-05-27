# Technical Debt

Bu doküman bilinen teknik borç ve geleceğe ertelenmiş işleri kayıt altına alır.
Her madde tetikleme koşulu (trigger) ile birlikte yazılır — durumu değişen
maddeler güncellenir veya kaldırılır.

**Son güncelleme:** 2026-05-27 (Hidden Backlog Fragment Audit + PR-B consolidation)

> Aktif backlog için → [docs/BACKLOG.md](BACKLOG.md)
> Future product direction için → [docs/ROADMAP.md](ROADMAP.md)
> Report Studio için → [docs/REPORT_STUDIO_BACKLOG.md](REPORT_STUDIO_BACKLOG.md)

---

## Notification Center — Legacy Bridge Deprecation Timeline

**Trigger:** Once all observed tenants migrated for ≥30 days and zero drift incidents.

**Status:** Bridge active

WR-NOTIFICATION-CENTER Phase 2C kapsamında legacy `CaseNotification` →
yeni `ActionItem` adapter'ı kuruldu. Bridge bileşenleri:

- `scripts/backfill-notification-to-inbox.js` — operatör tarafından
  manuel tetiklenir; idempotent
- `buildLegacyTransferDedupKey` (`server/db/actionItemRepository.js`) —
  pre-fix `transfer` dedupKey shape'ini tanır
- `VITE_LEGACY_MENTION_BELL_ENABLED` env flag — Action Center off-ramp
- `MentionBellBadge` component — legacy bell hâlâ koddave; flag'le toggle

**Riskler / planlama:**
- Bridge'i ne zaman emekli ederiz? Aksiyonlarım inbox tek source-of-
  truth oldu sayılır mı?
- `buildLegacyTransferDedupKey` helper'ı bir noktada delete'lenecek
  (legacy rows yeniden materialize edilmeyecek). Cut-off date karar
  gerek.
- Legacy `MentionBellBadge` component'i ne zaman silinecek?

**Önerilen plan:**
1. Q3'te 3 ardışık ay no-drift gözlemle
2. `VITE_LEGACY_MENTION_BELL_ENABLED` Vercel'den kaldır
3. `MentionBellBadge` component delete
4. `buildLegacyTransferDedupKey` helper delete + smoke G13c update
5. Backfill script archive

---

## ActionItem polymorphism — referansiyel bütünlük riski

**Trigger:** Schema migration round dış-FK enforcement için.

**Status:** Risk doc'lanmadı, mitigasyon yok

`ActionItem.objectType` (string: 'CaseMention' | 'CaseNotification' |
'CaseApproval' | ...) ve `ActionItem.objectId` (string, FK YOK).
Polymorphic association — DB-level referansiyel bütünlük yok. Pratik
risk:

- Source row (örn. `CaseMention`) silinirse `ActionItem.objectId`
  dangling kalır
- `objectType` typo'su veya enum drift'i sessizce kaçar
- Tenant scope `companyId` field'ı ile sağlanıyor — `objectId`'ye
  güven verilmemeli

**Önerilen mitigasyonlar (henüz seçilmedi):**
- Option A: explicit nullable FK columns per object type
  (`mentionId`, `notificationId`, `approvalId`) + check constraint
- Option B: cron-based orphan sweeper
- Option C: at-write validator (her insert/update'de source row exists?)

**Çaba:** karar sonrası 1-2 gün.

---

## METRIC_FIXTURES.md PENDING values (önceki BACKLOG #15)

**Trigger:** Phase 1 metric regression test temeli.

**Status:** Doc var, 11 satır hâlâ PENDING

`docs/METRIC_FIXTURES.md:22-34` smoke verisinden gerçek baseline'larla
doldurulmayı bekliyor:
- Per-role `openCases` / `totalCases` / `slaViolationRatePct` (multi-role
  smoke'tan)
- Beklenen `byStatus` / `byPriority` dağılımları

Smoke baseline 2 hafta gecikti; operasyon oturumunda 1 saatte
doldurulur.

**Çaba:** 1 saat.

---

## CaseNote.authorId nullable backfill (önceki BACKLOG #29)

**Trigger:** Tarihçeye dokunan reaction/threading akışları eski notları
da kapsasın.

**Status:** PR #68 öncesi notlar `authorId=NULL` taşıyor

PR #68 `CaseNote.authorId` ekledi (nullable, fire-and-forget gate).
Yeni notlar tamam, eski notlar boş. Tek seferlik backfill:
`CaseActivity` (note_added event'i) üzerinden eski notların yazarını
eşle.

Etki düşük (silent gate notification üretmeyi engelliyor, exception
atmıyor) ama eski notlara reaksiyon → not sahibine bildirim
gönderilemiyor.

**Çaba:** 2 saat — script `scripts/backfill-note-author.js`.

---

## snooze-wakeup cron path — `/api/cron` prefix taşıma (önceki BACKLOG #42)

**Trigger:** Cron route layout disiplin sweep'i.

**Status:** Tarihsel sebep documented

`server/routes/cases.js:7,24` — `router.post('/cron/snooze-wakeup', ...)`
cases router altında mount → `/api/cases/cron/snooze-wakeup`.
`server/routes/cron.js:12-15` yorumu bu durumu açıklıyor.

Taşıma değeri kozmetik; tetik gerekirse GitHub Actions/UptimeRobot
config'ini de paralel güncellemek gerek (operasyonel risk var).

**Çaba:** 1 saat kod + ops sync.

---

## `smoke:data-contracts` + `smoke:ai-telemetry` CI coverage gap

**Trigger:** Production regression CI'da yakalanmadan inerse / şüpheli PR.

**Status:** Scripts var, default CI'da çalışmıyor

`scripts/smoke-data-contracts.js` (16 contract grup) + `scripts/smoke-ai-telemetry.js` (38 senaryo) — repo'nun en geniş regression gate'leri. DB-backed olduğu için PR Phase 1 audit'inde default CI'a alınmadı (`docs/QUALITY_GATES.md` §Matrix bunu açıkça belirtir). Sonuç: schema/tenant scope drift CI'da kırılmıyor; operatör manuel çalıştırmadan PR merge olabiliyor.

**Önerilen yön:** Ayrı `nightly-smoke.yml` workflow + sandbox DB secret (Phase 2 audit'de detaylanmıştı). Branch protection: required check olarak nightly status'ı en azından bilgilendirici sürum.

**Çaba:** Yarım gün (workflow + secret + first run).

---

## Repo default base = `main` / dual-path Git Flow workaround

**Trigger:** Repo settings revision veya GitHub admin onayı.

**Status:** Protokol mevcut workaround'la yaşıyor

`docs/AI_WORKFLOW.md §"Git Flow Rules → Observed reality (2026-05-19)"`: repo default base `main`; operatör merge anında base'i `dev`'e çevirmezse PR doğrudan main'e iner (Path B). Protokol bunu "dual-path discipline" ile mitige ediyor — her merge sonrası operasyonel sweep (FF dev to main veya release PR).

**Riskler:**
- Operasyonel maliyet: her merge sonrası ekstra sync adımı
- Forgotten FF: dev stale kalırsa sonraki feature branch eski base'den ayrılır

**Tek atılım çözüm:** GitHub repo Settings → Default branch'i `dev`'e çevir (yalnız Admin). O zaman PR default base = `dev`, release PR ayrı disiplin.

**Çaba:** GitHub UI 5 dakika + 1 sprint operatör eğitimi.

---

## `test:pattern` / `test:qa` script naming mismatch

**Trigger:** Vitest framework (BACKLOG P1) shipped olunca.

**Status:** Misleading naming

`package.json`'da `test:pattern` ve `test:qa` script'leri var ama bunlar assertion-framework içermeyen smoke script'leri (`scripts/test-pattern-alert.js`, `scripts/test-qa-scores.js`). `test:*` prefix Vitest planning'ini ve "gerçek test" mental model'ini kirletiyor.

**Eylem (Vitest landed sonrası):**
- Rename: `test:pattern` → `smoke:pattern-alert`, `test:qa` → `smoke:qa-scores`
- Geçici alias bir release boyunca tutulabilir
- README §"Test Scriptleri" satırlarını güncelle
- `scripts/test-*.js` dosya adları → `scripts/smoke-*.js` (compat hardlink veya rename)

**Çaba:** 1 saat (paralel commits).

---

## CI / build script comment drift

**Trigger:** CI workflow editing turu.

**Status:** Stale yorum

`.github/workflows/ci.yml:51-56` Vite build adımı yorumu "Build script'i (`prisma migrate deploy && tsc -b && vite build`) CI'da DB'ye bağlanmaya çalışıyor" diyor — ama `package.json:10` `"build": "tsc -b && vite build"` (migrate yok). Yorum production geçmişinden kalıntı.

**Eylem:** Yorumu yeniden yaz veya tamamen sil; gerçek workaround zaten step description'da.

**Çaba:** 10 dakika.

---

## Catalog-bound SLA / Checklist refactor (A6c follow-up)

**Trigger:** SLA / escalation / routing tier-aware rewrite (BACKLOG P3) başlarken.

**Status:** Mevcut lookup hâlâ legacy distinct-from-case

`docs/planning_cards/WR-A6.md` "lookupRepository.productGroups() switch": A6 shipped ama `lookupRepository.productGroups()` hâlâ distinct-from-case besliyor (`Case.productGroup` string scan); catalog'a bağlanmadı. A7b-INTEGRATED §② "Legacy `Case.productGroup` ve `AccountCompany.packageName` dokunulmaz" diyor → bu legacy field consumer hâlâ aktif.

**Eylem:** SLA/Checklist matching path'lerini Product/Package catalog'a bağla; legacy string field'ları read-only deprecate işaretle.

**Çaba:** 1 gün (P3 SLA tier rewrite ile aynı sprint).

---

## Metric golden snapshot JSON pipeline

**Trigger:** Metric formula değişiklikleri başka regresyona neden olur.

**Status:** Doc'ta vaadedilmiş, dosya yok

`docs/METRIC_FIXTURES.md:113-117` "Sonraki adımlar": "Golden snapshot JSON dosyası (`__tests__/golden/operations-overview.json`) — Phase 2'de." Vitest landed sonrası bu file otomatik regression test temeli olmalı.

**Eylem:**
- `server/analytics/__tests__/golden/` dizini
- `operations-overview.json` + `byPriority.json` + `byTeam.json` snapshot'ları
- Vitest test runner snapshot diff

**Çaba:** Vitest sonrası 2 saat fixture + diff matcher.

---

## In-product help registry coverage gap

**Trigger:** Her major user-facing PR'da yeni topic'in `helpRegistry.ts`'e eklenmesi.

**Status:** Yalnız Data Import topic migrate edildi

`docs/IN_PRODUCT_HELP_STANDARD.md §Registry "Migration policy"`: "do NOT migrate every existing screen at once. Start with the most critical topic (Data Import) and grow as PRs touch new screens." §B'deki 6 critical screen sınıfı (case workflows, account master, admin definitions, AI/KB, reporting, permissions) henüz topic yazılmadı.

**Eylem:** Her PR Help Impact gate ile uyumlu olunca otomatik organik büyüme; aşağıdaki "shared `HelpButton`/`HelpDrawer` extraction" da bunu hızlandırır.

**Status hedefi:** 6 critical screen sınıfı için bir-bir topic yazılması — explicit takvim yok, organik.

---

## Shared `HelpButton` / `HelpDrawer` component extraction

**Trigger:** Help registry coverage 2. kritik topic'e ulaştığında.

**Status:** Deferred (Data Import bir tek topic — örüntü tek noktada)

`docs/IN_PRODUCT_HELP_STANDARD.md §Component pattern`: "A lightweight `HelpButton` / `HelpDrawer` wrapper can be added when more screens migrate; for now, individual screens may render their own drawer." Bugün `ImportHelpPanel.tsx` tek implementasyon — copy-paste yerine shared component ihtiyacı 2. topic'te kendini gösterir.

**Eylem:** `src/components/help/HelpButton.tsx` + `HelpDrawer.tsx`; mevcut ImportHelpPanel'i wrapper'a refactor et.

**Çaba:** Yarım gün (2. topic ekleyen PR ile birlikte).

---

## Admin / account list cap audit

**Trigger:** Defansif performans sweep (Performance Gate başlık #6 "Large Query Guards" kapsamı).

**Status:** Case list capped ✓ (WR-H1, `Math.min(200, limit)`), diğer endpoint'ler audit edilmedi

`docs/planning_cards/WR-H1.md` "Next: accounts list cap audit." Account list endpoint'inde mevcut `Math.min(100, limit)` cap var, ama 12+ admin list endpoint'i (`/api/admin/categories`, `/teams`, `/sla-policies`, `/checklist-templates`, `/field-definitions`, `/knowledge-sources`, `/external-kb-settings`, ...) sistematik audit edilmedi.

**Eylem:** Tüm `GET /api/...` list endpoint'lerinde `Math.min(N, limit)` cap olduğunu doğrula; smoke-data-contracts'a yeni `defineGroup` "Query Hard Caps Contract" ekle (her endpoint için `?limit=10000` → response ≤ cap assertion).

**Çaba:** Yarım gün audit + 2 saat smoke group.

---

## Drawer prefetch / N+1 review (WR-H3 measurement-gated)

**Trigger:** Production-shadow gerçek 99p latency ölçümü.

**Status:** Önerilen iki opsiyon arasında karar bekliyor

`docs/planning_cards/WR-H2.md` "Next: H3 prefetch ölçüm + cost-benefit." Drawer selected case'de paralel 4 fetch (`getCase` + `getCaseCustomerContext` + notes + files); cold start'ta connection burn-in. İki yön:
- (a) Liste hover prefetch (mouseenter → fetch start, debounce 150ms)
- (b) Bileşik endpoint `GET /api/cases/:id?include=context,notes,files`

**Önkoşul:** Önce prod-shadow ölçüm; sonra karar. H2 (drawer reopen cache) bu cost-benefit'i zaten değiştirdi olabilir.

**Çaba:** Karar sonrası 1-2 gün.

---

## TCKN pepper rotation owner / runbook

**Trigger:** İlk pepper rotation (yıllık veya security incident).

**Status:** A2 shipped, rotation tooling yok

A2 `TCKN_HASH_PEPPER` env secret olarak prod'da; HMAC + last4 + masked storage çalışıyor. KVKK gereği yıllık batch rehash gerekir, ama:
- Pepper kim üretip yönetir? (System admin / KMS / manuel) — `MASTER_DATA_DECISION_SPRINT.md §Open` hâlâ açık karar
- `scripts/rehash-tckn.js` yok
- Operator runbook ("hot-rotate prosedürü") yok

**Eylem:**
- Karar: pepper sahibi (sysadmin vs KMS)
- Rehash script: eski pepper'la mevcut hash'leri decrypt edemeyiz (HMAC tek yönlü); ya plain TCKN re-input gerek (impractical) ya da rotation = forward-only (yeni TCKN'ler yeni pepper, eski hash'ler eski pepper'la "sealed"). Bu mimariyi belgelemek lazım.
- Runbook + DPO ile review

**Çaba:** Karar + 2 gün (mimari + runbook).

**Bağlantı:** BACKLOG P4 "TCKN pepper rotation runbook" item'i bu debt'in implementation karşılığı.

---

## AccountProduct catalog-bound refactor

**Trigger:** Catalog-bound SLA/Checklist refactor (yukarıda) ile aynı sprint.

**Status:** Legacy string field hâlâ aktif

`docs/planning_cards/WR-A6.md` ⑥: "AccountProduct refactor — bir sonraki phase'de catalog-bound olabilir (kararı ileride)." Bugün `AccountProduct` rich metadata'sı `Case.productGroup` string field'ı ile drift'li.

**Eylem:** A7b shipped olduğu için catalog hazır; AccountProduct → Product FK migration + legacy field deprecate.

**Çaba:** 1 gün.

---

## Engineering Handover Documentation

**Priority:** Must complete before handing over to dev team
**Status:** Partially Complete

### Required documents

- [x] **README.md** — project summary, local setup, commands, doc links
- [x] **docs/API.md** — BFF endpoints, auth, tenant scope, request/response examples
- [x] **docs/ARCHITECTURE.md** — frontend, BFF, Prisma, Supabase, cron, AI, multi-tenant
- [x] **docs/OPERATIONS.md** — env, migration, deployment, cron, monitoring, troubleshooting
- [ ] **docs/HANDOVER.md** — current state, completed/pending work, tech debt, risks,
  recommended first-week review order
- [ ] **docs/PRODUCT_CONTEXT.md** — user roles, main workflows, business rules,
  product decision rationale
- [x] **docs/ROADMAP.md** or GitHub Issues — next phases, open items, priorities

> **Note:** `docs/DATA_MODEL.md` will be prepared after schema stabilizes.

**Trigger:** Before any engineering team handover.

**Handover rule:** This checklist is the source of truth for engineering handover
readiness. The project should not be considered ready for team takeover until all
required handover documents are complete or explicitly deferred with owner/date.
