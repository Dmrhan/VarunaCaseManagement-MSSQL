# Agentic Planning Card — F7 AI Telemetry Verification Smoke

- **Work Register ID:** F7
- **Product Planning Matrix ID:** PM-16 (AI Usage / Cron Health / QA / Pattern Alerts)
- **Product capability:** Operasyonel görünürlük — AI Usage Dashboard'a giren telemetrinin doğruluk garantisi
- **Request source:** WR Ready quick-win; AGENTIC_PLANNING_PROTOCOL v2.0 §③ #7 Observability mitigation
- **Card sahibi:** Ürün direktörü + agent
- **Tarih:** 2026-05-19
- **Protocol versiyonu:** 2.0 (lightweight)

---

## ① Product Fit
- **Problem:** Tüm backend AI çağrılarının `AIUsageLog`'a yazıldığı doğrulanmadı; gelecek AI feature'ı sessizce log'suz eklenebilir. F1'in geniş envanter işi backlog'da; F7 onun **hemen yapılabilir küçük adımı**: deterministic smoke + data-contract guard.
- **Business fit:** Üç tenant için de AI maliyet/kullanım dashboard'unun güvenilirliği. Müşteriye "yatırım yaptığımız AI'ın ROI'sini gösteriyoruz" mesajı şu an telemetri kapsamı ölçülmüş değil.
- **Affected roles:** Admin (AI Usage Dashboard'u görür); SystemAdmin (smoke runner).
- **Acceptance criteria:**
  1. `AIUsageLog` schema kontratının kontratı smoke ile assert edilir (required fields, nullable beklentileri).
  2. 18 bilinen AI endpoint identifier'ı için `logAIUsage` çağrı path'inin var olduğu kanıtlanır (DB'de daha önce yazılmış satırlar veya kod-statik path doğrulaması).
  3. `AIUsageLog` tablosunda **YASAK** PII/raw-prompt alanları yok — schema-level kontrat.
  4. Dashboard aggregate query (COUNT, AVG responseTimeMs, GROUP BY endpoint) deterministic çalışır + null behavior beklenen şekilde.
  5. `scripts/smoke-data-contracts.js`'e yeni "AI Telemetry Contract" grup eklendi (4-5 cheap check).
- **Out-of-scope:**
  - F1 (büyük envanter / dashboard logic review umbrella)
  - Gerçek OpenAI çağrı yaparak full e2e test (cost'lu)
  - AI Usage Dashboard UI değişiklikleri
  - Yeni telemetri kolonu (acceptedAt, errorRate, costEstimate vb.)
  - acceptedRate aggregate'in iyileştirilmesi
- **Product decisions needed:** Yok.

## ② Architecture Fit
- **Schema impact:** Yok. `AIUsageLog` mevcut model üzerinden okuma.
- **API impact:** Yok. Sadece smoke + data-contract groups.
- **Role/scope impact:** Yok.
- **Privacy/PII:** Smoke schema'da `customerContactName/Phone/Email`, `customerCompanyName`, `prompt`, `system`, `user`, `text`, `content` gibi forbidden field'ların **yokluğunu** assert eder. Mevcut schema (kontrol edildi: id/companyId/endpoint/caseId/userId/accepted/responseTimeMs/tokenCount/createdAt) bu kuralı **zaten** karşılıyor; smoke regression guard görevi görür.
- **Migration/backfill:** Yok.
- **Backward compat:** Pure additive scripts.
- **Modeling guardrails:** ✓ 7/7

## ③ Performance & Architecture Gate
- **Query/index impact:** Yok. Smoke deterministic count + distinct queries; mevcut index'lerle uyumlu (companyId, companyId+createdAt, endpoint).
- **Cache strategy:** Yok (smoke 1-shot run).
- **Large query guard:** Yok — okumalar küçük (`LIMIT` veya tek `count`).
- **Frontend perf:** Yok (FE değişmiyor).
- **Concurrency:** Yok (read-only smoke).
- **Observability:** Bu PR'ın **kendisi** F1 umbrella için observability platformu sağlıyor. Cost estimate aşağıda.
- **OpenAI cost estimate:** **$0.00** — Smoke gerçek OpenAI çağrısı yapmaz; sadece DB okumaları + schema inspection. No new recurring AI calls.
- **Verdict:** **Pass** — gate başlık #7 (Observability) mitigation.

## ④ Code Fit
- **File impact:**
  - **Script:** `scripts/smoke-ai-telemetry.js` (yeni, ~250 satır)
  - **Script:** `scripts/smoke-data-contracts.js` (4-5 cheap check eklenir "AI Telemetry Contract" grubu altında)
  - **BE:** **Yok** — eksik logAIUsage tespit edilmedi (aiHandler wrapper auto-loglar tüm 15 endpoint'i; transferAi/actionSummaryAi/qaScoreBatch manuel loglar).
- **Reuse plan:** Mevcut data-contracts harness (`defineGroup`/`check`); mevcut Prisma model introspection; mevcut auth seed personas.
- **No-touch list:** aiClient.js, aiHandler wrapper, ai.js routes (kod fix yok), AIUsageLog schema, AI prompt'lar.
- **Implementation risk:** Düşük — pure read-only smoke.
- **Likely test files:** Yeni `smoke-ai-telemetry.js` + data-contracts ek check'ler.

## ⑤ QA Fit
- **Automated:** smoke-ai-telemetry 4 section (A/B/C/D) ~12-15 assertion; smoke-data-contracts +4 cheap check.
- **Manual:** Yok (FE değişmedi, sadece smoke script çalıştırma).
- **Seed:** Mevcut demo seed yeterli; `AIUsageLog` tablosu seed-full-demo + kullanımla daha önce dolmuş.
- **Backward compat:** Etkilenmiyor.
- **Production smoke:** Gereksiz (FE/BE değişmedi).

## ⑥ Decisions — Yok

## ⑦ Ready / Not Ready — **Ready**

## ⑧ Implementation Prompt
1. `scripts/smoke-ai-telemetry.js`:
   - **A** Schema/contract: information_schema ile AIUsageLog kolonları read; required (id/endpoint/createdAt) + nullable (userId/caseId/accepted/responseTimeMs/tokenCount) + forbidden (yok)
   - **B** Path coverage: 18 bilinen endpoint identifier listesi (15 route + 3 lib/cron: transfer-cause-analysis, devir-brief, action-summary, qa-score-batch — exact names from grep) → DB'de her biri için `count > 0` veya WARN
   - **C** Privacy: forbidden field listesi (customerContact*/customerCompanyName/prompt/system/user/text/content/raw) — information_schema check
   - **D** Dashboard aggregate sanity: COUNT, AVG(responseTimeMs), GROUP BY endpoint queries deterministic + reasonable
2. `scripts/smoke-data-contracts.js`:
   - Yeni `defineGroup('AI Telemetry Contract', ...)`:
     - AIUsageLog.endpoint not null/empty for existing rows
     - responseTimeMs numeric when present (>0)
     - tokenCount numeric when present
     - Forbidden columns absent (PII regression guard)
     - cron userId nullable accepted (qa-score-batch rows have null userId)
3. Validation
4. Branch `feat/ai-telemetry-smoke` → `dev` PR

## ⑨ Test Plan
A/B/C/D = ~15 assertion + 4 data-contract checks. Read-only, deterministic.

## ⑩ Rollback
`git revert <merge-sha>` — script-only.

## ⑪ Register Updates
- [ ] Merge sonrası WR F7: Ready → Shipped + commit hash.

## ⑫ Git Flow / Topology Metadata
- **Current branch:** `feat/ai-telemetry-smoke`
- **PR base:** `dev`
- **PR head:** `feat/ai-telemetry-smoke`
- **Branch deletion after merge:** Yes (local + remote)
- **Topology pre-PR:** `origin/main..origin/dev` empty ✓ · `origin/dev..origin/main` empty ✓ (her ikisi `42b060e`)
