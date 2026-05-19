# Agentic Planning Card — C1 Unassigned case "Üstlen" (claim)

- **Work Register ID:** C1
- **Product Planning Matrix ID:** PM-07 (Vaka Sahiplenme / Claim)
- **Product capability:** Self-service vaka üstlenme, Supervisor bottleneck'ini düşürme
- **Request source:** WR Ready quick-win
- **Card sahibi:** Ürün direktörü + agent
- **Tarih:** 2026-05-19
- **Protocol versiyonu:** 2.0 (lightweight)

---

## ① Product Fit
- **Problem:** Atanmamış vakalar Supervisor'ın elle atamasını bekliyor; Agent kendi başına üstlenemiyor. Frontline'da bottleneck + boş duran vaka.
- **Business fit:** PARAM/UNIVERA/FINROTA — üçü de quick-win. Supervisor yükünü düşürür, frontline owns iş başlangıcını.
- **Affected roles:**
  - Agent, Backoffice, CSM, Supervisor, Admin, SystemAdmin: claim yapabilir
  - Mevcut RBAC dışındaki kullanıcılar: 403
- **Acceptance criteria:**
  1. `POST /api/cases/:id/claim` mevcut + auth listesi izin verir
  2. Sadece açık (Cozuldu/IptalEdildi olmayan) ve atanmamış (assignedPersonId IS NULL) vakalar üstlenilebilir
  3. Atomic update (race-safe — `updateMany` WHERE NULL)
  4. Başarıda: assignedPersonId/Name/TeamId güncellenir + CaseActivity (`FieldUpdate`, "Vaka üstlenildi: X")
  5. İkinci claim attempt → 409 "Bu vaka başka bir kullanıcı tarafından üstlenilmiş olabilir"
  6. Kapalı vaka claim → 400 "Kapalı vaka üstlenilemez"
  7. Cross-tenant → 403/404 mevcut scope pattern
  8. UI: CasesListPage row + CaseDetailPage'de "Üstlen" butonu (uygun durumlarda)
- **Out-of-scope:** Otomatik claim önerisi, claim leaderboard, smart load balancing, "bırak" (unclaim) endpoint'i, bulk claim.
- **Decisions:** Yok. Edge: User'ın personId'si yoksa (örn. SystemAdmin) → 400 "Bu hesap claim yapamaz (Person kaydı yok)".

## ② Architecture Fit
- **Schema impact:** Yok — mevcut alanlar (`assignedPersonId`, `assignedPersonName`, `assignedTeamId`) yeterli.
- **API impact:** Yeni `POST /api/cases/:id/claim` endpoint. Response: updated case (lightweight, mevcut `shape()` pattern).
- **Role/scope impact:** Aynı LIST_ROLES (zaten authenticated case path'i); `requireRole` ile 6 rol whitelist.
- **Privacy/PII:** Yok.
- **Migration/backfill:** Gerekmez.
- **Backward compatibility:** Pure additive endpoint.
- **Modeling guardrails check:** ✓ 7/7

## ③ Performance & Architecture Gate
- **Query/index impact:** Tek `case.updateMany({ where: { id, assignedPersonId: null, status: { notIn: closed }, companyId: { in: allowed } }, data: {...} })` — atomic. Yeni index gerekmez (Case.id primary key kullanılıyor). N+1 yok.
- **Cache strategy:** Mutation sonrası `invalidateCaseDetail(caseId)` çağrılır (caseService.update pattern'i ile aynı). Yeni cache key yok.
- **Large query guard:** N/A (single-row atomic).
- **Frontend performance:** Liste sayfasında her row için "Üstlen" buton koşulu basit ternary; ekstra render yükü yok. Mutation sırasında row-level loading (full-screen blocker yok).
- **Concurrency:** **Bu PR'ın merkezi**. `updateMany` WHERE filter'ı race koşulunu kapatır — iki kullanıcı eş zamanlı claim'lerse Postgres ilk başarıyı kaydeder, ikincide `count: 0` döner → 409 fırlatılır.
- **Observability:** CaseActivity insert mevcut audit log standardını takip eder. Ek telemetri gerekmiyor.
- **Verdict:** **Pass** — gate başlık #5 Concurrent Mutations için atomic update pattern (anti-pattern #14 mutation block protection için inline loading).

## ④ Code Fit
- **File impact:**
  - **BE:**
    - `server/db/caseRepository.js` — yeni `claim({ caseId, user })` metodu
    - `server/routes/cases.js` — yeni `POST /:id/claim` route
  - **FE:**
    - `src/services/caseService.ts` — yeni `claimCase(id)` + cache invalidation
    - `src/features/cases/CasesListPage.tsx` — row action "Üstlen"
    - `src/features/cases/CaseDetailPage.tsx` — sidebar "Üstlen" butonu
  - **Script:**
    - `scripts/smoke-case-claim.js` — 10 senaryo
- **Reuse plan:** `assertCaseInScope`, `CaseAccessError`/`CaseValidationError`, `shape()`, `notify` toast, `invalidateCaseDetail` cache invalidate, `requireRole` route guard.
- **No-touch:** `caseRepository.update`, `linkAccount`, `transitionStatus`, mevcut RBAC sabitleri, watcher subscribe logic.
- **Risk:** Düşük. Tek atomic update; mevcut pattern'lere uyumlu.
- **Likely test files:** `smoke-case-claim.js` (yeni).

## ⑤ QA Fit
- **Automated:**
  - smoke-case-claim.js 10 senaryo (success path, race conflict 409, cross-tenant 403/404, closed 400, already-assigned 409, supervisor/admin claim, list filter intactness, no cross-tenant leak)
- **Manual:**
  - Agent: list'ten "Üstlen" → row güncellenir + toast + CaseActivity görünür
  - Agent2 aynı vakayı tıklarsa → "başkası üstlenmiş" toast + list refresh
  - Admin: claim yapabilmeli
  - Supervisor: claim yapabilmeli
  - Closed case: buton görünmemeli (UI guard)
  - Assigned case: buton görünmemeli
- **Seed:** Mevcut demo data yeterli (atanmamış vaka pool'u var).
- **Backward compat:** Mevcut endpoint'ler etkilenmiyor; sadece yeni POST.
- **Production smoke:** Gereksiz (deterministic atomic SQL).

## ⑥ Decisions — Yok

## ⑦ Ready / Not Ready — **Ready**

## ⑧ Implementation Prompt
Spec'in 8 noktasına uy:
1. `caseRepository.claim({ caseId, user, allowedCompanyIds })`:
   - Önce `assertCaseInScope` — 403/404 hatasını fırlatır
   - `prisma.case.findUnique({ select: { status, assignedPersonId, companyId } })` — closed/already-assigned ön check + early 400/409
   - `if (!user.personId)` → 400 "Bu hesap claim yapamaz"
   - `prisma.person.findUnique({ where: { id: user.personId }, select: { teamId: true } })` → teamId
   - **Atomic:** `prisma.case.updateMany({ where: { id, assignedPersonId: null, status: { notIn: ['Cozuldu', 'IptalEdildi'] } }, data: { assignedPersonId: ..., assignedPersonName: ..., assignedTeamId: teamId } })`
   - `if (count === 0)` → 409
   - CaseActivity create (FieldUpdate, "Vaka üstlenildi: X")
   - Return `shape(updated)` via re-fetch with include
2. Route POST `/:id/claim` — `requireRole(...6 roles)`, asyncRoute wrapper, error mapping
3. `caseService.claimCase(id)` — POST + invalidate prefix `/api/cases/:id`
4. CasesListPage: row condition + button + handler (local row loading)
5. CaseDetailPage: sidebar button (assignment area)
6. smoke-case-claim.js

## ⑨ Test Plan
10-assertion smoke + 6 manuel rol senaryosu.

## ⑩ Rollback
Revert tek atomic mutation; pure additive endpoint, veri kaybı yok.

## ⑪ Register Updates
- [ ] Merge sonrası WR C1: Ready → Shipped + commit hash.

## ⑫ Git Flow / Topology Metadata
- **Current branch:** `feat/case-claim`
- **PR base:** `dev`
- **PR head:** `feat/case-claim`
- **Branch deletion after merge:** Yes (local + remote)
- **Topology pre-PR:** `origin/main..origin/dev` empty ✓ · `origin/dev..origin/main` empty ✓ (her ikisi `81c08d4`)
