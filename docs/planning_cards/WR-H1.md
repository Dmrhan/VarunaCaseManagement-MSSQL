# Agentic Planning Card — H1 Case list server-side hard max `pageSize` cap

- **Work Register ID:** H1
- **Product Planning Matrix ID:** — (architecture/performance mitigation; capability eklemiyor, gate'i somutlaştırıyor)
- **Product capability:** Defansif liste sınırı — sistem bütçesi koruyucusu
- **Request source:** AGENTIC_PLANNING_PROTOCOL v2.0 retro review (2026-05-19) — case list endpoint `?pageSize` query param'ında hard cap olmadığı tespit edildi
- **Card sahibi:** Ürün direktörü + agent
- **Tarih:** 2026-05-19
- **Protocol versiyonu:** 2.0

---

## ① Product Fit
- **Problem statement:** `GET /api/cases` endpoint'inde `pageSize` (alias: `limit`) query param user-controlled; UI default 25 ama tenant başına 1000+ vakası olan bir hesap için kötü niyetli/yanlışlıkla büyük değer (`pageSize=10000`) bütün tabloyu döker, response süresi patlar.
- **Business fit:** PARAM/UNIVERA/FINROTA — üçü için de defansif quick-win. Müşteri görünür değer yok (kullanıcı zaten 25-100 arası sayfa istiyor); operasyonel + güvenlik kazancı.
- **Affected roles:** Tüm rolleri etkiler ama Agent/Backoffice'in liste sayfasındaki query'leri zaten 25 ile sabit. Etki bantı: API çağıran kötü niyetli/script kullanıcı.
- **Acceptance criteria:**
  1. `GET /api/cases?pageSize=10000` → response satır sayısı **≤ 200** (hard cap)
  2. `GET /api/cases?pageSize=50` → response satır sayısı = 50 (cap aşılmıyorsa request'i bozma)
  3. `GET /api/cases` (page param yok) → cap'lenmiş **default 25** uygulanır, unbounded sorgu **yok**
  4. Smoke harness `pageSize=10000` ile cap'i doğrular
- **Out-of-scope:**
  - Stats endpoint cap'i (zaten count-bazlı, satır dönmüyor)
  - Accounts/Admin list cap'leri (accounts zaten 100 cap'li; bu PR cases'e odaklı)
  - Cursor-based pagination (BACKLOG F4/F5)
  - UI'da pageSize seçici (out of scope)
- **Product decisions needed:** Yok. Hard cap = **200** (default 25, max 200) seçildi — accounts 100'den fazla, makul tampon.

---

## ② Architecture Fit
- **Schema impact:** Yok.
- **API impact:** `GET /api/cases` davranışı:
  - Eski: `pageSize=N` → take=N (unbounded), no page → unbounded findMany
  - Yeni: `pageSize=N` → take=`min(200, max(1, N || 25))`, no page → take=25
  - Response shape değişmiyor; sadece üst sınır eklenir.
- **Role/scope impact:** Yok (RBAC + tenant filter olduğu gibi korunur).
- **Privacy/risk notes:** Yok.
- **Migration/backfill needs:** Yok.
- **Backward compatibility notes:** Eski client `pageSize=25` gönderiyorsa hiç değişmez. Sadece `pageSize > 200` gönderen olası caller'lar 200 ile sınırlanır — bilinen frontend kullanıcısı yok (CasesListPage default 25).
- **Modeling guardrails check:** ✓ 7/7 — performance mitigation, schema/PII/multi-tenant değişmiyor.

---

## ③ Performance & Architecture Gate  *(TEMİZ ve GÜÇLÜ MİMARİ)*
- **Query/index impact:** Query yapısı değişmiyor; sadece `take` parametresinin değer aralığı clamp ediliyor. Mevcut `Case` index'leri korunuyor; yeni index gerekmez. Cap'in DB'ye etkisi: tek sorguda max 200 satır dönüyor → memory + network savunması.
- **Cache strategy:** Yok — cap stateless, cache irrelevant.
- **Large query guard:** ✅ **Bu PR'ın kendisi**. Gate başlık #6'nın doğrudan implementasyonu. `Math.min(200, max(1, n||25))` clamp pattern'i accountRepository ile uyumlu.
- **Frontend performance:** Etki yok (frontend zaten ≤25 gönderiyor). Yan etki: kötü niyetli/buggy script'ler artık 200 üzeri response yiyemeyeceği için BFF + Supabase pool nefes alır.
- **Concurrency:** Etki yok — stateless.
- **Observability:** Cap'in tetiklendiği durumda **uyarı log'u atılır** (opsiyonel — dev mode için). Smoke harness'ta assertion explicit. Production'da silently clamp kabul edilebilir (200 yeterli üst sınır olmalı).
- **Verdict:** **Pass** — mitigation gerekmedi, gate başlık #6'nın somut karşılığı.

---

## ④ Code Fit
- **File impact map:**
  - **BE:** `server/routes/cases.js` (line 119-121 civarı — pagination object build) — pageSize clamp + default-25 even-without-page
  - **Script:** `scripts/smoke-case-stats.js` — yeni 1-2 assertion (`pageSize=10000` → response.length ≤ 200; no-param → ≤25)
- **Reuse plan:** `accountRepository.listAccounts` pattern'i (`Math.min(100, Math.max(1, Number(limit) || 25))`) — case için 200 max ile aynı yapı.
- **No-touch list:**
  - `caseRepository.list` repository semantics korunur (internal smoke callers unbounded kullanabilir).
  - `CASE_INCLUDE`, filter logic, stats endpoint — dokunulmuyor.
  - UI tarafı — değişiklik yok.
- **Implementation risk:** Çok düşük. Tek route dosyasında ~5 satır değişiklik.
- **Likely test/smoke files:** `smoke-case-stats.js` (yeni 2 senaryo).

---

## ⑤ QA Fit
- **Automated test plan:** `smoke-case-stats.js`'e ek 2 senaryo:
  1. `GET /api/cases?pageSize=10000` → response value.length ≤ 200, @odata.count toplam vakanın gerçek sayısı
  2. `GET /api/cases` (param yok) → response value.length ≤ 25
- **Manual QA checklist:**
  - Agent: CasesListPage normal akışı bozulmadı (default 25 satır gelir, page navigation çalışır)
  - Supervisor: Liste sayfası filter + page değişiminde davranış aynı
  - Admin: Aynı
- **Seed readiness check:** Seed güncellemesi gerekmez (test cap'i runtime'da doğrulanır, mevcut 165 demo vaka yeterli).
- **Backward compatibility checks:** CasesListPage'in `pageSize` request'i (default 25) değişmiyor. SystemAdmin operations stats endpoint'i etkilenmiyor.
- **Rollback/regression risks:** Revert trivial (route dosyası tek line back). Hiçbir veri kaybı yok.
- **Production smoke:** **Gereksiz** — pure routing logic, dev smoke yeterli.

---

## ⑥ Decisions
- Hard max değer: **200** (kabul edildi). Argüman: accounts 100 cap'i var; cases entity bigger, 200 makul tampon, üst limit hâlâ defansif.

---

## ⑦ Ready / Not Ready
- **Durum:** **Ready**
- **Engelleyen:** Yok

---

## ⑧ Implementation Prompt
1. `server/routes/cases.js` line ~119-121 `pagination` build'ini şu şekilde değiştir:
   ```js
   const requestedPageSize = Number(f.pageSize ?? 25);
   const safePageSize = Math.min(200, Math.max(1, Number.isFinite(requestedPageSize) ? requestedPageSize : 25));
   const pagination = { page: Math.max(1, Number(f.page) || 1), pageSize: safePageSize };
   ```
   Yani: pagination object'i **her zaman** üretilir (no `undefined`), pageSize cap'li, page default 1.
2. `caseRepository.list` semantics'i değiştirme — internal caller'lar undefined pagination ile unbounded kullanmaya devam edebilir.
3. `scripts/smoke-case-stats.js`'e Section 6 olarak iki yeni assertion ekle (pageSize=10000 ve no-param senaryoları).
4. Validation: `node --check`, `npm run build`, `node scripts/smoke-case-stats.js`.

---

## ⑨ Test Plan (özet)
2 smoke assertion + manuel Agent/Supervisor/Admin liste açılışı.

---

## ⑩ Rollback Plan
`git revert <merge-sha>`. Veri kaybı yok, schema değişmedi, seed re-run gerekmedi.

---

## ⑪ Register Updates Needed
- [ ] Merge sonrası WORK_REGISTER.md H1 Status: `Ready` → `Shipped` + commit hash
- [ ] H1 Next action: "Done (commit ...)" + opsiyonel "Next: accounts list cap audit"
- [ ] PRODUCT_PLANNING_MATRIX.md güncellenmez (capability scope eklenmedi)

---

## ⑫ Card History
- 2026-05-19: Card oluşturuldu (v2.0 protokol). Status: Ready. Implementation başlatılabilir.
