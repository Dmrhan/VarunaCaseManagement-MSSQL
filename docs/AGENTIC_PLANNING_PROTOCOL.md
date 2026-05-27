# Varuna Agentic Planning Protocol

> **Mühendislik mottosu:** ***TEMİZ ve GÜÇLÜ MİMARİ***
>
> **Amaç:** Müşteri/iş ihtiyacından koda atlamadan, **beş zorunlu uyum kontrolü** (Product / Architecture / **Performance & Architecture Gate** / Code / QA) yapan, agent destekli bir planlama döngüsü tanımlamak. Hiçbir WORK_REGISTER item'ı bu döngüden geçmeden implementasyona alınmaz.
>
> **Tek satırlık ilke:** *"Önce beş uyum kartı, sonra prompt; prompt'tan önce kod yok. Temiz ve güçlü mimari, sonradan eklenecek bir cila değil — tasarımın kendisi."*
>
> **Son güncelleme:** 2026-05-19
> **Protocol versiyonu:** **2.0** (v1.0'a ek: Performance & Architecture Gate zorunlu hale getirildi. Eski Card'lar v1.0 atıfıyla korunur; v2.0'dan itibaren yeni Card'lar bu gate'ten geçmek zorunda.)
> **Bağlı dokümanlar:** [WORK_REGISTER.md](./WORK_REGISTER.md), [PRODUCT_PLANNING_MATRIX.md](./PRODUCT_PLANNING_MATRIX.md), [ARCHITECTURE.md](./ARCHITECTURE.md), [API.md](./API.md), [AI_WORKFLOW.md](./AI_WORKFLOW.md), [BACKLOG.md](./BACKLOG.md).

---

## 0. Performans Varsayımları (Sistem Bütçesi)

Bu protokol aşağıdaki ölçek varsayımları altında çalışır. Her Performance & Architecture Gate kararı bu sayılara göre verilir:

- **Eş zamanlı kullanıcı:** 800-1000
- **Günlük yeni vaka (toplam kohort):** 30-40 vaka × ~1000 kullanıcı kohortunda günlük operasyonel akış
- **UI invariants:**
  - **Donma yok** — uzun süren çağrılar UI thread'i bloklayamaz
  - **Timeout yok** — kullanıcının yaptığı bir aksiyon BFF veya DB time-out ile bitemez
  - **Bloklayan sorgu yok** — UI render'ı tek bir sorgunun cevabını beklemek zorunda kalmamalı

Bu varsayımlar değişirse (örn. 5000 eş zamanlı kullanıcı) protokol revize edilir.

---

## 1. Planlama Döngüsü (Loop)

```
   ┌──────────────────────────────────────────────────────────────────────┐
   │                                                                      │
   │   Müşteri/PM İhtiyacı                                                │
   │            │                                                         │
   │            ▼                                                         │
   │   ① Product Fit Agent  ──► problem, roller, business, acceptance     │
   │            │                                                         │
   │            ▼                                                         │
   │   ② Architecture Fit Agent ──► schema, API, tenant, privacy          │
   │            │                                                         │
   │            ▼                                                         │
   │   ③ Performance & Architecture Gate ──► query/index, cache,          │
   │       (TEMİZ ve GÜÇLÜ MİMARİ)         pool, FE perf, concurrency,    │
   │            │                          large-query guard, observabty  │
   │            ▼                                                         │
   │   ④ Code Fit Agent  ──► dosya etkisi, reuse, no-touch                │
   │            │                                                         │
   │            ▼                                                         │
   │   ⑤ QA Fit Agent  ──► smoke, manual, seed, regresyon                 │
   │            │                                                         │
   │            ▼                                                         │
   │   ⑥ Implementation Prompt Synthesizer                                │
   │            │                                                         │
   │            ▼                                                         │
   │   Implementation PR (kod buradan başlar)                             │
   │                                                                      │
   └──────────────────────────────────────────────────────────────────────┘
```

Her aşamanın çıktısı **Agentic Planning Card**'ın ilgili bölümünü doldurur. Aşamalar sırayla işler; bir aşama "decision missing" döndürürse sonraki aşamalar başlamaz.

---

## 2. Aşama Tanımları

### ① Product Fit Agent

**Amaç:** İhtiyacın iş tarafında doğru çerçevede olduğunu, ürün matrisine oturduğunu, gerçek kullanıcı ve değer karşılığı olduğunu doğrulamak.

**Kontroller:**
- Hangi iş sorununu çözüyor? Bir cümlede ifade edilebiliyor mu?
- Hangi kullanıcı rolünü etkiliyor? (Agent / Backoffice / Supervisor / CSM / Admin / SystemAdmin)
- Hangi business context'i destekliyor? (PARAM / UNIVERA / FINROTA / generic)
- Operasyonel değer ne? Ölçülebilir bir KPI'a (SLA, AHT, ticket/agent, churn) bağlanıyor mu?
- Scope dışında ne kalıyor? (Out-of-scope listesi)
- `PRODUCT_PLANNING_MATRIX.md`'de hangi PM-XX capability'sine denk geliyor? (Yoksa önce matrix'e eklenmeli)
- Hangi ürün kararları eksik? (Decisions checklist)

**Çıktı (Planning Card'a yazılacak):**
- **Problem statement** (1-2 cümle)
- **Business fit** — PARAM/UNIVERA/FINROTA/generic + neden
- **Affected roles** — list
- **Acceptance criteria** — kullanıcı görünür kabul kriterleri (3-6 madde)
- **Out-of-scope** — açıkça hariç bırakılan iş kalemleri
- **Product decisions needed** — varsa karar bekleyen sorular

**Stop point:** Eğer Product Fit'te kararsızlık varsa veya matrix'e oturmuyorsa, **WORK_REGISTER status = Needs Decision** kalır; sonraki aşamalar başlamaz.

---

### ② Architecture Fit Agent

**Amaç:** Önerinin mevcut veri modeli ve sistem invariant'larıyla uyumunu doğrulamak; gizli borç oluşturmadığını kanıtlamak.

**Kontroller:**
- Hangi domain modeline temas ediyor? (`Account`, `AccountCompany`, `AccountProject`, `Case`, `Team`, `Person`, `User`, `CategoryDef`, `SLAPolicy`, ...)
- Schema migration gerekli mi? Yeni tablo/kolon/enum?
- Multi-tenant scope: `companyId` filter doğru uygulanabiliyor mu? `allowedCompanyIds` guard'ı nereye giriyor?
- RBAC etkisi: hangi rollerin neye erişimi değişiyor? Yeni permission flag gerekiyor mu?
- Privacy/PII: KVKK kapsamında hassas alan eklendi mi? (TCKN, telefon, e-posta vb.) Encrypt-at-rest, hash, mask ya da saklama-yok kararı var mı?
- Backward compatibility: yeni alan nullable mı? Var olan response shape'lerini bozuyor mu?
- Seed/demo data: `scripts/seed-full-demo-scenarios.js` güncellenmesi gerekiyor mu?
- Enum mapping: yeni Prisma enum varsa `server/db/enumMap.js` + `src/types.ts` mirror gerekli mi?

**Çıktı:**
- **Schema impact** — yeni tablo/kolon/enum listesi (FK ilişkileri ile)
- **API impact** — yeni/değişen endpoint'ler + request/response shape farkı
- **Role/scope impact** — RBAC matrix değişikliği
- **Privacy/risk notes** — PII alanları için saklama modeli, audit log gereksinimi
- **Migration/backfill needs** — mevcut veri için backfill stratejisi
- **Backward compatibility notes** — eski client/data path'lerin etkisi
- **Modeling guardrails check** — `WORK_REGISTER.md` "Modeling Guardrails" bölümünün 7 kuralına uyum doğrulaması

**Stop point:** Privacy veya tenant izolasyonu kararsız ise → Product Fit'e geri dönüş ve karar gerekli.

---

### ③ Performance & Architecture Gate  *— TEMİZ ve GÜÇLÜ MİMARİ*

**Amaç:** Önerinin sistem bütçesi içinde (800-1000 eş zamanlı kullanıcı, 30-40 günlük yeni vaka/kullanıcı kohortu) **donmadan, time-out almadan, sorgu bloklamadan** çalışacağını planlama aşamasında kanıtlamak. Mimari kararı kötüleştirebilecek yedi başlık burada elenir.

Bu gate **mimari sağlamlığı sonradan değil önden** koruyan teknik invariant kontrolüdür. Implementation'a inilmeden "verdict = Pass" gerekir.

#### 1. Query Optimization

- Liste/filter sorguları **uygun index'lerle** destekleniyor mu? (`@@index([...])`)
- Bu feature yeni bir list/filter query ekliyor mu? Ekliyorsa hangi alan üzerinden çalışıyor?
- **N+1 önleniyor mu?** Prisma `include`/`select` bilinçli mi, batch lookup gerekiyor mu (case-stats pattern'i gibi `groupBy`/`findMany` ile)?
- `select` ile sadece **gerekli alanlar** çekiliyor mu? Heavy field (Text/Json/BLOB) gereksiz yere giriyor mu?
- Heavy relation (nested include) gereksiz yere yükleniyor mu?
- **Pagination/limit** zorunlu uygulanıyor mu? (`take` cap, default 25, max ≤ 100)
- Count'lar `COUNT(*)`/`groupBy` ile mi, yoksa `findMany().length` ile mi? **Memory'e satır yüklemek yasak**.

#### 2. Caching Strategy

- Client cache gerekli mi? (React state cache, SWR/RTK-Q ya da `useMemo`/`useState` lokal cache)
- Server cache gerekli mi? (Redis yok; in-memory ya da DB-tarafı materialized view)
- **TTL** ne kadar olmalı? (örn. lookup data 1 saat, KPI 60 sn, AI çıktı 24 saat)
- Cache invalidation tetikleyicileri net mi? (custom event, mutation hook'u, polling tick)
- **Stale-while-revalidate** kabul edilebilir mi? (Frontend KPI tile'ları için tipik OK; SLA stats için OK değil)
- Projenin mevcut cache pattern'i yeniden kullanılabilir mi? (`lookupService.companies()` gibi)

#### 3. Connection Pooling / Serverless

- Feature yeni "serverless-heavy" endpoint ekliyor mu (cron, batch job, AI çağrısı)?
- Bir HTTP request başına **Prisma sorgu sayısı** ne kadar artıyor? (3-5 OK, 10+ alarm)
- Vercel/Supabase'de **connection spike** riski var mı? (Bulk import, çoklu paralel mutation)
- `DATABASE_URL` (pooler 6543) vs `DIRECT_URL` (5432) — bu endpoint hangisinden geçer? Migration mı app mi?
- Prisma client import'u **mevcut pattern'le tutarlı mı** (`server/db/client.js`)?
- Sıralı `prisma.$transaction([])` mi yoksa `interactive` mi gerekli? Lock window ölçüldü mü?

#### 4. Frontend Performance

- Uzun liste render ediliyor mu? **Virtualization** (react-window / tanstack-virtual) gerekli mi? (eşik: 100+ satır)
- Search/filter input'ları **debounce** edilmiş mi? (typical 250-350ms)
- Mutation'lar UI'yi bloklamıyor mu? **Optimistic update** veya inline spinner ile lokal loading state var mı?
- **Full-screen** loader yerine **inline/skeleton** kullanılıyor mu? (full-screen sadece sayfa-bazlı navigation'da)
- Component gereksiz rerender üretmiyor mu? (`useMemo`/`useCallback` doğru noktada mı, key prop stable mi)
- Bundle splitting etkilenir mi? (Yeni dev-only library lazy chunk'a yerleştirilebilir mi — BACKLOG #10 / G4 ile uyumlu)

#### 5. Concurrent Mutations

- Aynı entity'yi birden çok kullanıcı eş zamanlı düzenleyebilir mi?
- **Last-write-wins** kabul edilebilir mi, yoksa optimistic concurrency (version field / `updatedAt` check) gerekli mi?
- Activity log değişikliği **kim/ne/ne zaman** olarak yakalıyor mu? (`CaseActivity` pattern'i)
- Endpoint **idempotent** mi gerekiyor? (örn. claim/üstlen → atomic update WHERE NULL, 409 conflict)
- **Race condition** atomic UPDATE ile mi yoksa transaction ile mi yönetilecek?
- Frontend tarafında stale state olasılığı var mı? Polling ya da custom event ile invalidation gerekli mi?

#### 6. Large Query Guards

- List endpoint'inde **hard maximum row limit** var mı? (`Math.min(100, limit)` ya da daha sıkı)
- Date range query'leri **mutlaka companyId/tenant scope'una** sıkıştırılmış mı? `allowedCompanyIds` filter zorunlu.
- Analytics sorguları UI render'ını **bloklamıyor mu**? Lazy load + skeleton ile mi yükleniyor?
- Pahalı aggregation **cron/background job**'a mı bırakıldı? (PatternAlert, BacklogSnapshot gibi)
- **Unbounded export** (CSV/Excel) sync mi? Hayır olmalı — async job + signed URL pattern'i kullanılmalı.
- Pagination cursor mı offset mi? Büyük tablolarda cursor önerilir (BACKLOG'a not).

#### 7. Observability

- Dev modda query süresi log'lanıyor mu? (Prisma log option / middleware)
- **Slow query riski** belgeleniyor mu? Hangi koşulda > 500ms beklenir?
- Feature'a özel **telemetri** gerekli mi? (örn. AI çağrısı → `logAIUsage`; cron çalışması → `CronRun` tablosu — WR-F2)
- Hatalar admin/job health dashboard'unda **görünür** mi olacak? (BACKLOG'a "F2 cron health" ile entegre note)
- KPI/metric değişiyorsa `METRIC_FIXTURES.md` güncellemesi gerekiyor mu?

**Çıktı (Planning Card'a yazılacak):**

- **Query/index impact** — yeni sorgular + index gereksinimi + N+1 / pagination kontrolü özeti
- **Cache strategy** — client/server cache kararı + TTL + invalidation hook'u (yoksa "gerekmez" + neden)
- **Large query guard** — limit, scope, async/sync sınırı (yoksa "uygulanmıyor" + neden)
- **Frontend performance** — list/render/debounce/loading state kararı
- **Concurrency** — race koşulu var mı, nasıl çözüldü (atomic / version / last-write-wins)
- **Observability** — telemetry/log/alert noktaları
- **Verdict:** **Pass** / **Needs mitigation** / **Blocked**
  - *Pass:* Tüm 7 başlık explicit "OK" cevabı aldı.
  - *Needs mitigation:* En az 1 başlıkta düzeltme gerekli ama scope içinde halledilebilir → mitigation Card'da listelenir, prompt'a kural olarak girer.
  - *Blocked:* Sistem bütçesini aşan bir tasarım kararı var; Architecture Fit'e geri dönülür, scope/yaklaşım değişir.

**Stop point:** Verdict **Blocked** ise döngü ②'ye geri döner. **Needs mitigation** ise mitigation listesi olmadan ④ Code Fit'e geçilmez.

---

### ④ Code Fit Agent

**Amaç:** Önerinin mevcut kod tabanıyla nasıl entegre olacağını, ne kadarının yeniden kullanılabileceğini ve neye dokunulmaması gerektiğini netleştirmek.

**Kontroller:**
- Hangi dosyalar/modüller etkilenir? (BE: `server/db/*`, `server/routes/*`; FE: `src/features/*`, `src/services/*`, `src/components/*`)
- Hangi mevcut pattern'ler yeniden kullanılmalı? (örn. `assertXxxInScope` guard, `shape(raw)` denormalize, `apiFetch` helper, Drawer split-panel)
- Benzer endpoint/service/component var mı? Kopyala-yapıştır yerine refactor mü gerekli?
- `smoke-*.js` script'lerinden hangileri yakın davranışı kapsıyor? (örn. `smoke-data-contracts.js` defineGroup harness, `smoke-case-stats.js`)
- Dokunulmaması gereken (no-touch) ne var? (kritik path'ler, in-flight refactor'lar, başka PR'da bekleyen alanlar)
- Önceki benzer implementasyon hangi PR'da? (git log referansı)

**Çıktı:**
- **File impact map** — etkilenen dosyalar + nedenleri (BE/FE/script)
- **Reuse plan** — yeniden kullanılacak helper/component/pattern listesi
- **No-touch list** — bu PR kapsamı dışı tutulacak dosyalar
- **Implementation risk** — riskli refactor noktaları (state ortak kullanımı, race condition, async sıralama vb.)
- **Likely test/smoke files** — yeni veya extend edilecek smoke script'leri

**Stop point:** Eğer reuse yerine ciddi refactor gerekiyorsa veya no-touch listesi büyükse → Product Fit / Architecture Fit / Performance Gate'e geri dön, scope küçült.

---

### ⑤ QA Fit Agent

**Amaç:** Implementasyon sonrası doğrulama yolunu önceden çizmek; "merge edip Production'a göndermeden önce ne yapılmalı?" sorusunu netleştirmek.

**Kontroller:**
- Otomatik test planı: hangi smoke script eklenecek/genişletilecek? Hangi assertion'lar zorunlu?
- Manuel QA checklist: hangi roller (Agent/Backoffice/Supervisor/CSM/Admin/SystemAdmin) hangi senaryoları test edecek?
- Seed readiness: `npm run db:seed:full-demo` yeni alanları/feature'ı kapsıyor mu? Smoke `npm run smoke:data-contracts` PASS mı?
- Backward compatibility: eski data path'leri bozulmadan çalışıyor mu? (eski response shape, eski URL param)
- Production/manual smoke: dev'de yapılan smoke yeterli mi yoksa production "shadow" smoke gerekiyor mu?
- Rollback senaryosu: PR revert edilirse veri kaybı/inconsistent state olur mu? Backfill geri alınabilir mi?

**Çıktı:**
- **Automated test plan** — yeni/değişen smoke script'leri + scenario count
- **Manual QA checklist** — rol bazlı senaryo listesi (Agent: X, Supervisor: Y, Admin: Z)
- **Seed readiness check** — `seed-full-demo-scenarios.js` güncel mi, smoke PASS mı
- **Backward compatibility checks** — eski path'lerin korunduğu manuel doğrulama listesi
- **Rollback/regression risks** — revert sonrası beklenen davranış + veri durumu
- **Production smoke gereksinimi** — gerekli/gereksiz

**Stop point:** Test edilemeyen bir scope varsa (örn. dış servise gerçek çağrı) → Architecture Fit'e geri dön, test edilebilir hale getir.

---

### ⑥ Implementation Prompt Synthesizer

**Amaç:** Yukarıdaki beş uyum kartını (Product / Architecture / **Performance Gate** / Code / QA) **tek, kapsamı kapalı bir implementation prompt'una** çevirmek. Bu prompt'u alan agent başka karar vermek zorunda kalmaz.

**Prompt zorunlu bölümleri:**

1. **Scope** — bu PR'da ne yapılacak (1 paragraf)
2. **Rules** — uyulması zorunlu kurallar (modeling guardrails, **Performance Gate mitigation'ları**, no-touch listesi, tenant filter, enum mapping)
3. **Affected files** — Code Fit Agent çıktısından file map (BE + FE + script ayrı)
4. **Git Flow** — branch adı, PR base (`dev` default), branch silme talimatı; [AI_WORKFLOW.md → Git Flow Rules](./AI_WORKFLOW.md#git-flow-rules)
5. **Validation gates** — `npx prisma migrate dev`, `npm run db:seed:full-demo`, `npm run smoke:data-contracts`, smoke-XXX.js, `npm run build`
6. **Manual QA** — QA Fit çıktısından rol bazlı checklist
7. **Performance kabul kriterleri** — query süresi, pagination cap, cache TTL, debounce ms — Performance Gate'ten kopyalanır
8. **Final report template** — PR'ın kapanışında yazılması gereken özet şablonu; **topology metadata bloğu (Current branch / PR base / PR head / branch deletion / origin/main↔origin/dev divergence) zorunlu**
9. **Explicit out-of-scope** — Product Fit'ten gelen scope-dışı listesi
10. **Stop points (faz-bazlıysa)** — "Adım X tamamlanınca onay bekle" ipuçları

**Stop point:** Eğer beş uyum kartından birinde belirsizlik kaldıysa veya Performance Gate verdict ≠ Pass/Needs mitigation ise prompt **yazılmaz**. Belirsizlik geri besleme döngüsüne gider.

---

## 3. Zorunlu Workflow (her WORK_REGISTER item için)

### A. Agentic Planning Card ile başla
Yeni bir item implementasyona girmeden önce **Card şablonu** doldurulur. Card sahibi: planlamayı yürüten agent + ürün direktörü onayı.

### B. Planlama sırasında kod değişikliği yok
`Read`, `grep`, `git log`, doküman okuma serbest. `Edit/Write/migrate` yasak.

### C. Beş uyum çıktısı zorunlu
Product Fit / Architecture Fit / **Performance & Architecture Gate** / Code Fit / QA Fit beş kart bölümü dolmadan ⑥ aşamaya geçilmez. Performance Gate verdict'i **Pass** veya **Needs mitigation** olmadan ⑥'ya geçilmez; **Blocked** verdict'i ②'ye geri döner.

### D. Kararlar eksikse
- `WORK_REGISTER.md` status = **Needs Decision** kalır.
- Card'a *exact* kararlar listelenir (kim ne karar verecek, hangi seçenekler).
- Karar alınınca Card revize edilip aşama tekrarlanır.

### E. Ready ise
- `WORK_REGISTER.md` status = **Ready**.
- Implementation prompt synthesizer çıktısı Card'ın "Implementation prompt" bölümüne yapıştırılır.
- PR/issue body'ye Card özeti eklenir, link verilir.

### F. Merge sonrası
- `WORK_REGISTER.md` status değişir (Shipped veya Backlog'a — kısmi shipped ise alt iş tanımlanır).
- **PR/commit hash** "Next action" sütununa eklenir.
- `PRODUCT_PLANNING_MATRIX.md` sadece business capability gerçekten değiştiyse güncellenir (yetenek scope büyüdü/küçüldü/yeniden adlandı). Salt status değişikliği matrix'i tetiklemez.

### G. In-Product Help (Help Impact gate)
Kullanıcıya görünür bir yüzey değişti mi (workflow adımı, buton/etiket, validation mesajı, rol/yetki, import/export semantiği, AI/KB davranışı)?
- Evet → ilgili topic [`src/help/helpRegistry.ts`](../src/help/helpRegistry.ts) içinde güncellenir, `updatedAt` bump edilir.
- Hayır → final report'taki `Help Impact:` satırında somut bir "Not needed: …" gerekçesi yer alır.

Detaylı kurallar ve banned/required keyword listesi: [`IN_PRODUCT_HELP_STANDARD.md`](./IN_PRODUCT_HELP_STANDARD.md). Smoke: `node scripts/smoke-help-content.js`.

---

## 4. Agentic Planning Card Şablonu

Aşağıdaki şablonu kopyala ve her yeni item için doldur. Card'ı `docs/planning_cards/` altında `WR-{ID}.md` adıyla saklamak iyi pratiktir (klasör mevcut; 20+ Card şipped/aktif örneklerle dolu).

```markdown
# Agentic Planning Card — {Kısa başlık}

- **Work Register ID:** A1 / B3 / C7 ...
- **Product Planning Matrix ID:** PM-01 / PM-12 ...
- **Product capability:** {PM rowdan kopyala}
- **Request source:** müşteri (UNIVERA QBR), iç (refactor), backlog (BACKLOG.md #X), incident (INCIDENTS.md)
- **Card sahibi:** {agent + ürün direktörü}
- **Tarih:** YYYY-MM-DD

---

## ① Product Fit
- **Problem statement:**
- **Business fit:** PARAM / UNIVERA / FINROTA / generic — neden
- **Affected roles:**
- **Acceptance criteria:**
  1.
  2.
  3.
- **Out-of-scope:**
- **Product decisions needed:** (varsa)

## ② Architecture Fit
- **Schema impact:**
- **API impact:**
- **Role/scope impact:**
- **Privacy/risk notes:**
- **Migration/backfill needs:**
- **Backward compatibility notes:**
- **Modeling guardrails check:** ✓ / ✗ + açıklama

## ③ Performance & Architecture Gate  *(TEMİZ ve GÜÇLÜ MİMARİ)*
- **Query/index impact:** yeni sorgular, gerekli index'ler, N+1 / pagination / select-only-needed kontrolü
- **Cache strategy:** client/server cache, TTL, invalidation hook'u (yoksa "gerekmez" + neden)
- **Large query guard:** hard limit, tenant scope, async/sync sınırı, export job ihtiyacı
- **Frontend performance:** liste virtualization, debounce, loading state (inline vs full-screen), rerender önlemleri
- **Concurrency:** race koşulu var mı, atomic update / version / last-write-wins kararı, activity log
- **Observability:** dev query log, slow query risk notu, telemetri (logAIUsage/CronRun), admin görünürlüğü
- **Verdict:** **Pass** / **Needs mitigation** / **Blocked**
  - *Needs mitigation listesi (varsa):* m1, m2, …

## ④ Code Fit
- **File impact map:**
  - BE:
  - FE:
  - Script:
- **Reuse plan:**
- **No-touch list:**
- **Implementation risk:**
- **Likely test/smoke files:**

## ⑤ QA Fit
- **Automated test plan:**
- **Manual QA checklist:**
  - Agent:
  - Backoffice:
  - Supervisor:
  - CSM:
  - Admin/SystemAdmin:
- **Seed readiness check:**
- **Backward compatibility checks:**
- **Rollback/regression risks:**
- **Production smoke:** gerekli / gereksiz

## ⑥ Decisions
- {karar 1}: {kim, ne zaman, seçenekler}
- {karar 2}: ...

## ⑦ Ready / Not Ready
- **Durum:** Ready / Not Ready
- **Engelleyen:** (Not Ready ise hangi karar/dependency bekleniyor — Performance Gate verdict'i dahil)

## ⑧ Implementation Prompt
{Synthesizer çıktısı — synthesizer aşamasında doldurulur. Performance Gate mitigation'ları **kural** olarak prompt'a girer.}

## ⑨ Test Plan (özet)
{Otomatik + manuel test tek paragrafta}

## ⑩ Rollback Plan
{Revert sonrası adımlar; backfill geri alınabilir mi}

## ⑪ Register Updates Needed
- [ ] WORK_REGISTER.md status change: {Backlog → Ready / Ready → Shipped}
- [ ] WORK_REGISTER.md Next action update
- [ ] PRODUCT_PLANNING_MATRIX.md update (sadece capability değiştiyse)

## ⑫ Git Flow / Topology Metadata (zorunlu — final report'ta da görünür)

Detaylı kurallar: [AI_WORKFLOW.md → Git Flow Rules](./AI_WORKFLOW.md#git-flow-rules)

- **Current branch:** feature/<name> / dev / main
- **Intended PR base:** dev (default) — main sadece release veya onaylı hotfix
- **Intended PR head:** feature branch adı
- **Feature branch deleted after merge:** Yes / No / Pending — gerekçe ile
- **Topology check (merge cycle sonrası):**
  - `origin/main..origin/dev` boş mu? ✓ / ✗
  - `origin/dev..origin/main` boş mu? ✓ / ✗

Bu blok eksikse self-review başarısız sayılır; ⑥ Implementation Prompt
synthesize edilmeden agent bloğu doldurmalı.
```

---

## 5. Anti-Patterns (Yapılmayacaklar)

Bu protokol aşağıdaki davranışları yasaklar. Card review'ünde herhangi biri tespit edilirse aşama geri döner.

**Genel (planlama disiplini):**

1. **Müşteri request'inden direkt koda atlama.** Önce beş uyum kartı.
2. **Privacy/tenant review olmadan schema field eklemek.** Özellikle PII (TCKN, telefon hash, KVKK kapsamı).
3. **Privacy stratejisi onaylanmadan TCKN saklamak.** A2 bekliyor — `plain tckn String` field eklenmez.
4. **UNIVERA Project'i Account-level modellemek.** Project AccountCompany-scoped: `Account → AccountCompany → AccountProject → Case`.
5. **"Müşteri eşleştirme"yi "müşteri birleştirme" ile karıştırmak.** Eşleştirme = case-link akışı; Birleştirme = Account merge — farklı UI, farklı audit.
6. **Category Layer'ı category tree depth olarak modellemek.** Layer yatay sınıflandırma (Backoffice/Mobile/Rapor); N-level hierarchy ayrı konudur.
7. **Backend count/list contract olmadan UI filter eklemek.** Stats endpoint + list endpoint scope/filter parity zorunlu (örnek: `notSnoozedClause()` invariant'ı).
8. **Smoke readiness olmadan demo data'ya güvenmek.** Her yeni schema field için seed + smoke güncellemesi zorunlu.
9. **Main'e merge edilmeden "Shipped" işaretlemek.** Status sadece git log/PR hash kanıtı ile güncellenir.
10. **Planning kararlarını aşan implementation prompt yazmak.** Prompt scope'u Card'da kabul edilen scope ile birebir; ek karar gerektiren satır olmamalı.

**Performance & Architecture (TEMİZ ve GÜÇLÜ MİMARİ ihlalleri):**

11. **Unbounded list query yazmak.** Her list endpoint'inde `take` cap'i olmalı; hard maximum default 100, kritik path'lerde daha düşük.
12. **Memory'e satır yükleyerek count hesaplamak.** `findMany().length` yasak — `prisma.X.count()` veya `groupBy` ile sayılır.
13. **Liste sayfalarına relation-heavy `include` eklemek.** Liste view'ı sadece chip/özet için gereken alanları çeker; detay relation'ı `getById` path'inde kalır.
14. **Mutation'larda UI'yi lokal loading state olmadan bloklamak.** Buton spinner / optimistic update / inline skeleton zorunlu; full-screen modal blocker yasak.
15. **Normal sayfa açılışına pahalı analytics yüklemek.** Aggregation (groupBy + tarih aralığı taraması) cron/background veya lazy-load sekme ile gelir; sayfa render'ını bloklayamaz.
16. **Serverless/Supabase connection pool riskini görmezden gelmek.** Yeni endpoint için Prisma query sayısı, pooler vs direct URL kararı, paralel mutation davranışı Performance Gate'te belgelenir.

**Git Flow hygiene (detaylı kurallar: [AI_WORKFLOW.md → Git Flow Rules](./AI_WORKFLOW.md#git-flow-rules)):**

17. **`dev` `main`'in gerisindeyken release PR (`dev → main`) açmak.** Bu durumda feature PR Path B (doğrudan `main`'e merge) ile inmiş demektir; release PR boş olur. Onun yerine `dev`'i `main`'den fast-forward et + push et. PR base = `dev` intent korunur; GitHub UI'nın default'una güvenme, merge anında base'i doğrula. (Detaylı dual-path discipline: [AI_WORKFLOW.md → Git Flow Rules](./AI_WORKFLOW.md#git-flow-rules))
18. **Merge edilmiş feature branch'i silmeden bırakmak.** Local + remote, açık bir saklama gerekçesi yoksa hemen silinir.
19. **`dev` `main`'in gerisindeyken yeni feature başlatmak.** Önce `dev`'i `main`'den fast-forward et + push et.
20. **Sessizce ekstra branch açmak.** Her branch oluşturma WR item'a ve/veya Planning Card'a bağlanır; raporda explicit görünür.

---

## 6. Cross-Reference Discipline

- **WORK_REGISTER.md** — tek doğru ID kaynağı (A1, B2, PM-XX). Status değişikliği sadece burada yapılır.
- **PRODUCT_PLANNING_MATRIX.md** — business capability görünümü. Salt-okunur status; capability scope değişirse güncellenir.
- **AGENTIC_PLANNING_PROTOCOL.md** — bu doküman; protokol değişiklikleri burada.
- **Implementation PR'ları** — body'de Work Register ID + Planning Matrix ID + Card link zorunlu.

Üç doküman birbirini kilitler: bir item ne WR'de yoksa Card açılamaz, ne Card yoksa PR açılamaz, ne PR merge'siz Shipped işaretlenemez.

---

## 7. Örnek: A1 customerType discriminator (referans uygulama — v2.0)

Aşağıda Planning Card'ın **A1** için v2.0 numbering ile nasıl doldurulduğu örneği. `docs/planning_cards/WR-A1.md` v1.0 protokolde yazıldığından Performance & Architecture Gate'i içermez; aşağıdaki retroaktif fill v2.0 numbering ile aynı item'ın nasıl ele alınması gerektiğini gösterir.

```markdown
# Agentic Planning Card — A1 Account customerType discriminator (v2.0 örneği)

- Work Register ID: A1
- Product Planning Matrix ID: PM-01 (Master Data & Müşteri Kimliği)
- Product capability: B2B/B2C ayırımı + tip-bazlı conditional alanlar
- Request source: master data discovery (2026-05-19) + üç tenant'ın hem B2B hem B2C ihtiyacı
- Card sahibi: ürün direktörü
- Tarih: 2026-05-19
- Protocol versiyonu: 2.0

## ① Product Fit
- Problem statement: Account modelinde B2B/B2C ayırımı yok; tipe göre conditional alan/UI imkansız
- Business fit: PARAM/UNIVERA/FINROTA — her üçü hem B2B hem B2C
- Affected roles: Agent (create form), Backoffice (edit), Admin (read)
- Acceptance criteria: (4 madde, TCKN hariç — v1.0 Card'la aynı)
- Out-of-scope: TCKN field/storage (A2); validation/format checksum (A2); phone normalize (A2)
- Product decisions needed: Yok

## ② Architecture Fit
- Schema impact: `enum CustomerType`; Account'a `customerType` (default Corporate), `legalName?`, `registrationNo?`
- API impact: POST/PATCH /api/accounts body extended; GET response additive
- Modeling guardrails check: ✓ (7/7)

## ③ Performance & Architecture Gate  *(TEMİZ ve GÜÇLÜ MİMARİ)*
- **Query/index impact:** Yeni 3 alan `select` listelerine eklendi (heavy değil — text). `customerType` üzerine `@@index` eklendi; ileride filter UI gelse hazır. Mevcut N+1 / pagination / select-only-needed pattern'i bozulmadı.
- **Cache strategy:** Gerekmez — account list/get zaten lookup-bazlı çağrılır, cache pattern eklenmedi.
- **Large query guard:** Mevcut `Math.min(100, limit)` cap'i korundu; yeni endpoint yok.
- **Frontend performance:** Form modal segmented control + 2 ek text input; render maliyeti ihmal edilebilir. Detail page'de 1 badge + 2 conditional row.
- **Concurrency:** Account mutation'ı admin-only ve mevcut last-write-wins davranışı korundu. Activity log dışında özel pattern gerekmez.
- **Observability:** Yeni endpoint olmadığı için yeni telemetri yok. Smoke harness 33 senaryo + 2 data-contracts regression check.
- **Verdict:** **Pass** — sistem bütçesi sınırları içinde, mitigation gerekmedi.

## ④ Code Fit
- File impact map: prisma/schema, accountRepository, enumMap, accountService, AccountFormModal, AccountDetailPage, seed, smoke (toplam 11 dosya)
- Reuse plan: shapeAccountRow, vknMasked, enumMap pattern
- No-touch list: AccountCompany/Contact/Product, VKN @unique, RBAC sabitleri

## ⑤ QA Fit
- Automated test plan: smoke-account-customer-type.js (33 senaryo) + smoke-data-contracts (2 yeni check)
- Manual QA checklist: 5 rol senaryosu (Agent → AccountSearchPicker bozulmadı; Admin → 4 tipte create + edit; Supervisor → detay görüntü)
- Production smoke: gerekli (KVKK + multi-tenant)

## ⑥ Decisions — Yok

## ⑦ Ready / Not Ready — Ready

## ⑧ Implementation Prompt — (TCKN-hariç scope ile yazılır; gate Pass olduğu için ek mitigation kuralı yok.)

## ⑨ Test Plan (özet) — 33 smoke + 5 rol manuel + production smoke

## ⑩ Rollback Plan — Migration revert + seed re-run

## ⑪ Register Updates Needed
- [x] WR-A1 → Shipped (commit e6df055)
- [ ] PM-01 update yok
```

---

## 8. Sürüm Yönetimi

Bu doküman protokol sürümlemesi içerir. Protokole yapılan değişiklikler için:

- **Minor değişiklik** (yeni anti-pattern, küçük şablon güncellemesi): doğrudan edit + commit message'da "protocol: minor update".
- **Major değişiklik** (yeni aşama eklenmesi, mevcut aşamanın kaldırılması): PR + onay; eski Card'lar geriye dönük protokole atıfla kalır.

Tüm Planning Card'lar Card'ın oluşturulduğu tarihteki protokol sürümüne tabidir. Eski Card'lar yeni sürüme migrate edilmek zorunda değildir.
