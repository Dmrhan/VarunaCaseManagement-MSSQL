# Technical Debt

Bu doküman bilinen teknik borç ve geleceğe ertelenmiş işleri kayıt altına alır.
Her madde tetikleme koşulu (trigger) ile birlikte yazılır — durumu değişen
maddeler güncellenir veya kaldırılır.

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
