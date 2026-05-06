# Technical Debt

Bu doküman bilinen teknik borç ve geleceğe ertelenmiş işleri kayıt altına alır.
Her madde tetikleme koşulu (trigger) ile birlikte yazılır — durumu değişen
maddeler güncellenir veya kaldırılır.

---

## Engineering Handover Documentation

**Priority:** Must complete before handing over to dev team
**Status:** Pending

### Required documents

- **README.md** — project summary, local setup, commands, doc links
- **docs/API.md** — BFF endpoints, auth, tenant scope, request/response examples
- **docs/ARCHITECTURE.md** — frontend, BFF, Prisma, Supabase, cron, AI, multi-tenant
- **docs/OPERATIONS.md** — env, migration, deployment, cron, monitoring, troubleshooting
- **docs/HANDOVER.md** — current state, completed/pending work, tech debt, risks,
  recommended first-week review order
- **docs/PRODUCT_CONTEXT.md** — user roles, main workflows, business rules,
  product decision rationale
- **docs/ROADMAP.md** or GitHub Issues — next phases, open items, priorities

> **Note:** `docs/DATA_MODEL.md` will be prepared after schema stabilizes.

**Trigger:** Before any engineering team handover.
