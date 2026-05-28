# Varuna Case Management

**Varuna**, AI-asistanlı, çok-kiracılı kurumsal vaka yönetimi platformudur. Müşteri operasyonları ve destek ekipleri için tasarlanmıştır; AI Fabric ürünün birinci sınıf bir katmanıdır. Tenant izolasyonu, operasyonel görünürlük, işbirliği, analitik ve denetlenebilirlik temel tasarım hedefleridir.

Bu README **giriş noktasıdır**; canonical statü ve kararlar aşağıdaki dokümanlarda yaşar:

- **Mevcut ürün davranışı:** `docs/PRODUCT_SPEC.md`
- **Shipped envanteri + gelecek yön:** `docs/ROADMAP.md`
- **Aktif iş (2-4 hafta):** `docs/BACKLOG.md`
- **Teknik borç:** `docs/TECHNICAL_DEBT.md`
- **Açık kararlar (canonical):** `docs/OPEN_DECISIONS.md`
- **Quality gate matrisi:** `docs/QUALITY_GATES.md`

---

## 1. Mevcut Yetenekler (shipped foundation)

Üretimde çalışan ana yetenekler. "Foundation" işaretli olanlar canlı ama ileri-faz iyileştirmeler `docs/BACKLOG.md` veya `docs/ROADMAP.md`'de izleniyor. Detay: `docs/ROADMAP.md §"Recent Ships / Platform Capabilities"`.

**Vaka iş akışı**
- Case management (CRUD, statü makinesi, SLA pause/resume, duplicate kontrolü)
- Resolution Approval flow (politika-tetikli, immutable audit)
- Notes + mentions + replies + reactions (CaseNoteReaction tablosu)
- File upload (Supabase Storage 3-step signed URL)
- Action Center / Aksiyonlarım inbox (unified `kind ∈ {approval, mention, watcher_event, system_alert}`)
- Case Watcher + Linked Cases (Related/Duplicate/Parent)
- Snooze / Inbox Later + cron wakeup
- Watcher Inbox UI (sidebar > Çalışma Alanım > İzleyici Inbox)

**Müşteri / hesap (foundation)**
- Account + AccountCompany + AccountContact + AccountAddress modelleri
- Account customerType (Individual / Corporate / Government / NonProfit)
- VKN / TCKN HMAC + last4 + masked storage (KVKK)
- Multi-address (Billing / Shipping / Visit / HQ / Branch — country-agnostic)
- AccountProject Phase 1 (UNIVERA proje-bazlı operasyon için opt-in)
- Deterministic Customer Match suggestions (AI YOK, VKN/telefon/e-posta/ad benzerliği)
- Customerless case flow + `customerMatchPending` flag
- Customer Pulse (case detail + new case flow; deterministic + AI özet)

**Katalog & destek seviyesi (foundation)**
- ProductGroup + Product + `Product.supportLevel` catalog
- Package + PackageItem catalog
- `Case.productId` + `Case.packageId` + `AccountCompany.packageId`
- SupportLevel L1/L2 enum (L3/Expert future-proof) + cascade (explicit > Product > Person > Team > L1)
- Person.isTeamLead flag

**Bildirim & onay**
- D3 Notification rules + templates + dispatch audit (Level A — manual-confirm flow)
- AccountCompany customer response channel fields (`preferredResponseChannel`, `responseEmail`, `responsePhone`)
- Per-case `communicationChannelOverride`
- Aktif e-posta gönderimi **henüz yok** (Resend MVP `docs/BACKLOG.md` P2)
- CaseNotification retention endpoint (cron scheduler dış ops setup)

**Analitik & raporlama**
- Operations Dashboard (11 KPI + breakdown + drilldown drawer)
- AI Brief + Insights + Explain Metric + Drilldown Assistant
- Report Studio (AI Report Draft + Markdown copy + browser print)
- AI Status Report / Durum Raporu
- Pattern detection (PatternAlert cron)
- QA score batch cron

**Veri içeri aktarım (foundation)**
- A8 Phase 1 Veri Aktarım Stüdyosu (Account import + audit + soft rollback)
- A8 Phase 2a Customer 360 Foundation (multi-target schema registry + dry-run)
- Phase 2b commit path açık (`docs/BACKLOG.md` P2)

**Admin & bilgi tabanı**
- 9 admin tanım ekranı (kategori, SLA, checklist, takım, ürün, paket, vb.)
- External KB console
- Custom Fields + CompanySettings (per-tenant)
- 6 rol RBAC (Agent / Backoffice / Supervisor / CSM / Admin / SystemAdmin)

**Quality posture**
- AI telemetry verification smoke (38 senaryo; 19/19 AI endpoint `logAIUsage` coverage)
- Release regression smoke harness (20 senaryo uçtan uca)
- Data contracts smoke (16+ contract grup)
- Help registry freshness smoke
- Demo/scenario seed (`seed-full-demo-scenarios.js`)

---

## 2. Mimari Özet

| Katman | Teknoloji |
|---|---|
| Frontend | React 18 + Vite 6 + TypeScript 5 |
| BFF | Node.js + Express (port 3101; Vercel serverless prod) |
| Veritabanı | Supabase Postgres (Frankfurt EU) + Prisma 6 |
| Auth | Supabase Auth (email/password + Google OAuth) + `verifyJwt` middleware |
| Storage | Supabase Storage (`case-attachments` private bucket; signed upload URL akışı) |
| AI | OpenAI `gpt-4o-mini` (structured output, JSON Schema strict) |
| Cron | Endpoint'ler dual-auth (CRON_SECRET + GitHub Actions); scheduler dış ops setup |
| Multi-tenant | `UserCompany` üyeliği + `req.user.allowedCompanyIds` filtre |
| Deploy | Vercel (`varuna-case-management.vercel.app`) |
| CI | GitHub Actions — Prisma validate + TypeScript + Vite build + help-content smoke |

Detay: `docs/ARCHITECTURE.md` · API yüzeyi: `docs/API.md` · AI endpoint envanteri: `docs/PRODUCT_SPEC.md §14`.

---

## 3. Local Kurulum

```bash
npm install
cp .env.example .env   # gerçek değerlerle doldur
npm run dev            # client (5273) + BFF (3101) birlikte çalışır
```

İzole çalıştırma:

```bash
npm run dev:client     # yalnız Vite
npm run dev:server     # yalnız Express (--watch)
npm run build          # tsc -b + vite build
npm run preview        # production build'i lokal serve
```

> Not: `VarunaExecutiveCockpit` projesi 5173/3001 portlarını kullanır; Varuna 5273/3101 portlarındadır — iki proje paralel çalışabilir.

---

## 4. Environment Variables

Backend:

```bash
DATABASE_URL=               # Prisma runtime (Supabase transaction pooler, port 6543)
DIRECT_URL=                 # Prisma migration (port 5432)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
OPENAI_API_KEY=
TCKN_HASH_PEPPER=           # KVKK — TCKN HMAC için; production'da zorunlu
```

Frontend (Vite — browser'a giden değerler):

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

`VITE_SUPABASE_ANON_KEY` secret değildir (browser'a inerek RLS politikasıyla çalışır). `SUPABASE_SERVICE_ROLE_KEY` yalnız backend'de tutulur.

Detay: `docs/OPERATIONS.md §"Environment Variables"` · Auth setup: `docs/AUTH_SETUP.md` · Supabase setup: `docs/SUPABASE_SETUP.md`.

---

## 5. Veritabanı Komutları

```bash
npm run db:generate          # Prisma Client üret
npm run db:migrate           # local/dev migration uygula
npm run db:migrate:deploy    # production-grade migration uygula (explicit)
npm run db:seed              # mock veri — local/demo/sandbox
npm run db:seed:auth         # demo personalar (Agent/Supervisor/...) — local/demo/sandbox
npm run db:seed:scenarios    # Univera/Finrota/PARAM senaryo verisi — local/demo/sandbox
npm run db:seed:full-demo    # full scenario seed — local/demo/sandbox
npm run db:studio            # Prisma Studio UI
npm run db:reset             # ⚠ destructive; yalnız local
```

> ⚠ **Seed komutları yalnızca local / demo / sandbox ortam içindir.** Production veya gerçek müşteri verisi tutan shared environment'lar üzerinde **asla çalıştırılmaz** — demo persona, bilinen credential ve mock case kayıtları üretir. Production migration **yalnız** `npm run db:migrate:deploy` ile uygulanır; `npm run build` migration çalıştırmaz. Detay: `docs/OPERATIONS.md §"Prisma Operasyonları"` + `docs/AI_WORKFLOW.md §"Seed / Environment Safety"`.

---

## 6. Smoke / Validation Komutları

Her PR'da default CI'da çalışan (DB gerektirmez):

```bash
npm run build                # tsc -b + vite build (CI'da koşar)
npm run smoke:help-content   # helpRegistry.ts banned phrase + freshness (CI'da koşar)
npx prisma validate          # schema syntax (CI'da koşar)
```

DB / env gerektirir (default CI'da değil; manuel veya nightly):

```bash
npm run smoke:data-contracts   # 16+ contract grup, read-only
npm run smoke:ai-telemetry     # 38 senaryo, AI endpoint `logAIUsage` coverage + privacy guard
npm run smoke:release          # 20 senaryo uçtan uca regresyon
```

Eski-adlı (smoke ama `test:` prefix'li — `docs/TECHNICAL_DEBT.md`'de rename item açık):

```bash
npm run test:pattern         # = smoke:pattern-alert (rename pending)
npm run test:qa              # = smoke:qa-scores (rename pending)
```

Hangi değişiklik tipinde hangi smoke zorunlu? → `docs/QUALITY_GATES.md` matrisi.

---

## 7. Quality & Validation Posture

- **PR template** (`/.github/pull_request_template.md`): Work Register ID + Planning Card link + Performance & Architecture Gate verdict + Validation (build / smoke:help-content / smoke:data-contracts when applicable) + Data Contract Impact + AI Telemetry + Help Impact (updated/not needed + concrete reason) + Docs Impact (granular checklist) + Post-merge Topology metadata. Zorunlu — boş bırakılmaz.
- **Default CI** (`.github/workflows/ci.yml`): `npm ci` → `prisma validate` → `tsc -b` → `vite build` → `node --check scripts/smoke-help-content.js` → `npm run smoke:help-content`. DB-bound smoke'lar default CI'da yok; nightly workflow `docs/TECHNICAL_DEBT.md` "smoke:data-contracts CI coverage gap" item'inde planlanıyor.
- **Change-type gate matrisi**: `docs/QUALITY_GATES.md` — docs-only / frontend-only / backend endpoint / schema migration / tenant-auth sensitive / AI feature / cron / import-export / hotfix / release PR.
- **Planning protocol**: Her non-trivial PR `docs/AGENTIC_PLANNING_PROTOCOL.md` 5-aşamalı uyum (Product / Architecture / Performance & Architecture Gate / Code / QA) gerektirir; Card'lar `docs/planning_cards/WR-*.md` altında.
- **AI agent disiplini**: `docs/AI_WORKFLOW.md` (8-section Multi-tenant Endpoint Review checklist + Final Response Format + Git Flow dual-path discipline).
- **Help registry**: `docs/IN_PRODUCT_HELP_STANDARD.md` (banned phrase + `updatedAt` bump + smoke).

---

## 8. Demo Akışı

```bash
npm install
cp .env.example .env
npm run db:generate
npm run db:migrate
npm run db:seed
npm run db:seed:auth
npm run db:seed:scenarios       # opsiyonel — Univera/Finrota/PARAM senaryoları
npm run dev
```

Demo personalar `demo1234` şifresi ile giriş yapar. Senaryo rehberi: `docs/TEST_SCENARIOS.md`.

---

## 9. Proje Yapısı (üst seviye)

```txt
src/
  features/
    cases/           Vaka listeleme, form, detay (full-page 3-kolon)
    accounts/        Account + Company/Contact/Address/Project editör
    action-center/   Aksiyonlarım inbox + drawer + bell
    analytics/       Operations Dashboard + Report Studio
    admin/           9 tanım ekranı + Data Import Stüdyosu
    customers/       Müşteri arama + Customer Card modal
    kb/              External KB console
    my/              MyHome + WatcherInboxPage + MyCalendar
    auth/            Login + SetPassword
  services/          Frontend service'ler (caseService, aiService, vb.)
  help/              In-product help registry (helpRegistry.ts)
  components/ui/     Ortak UI bileşenleri (Drawer, Skeleton, RunaAiCard, ...)

server/
  routes/            BFF endpoint'leri (cases, ai, admin, analytics,
                     action-center, my, approvals, accounts, ...)
  db/                Prisma repository'leri (caseRepository,
                     actionItemRepository, accountRepository, ...)
  analytics/         metricFormulas + operationsAggregator
  cron/              Zamanlanmış işler (snoozeWakeup, patternDetect,
                     qaScoreBatch, notificationCleanup)
  lib/               aiClient + transferAi + import target schemas

prisma/
  schema.prisma      ~50 model
  migrations/        sıralı SQL migration'ları
  seed*.ts           seed entry-point'leri

scripts/
  seed-*.js          full-demo + senaryo seed'leri
  smoke-*.js         70+ smoke script (data-contracts, ai-telemetry,
                     release, help-content, mention-inbox, ...)
  backfill-*.js      idempotent backfill script'leri

docs/                kanonik dokümantasyon (aşağıdaki §11 map'i)
.github/             PR template + CI workflow
```

---

## 10. Multi-Tenant Erişim

Kullanıcı şirket erişimi `UserCompany` üyeliği üzerinden tanımlanır. API sorguları `req.user.allowedCompanyIds` ile sunucu tarafında filtrelenir; FE'ye güvenilmez.

- **SystemAdmin** — tüm şirketlere erişim
- **Admin / Supervisor / Backoffice / CSM / Agent** — yalnızca üye oldukları şirketlerde işlem yapar
- **Multi-tenant izolasyon kontrolü** — `docs/AI_WORKFLOW.md §"Multi-tenant Endpoint & UI Review Checklist"` 8 bölümlü zorunlu kontrol listesi (rol matrisi / scope matrisi / aggregate-count safety / filter safety / picker safety / legacy data / data leakage / regression smoke)

---

## 11. Dokümantasyon Haritası

**Ürün ve davranış**
- [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) — mevcut ürün davranışı, statü makinesi, alan tanımları, AI matrisi, RUNA AI marka kimliği, ekran mimarisi, AI endpoint envanteri
- [`docs/FAZ2_COLLAB_SPEC.md`](docs/FAZ2_COLLAB_SPEC.md) — Faz 2 işbirliği spec'i (§1-14: takipçi, bağlı vakalar, etkinlik akışı, AI rolleri, bildirim, alt görevler, niyet/etki/başarı kriteri, risk göstergesi)
- [`docs/OPERATIONS_DASHBOARD_DESIGN.md`](docs/OPERATIONS_DASHBOARD_DESIGN.md) — analitik yüzey tasarımı

**Planlama ve karar**
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — Recent Ships envanteri + Future Product Direction + Known Limitations
- [`docs/BACKLOG.md`](docs/BACKLOG.md) — aktif iş (P0-P4)
- [`docs/TECHNICAL_DEBT.md`](docs/TECHNICAL_DEBT.md) — engineering risk ve cleanup
- [`docs/REPORT_STUDIO_BACKLOG.md`](docs/REPORT_STUDIO_BACKLOG.md) — Report Studio özel backlog
- [`docs/OPEN_DECISIONS.md`](docs/OPEN_DECISIONS.md) — canonical açık karar register (OD-XXX ID'li, 8 kategori, ~85 entry)
- [`docs/WORK_REGISTER.md`](docs/WORK_REGISTER.md) — item-bazlı tracking tablosu
- [`docs/PRODUCT_PLANNING_MATRIX.md`](docs/PRODUCT_PLANNING_MATRIX.md) — PM-XX capability görünümü

**Teknik referans**
- [`docs/API.md`](docs/API.md) — BFF endpoint'leri, auth, tenant scope, request/response örnekleri
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — sistem mimarisi, FE/BFF/Prisma/Supabase/AI flow
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — env, migration, deploy, cron, monitoring, troubleshooting
- [`docs/AUTH_SETUP.md`](docs/AUTH_SETUP.md) — Supabase Auth + Google OAuth kurulumu
- [`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md) — Supabase project setup + storage bucket
- [`docs/METRIC_FIXTURES.md`](docs/METRIC_FIXTURES.md) — metric formül regresyon fixture'ları
- [`docs/INCIDENTS.md`](docs/INCIDENTS.md) — production incident log

**Süreç ve kalite**
- [`docs/QUALITY_GATES.md`](docs/QUALITY_GATES.md) — change-type başına zorunlu gate matrisi
- [`docs/AI_WORKFLOW.md`](docs/AI_WORKFLOW.md) — AI agent disiplini, review checklist, smoke gate kullanımı, Git Flow Rules
- [`docs/AGENTIC_PLANNING_PROTOCOL.md`](docs/AGENTIC_PLANNING_PROTOCOL.md) — 5-aşamalı planlama döngüsü + Card şablonu
- [`docs/IN_PRODUCT_HELP_STANDARD.md`](docs/IN_PRODUCT_HELP_STANDARD.md) — in-product help registry standardı
- [`docs/TEST_SCENARIOS.md`](docs/TEST_SCENARIOS.md) — PM/QA manuel test senaryoları, persona'lar, bilinen kısıtlamalar
- [`docs/FAZ1_5_RELEASE_NOTES.md`](docs/FAZ1_5_RELEASE_NOTES.md) — Faz 1.5 release notları

**Planning cards** (`docs/planning_cards/WR-*.md`) — shipped/aktif iş için tarihsel design context.

---

## 12. Engineering Handover Notu

README **giriş noktasıdır**; ürün/kod/karar bilgisinin canonical sahibi değildir. Doc sahiplik matrisi:

| Doc | Sahip olduğu sınıf |
|---|---|
| PRODUCT_SPEC.md | Mevcut ürün davranışı (rules, statü makinesi, alanlar, AI matrisi) |
| `ROADMAP.md` | Shipped envanteri + future product direction + known limitations |
| `BACKLOG.md` | Aktif iş listesi (2-4 hafta horizon, P0-P4 öncelik) |
| `TECHNICAL_DEBT.md` | Engineering risk ve cleanup borcu |
| `OPEN_DECISIONS.md` | Açık ürün/teknik kararlar (OD-XXX ID'li, status-track) |
| `QUALITY_GATES.md` | Change-type başına zorunlu validation gate'leri |
| `WORK_REGISTER.md` | İtem-bazlı status track (Shipped / Ready / Backlog / Needs Decision) |
| `AI_WORKFLOW.md` | AI agent + reviewer disiplini, Git Flow Rules |
| `AGENTIC_PLANNING_PROTOCOL.md` | 5-aşamalı planlama protokolü + Card şablonu |

Tutarsızlık durumunda öncelik sırası: `PRODUCT_SPEC` > diğer kanonik doc'lar > README. Bu README değişen davranışı yansıtmazsa, **doc-side bug** olarak `docs/TECHNICAL_DEBT.md`'ye düşülür.

İlk hafta önerisi için ekibe bakış: önce `PRODUCT_SPEC.md` → `ARCHITECTURE.md` → `API.md` → `OPERATIONS.md` → `ROADMAP.md` ve `BACKLOG.md` → `QUALITY_GATES.md` → ilgili `planning_cards/WR-*.md`.
