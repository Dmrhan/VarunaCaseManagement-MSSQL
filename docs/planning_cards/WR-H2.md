# Agentic Planning Card — H2 Drawer/Detail reopen TTL cache

- **Work Register ID:** H2
- **Product Planning Matrix ID:** — (architecture/performance mitigation)
- **Product capability:** Perceived latency düşürme — drawer/detail reopen tekrar trafiği
- **Request source:** AGENTIC_PLANNING_PROTOCOL v2.0 §③ #2 (Caching Strategy) retro review
- **Card sahibi:** Ürün direktörü + agent
- **Tarih:** 2026-05-19
- **Protocol versiyonu:** 2.0

---

## ① Product Fit
- **Problem statement:** Frontline kullanıcı (Agent) MyHome veya CasesListPage'te drawer'ı aynı vaka için defalarca açıp kapatıyor. Her açılışta `GET /api/cases/:id` + `GET /api/cases/:id/customer-context` tekrar tetikleniyor. AccountDetailPage'de aynı durum — `GET /api/accounts/:id` her geriye-gel ile yeniden fetch ediliyor. Sunucu yükü + perceived latency boşa harcanıyor.
- **Business fit:** PARAM/UNIVERA/FINROTA üçünde de frontline ergonomi kazancı. Demo izleniminde "anında açılma" hissi.
- **Affected roles:** Tüm rolleri etkiler ama maksimum kazanç drawer'ı sık kullanan Agent/Backoffice'te.
- **Acceptance criteria:**
  1. Drawer aynı vaka için 30 saniye içinde tekrar açılırsa `/api/cases/:id` ve customer-context fetch network'e gitmez (DevTools Network tab boş)
  2. AccountDetailPage'e geri gelinince 30 saniye içinde `/api/accounts/:id` cache'ten döner
  3. Vakaya yapılan herhangi bir mutation (update/addNote/addFile/removeFile/...) cache'i invalidate eder — sonraki açılış fresh fetch'i tetikler
  4. Logout (`app:unauthenticated`) tüm cache'i temizler — başka kullanıcı oturumu cross-account leak olmasın
  5. TypeScript build temiz; mevcut response shape'leri değişmez
- **Out-of-scope:**
  - Server-side cache (Redis/in-memory BFF) — bu PR FE-only
  - Stale-while-revalidate (background refresh) — sadece TTL-based hit/miss
  - Optimistic update'lerin cache ile ortak yönetimi
  - List endpoint'lerinin cache'lenmesi (sadece detail GET'leri)
  - F4 SavedView veya F5 list standardı ile entegrasyon
- **Product decisions needed:** Yok. TTL = **30 saniye** (PM tarafından makul mutual default, kararı agent verir).

---

## ② Architecture Fit
- **Schema impact:** Yok (frontend-only).
- **API impact:** Yok. Server endpoint'leri ve response shape'leri değişmiyor; bu pure FE optimization.
- **Role/scope impact:** Yok. Cache anahtarı sadece URL path, yani Authorization header'a girmeden DB ile aynı kapsama tabi. **Cross-user leak yok** çünkü cache module-level singleton, browser tab başına izole; logout'ta clear ediliyor.
- **Privacy/risk notes:** Cache memory'de tutulur; persistent storage (localStorage/sessionStorage) yok. Tab kapanınca cache de gider. PII (vkn, email, customer name) cache'de tutulur ama zaten React state'inde de tutuluyor — risk ek değil.
- **Migration/backfill needs:** Yok.
- **Backward compatibility notes:** Mevcut servis metotları aynı interface'i korur; opt-in caching parametreden geçer. Cache-disabled durumda davranış birebir aynı.
- **Modeling guardrails check:** ✓ 7/7 — schema/multi-tenant/enum dokunulmuyor; FE-only.

---

## ③ Performance & Architecture Gate  *(TEMİZ ve GÜÇLÜ MİMARİ)*
- **Query/index impact:** Yok. Backend sorgu sayısı düşer (cache hit'lerde 0 sorgu).
- **Cache strategy:** Bu PR'ın **kendisi**. TTL=30s, browser tab içi singleton Map. Invalidation: mutation hook'larında explicit `invalidateCachePath(url)`. Logout event'inde `clearClientCache()`. Stale-while-revalidate yok — bu fazda gereksiz.
- **Large query guard:** Cache memory bound: aynı path → tek entry üzerine yazılır (Map). Worst-case her cache key başına ~50KB JSON × ~20 endpoint × 1 tab = ~1MB. Production'da tolere edilebilir.
- **Frontend performance:** **Doğrudan kazanç**. Reopen latency: 100-300ms → ~1ms (cache hit). Network burn'ı düşer.
- **Concurrency:** Tek tab içinde concurrent reads aynı cache entry'sini paylaşır — race yok (Map atomik). İki tab arası cache paylaşımı YOK (her tab kendi Map'ini tutar) — istenmeyen cross-tab sync sorunu yok.
- **Observability:** Cache hit/miss console.debug ile dev mode'da görünür. Production'da sessiz. F2 (cron health) gibi metric backlog değil — tipik client cache.
- **Verdict:** **Pass** — gate başlık #2 (Caching Strategy) mitigation. Mitigation listesi: TTL conservative (30s); cache disabled için fallback yok ama dev mode'da kapatma override eklenebilir (out of scope).

---

## ④ Code Fit
- **File impact map:**
  - **FE (new):** `src/services/clientCache.ts` (~70 satır) — `cachedGet`, `invalidateCachePath`, `invalidateCachePrefix`, `clearClientCache`
  - **FE (modified):**
    - `src/services/caseService.ts` — `caseService.get` cachedGet'e geçer; mutation metotları (update/addNote/removeNote/addFile/removeFile/addReply/addReaction/removeReaction/transfer/snooze/unsnooze vb.) success sonrası invalidate
    - `src/services/accountService.ts` — `accountService.get` + `getCaseCustomerContext` cachedGet; update/relation/contact/product mutation'ları invalidate
    - `src/services/AuthContext.tsx` — `app:unauthenticated` event handler içine `clearClientCache()` çağrısı
- **Reuse plan:**
  - Mevcut `apiFetch` aynen kullanılır (cache layer onun üzerine wrapper)
  - Existing event pattern (`app:unauthenticated`) reuse edilir
- **No-touch list:**
  - `apiFetch` davranışı (POST/PATCH/DELETE değişmiyor)
  - Liste endpoint'leri (`caseService.list`, `accountService.list`) cache'lenmiyor — pagination/filter sayısı patlar
  - Backend route'lar
  - Mevcut `caseRepository`, `accountRepository`
- **Implementation risk:**
  - Mutation invalidate path'i kaçırırsak stale read kalır → bu yüzden invalidate çağrılarını **her mutation'ın success branch'inde** systematik yapacağız
  - SSR olmadığı için "hydration mismatch" riski yok
  - Cache key'i sadece path; query string varsa fark etmeli — path'i URL.search ile birlikte kullanırız
- **Likely test/smoke files:**
  - Unit test yok (Vitest set up değil — BACKLOG #7)
  - Manuel smoke + Network tab gözlemi
  - Existing smoke'lar (caseService/accountService kullanan) etkilenmez

---

## ⑤ QA Fit
- **Automated test plan:** Pure FE optimization; backend smoke etkilenmez. `npm run smoke:data-contracts` PASS, `npm run smoke:case-stats` PASS (eski 29/29) korunur.
- **Manual QA checklist:**
  - Agent: MyHome KPI tile → drawer aç (network fetch görünür) → kapat → tekrar aç (network sessiz, cache hit beklenir, < 50ms açılma)
  - Agent: Drawer'da vaka detayında Düzenle, status değiştir → tekrar aç → güncel data görünmeli (invalidate çalıştı)
  - Agent: Drawer'da not ekle → kapat-aç → not listede görünmeli
  - Supervisor: AccountDetailPage aç → liste'ye dön → tekrar aç → cache hit (network sessiz)
  - Supervisor: Account üzerinde şirket ilişkisi ekle/güncelle → detay refresh fresh data
  - Admin: Logout/login → diğer kullanıcı oturumu açıldığında cache temiz olmalı (cross-user PII leak yok)
- **Seed readiness check:** Etkilenmez. Mevcut seed yeterli.
- **Backward compatibility checks:** Drawer dışından `caseService.get(id)` çağıran yerler (varsa) cache'ten döner → mutation'lardan sonra fresh data alır. Akışlar normalde mutation tetikleyenler olduğu için sorun beklenmez. Cross-check edilecek call site'lar:
  - `MyHomePage.tsx` (eğer drawer dışında case detail load ediyorsa)
  - `CaseDetailPage.tsx` (full case detail page) — burası `caseService.get(id)`'yı muhtemelen çağırıyor; cache'ten dönmesi beklenir, mutation'lar invalidate eder
- **Rollback/regression risks:**
  - Eğer mutation invalidate path'i unutulursa stale UI gösterilebilir → manual QA'da bunu test et
  - Revert trivial (clientCache import'unu kaldır, eski `apiFetch` çağrılarına dön)
- **Production smoke:** Gereksiz (FE-only, server davranışı değişmiyor).

---

## ⑥ Decisions
- TTL = **30 saniye** (agent kararı).
- Cache scope = **module-level singleton per tab** (browser navigation cache'lemez, tab kapanınca gider).
- Persistent storage = **yok**.
- Invalidation = **explicit per-mutation** (broad pattern: aynı `id` üzerinde mutation → ilgili cache path drop).

---

## ⑦ Ready / Not Ready
- **Durum:** **Ready**
- **Engelleyen:** Yok

---

## ⑧ Implementation Prompt
1. Yeni dosya `src/services/clientCache.ts`:
   - Module-level `Map<string, { data: unknown; expiresAt: number }>`
   - `cachedGet<T>(path, ttlMs, errorContext): Promise<T | undefined>` — apiFetch'i internal kullanır, hit/miss yönetir
   - `invalidateCachePath(path: string): boolean` — tek path
   - `invalidateCachePrefix(prefix: string): number` — prefix match toplu drop
   - `clearClientCache(): void` — tüm cache
2. `src/services/caseService.ts`:
   - `caseService.get(id)` → `cachedGet(`${API_BASE}/${id}`, 30_000, 'Vaka yüklenemedi')`
   - Mutation metotlarının her birinde başarı sonrası `invalidateCachePath(`${API_BASE}/${id}`)` + `invalidateCachePath(`${API_BASE}/${id}/customer-context`)`
3. `src/services/accountService.ts`:
   - `accountService.get(id)` → cachedGet 30s
   - `accountService.getCaseCustomerContext(caseId)` → cachedGet 30s
   - Mutation metotları (update, addCompanyRelation, vb.) success sonrası invalidate
4. `src/services/AuthContext.tsx`:
   - `app:unauthenticated` listener'ı + signOut path'inde `clearClientCache()` çağır
5. Validation: `tsc -b && vite build`; manuel drawer reopen + DevTools Network gözlemi
6. Branch: `feat/drawer-detail-cache` → `dev` → release PR sonrası `main`

---

## ⑨ Test Plan (özet)
TypeScript build + manuel 6 senaryolu QA (drawer reopen cache, mutation invalidate, account detail reopen, logout clear).

---

## ⑩ Rollback Plan
`git revert <merge-sha>` — pure FE değişiklik. Veri kaybı yok.

---

## ⑪ Register Updates Needed
- [ ] Merge sonrası WR H2 Status: `Ready` → `Shipped` + commit hash
- [ ] H2 Next action: "Done (commit ...)" + opsiyonel "Next: H3 prefetch ölçüm + cost-benefit"
- [ ] PRODUCT_PLANNING_MATRIX.md güncellenmez

---

## ⑫ Card History
- 2026-05-19: Card oluşturuldu (v2.0 protokol). Status: Ready. Implementation başlatılabilir.
