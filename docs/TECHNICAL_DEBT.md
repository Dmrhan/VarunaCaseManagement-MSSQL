# Technical Debt

Bu doküman bilinen teknik borç ve geleceğe ertelenmiş işleri kayıt altına alır.
Her madde tetikleme koşulu (trigger) ile birlikte yazılır — durumu değişen
maddeler güncellenir veya kaldırılır.

**Son güncelleme:** 2026-05-27 (Backlog Reality Audit cleanup)

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
