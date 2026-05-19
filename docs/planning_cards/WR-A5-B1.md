# Agentic Planning Card — A5 SupportLevel + B1 Team Lead (Phase 1 Foundation)

- **Work Register IDs:** A5, B1
- **Product Planning Matrix ID:** PM-03 (Support tier + team leadership for L1/L2 operations)
- **Product capability:** Vaka destek seviyesi (L1/L2/L3/Expert) + takım lideri bayrağı. SLA/escalation/routing entegrasyonları sonraki phase'lere bırakılıyor.
- **Request source:** Backlog A5 + B1; UNIVERA proje bazlı L1/L2 destek modeli
- **Card sahibi:** Ürün direktörü + agent
- **Tarih:** 2026-05-20
- **Protocol versiyonu:** 2.0
- **Scope guard:** PHASE 1 FOUNDATION ONLY. **No** PersonTeam multi-membership tablosu, **no** `Product.supportLevel` migration (A6 foundation shipped ama A5 dependency sonrası ayrı PR), **no** SLA/escalation rewrite, **no** routing logic değişikliği.

---

## ① Product Fit

- **Problem:** Mevcut schema'da `Team`, `Person.teamId` var ama explicit takım lideri yok ve destek seviyesi (tier) boyutu yok. UNIVERA müşterileri L1/L2 destek alıyor (özellikle proje-tabanlı); şu an bunu sistem üzerinden takip etmek mümkün değil. SLA/escalation Phase 2'de tier-aware olacak; bu kart foundation kuruyor.

- **Business fit:**
  - **UNIVERA** core ihtiyacı — saha L1 / merkez L2 routing, proje bazlı destek tier'ları
  - **PARAM/FINROTA** opt-in — gelecekte tier-aware SLA matching faydalı
  - **B1 takım lideri** — agent ataması + escalation iş akışı için Phase 2 hazırlık

- **Affected roles:**
  - Admin / SystemAdmin — Person `isTeamLead` toggle, Person `supportLevel`, Team `defaultSupportLevel` CRUD
  - Supervisor / Admin / SystemAdmin — Case `supportLevel` patch (sonradan değiştirme)
  - Agent — Case `supportLevel` **patch yetkisi YOK** (D-A5.1)
  - Tüm roller — Case `supportLevel` badge görür (read-only)

- **Acceptance criteria:**
  1. `SupportLevel` enum: L1, L2, L3, Expert
  2. `Person.isTeamLead Boolean @default(false)`
  3. `Person.supportLevel SupportLevel @default(L1)`
  4. `Team.defaultSupportLevel SupportLevel @default(L1)`
  5. `Case.supportLevel SupportLevel @default(L1)` + index `(companyId, supportLevel)` (filter hazır)
  6. **Case create cascade:**
     - `assignedPersonId` set ise → Person.supportLevel
     - else `assignedTeamId` set ise → Team.defaultSupportLevel
     - else → L1 (DB default)
  7. **Case update:** Only Supervisor/Admin/SystemAdmin (Agent forbidden — D-A5.1). Admin route'unda 403.
  8. Admin UI: Team edit modal'a `defaultSupportLevel` select, Person edit modal'a `supportLevel` + `isTeamLead` toggle
  9. Case detail: supportLevel badge classification panel'inde; inline edit Supervisor+
  10. Seed: Major takımlara birer team lead; Person.supportLevel rol-bazlı dağılım; UNIVERA case'lerinde L1/L2 karışım
  11. Smoke 10 senaryo + data-contracts extension

- **Out-of-scope:**
  - PersonTeam join table (multi-membership)
  - Product.supportLevel migration (A6 sonrası ayrı PR — `Product.supportLevel` add column)
  - SLA matching tier-aware rewrite
  - Escalation engine tier dispatch
  - Routing / auto-assign by tier
  - CasesListPage supportLevel filter UI (chip render zaten yapılır; filter Phase 2)

- **Decisions:**
  - **D-A5.1:** Case.supportLevel patch sadece Supervisor/Admin/SystemAdmin. Agent isteği 403. Mevcut Case PATCH endpoint zaten her role açık ama yeni alan için role gating eklenir (asyncRoute katmanında değil; repository-level `if ('supportLevel' in patch) require ['Supervisor','Admin','SystemAdmin','CSM']` — CSM dahil çünkü customer-facing escalation kararını alabilir).
  - **D-A5.2:** Default cascade person → team → L1. Patch'te explicit set edilirse cascade override edilir.
  - **D-A5.3:** Mevcut Cases (~330 demo) için backfill: migration'da yapılmaz; `@default(L1)` ile DB-level default sağlanır. Tüm mevcut satırlar L1 olur. Seed re-run karışık L1/L2'ye günceller.
  - **D-A5.4:** `Product.supportLevel` eklenmez bu PR'da. A5 enum shipped olunca A6 follow-up migration ile gelir (yapı: `ALTER TABLE "Product" ADD COLUMN "supportLevel" "SupportLevel" NOT NULL DEFAULT 'L1'`). Bu kararı WR-A6 row'unda zaten not aldık.
  - **D-A5.5:** Person `isTeamLead` toggle sadece Admin/SystemAdmin. Supervisor/CSM yapamaz.
  - **D-A5.6:** L3/Expert enum'da var ama bu PR'da UI dropdown'larda gösterilir — kullanılırsa erken sinyal alırız; gerekirse Phase 2'de UI gizleme kararı verilir.

---

## ② Critical Files

**Schema/migration:**
- `prisma/schema.prisma` — enum SupportLevel + Person (2 alan) + Team (1 alan) + Case (1 alan + index)
- `prisma/migrations/20260520140000_add_support_level/migration.sql`

**BFF:**
- `server/db/enumMap.js` — supportLevel pass-through (no TR mapping; identifier zaten kullanım için uygun)
- `server/db/caseRepository.js` — create cascade + update role gating
- `server/db/adminRepository.js` — teamRepo update + personRepo update (yeni alanlar)
- `server/routes/admin.js` — `isTeamLead` toggle gating (Admin/SystemAdmin only — zaten admin namespace bunu zorlar)

**Frontend:**
- `src/services/adminService.ts` — `SupportLevel` type + `CaseTeam.defaultSupportLevel` + `CasePerson.supportLevel`/`isTeamLead` types
- `src/features/cases/types.ts` — `Case.supportLevel` field
- `src/features/admin/AdminTeamsPage.tsx` — team modal'a select
- (Person editor zaten AdminTeamsPage içinde mi?) — kontrol edilecek
- `src/features/cases/CaseDetailPage.tsx` — badge + inline edit
- (Cases list chip optional — column yer varsa)

**Seed/smoke:**
- `scripts/seed-full-demo-scenarios.js` — team lead atama + person supportLevel dağılım + case supportLevel karışım
- `scripts/smoke-support-level-team-lead.js` — yeni (10 senaryo)
- `scripts/smoke-data-contracts.js` — yeni "Support Level / Team Lead Contract" group

---

## ③ Performance & Architecture Gate

| # | Concern | Address |
|---|---|---|
| 1 | **Indexed FK + scope index** | `Case`: yeni `@@index([companyId, supportLevel])` — tier-based filter hot path (Phase 2 SLA/routing). Person/Team yeni alanlar enum + bool — separate index gereksiz (mevcut companyId/teamId index'leri yeterli). |
| 2 | **No relation-heavy `include`** | Case create cascade `assignedPersonId` → `prisma.person.findUnique({ select: { supportLevel: true } })` (scalar select). Hot path tek ek query (~1ms cached). |
| 3 | **N+1 guard** | Cascade single fetch — yok. Liste view'lara `Person.team` JOIN eklenmez. |
| 4 | **Unbounded list cap** | Bu PR list endpoint'i değiştirmiyor; sadece Case create / update / detail. |
| 5 | **`count()` vs `findMany().length`** | Smoke + contracts `prisma.person.count({ where: { isTeamLead: true } })` kullanır — `findMany().length` yasak. |
| 6 | **Large query guard** | Yok — Case PATCH single row update. |
| 7 | **Mutation atomicity** | Case create cascade tek Prisma create — supportLevel computation pre-create'te yapılır; trans yok (zaten tek statement). |
| 8 | **UI loading state** | Inline patch existing pattern (Supervisor inline edit on case detail) — yeni global blocker yok. |
| 9 | **Lazy load** | Yok — yeni component yok, mevcut Admin modal'larına satır eklenir. |
| 10 | **Connection pool** | Mevcut endpoint sayısı değişmez; Case create'e ek 1 query (cascade fetch) — Supabase pooler için ihmal edilebilir. |

**Verdict: PASS.**

---

## ④ Decisions Log

(yukarıdaki ⑤ Acceptance kısmında tutuldu)

---

## ⑤ Test Plan (özet)

**10 ana senaryo (smoke-support-level-team-lead.js):**
1. Schema: SupportLevel enum exists; Person/Team/Case columns present
2. Seed: en az 1 team lead per active company (Person.isTeamLead=true count > 0)
3. Person.supportLevel non-null distribution check (L1 + L2 her ikisi var)
4. Team.defaultSupportLevel non-null distribution check
5. Case create with assignedPersonId → Case.supportLevel = Person.supportLevel
6. Case create with assignedTeamId only → Case.supportLevel = Team.defaultSupportLevel
7. Case create with neither → Case.supportLevel = L1 (DB default)
8. Supervisor PATCH Case.supportLevel → 200
9. Agent PATCH Case.supportLevel → 403 support_level_forbidden
10. Multi-tenant: cross-tenant Case patch supportLevel by foreign admin → 403/404

**Data contracts (Support Level / Team Lead Contract — 7 invariant):**
- SL.1 Person.supportLevel column not nullable (default L1)
- SL.2 Team.defaultSupportLevel column not nullable (default L1)
- SL.3 Case.supportLevel column not nullable (default L1)
- SL.4 Existing Cases all have L1 (migration default backfill)
- SL.5 At least one Person.isTeamLead=true per active company that has teams
- SL.6 No Person.isTeamLead=true with teamId NULL (orphan lead invariant)
- SL.7 UNIVERA cases mix L1 + L2 (seed coverage)

---

## ⑥ Rollback Plan

`git revert <merge-sha>` + `prisma migrate resolve --rolled-back 20260520140000_add_support_level`. Existing Cases drop their L1 default — no data lost (all defaulted to L1 anyway; semantic neutral).

---

## ⑦ Register Updates

- [ ] Merge sonrası WR-A5 + WR-B1 Status: `Ready (Phase 1)` → `Shipped (Phase 1)` + commit hash + PR ref.
- [ ] Shipped tally: `11 → 12` (one row covering both A5+B1 — combined entry).
- [ ] Ready: `11 → 9` (remove A5 + B1).

---

## ⑧ Git Flow / Topology Metadata

- **Current branch:** `feat/support-level-team-lead` (base `dev`)
- **Intended PR base:** `dev`
- **Intended PR head:** `feat/support-level-team-lead`
- **Topology pre-PR:** `origin/main..origin/dev` empty ✓ · `origin/dev..origin/main` empty ✓ (her ikisi `d5cfc47`)
- **Branch deletion after merge:** Yes (local + remote)
- **Path detection:** Post-merge re-fetch + path A/B per [AI_WORKFLOW.md → Git Flow Rules](../AI_WORKFLOW.md#git-flow-rules)
