# Operations Intelligence Dashboard — Design Brief & Technical Plan

**Status:** Design (not implemented)
**Source:** Replacement for `CaseAnalyticsPage` (Vaka Raporları)
**Target scale:** ~800 agents, 30K–40K daily cases
**Last updated:** 2026-05-13

---

## 0. Bağlam

`src/features/analytics/CaseAnalyticsPage.tsx` (678 satır) **client-side**
aggregation yapıyor:

- Mount'ta `caseService.list()` ile **tüm vakaları çeker** (pagination yok)
- 180 satırlık `computeStats()` JS fonksiyonu KPI'ları, status/priority/type/
  category/team breakdown'larını, 30-gün trend line'ını **tarayıcıda hesaplar**
- Filter (sadece company) değişince her şey yeniden hesaplanır
- Polling yok, drill-down yok, AI insights yok

30K–40K/gün × 90 gün × 1 KB/case ≈ **2.7–3.6 GB** payload — bu mimari
çökecek. Server-side aggregation + drill-down + AI insights gerek.

Önceki server-side analytics endpoint'leri (AI usage, QA scores, patterns)
zaten Prisma `aggregate`/`groupBy` ile yazıldı; bu doküman aynı pattern'i
**case operations** için ölçeklendirir.

---

## 1. Product Design Brief

### Hedef kullanıcılar

| Kullanıcı | Default scope | Default lens | Asıl ihtiyaç | Bir bakışta görmek istediği |
| --- | --- | --- | --- | --- |
| **Agent / Backoffice / CSM** | Kişisel — kendi atandığı vakalar | — (dashboard yok) | Kişisel performans, kendi yük takibi | Bugün açtığım/çözdüğüm, SLA durumum, QA skorum |
| **Supervisor / Team Lead** | Kendi takımı | ⚙ Operations | Takım operasyonu | Takım açık vakaları, SLA risk, kuyrukta bekleyenler, agent dağılımı |
| **Operations Manager (Company Admin)** | Kendi şirket(ler)i | ⚙ Operations | Çapraz takım & kuyruk yönetimi | Şirket volume, TTR, eskalasyon, kuyruklar arası dengesizlik, takım kıyası |
| **Product Manager** | Kendi şirket(ler)i | 📦 Product | Ürün-odaklı operasyon analizi | Hangi ürün alanı sürtünme yaratıyor, repeated issue clusters, roadmap aday'ları |
| **Customer Success Lead / Account Manager** | Kendi şirket(ler)i | 👥 Customer | Müşteri risk + proaktif outreach | Hangi müşterilere yaklaşılmalı, churn sinyalleri, customer pulse |
| **Company-level Executive (GM / Direktör)** | Kendi şirket(ler)i | 🎯 Executive | Sağlık & trend & karar | Top-line KPI'lar, trend, alınacak 3 karar |
| **CS Leadership (internal-only)** | Cross-tenant (PARAM+Univera+Finrota) | 🎯 Executive | Tenant kıyası + platform sağlığı | PARAM vs Univera vs Finrota, yığılma, sapma; kişi/ürün/sözleşme bazlı analiz |
| **SystemAdmin** | Sınırsız | 🎯 Executive | Platform yapılandırma + audit | Tüm tenant'lar, AI usage, QA model kalite trendi, anomaliler |

> **Görünürlük matrisi + scope kuralları §2.2A'da, lens permission tablosu §2.9.8'de detaylı.**

### Bu dashboard hangi soruları cevaplar?

1. **"Bugün operasyonum nasıl?"** — açık vaka, SLA risk altındaki, son 24h volume, TTR trendi
2. **"Sorun nerede yığılıyor?"** — kategori/ürün grubu/takım/şirket bazında SLA ihlali + bekleme süresi sıcak noktaları
3. **"En zorda olan müşteriler kim?"** — açık + SLA + tekrar eden vakalar
4. **"Hangi takım/agent zorlanıyor?"** — yük dağılımı, ortalama TTR, QA skoru, transfer/eskalasyon oranı
5. **"Geçen haftaya göre durum nasıl?"** — period-over-period KPI delta
6. **"AI ne yakaladı?"** — anomali (yığılma, SLA spike, churn risk artışı, atama dengesizliği)
7. **"Bu sayının arkasında hangi vakalar var?"** — her KPI/breakdown'dan **drill-down** → vaka listesi

### Page sections (önerilen) — AI-first layout

> AI bir secondary widget değil — Command Strip filter'ların hemen altında
> ve insight card'lar dashboard içine **gömülü** (§2.8). Her major section
> başlığında `🤖 ▾` Contextual AI Actions chip'i var. Drill-down drawer'ı
> açıldığında üstte RUNA assistant özet kartı çıkar.

```
┌────────────────────────────────────────────────────────────────────┐
│  HEADER  Şirket·Takım·Ürün·Tarih  [Yenile] [Rapor Studio] [Dışa akt.]│
│          ↑ scope rozeti: "Kapsam: Destek Takımı (PARAM)" sağ üstte  │
├────────────────────────────────────────────────────────────────────┤
│  🤖 RUNA AI COMMAND STRIP (§2.8.2) — birinci sınıf, sticky          │
│  - Operasyon briefingi (top 3 risk) + değişim + önerilen ilk aksiyon│
│  - [Yönetici özeti hazırla] [Bu dashboard hakkında sor]             │
│  - Üretildi stamp + Audit ID + Scope rozeti                          │
├────────────────────────────────────────────────────────────────────┤
│  TOP KPI ROW (6 tile, period delta + (i) info + AI ile açıkla)     │
│  [Açık] [SLA risk] [Bugün açılan] [Bugün çözülen] [Avg TTR] [Reopen%]│
│  ↑ her tile'da Metric Details popover + "🤖 AI ile açıkla" action   │
├────────────────────────────────────────────────────────────────────┤
│  🤖 INSIGHT — SLA Anomaly (severity rose)         [👍][👎][drill-down]│
│  (yalnız tetiklenirse render — sapma yoksa kart yok)                 │
├────────────────────────────────────────────────────────────────────┤
│  TIME SERIES (full-width)                          [🤖 ▾]            │
│  Açılan vs Çözülen vs SLA İhlali — gün/saat granularity              │
│  🤖 menu: "Bu trendi açıkla" / "Ne değişti?" / "Öneri"               │
├────────────────────────────────────────────────────────────────────┤
│  🤖 INSIGHT — Backlog Buildup (severity amber)    [drill-down]       │
├──────────────────────────────────────┬─────────────────────────────┤
│  BREAKDOWN — Statü dağılımı   [🤖 ▾] │ BREAKDOWN — Öncelik  [🤖 ▾] │
│  drilldown destekli bar                │  drilldown destekli bar   │
├──────────────────────────────────────┼─────────────────────────────┤
│  BREAKDOWN — Takım yükü       [🤖 ▾] │ BREAKDOWN — Şirket   [🤖 ▾] │
│  (top 10)                              │  (sadece cross-company role) │
├──────────────────────────────────────┴─────────────────────────────┤
│  🤖 INSIGHT — Repeated Issue (severity blue)      [drill-down]       │
├────────────────────────────────────────────────────────────────────┤
│  BREAKDOWN — Kategori & ürün grubu sıcak nokta tablosu  [🤖 ▾]      │
│  Sıralanabilir: Toplam · Açık · Avg TTR · SLA% · Eskalasyon%        │
│  Her satır tıklanabilir → drill-down (drawer'da RUNA özetler)        │
├────────────────────────────────────────────────────────────────────┤
│  🤖 INSIGHT — Customer Risk Cluster              [drill-down]        │
├────────────────────────────────────────────────────────────────────┤
│  TOP ACCOUNTS AT RISK (top 10 müşteri)           [🤖 ▾]              │
│  Customer Pulse state + açık + SLA + tekrar eden                     │
├────────────────────────────────────────────────────────────────────┤
│  🤖 INSIGHT — Workload Imbalance (Supervisor+)   [drill-down]        │
├────────────────────────────────────────────────────────────────────┤
│  AGENT PERFORMANCE (Supervisor+)                 [🤖 ▾]              │
│  Top 10 vs bottom 10 — yük, TTR, QA skoru                            │
│  ⚠ People-safe dil (§2.7.5) — etiket değil, akış sorusu              │
├────────────────────────────────────────────────────────────────────┤
│  PATTERN ALERTS (mevcut PatternAlert tablosu)    [🤖 ▾]              │
│  Aktif anomaliler — dismiss action mevcut                            │
└────────────────────────────────────────────────────────────────────┘

Drill-down drawer (her tıklanabilir KPI/satır):
┌──────────────────────────────────────────────────────────────────┐
│  Drill-down: "SLA İhlal Eden Vakalar" (162)            [✕][⤢]    │
│  🤖 RUNA — Bu listeyi özetliyor (§2.8.5)                          │
│  - Dominant kategori + müşteri tespiti                            │
│  - Incele önerisi: 3-5 highlighted satır                          │
│  - [✉ Takip mesajı hazırla] [⚠ Eskalasyon özeti hazırla]         │
│  ─────────────────────────────────────                            │
│  Vaka tablosu (server-side pagination, 50/sayfa)                  │
└──────────────────────────────────────────────────────────────────┘
```

**Detaylı AI yüzeyleri:** Command Strip §2.8.2, Insight Cards §2.8.3,
Contextual Actions §2.8.4, Drill-down assistant §2.8.5, Report Studio §2.8.6,
Visual design §2.8.7, Trust rules §2.8.8.

### Filtreler (URL-syncable, sticky)

| Filtre | Tip | Default | Notes |
| --- | --- | --- | --- |
| Şirket | Multi-select | `allowedCompanyIds` hepsi | SystemAdmin/multi-tenant Admin için |
| Takım | Multi-select | hepsi | Şirket seçimine bağımlı |
| Ürün grubu | Multi-select | hepsi | Distinct'ler tenant-scoped (P0.2 audit fix) |
| Tarih aralığı | Preset + custom | "Son 7 gün" | Preset: Bugün / Son 24h / 7g / 30g / Bu ay / Çeyrek |
| Vaka tipi | Multi-select | hepsi | GeneralSupport / ProactiveTracking / Churn |
| Statü | Multi-select | açık olanlar default | "Tümü" ekrana bağlı |

**URL state**: `?from=...&to=...&companies=...&teams=...` — paylaşılabilir
deep-link, refresh sonrası kaybolmaz.

### Drill-down etkileşimi

Her KPI tile + her breakdown bar + her tablo satırı tıklanabilir. Tıklamada:

1. **Drawer açılır** (sağdan slide-in, ~50% genişlik)
2. Drawer içinde **filtered case listesi** (server-side pagination, 50/sayfa)
3. Vaka satırı tıklanırsa → tam vaka detayı (drawer üstüne stack veya tam ekran)
4. Drawer'da **"Tüm filtrelerle CasesList'e git"** linki (URL state'i CasesList'e taşır)

Drill-down isteği aynı filtre + ek sütun (bucket) ile **dashboard endpoint'inden ayrı** bir drilldown endpoint'ine gider — KPI yüklemesi yavaşlamaz.

### AI insight davranışı

- **Non-blocking**: ana dashboard yüklendikten sonra arka planda fetch
- **Evidence-based**: her insight `{ summary, severity, evidence: { caseIds, metricSnapshot }, suggestedAction }` döner
- **Tıklanabilir**: "Vakaları gör" → drill-down drawer'ı insight'ın `caseIds`'iyle açar
- **Dismissible**: insight'ı gizle (24h cache local)
- **Fail-safe**: AI 503/500 → kart "Şu an analiz alınamadı" amber state, dashboard etkilenmez
- **Rate limit**: per-user 1 dk içinde max 3 generate çağrısı (cost protection)
- **Cache**: aynı filter + 5 dk içinde aynı sonucu döner (avoid redundant calls)

### UI states

| State | Davranış |
| --- | --- |
| **Loading** | Tile başına Skeleton; trend line için chart Skeleton; AI kartı kapalı |
| **Empty** (no data) | Her tile için "Veri yok" + ikon; "Filtreyi gevşet" CTA |
| **Error** (endpoint fail) | Tile başına error chip + "Yeniden dene"; dashboard çökmez |
| **Stale** (5 dk+ eski cache) | Yeşil dot → sarı dot; üst-sağda "Son güncelleme: 6 dk önce" + Yenile |
| **Partial** (bazı kart fail) | Diğerleri çalışmaya devam; fail olanlar amber state |
| **Cross-tenant guard fail** | Filter UI bunu zaten engellemeli ama BE 403 dönerse toast |

### Dark mode

Tüm chart renkleri `dark:` varyantlı. Recharts theme prop'u current theme'i okur. Smoke audit Phase 3'te `bg-white` problemleri çözüldü — bu sayfa aynı pattern'i kullanır.

---

## 2. Technical Design

### 2.1. Endpoint yüzeyi

#### `POST /api/analytics/cases/overview`

Tek istekle dashboard'un tamamını besler (KPI + breakdown'lar + time series).
Body POST tercih edildi çünkü filter set'i GET query string'inde çabuk taşar.

**Request body:**
```jsonc
{
  "from": "2026-05-06T00:00:00Z",     // ISO, gerekli (max 90 gün aralık)
  "to":   "2026-05-13T23:59:59Z",
  "companies":   ["COMP-PARAM"],      // opsiyonel; verilmezse allowedCompanyIds
  "teams":       ["TEAM-DESTEK"],     // opsiyonel
  "productGroups": ["Sanal POS"],     // opsiyonel
  "caseTypes":   ["GeneralSupport"],  // opsiyonel
  "statuses":    null,                // null = hepsi
  "granularity": "day"                // "hour" | "day" — time series için
}
```

**Response shape (tek payload):**
```jsonc
{
  "asOf": "2026-05-13T19:42:00Z",
  "windowMs": 12,                     // backend toplam süre — perf telemetri
  "kpis": {
    "totalCases":          { "value": 14823, "delta7d": 1242,   "trend": "up" },
    "openCases":           { "value":  4112, "delta7d":  -98,   "trend": "down" },
    "slaRiskCount":        { "value":   612, "delta7d":   72,   "trend": "up" },
    "createdToday":        { "value":  1834, "delta7d":   12 },
    "resolvedToday":       { "value":  1721, "delta7d":   45 },
    "avgTtrHours":         { "value":   5.4, "delta7d":  -0.3 },
    "reopenRatePct":       { "value":   3.1, "delta7d":  -0.2 },
    "slaViolationRatePct": { "value":   8.7, "delta7d":   0.6 }
  },
  "timeSeries": [
    { "bucket": "2026-05-06", "created": 1820, "resolved": 1755, "slaBreached": 162 },
    // …gün başına; granularity=hour ise saat başına
  ],
  "byStatus":   [{ "key": "Acik",    "count":  4112, "label": "Açık" }, …],
  "byPriority": [{ "key": "Critical","count":   218 }, …],
  "byCaseType": [{ "key": "GeneralSupport", "count": 12010 }, …],
  "byCompany":  [{ "id": "COMP-PARAM",  "name": "PARAM",  "count": 7012 }, …],
  "byTeam":     [{ "id": "TEAM-DESTEK", "name": "Destek", "count": 2118, "avgTtrHours": 4.8 }, … top 10],
  "byCategory": [
    { "category": "Yazılım", "subCategory": "Entegrasyon",
      "total": 2210, "open": 612, "avgTtrHours": 6.1,
      "slaBreachCount": 184, "slaBreachPct": 8.3 },
    // … top 20
  ],
  "topAtRiskAccounts": [
    { "accountId": "ACC-1042", "accountName": "Anadolu Holding",
      "openCount": 5, "slaBreachCount": 2, "pulseState": "Critical" },
    // … top 10
  ],
  "agentPerformance": {
    "topByVolume":    [{ "personId": "P-1", "name": "...", "resolvedCount": 218, "avgTtrHours": 3.9, "qaScore": 4.2 }, …],
    "bottomByQaScore":[…],
    "available": true  // false ise card hidden (yetki yok)
  },
  "activePatternCount": 3
}
```

#### `POST /api/analytics/cases/drilldown`

Tile veya breakdown'a tıklandığında çağrılır. Aynı filter + bir
**bucket** spec'i alır, ilgili vakaların paginated listesini döner.

**Request body:**
```jsonc
{
  // Aynı filter set (overview ile birebir uyumlu)
  "from": "...", "to": "...", "companies": [...], "teams": [...],
  "productGroups": [...], "caseTypes": [...], "statuses": [...],

  // Drill-down kriteri (sadece bir tane verilir):
  "bucket": {
    "kind": "status" | "priority" | "category" | "team" | "company"
          | "slaBreached" | "reopened" | "createdToday" | "atRiskAccount"
          | "patternAlert",
    "key":  "Acik",       // bucket.kind = 'status' → CaseStatus enum value
                          // bucket.kind = 'category' → { category, subCategory? }
                          // bucket.kind = 'atRiskAccount' → accountId
                          // bucket.kind = 'patternAlert' → patternAlertId
  },

  // Pagination
  "page": 1,
  "pageSize": 50,
  "sortBy": "createdAt" | "priority" | "slaResolutionDueAt" | "ageHours",
  "sortDir": "asc" | "desc"
}
```

**Response shape:**
```jsonc
{
  "items": [
    { "id": "cuid", "caseNumber": "PAR-2025-0001234", "title": "...",
      "status": "Açık", "priority": "High",
      "companyName": "PARAM", "accountName": "...",
      "category": "Yazılım", "subCategory": "Entegrasyon",
      "assignedTeamName": "Destek", "assignedPersonName": "...",
      "createdAt": "...", "slaResolutionDueAt": "...",
      "slaViolation": true, "ageHours": 28.2 }
  ],
  "total": 612,
  "page": 1, "pageSize": 50,
  "appliedBucket": { "kind": "slaBreached", "label": "SLA risk altındaki vakalar" }
}
```

#### `POST /api/ai/operations-insights` (opsiyonel — Phase 4)

Dashboard'un overview snapshot'ını alır, RUNA AI ile anomali/öneri üretir.

**Request body:**
```jsonc
{
  "filterFingerprint": "...",       // overview filter set'in stable hash'i (cache key)
  "snapshot": { /* overview response'unun küçültülmüş, AI-friendly versiyonu */ }
}
```

**Response shape:**
```jsonc
{
  "insights": [
    {
      "id": "ins-cuid",
      "severity": "info" | "warning" | "critical",
      "title": "Stokbar şikayetleri son 4 saatte 2.3× arttı",
      "narrative": "Son 4 saatte Univera/Stokbar kategorisinde 18 yeni vaka açıldı — geçen haftanın aynı diliminin 2.3 katı.",
      "evidence": {
        "metric": { "key": "categorySpike", "value": 18, "baseline": 8 },
        "caseIds": ["cuid1","cuid2", ...],
        "windowFrom": "...", "windowTo": "..."
      },
      "suggestedAction": "Univera takımı yükünü gözden geçir, gerekiyorsa transfer öner."
    }
  ],
  "usageLogId": "...",
  "generatedAt": "2026-05-13T19:42:00Z",
  "cacheTtlSec": 300
}
```

### 2.2. Tenant/auth modeli (özet)

- Tüm 3 endpoint `verifyJwt` ile korunur
- **Rol → scope** karar mantığı **§2.2A Role-Based Analytics Scope** bölümünde detaylı tanımlandı
- Cross-tenant veri sızıntısı server-side enforce edilir; frontend filter'a güvenilmez
- AI insights yalnızca scope-içi snapshot ile beslenir (CS Leadership/SystemAdmin haricinde cross-tenant payload AI'ya gönderilmez)

### 2.2A. Role-Based Analytics Scope

> **Mimari ilke:** Server her zaman scope'u `req.user.role` + `req.user.allowedCompanyIds`
> (+ `req.user.personId` + `personId → teamId` lookup) **üzerinden türetir**.
> Body'deki filter alanları (companies/teams) sadece **scope içinde daraltma**
> amaçlıdır — scope'u **genişletemez**. Frontend filter tenant scope için
> **asla** otoriter değildir.

#### Role matrisi

| Rol | Default scope | Maksimum scope | Cross-company agg? | Export | AI insight payload |
| --- | --- | --- | --- | --- | --- |
| **Agent** | Kendi kişisel performansı + kendi atandığı vakalar | Aynı | Hayır | Hayır | Yalnız kişisel vakalar |
| **Backoffice / CSM** | Kendi atandığı vakalar + (rol gerekiyorsa) kendi team queue'su | Team queue (config'e bağlı) | Hayır | Hayır | Yalnız kendi/team vakaları |
| **Supervisor / Team Lead** | Kendi takımının vakaları | `assignedTeamId IN supervisor.teamIds` (kendi yönettiği takım(lar)) | Hayır | Read-only PDF (opsiyonel — Phase 6) | Kendi takım vakaları |
| **Company Admin** | Atandığı tüm şirket(ler) | `companyId IN allowedCompanyIds` | Hayır (sadece kendi şirket(ler)i içinde takım kıyası) | CSV/XLSX kendi şirketleri | Kendi şirketlerinin scope'u |
| **CS Leadership** (yeni rol — internal-only) | Tüm tenant'lar (PARAM/Univera/Finrota) | Cross-company | **Evet** | Cross-company CSV | Cross-tenant snapshot (sadece bu role) |
| **SystemAdmin** | Tüm tenant'lar | Sınırsız | Evet | Hepsi | Cross-tenant snapshot |

**Yeni rol — "CS Leadership"**: Mevcut rol enum'unda yok. Önerilen iki yol:
1. **(Önerilen)** `User.role` enum'una `CSLeadership` ekle (small migration). Bu rol UserCompany kaydı olmadan tüm aktif şirketleri implicit görür (SystemAdmin gibi ama platform ayarlarına dokunamaz).
2. **(Alternatif)** Mevcut roller içinde tutmak için `User.crossTenantAnalytics: Boolean @default(false)` field'ı (custom permission flag). Daha esnek ama izin yönetimi büyür.

Bu doc'ta seçim: **CSLeadership enum üyesi** (basit, mevcut `User.role` switch'leri için tek satır eklemek yeter; kalıcı arşiv).

#### Data visibility kuralları (server-side enforcement)

Server-side helper: `deriveAnalyticsScope(user, requestBody)` her endpoint'in **ilk satırında** çağrılır ve şu shape'i döner:

```ts
type AnalyticsScope = {
  scopeKind: 'self' | 'team' | 'company' | 'cross-company';
  companyIds: string[];          // her zaman dolu (en az 1)
  teamIds: string[] | null;      // null = team filter yok (Admin+)
  personIds: string[] | null;    // null = person filter yok (Supervisor+)
  canExport: boolean;
  canCrossCompanyAgg: boolean;   // CS Leadership / SystemAdmin
  // İzin verilen filtre yüzeyi — UI'da yalnız bunlar gösterilir
  allowedFilters: {
    companies: string[];         // Admin: allowedCompanyIds; Supervisor: kendi şirket(ler)i
    teams: string[];             // Admin: tüm şirket takımları; Supervisor: kendi takım(lar)ı
    productGroups: string[];     // her zaman scope'tan distinct
  };
  // Telemetri/doğrulama için response.scope alanına da yansır
  effectiveScopeReason: string;  // "agent-self", "supervisor-team-12", vs.
};
```

**Türetme mantığı**:

```
if (user.role === 'Agent' || user.role === 'Backoffice' || user.role === 'CSM') {
  scopeKind = 'self';
  companyIds = [user.allowedCompanyIds[0]];
  personIds = [user.personId];          // null ise → 403 "personId bağlı değil"
  teamIds = null;
} else if (user.role === 'Supervisor') {
  // Supervisor'ün yönettiği takımları DB'den çek (Person.team where leadId/supervisorId match)
  // VEYA UserCompany.role === 'Supervisor' olduğu şirket(ler)deki tüm takımlar
  scopeKind = 'team';
  companyIds = intersect(body.companies, user.allowedCompanyIds);
  teamIds = supervisorTeams(user.id);   // boşsa fallback: tüm allowedCompanyIds takımları
  personIds = null;
} else if (user.role === 'Admin') {
  scopeKind = 'company';
  companyIds = intersect(body.companies, user.allowedCompanyIds);
  teamIds = body.teams ?? null;
  personIds = null;
  canExport = true;
} else if (user.role === 'CSLeadership' || user.role === 'SystemAdmin') {
  scopeKind = 'cross-company';
  // Body cross-tenant verebilir; allowed = tüm aktif companies (SystemAdmin),
  // ya da assignedCompanies ∪ "internal-ops" flag'i (CSLeadership).
  companyIds = body.companies ?? allActiveCompanyIds;
  teamIds = body.teams ?? null;
  canExport = true;
  canCrossCompanyAgg = true;
}
```

#### Endpoint scope enforcement

**Her** endpoint (overview, drilldown, AI insights, export) **aynı**
`deriveAnalyticsScope` helper'ını çağırır — copy-paste yok, tek kaynak.
Sonra:

| Endpoint | Scope kullanımı |
| --- | --- |
| `POST /api/analytics/cases/overview` | `WHERE companyId = ANY(scope.companyIds)` + (scope.teamIds varsa) `AND assignedTeamId = ANY(scope.teamIds)` + (scope.personIds varsa) `AND assignedPersonId = ANY(scope.personIds)`. `byCompany` breakdown sadece `canCrossCompanyAgg=true` ise döndürülür. `agentPerformance` Supervisor+ için açık. |
| `POST /api/analytics/cases/drilldown` | Aynı 3-katmanlı filter zorunlu. Body'de `bucket.key` istense bile scope dışı dönmez. Pagination cap = 200/sayfa. |
| `POST /api/ai/operations-insights` | Snapshot **scope'tan** üretilir. Cross-tenant AI çağrısı **sadece** `canCrossCompanyAgg=true` rolünden gelirse yapılır. CS Leadership olmayan kullanıcı yanlışlıkla snapshot içinde başka şirket veri'si gönderemez. |
| `POST /api/analytics/cases/export` *(Phase 6 — ayrı doc)* | `scope.canExport=true` zorunlu. Aynı 3-katman filter. Export raw vaka listesi — scope-out satır asla içermez. |

**Defense in depth — DB seviyesi (Phase 5+):** Postgres Row-Level Security
(Supabase native destek) ileride eklenebilir. Yine de application layer
filter yeterlidir + test edilir.

#### Drill-down scope kuralları

- Drill-down body **overview body ile aynı filter set'i** alır (URL'den taşır)
- Server-side `deriveAnalyticsScope` **yeniden** çağrılır (drilldown overview'a güvenmez — token süresinde rol değişebilir)
- Drilldown response'da **scope metadata echo edilir** (`response.scope`) — UI scope farkı varsa kullanıcıya bildirir
- Agent drill-down'u **yalnız** kendi atandığı veya kendisini izleyici olarak ekli olduğu vakaları döner; başka vaka istenirse 403 yerine sessiz 0-result + scope metadata "agent-self"
- Supervisor drill-down `assignedTeamId` dışına çıkamaz; başka takım istenirse silent narrow

#### Export scope kuralları

- Export sadece `scope.canExport=true` rollere açık (Admin, CSLeadership, SystemAdmin)
- Export endpoint aynı 3-katman filter'ı uygular + 90-gün üst sınır + 100K satır cap (kötü amaçlı dump koruması)
- Export job idempotent: her export request bir `ExportJob` satırı oluşturur (id, userId, scopeFingerprint, generatedAt, expiresAt 24h). Audit trail.
- Cross-company export sadece `canCrossCompanyAgg=true` rolde mümkün

#### AI insight scope kuralları

Mevcut §1 AI behavior'a ek olarak:

1. **Snapshot scope-bound**: AI'ya gönderilen snapshot **yalnız** `deriveAnalyticsScope` döndürdüğü filter sonucundan üretilir. Server snapshot'u oluşturduktan **sonra** AI'ya gönderir; client snapshot manipule edemez.
2. **Cross-tenant gate**: `snapshot.kind === 'cross-company'` flag'i sadece `scope.canCrossCompanyAgg=true` ise true olur. Aksi halde insight prompt'u "single-tenant view" olarak şekillenir; cross-company comparisons içeremez.
3. **Evidence caseIds doğrulaması**: AI response'un `evidence.caseIds[]` değerleri **scope.companyIds** ile cross-check edilir. Cross-tenant caseId döndürürse insight reject edilir (defensive — model hallucination olası).
4. **Cache key scope-aware**: insight cache key'i `filterFingerprint` yanı sıra `scopeFingerprint` (`hash(scope.companyIds + scope.teamIds + scope.personIds)`) içerir. Aynı kullanıcı role'ü değişse cache hit olmaz.
5. **Prompt'ta scope açık**: System prompt'a "Bu kullanıcı yalnız {scopeDescription} kapsamını görür — bu kapsam dışına çıkma" cümlesi konur. Bu hallucination'ı azaltır ama tek güvenlik katmanı değildir (server-side doğrulama #3 zorunlu).

#### `response.scope` metadata

Tüm 3 endpoint response'unda `scope` alanı zorunlu — UI ve audit için:

```jsonc
{
  "scope": {
    "kind": "team",                          // self | team | company | cross-company
    "companyIds": ["COMP-PARAM"],
    "companyNames": ["PARAM"],               // human-readable
    "teamIds": ["TEAM-DESTEK"],
    "teamNames": ["Destek Takımı"],
    "personIds": null,
    "canExport": false,
    "canCrossCompanyAgg": false,
    "narrative": "Destek Takımı (PARAM) için raporlama",  // i18n-ready text
    "narrowedFrom": null                     // body filter'ı kısıtlandıysa "body istemi 2 şirketti, 1'e indirildi"
  },
  // … kpis, breakdowns, vs.
}
```

UI üst-sağda bunu küçük rozetle gösterir: **"Kapsam: Destek Takımı (PARAM)"** — kullanıcının verisinin neden bu olduğunu anlaması için.

#### Filter UI — server-driven `allowedFilters`

Frontend filter dropdown'ları **server'dan gelen** `allowedFilters` list'ini
kullanır (overview response'undan ya da ayrı `GET /api/analytics/cases/scope-meta`
endpoint'inden). Client lookup cache'inden filter setleme **YASAK** — çünkü
lookup tüm şirket/takımları içerir ve cross-tenant sızıntı yapar.

| Rol | Şirket dropdown | Takım dropdown | Ürün grubu dropdown |
| --- | --- | --- | --- |
| Agent / Backoffice / CSM | Kendi şirketi (read-only) | Kendi takımı (read-only) | Scope distinct'i |
| Supervisor | Kendi şirket(ler)i | Kendi yönettiği takım(lar) | Scope distinct'i |
| Admin | `allowedCompanyIds` | Tüm şirket takımları | Scope distinct'i |
| CSLeadership / SystemAdmin | Tüm aktif şirketler | Tüm takımlar | Tüm distinct'ler |

#### Test matrisi (Phase 5 acceptance)

| Senaryo | Beklenti |
| --- | --- |
| Agent body'de başka company gönderir | Response yalnız kendi şirket vakalarını içerir; `scope.narrowedFrom` set |
| Supervisor body'de farklı takım gönderir | Response yalnız kendi takımının vakaları; başka takım gönderirse silent narrow |
| Admin (PARAM+UNIVERA) body'de FINROTA gönderir | Response sadece PARAM+UNIVERA — FINROTA scope dışı silent drop |
| CSLeadership body'de tüm şirketleri gönderir | Response cross-company; `byCompany` breakdown dolu |
| Agent rolüyle export çağrısı | 403 "export yetkisi yok" |
| AI insight: Agent rolü | Snapshot sadece kendi vakaları; cross-company prompt **yok** |
| AI response'unda scope dışı caseId | Insight reject + log warn + UI'da insight gösterilmez |
| Filter UI: Agent şirket dropdown | Yalnız 1 şirket disabled görünür; başka seçilemez |

### 2.3. Caching stratejisi

İki katman:

1. **Application-level memoization** (in-process Map) — Vercel serverless'ta `/api/index.js` cold start sonrası warm function'da geçerli. Key: `{filterFingerprint, userId, allowedCompanyIdsHash}`; TTL **30 sn** overview için, **5 dk** AI insights için.
   - Vercel serverless invocation per request olabilir → in-process cache kısa süreli avantaj sağlar.

2. **Redis/Upstash (opsiyonel — Phase 5)** — eğer Phase 5 scale hardening fazında p95 latency hedefi tutturulamazsa eklenebilir. Şimdilik **defer**.

3. **No browser-side cache** for overview — kullanıcı "Yenile" beklentisinde. Drill-down ise React Query/in-memory map ile sayfa içinde cache'lenir (URL-state değişene kadar).

### 2.4. Performans / index önerileri

Mevcut Case indexleri analytics yükü için kısmen yeterli ama 3 boyutlu (companyId + tarih + statü/category/team) sorgular için **composite index** eksik.

**Önerilen yeni indexler** (separate migration, additive only):

```sql
-- Hot path: companyId + tarih aralığı + status/category
CREATE INDEX "Case_companyId_createdAt_idx"        ON "Case"("companyId", "createdAt");
CREATE INDEX "Case_companyId_status_idx"           ON "Case"("companyId", "status");
CREATE INDEX "Case_companyId_assignedTeamId_idx"   ON "Case"("companyId", "assignedTeamId");
CREATE INDEX "Case_companyId_category_idx"         ON "Case"("companyId", "category", "subCategory");
CREATE INDEX "Case_companyId_resolvedAt_idx"       ON "Case"("companyId", "resolvedAt");
-- TTR + SLA breach hesabı için
CREATE INDEX "Case_slaViolation_companyId_idx"     ON "Case"("slaViolation", "companyId") WHERE "slaViolation" = true;
```

**Sorgu pattern'i** (Postgres):
```sql
-- Örnek: Statü dağılımı için
SELECT status, COUNT(*)
FROM "Case"
WHERE "companyId" = ANY($1) AND "createdAt" BETWEEN $2 AND $3
GROUP BY status;
-- Index: Case_companyId_createdAt_idx + Case_companyId_status_idx kapsar
```

**Raw SQL vs Prisma groupBy**: 800 agent × 30K vaka = **2.7M satır 90 gün için**. Prisma `groupBy` performansı genelde tatmin edici ama **avgTtrHours** + **slaBreachPct** gibi türetilmiş metrikler için **raw SQL CTE** önerilir:

```sql
WITH agg AS (
  SELECT
    "companyId",
    DATE_TRUNC('day', "createdAt") AS bucket,
    COUNT(*)                            AS created_count,
    COUNT(*) FILTER (WHERE "resolvedAt" IS NOT NULL)        AS resolved_count,
    COUNT(*) FILTER (WHERE "slaViolation" = true)           AS sla_breach_count,
    AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt"))/3600)
      FILTER (WHERE "resolvedAt" IS NOT NULL)               AS avg_ttr_hours
  FROM "Case"
  WHERE "companyId" = ANY($1) AND "createdAt" BETWEEN $2 AND $3
  GROUP BY "companyId", bucket
)
SELECT * FROM agg ORDER BY bucket;
```

Tek round-trip; tek index range scan. Prisma `$queryRaw` ile çağrılır.

### 2.5. Migration & index önerisi

- **6 yeni index** önerildi (yukarıda) — hepsi additive, downtime yok
- Mevcut Case tablosu 2.7M+ satıra çıkarsa `CREATE INDEX CONCURRENTLY` ile çalıştırılmalı (Supabase'de manual SQL editor'den)
- Phase 1 prework: migration yaratıp boş DB'ye applyla; prod'a Phase 5 öncesi `db:migrate:deploy` (mevcut OPERATIONS.md akışı)

### 2.6. Metric Accuracy & Auditability

> **Bu dashboard performans değerlendirmesi ve kariyer kararlarına etki edebilir.**
> Her sayı matematiksel olarak doğru, deterministik, tekrarlanabilir ve
> denetlenebilir olmak zorundadır. Aşağıdaki kurallar **non-negotiable**.

#### 2.6.1. Mimari ilke — AI sayı üretmez

**Boundary:**
- **AI yapar:** açıklar, özetler, vurgular, anomaliye dikkat çeker, neden-sonuç önerir
- **AI yapmaz:** toplam, oran, ortalama, sıralama, SLA breach sayısı, QA skoru hesabı, agent performance skoru, trend değeri

Tüm numerik metrikler **deterministik backend sorgusu**ndan gelir. AI insight endpoint'i bile metrik **hesaplamaz** — server-side aggregator'ın ürettiği snapshot'u alır, metni şekillendirir. Snapshot'ta olmayan bir sayıyı AI **uydurursa** §2.2A'daki cross-check (evidence validation) tetiklenir ve insight reject edilir.

**Test kuralı:** AI prompt + snapshot içinde geçmeyen herhangi bir sayı insight çıktısında ise → log warn + insight gösterme.

#### 2.6.2. Metric Dictionary

Her KPI için aşağıdaki şablon zorunlu. Bu doc tek **resmi kaynak** —
implementation bundan sapamaz.

##### `totalCases`
| Alan | Tanım |
| --- | --- |
| **Business definition** | Filter scope'a giren toplam vaka sayısı |
| **Formula** | `COUNT(*) FROM Case WHERE <scope filter>` |
| **Numerator** | Eşleşen tüm vakalar |
| **Denominator** | — (sayım) |
| **Included** | createdAt ∈ [from, to); scope filter geçenler |
| **Excluded** | createdAt range dışı; scope dışı şirketler |
| **Timezone** | from/to: ISO UTC; date boundary Europe/Istanbul (start-of-day) |
| **Scope filter** | §2.2A `deriveAnalyticsScope` |
| **Caveats** | Cancel edilen vakalar dahil (statü filtresi default değil); silinmiş veri (soft delete) yok — kalıcı silme uygulanmaz |
| **Rounding** | Integer |
| **Min sample** | — |

##### `openCases`
| Alan | Tanım |
| --- | --- |
| **Business definition** | Şu an açık (çözülmemiş + iptal değil) vaka sayısı — period-independent |
| **Formula** | `COUNT(*) FROM Case WHERE status IN ('Acik','Incelemede','ThirdPartyWaiting','Eskalasyon','YenidenAcildi') AND <scope>` |
| **Numerator** | Açık statüde olan vakalar |
| **Denominator** | — |
| **Included** | status ∈ açık enumlar; scope filter geçenler |
| **Excluded** | Cozuldu, IptalEdildi statüleri |
| **Timezone** | Snapshot — "as of now"; tarih range uygulanmaz |
| **Caveats** | Snooze edilmiş vakalar açık sayılır (statü hâlâ Acik) |

##### `slaRiskCount`
| Alan | Tanım |
| --- | --- |
| **Business definition** | SLA çözüm süresi dolmaya 4 saatten az kalmış açık vakalar (yaklaşan ihlal) |
| **Formula** | `COUNT(*) FROM Case WHERE status open enumlar AND slaResolutionDueAt BETWEEN NOW() AND NOW() + INTERVAL '4 hours' AND slaViolation = false AND <scope>` |
| **Numerator** | 4 saat içinde SLA dolacak ve henüz ihlal etmemiş açık vakalar |
| **Denominator** | — |
| **Included** | slaResolutionDueAt ∈ (now, now+4h]; status açık |
| **Excluded** | Zaten slaViolation=true olanlar (onlar "ihlal etmiş"); slaPausedAt NOT NULL (paused SLA ihlal sayılmaz) |
| **Timezone** | NOW() server UTC; boundary saat dilimi-agnostic (interval matematiği) |
| **Caveats** | 3rd party wait sırasında slaPausedAt set olur — pause süresi sayaca eklenmez (mevcut SLA pause behavior) |
| **Rounding** | Integer |

##### `slaViolationRatePct`
| Alan | Tanım |
| --- | --- |
| **Business definition** | Period içinde çözülen vakalardan SLA'yı ihlal etmişlerin yüzdesi |
| **Formula** | `100 * COUNT(slaViolation=true AND resolvedAt ∈ [from,to)) / NULLIF(COUNT(resolvedAt ∈ [from,to)), 0)` |
| **Numerator** | resolvedAt ∈ [from, to) AND slaViolation = true |
| **Denominator** | resolvedAt ∈ [from, to) (period içinde çözülen toplam) |
| **Included** | Yalnız period içinde çözülen vakalar |
| **Excluded** | Hâlâ açık vakalar (period sonunda açıksa hesaba katılmaz — biased lookback); resolvedAt NULL |
| **Timezone** | resolvedAt UTC; from/to UTC |
| **Caveats** | Açık vakalar dahil değil — bu metrik **resolved-only**. "Açıkta SLA ihlal eden" için ayrı metric (`openSlaBreachCount`) gerekirse eklenir. |
| **Rounding** | 1 ondalık (`8.7%`) |
| **Min sample** | 5 (≥ 5 çözülen vaka yoksa "Yetersiz veri") |

##### `createdInPeriod` (ve `createdToday` özel hali)
| Alan | Tanım |
| --- | --- |
| **Business definition** | Period içinde açılan vaka sayısı |
| **Formula** | `COUNT(*) WHERE createdAt ∈ [from, to) AND <scope>` |
| **Date boundary** | "Bugün" = Europe/Istanbul start-of-day inclusive, end-of-day exclusive |
| **Caveats** | Saat 23:55 Istanbul'da açılan vaka **bugün** sayılır; UTC switch (DST) Postgres `AT TIME ZONE 'Europe/Istanbul'` ile yönetilir |

##### `resolvedInPeriod` (ve `resolvedToday`)
| Alan | Tanım |
| --- | --- |
| **Business definition** | Period içinde çözülen (resolvedAt set edilen) vaka sayısı |
| **Formula** | `COUNT(*) WHERE resolvedAt ∈ [from, to) AND <scope>` |
| **Caveats** | YenidenAcildi olan vakalar → yeniden çözülürse her çözüm bir kez sayılır (resolvedAt overwrite); reopened olarak sayılmaz çünkü resolved sayısının kendisi bilgi vermez. Reopen için ayrı metrik. |

##### `avgTtrHours` (Time To Resolution)
| Alan | Tanım |
| --- | --- |
| **Business definition** | Çözülen vakaların ortalama açılış → çözüm süresi (saat cinsinden) |
| **Formula** | `AVG(EXTRACT(EPOCH FROM (resolvedAt - createdAt)) / 3600) WHERE resolvedAt ∈ [from, to) AND <scope>` |
| **Numerator** | Tüm çözülen vakaların TTR toplamı |
| **Denominator** | Çözülen vaka sayısı |
| **Included** | resolvedAt ∈ [from, to) AND resolvedAt > createdAt |
| **Excluded** | Hâlâ açık vakalar; resolvedAt < createdAt (data integrity); slaPausedDurationMin (pause süresi TTR'den **çıkarılır**) |
| **Caveats** | Pause süresi excluded → "net çalışma süresi". Wall-clock istenirse ayrı metrik (`avgTtrWallClockHours`) eklenir. |
| **Rounding** | 1 ondalık (`5.4h`) |
| **Min sample** | 5 |

**Spot-check SQL:**
```sql
SELECT
  AVG(EXTRACT(EPOCH FROM (resolvedAt - createdAt)) / 3600.0
      - (slaPausedDurationMin / 60.0)) AS avg_ttr_hours,
  COUNT(*) AS sample_size
FROM "Case"
WHERE companyId = ANY($1)
  AND resolvedAt >= $2 AND resolvedAt < $3
  AND resolvedAt > createdAt;
```

##### `firstResponseTimeMin`
| Alan | Tanım |
| --- | --- |
| **Business definition** | Vakaya **ilk Agent yanıtı** verilene kadar geçen ortalama süre (dakika) |
| **Formula** | `AVG(EXTRACT(EPOCH FROM (firstAgentResponseAt - createdAt)) / 60)` |
| **Required field** | `firstAgentResponseAt` — şu an mevcut DEĞİL → **şema'ya eklenecek** (Phase 1 prework). Hesaplama: ilk CaseActivity (Note/Call/StatusChange) Agent tarafından, müşteri-açma sonrası |
| **Min sample** | 5 |
| **Caveats** | Activity feed'den türetilmeli; ilk müşteri-açma sonrası ilk agent aksiyonu = response. Tanım yoksa metric **gösterilmez** ("Veri yapısı eksik"). |

##### `reopenRatePct`
| Alan | Tanım |
| --- | --- |
| **Business definition** | Bir kez çözülmüş ve sonra **yeniden açılmış** vakaların oranı — çözüm kalitesi sinyali |
| **Formula** | `100 * COUNT(*) FILTER (WHERE status='YenidenAcildi' AND resolvedAt ∈ [from, to)) / NULLIF(COUNT(*) FILTER (WHERE resolvedAt ∈ [from, to)), 0)` |
| **Numerator** | Period içinde resolvedAt set olan VE status='YenidenAcildi' olan vakalar |
| **Denominator** | Period içinde **çözülmüş** (resolvedAt set olan) tüm vakalar (**resolved-based** — Phase 1 kararı §5) |
| **Required source** | `Case.status` + `Case.resolvedAt`. CaseActivity history opsiyonel ileri analiz için. |
| **Included** | resolvedAt period içinde; status sonradan YenidenAcildi'ye dönmüş vakalar payına dahil |
| **Excluded** | Hiç çözülmemiş vakalar (denominator dışı); period dışı çözülenler |
| **Caveats** | Resolved-based payda **çözüm kalitesi** semantiğiyle uyumlu: "kaç vakayı çözdük, kaçı geri açıldı?" Created-based alternatifi (period içinde açılanlar) gecikmeli reopen sinyalini geç yakalar — Phase 1'de tercih edilmedi. |
| **Rounding** | 1 ondalık |
| **Min sample** | default (5) — yetersiz örnekte null + minSampleViolations'a eklenir |

##### `escalationRatePct`
| Alan | Tanım |
| --- | --- |
| **Business definition** | Period içinde escalationLevel != 'Yok' olan vakaların oranı |
| **Formula** | `100 * COUNT(escalationLevel != 'Yok' AND createdAt ∈ [from, to)) / NULLIF(COUNT(createdAt ∈ [from, to)), 0)` |
| **Caveats** | Escalation snapshot — period içinde escalation **olmuş** veya hâlâ olan vakalar. Tarihsel escalation history (CaseActivity'den türetme) daha doğru olabilir → v2'de eklenir |
| **Rounding** | 1 ondalık |

##### `agentWorkload`
| Alan | Tanım |
| --- | --- |
| **Business definition** | Agent başına aktif açık vaka sayısı (snapshot) |
| **Formula** | `GROUP BY assignedPersonId, COUNT(*) WHERE status open AND <scope>` |
| **Included** | Atanmış + açık vakalar |
| **Excluded** | Unassigned vakalar (`assignedPersonId IS NULL`) → ayrı `unassignedQueueCount` metriği |
| **Caveats** | Snooze edilmiş vakalar dahil (atanan kişi hâlâ sorumlu); transfer edilen vakalar yeni atanan kişiye sayılır |

##### `agentResolvedCount` (period)
| Alan | Tanım |
| --- | --- |
| **Business definition** | Period içinde her agent'ın çözdüğü vaka sayısı |
| **Formula** | `GROUP BY assignedPersonId, COUNT(*) WHERE resolvedAt ∈ [from, to)` |
| **Caveats** | Çözüm anındaki atanan kişi sayılır — transferred-out vaka çözüm tarihindeki agent'a yazılır. Tarihsel **gerçek çözen** için CaseActivity log gerekir (v2) |

##### `qaScoreAvg`
| Alan | Tanım |
| --- | --- |
| **Business definition** | Period içinde QA skorlanmış vakaların ortalama skoru (0-5 ölçeği) |
| **Formula** | `AVG((qaEmpathyScore + qaClarityScore + qaSpeedScore) / 3.0) WHERE qaScoredAt ∈ [from, to)` |
| **Source** | QAScoreLog tablosu (existing) |
| **Min sample** | 5 |
| **Rounding** | 1 ondalık |
| **Caveats** | QA cron yalnız Cozuldu vakalarını skorlar; period içinde QA cron çalışmadıysa sample sıfır olabilir |

##### `retentionSuccessPct`
| Alan | Tanım |
| --- | --- |
| **Business definition** | Churn vakalarında "Başarılı" retention oranı |
| **Formula** | `100 * COUNT(retentionStatus='Basarili' AND caseType='Churn' AND createdAt ∈ [from, to)) / NULLIF(COUNT(caseType='Churn' AND createdAt ∈ [from, to)), 0)` |
| **Excluded** | retentionStatus = 'DevamEdiyor' denominator'da yok (henüz outcome yok) |
| **Min sample** | 10 |
| **Rounding** | 1 ondalık |

##### `backlogChangePct` (period over period)
| Alan | Tanım |
| --- | --- |
| **Business definition** | Period başındaki açık vaka sayısına göre period sonundaki açık vaka sayısı değişimi (%) |
| **Formula** | `100 * (openCount(at to) - openCount(at from)) / NULLIF(openCount(at from), 0)` |
| **Required** | Tarihsel snapshot — Case yalnız current state; "period başında açıktı" sorgusu CaseActivity'den türetilir veya **günlük cron snapshot** tablosu gerekir |
| **Caveats** | İlk implementation: yalnız `createdAt vs resolvedAt` ile yaklaşık (created during period - resolved during period). **"approximate" label'ı zorunlu**. Kesin değer için Phase 5'te `BacklogSnapshot` tablosu cron'lanır. |
| **Rounding** | 1 ondalık |

##### `transferRatePct`
| Alan | Tanım |
| --- | --- |
| **Business definition** | Period içinde açılan vakalardan en az bir kez transfer edilenlerin oranı |
| **Formula** | `100 * COUNT(transferCount > 0 AND createdAt ∈ [from, to)) / NULLIF(COUNT(createdAt ∈ [from, to)), 0)` |
| **Source** | `Case.transferCount` field (mevcut) |
| **Rounding** | 1 ondalık |

#### 2.6.3. Rounding & sayısal kurallar

| Tip | Kural | Örnek |
| --- | --- | --- |
| **Yüzde** | 1 ondalık, `ROUND(value, 1)` | `8.7%` |
| **Saat** | 1 ondalık | `5.4h` |
| **Dakika** | Integer (round half-up) | `48 dk` |
| **Sayım** | Integer | `1834` |
| **Sıralama berabere** | Deterministik tiebreaker: `ORDER BY <metric> DESC, createdAt ASC, id ASC` | Aynı resolveCount'a sahip 2 agent → daha önce vaka kapatan üstte |
| **NULL division guard** | `NULLIF(denominator, 0)` → NULL → UI'da `—` veya "Yetersiz veri" | 0 vaka varsa `slaViolationRatePct = null`, "—" |
| **Floating point** | Integer math önce, son adımda `/ 100.0` veya `/ 3600.0` | Postgres `EXTRACT(EPOCH FROM ...) / 3600.0` |
| **Currency / TL** | Bu dashboard'da yok; ileride eklenirse: `NUMERIC(18,2)`, 2 ondalık | — |

**Approximation labeling**: Bir metric kesinleştirilemiyor (örn. backlogChangePct snapshot tablosu yokken) → response'da `approximate: true` flag + UI'da `~` prefix + tooltip "yaklaşık değer; kesin hesap için tarihsel snapshot gerekir".

#### 2.6.4. Date boundary & timezone

**Tek kural:** Tüm metric `Europe/Istanbul` timezone'da yorumlanır.

- **from/to** request body'de **ISO UTC** olarak gelir (örn. `2026-05-06T00:00:00Z`)
- Frontend kullanıcının "Son 7 gün" gibi preset'ini Istanbul start-of-day ile UTC'ye çevirir
- Backend `WHERE createdAt >= $from AND createdAt < $to` → **inclusive start, exclusive end** (yarı-açık aralık standardı)
- "Bugün" = Istanbul start-of-day → ertesi Istanbul start-of-day exclusive
- DST geçişleri Postgres `AT TIME ZONE 'Europe/Istanbul'` ile yönetilir; range hesabı UTC'de yapılır
- Time series bucket'ları **Istanbul timezone'da day/hour boundary**: `DATE_TRUNC('day', createdAt AT TIME ZONE 'Europe/Istanbul')`

**Cross-midnight edge case:**
- Vaka `2026-05-13 23:55 +03:00` (Istanbul) = `20:55 UTC`
- "13 Mayıs" bucket'ında olmalı, "12 Mayıs"ta değil
- `DATE_TRUNC('day', createdAt AT TIME ZONE 'Europe/Istanbul') = DATE '2026-05-13'` ✅

#### 2.6.5. Drill-down traceability

Her KPI tile'a **info icon (i)** eklenir. Tıklayınca **Metric Details popover** açılır:

```
┌─────────────────────────────────────────────┐
│ SLA İhlal Oranı — %8.7                       │
├─────────────────────────────────────────────┤
│ Formül:                                      │
│   100 × (SLA ihlal eden çözülmüş) / (toplam │
│   çözülmüş)                                  │
│                                              │
│ Pay (numerator):     162                     │
│ Payda (denominator): 1,860                   │
│                                              │
│ Kapsam: Destek Takımı (PARAM)                │
│ Dönem:  6 May 2026 → 13 May 2026             │
│ Üretildi: 13 May 2026 19:42 (Istanbul)       │
│ Audit ID: m-cuid-...                         │
│                                              │
│ [İhlal eden 162 vakayı gör →]                │
│ [Tüm 1,860 çözülmüş vakayı gör →]            │
└─────────────────────────────────────────────┘
```

**Drilldown garanti:** "İhlal eden 162 vakayı gör" tıklanırsa drill-down drawer açılır; drawer'daki vaka listesi **tam olarak** o numerator sorgusunun sonucudur (`COUNT(*)` ile aynı `findMany`). UI ↔ backend tutarlılığı: drill-down endpoint'in WHERE clause'u metric'in numerator/denominator clause'u ile **bit-bit aynı** olmak zorundadır. Bu da §2.6.9 testleriyle korunur.

**Drilldown sensitive metric'ler (zorunlu):**
- slaViolationRatePct
- avgTtrHours
- firstResponseTimeMin
- reopenRatePct
- agentWorkload
- qaScoreAvg
- escalationRatePct
- backlogChangePct
- retentionSuccessPct
- transferRatePct

#### 2.6.6. Audit log / `generatedAt` davranışı

Her response zorunlu alanlar:
```jsonc
{
  "asOf": "2026-05-13T19:42:00.000Z",     // UTC ISO
  "asOfLocal": "13 May 2026 22:42 +03:00", // Istanbul, human-readable
  "metricAuditId": "m-cuid-xyz",           // unique per response
  "scope": { /* §2.2A */ },
  "appliedFilters": {                      // hangi filter etkin oldu
    "from": "...", "to": "...",
    "companies": [...], "teams": [...], "productGroups": [...]
  },
  "formulaVersion": "v1",                  // metric tanım versiyonu — UI cache invalidation için
  "approximations": [],                    // örn. ["backlogChangePct"]
  "minSampleViolations": ["qaScoreAvg"]    // sample < threshold olanlar; UI bunları "yetersiz veri" gösterir
}
```

**Audit table (önerilen — Phase 1 ile birlikte)**:

```prisma
model MetricQueryAudit {
  id               String   @id @default(cuid())
  userId           String
  endpoint         String   // 'overview' | 'drilldown' | 'export' | 'ai-insights'
  scopeFingerprint String   // hash(scope.companyIds + teamIds + personIds)
  filterFingerprint String  // hash(appliedFilters)
  formulaVersion   String
  generatedAt      DateTime @default(now())
  durationMs       Int
  recordsScanned   Int?     // approximate query plan estimate
  responseHash     String?  // hash of response (opsiyonel — diff için)

  @@index([userId, generatedAt])
  @@index([endpoint, generatedAt])
}
```

**Kullanım:** Çalışan başvurusu "skorum yanlış" derse → MetricQueryAudit'ten ilgili `metricAuditId` aranır → o anki tam scope + filter + formulaVersion + sample size yeniden hesaplanabilir.

#### 2.6.7. "Metric confidence" / data incomplete davranışı

| Durum | UI davranışı |
| --- | --- |
| Sample size < min threshold | Tile değer alanı `—`, alt satırda **"Yetersiz veri (n=3, min=5)"** + ikon (gri) |
| Required field eksik (örn. firstAgentResponseAt yok) | Tile **gösterilmez** + dashboard'un ilgili bölümünde info banner "Bu metrik için DB alanı henüz hazır değil" |
| Approximation flag | Değerin başına `~` + tooltip; renkten dolayı misleading olmamasına dikkat |
| Tüm denominator 0 (örn. period içinde hiç çözülen yok) | `—` + "Veri yok (period içinde çözülmüş vaka yok)" |
| Endpoint partial fail (bir KPI sorgusu fail) | O tile **error state** (amber + retry), diğerleri çalışmaya devam |
| Token süresi dolmuş / scope değişmiş | Tüm dashboard 401 / 403; full reload |

**AI kuralı**: Yetersiz veri durumunda AI insight bu metric hakkında **konuşamaz**. Snapshot'a `minSampleViolations` array'i eklenir; AI prompt'a "bu metrikler hakkında konuşma" instruction'ı gömülür.

#### 2.6.8. Export ↔ dashboard tutarlılığı

**Tek kaynak ilkesi:** Export endpoint **aynı** `operationsAggregator` helper'ını
kullanır — ayrı SQL yazılmaz. UI'da gördüğün rakam, export'taki rakamla
**her zaman aynı** (aynı scope, aynı filter, aynı formulaVersion).

**Export payload zorunlu footer:**
- formulaVersion
- generatedAt (Istanbul)
- scope (human-readable)
- appliedFilters
- metricAuditId
- sampleSizeViolations / approximations

PDF/XLSX export'unun son sayfası bu audit footer'ı içerir — okuyucu kararı verirken kapsam farkını görür.

**Yasak:** "Export için ayrı hesaplama" veya "performance için round-up" — yok. Aynı helper'dan geçmeyen export rakamı kabul edilmez.

#### 2.6.9. Test strategy — metric correctness

Üç katman:

##### A. Formula unit tests (`server/analytics/__tests__/operationsAggregator.test.ts`)

Pure function level — fixture data verip helper'ın doğru hesapladığını doğrula:

```ts
// Örnek: slaViolationRatePct
test('100 SLA-resolved out of 1000 resolved = 10.0%', () => {
  const result = computeSlaViolationRate({ slaResolvedCount: 100, totalResolvedCount: 1000 });
  expect(result).toBe(10.0);
});
test('0 resolved → null (not 0%, not NaN)', () => {
  const result = computeSlaViolationRate({ slaResolvedCount: 0, totalResolvedCount: 0 });
  expect(result).toBeNull();
});
test('NULL safe — denominator 0', () => {
  expect(computeAvgTtr({ totalSeconds: 0, sampleSize: 0 })).toBeNull();
});
```

##### B. Seed scenario expected values (`docs/METRIC_FIXTURES.md` — Phase 1 ile)

`prisma/seedScenarios.ts` ile gelen 18 demo vaka için **her metriğin beklenen değeri** elle hesaplanır ve fixture olarak tutulur. Integration test bu fixture'a karşı koşar.

| Metric | DEMO seed beklenen (default scope: tüm DEMO-) | Hesaplama |
| --- | --- | --- |
| `totalCases` | 18 | manual count |
| `openCases` | 15 | (DEMO-FIN-003=Cozuldu, DEMO-FIN-004=ThirdPartyWaiting, DEMO-UNI-PARENT-001=Incelemede dahil — açık sayılır) |
| `slaViolationRatePct` | %50 (1 / 2 çözülen) | DEMO-FIN-002 (slaViolation=true, ama açık → resolved-only filtre dışı), DEMO-UNI-002 (slaViolation=true, eskalasyon → resolved-only dışı). Çözüleler: DEMO-FIN-003 (slaViolation=false) → 0/1 → %0. **Beklenen 0%** (revision). |
| `avgTtrHours` | yalnız DEMO-FIN-003 çözüldü → tek-değer ortalaması | manual: createdAt - resolvedAt'tan hesapla |
| … | … | … |

(Bu tablonun tamamı Phase 1 prework'ünde finalize edilir; doc o aşamada `METRIC_FIXTURES.md` ile birlikte güncellenir.)

##### C. Edge case test matrisi

| Edge case | Senaryo | Beklenti |
| --- | --- | --- |
| **Reopened case** | Cozuldu → YenidenAcildi geçişi | reopen sayılır; resolvedAt sıfırlanır mı yoksa korunur mu? **Karar: korunur** (orijinal resolution time); reopen sonrası yeniden resolve edilirse resolvedAt update |
| **Canceled case** | IptalEdildi statüsü | TTR hesabına **dahil değil** (resolvedAt null kalır); totalCases'e dahil |
| **Paused SLA / 3rd party wait** | slaPausedAt set, slaPausedDurationMin > 0 | avgTtrHours'tan pause süresi **çıkarılır** (`/ 60` dakikadan saate); slaViolation flag'i SLA pause sırasında set olmaz |
| **Cross-midnight Istanbul** | Vaka 23:55 +03:00'te açıldı | "Bugün" bucket'ında olmalı (DATE_TRUNC AT TIME ZONE) |
| **DST transition** | 2026-03-29 02:00 → 03:00 atlama | Hour granularity'de "kayıp saat" bucket'ı `count=0` olmalı; aggregator NaN dönmemeli |
| **Unassigned case** | assignedPersonId NULL | `agentWorkload`'a dahil değil; ayrı `unassignedQueueCount` metric'inde |
| **Transferred case** | transferCount > 0 | `transferRatePct` payına eklenir; agentResolvedCount **çözüm anındaki** atanana yazılır |
| **Duplicate linked case** | DEMO-PAR-DUP-A ve DUP-B birbirine Duplicate | totalCases'te **iki ayrı vaka** sayılır (link != aynı vaka); rapor okuyana duplicate'lar drill-down'da görünür |
| **Multi-tenant boundary** | Aynı müşteri 3 şirkette (DEMO-MT-*) | Default scope kullanıcının izinli şirket(ler)i — diğerleri **gözükmez** |
| **Empty scope** | Kullanıcı 0 izinli şirkete sahip | Tüm metric'ler `null` + dashboard "Henüz yetkili olduğunuz bir şirket yok" empty state |
| **Period boundary** | from == to (boş aralık) | Validation: 400 "from ve to farklı olmalı" |
| **Period > 90g** | from = 2026-01-01, to = 2026-05-13 | Validation: 400 "max 90 gün" |

##### D. Regression fixtures — golden snapshots

Phase 1 PR'ı ile birlikte `server/analytics/__tests__/golden/operations-overview.json` dosyası:
- DEMO- seed + sabit `from`/`to` ile çağrı sonucu donmuş JSON
- Her sonraki refactor bu fixture'a karşı diff
- Değişiklik kasıtlıysa `formulaVersion` bump + fixture güncellenir + PR'da explicit

##### E. Spot-check SQL examples

Her metric için doc'ta canlı SQL örneği var (yukarıda `avgTtrHours` spot-check verildi). Veri ekibi ya da audit bu SQL'i Supabase SQL editor'de çalıştırıp UI ile karşılaştırabilir.

### 2.7. AI as Analyst Companion

> **Rol tanımı:** AI burada **veri analisti yardımcısı** — yöneticiye yorumla,
> yönlendir, draft hazırla, "neye bakmalı" söyle. **Sayı üretmez** (§2.6.1),
> **kişi hakkında hüküm vermez**, **karar vermez** — yönetici karar verir,
> AI eylemi kolaylaştırır.

#### 2.7.1. AI companion UX prensipleri

1. **Augment, don't replace** — Her AI çıktısı yanında deterministik sayı var; AI sadece bağlam veriyor
2. **Evidence first** — Her insight `evidence` chip'leri ile çıkar; "drill-down"a tıkla → AI'nın bahsettiği vakaları gör
3. **Scope-aware** — AI her zaman "Mevcut filtreler içinde…" der; kullanıcı hangi kapsamda konuştuğunu bilir
4. **Trust through humility** — AI "bence", "öneririm", "kontrol etmeye değer"; "kesinlikle", "şüphesiz" yok
5. **Action-oriented** — Her insight sonunda **"Sonraki adım"** veya **"Nereye bakılmalı"** önerisi; sadece teşhis değil yönlendirme
6. **Dismissible** — Her kart kapatılabilir; gözle gözle aynı insight cache TTL'sinde tekrar görünmez
7. **Fail-safe** — AI 503/timeout → kart "AI önerisi alınamadı" amber state; dashboard etkilenmez
8. **People-safe language** — Agent-bazlı analitikte dil **HR-uygun**: kişiyi yargılamaz, sistem/iş yükü/akış sorusuna döner

#### 2.7.2. Required AI experiences

##### (a) Executive AI Brief — dashboard üstü

Dashboard'un en üstünde sticky kart (Pattern Alert + scope rozeti şeridinin altında). Daily/weekly özet:

```
┌──────────────────────────────────────────────────────────────────┐
│ 🤖 RUNA Yönetici Özeti                          [Yenile] [Kapat] │
│ Mevcut filtreler: PARAM, Son 7 gün                                │
├──────────────────────────────────────────────────────────────────┤
│ Bugün dikkat edilmesi gereken 3 konu:                             │
│                                                                    │
│ 1. 🔴 Sanal POS kategorisinde SLA ihlali son 24 saatte iki katı   │
│    [12 ihlal vakası] [→ Drill down] [→ AI ile açıkla]            │
│                                                                    │
│ 2. 🟠 Destek Takımı bekleyen kuyruğu %30 büyüdü                   │
│    [38 → 49 açık vaka] [→ Takım yükünü gör]                       │
│                                                                    │
│ 3. 🟡 Kemal Mali Müşavirlik müşterisinde 3 açık vaka              │
│    [Customer Pulse: Riskli] [→ Müşteri detayına git]              │
│                                                                    │
│ Dünkü güne göre değişen: çözüm süresi +0.4h, açılan vaka -8%      │
│ En hızlı aksiyon: Sanal POS SLA risk vakaları                     │
└──────────────────────────────────────────────────────────────────┘
```

**Davranış:**
- Top 3 insight (severity sırası: critical → warning → info)
- Her bullet ≤ 100 char + evidence chip + tıklanabilir CTA
- "Mevcut filtreler" rozeti zorunlu
- "Üretildi: 10 dk önce" stamp + Yenile butonu
- Cache: 5 dk (aynı scopeFingerprint+filterFingerprint için)
- Kullanıcı dismiss ederse → 24h local hide

##### (b) Explain This Metric — her sensitive KPI tile'ında

§2.6.5'deki info popover'a ek olarak **"AI ile açıkla"** action button:

```
[ KPI tile: SLA İhlal Oranı %8.7 ↑1.2 ]
                   |
                   ▼ (info icon click)
┌──────────────────────────────────────┐
│ SLA İhlal Oranı — Formül + Audit     │
│ [→ İhlal eden 162 vakayı gör]        │
│ [→ Tüm 1860 çözülen vakayı gör]      │
│                                      │
│ [🤖 AI ile açıkla]                   │  ← yeni action
└──────────────────────────────────────┘
                   |
                   ▼ click
┌──────────────────────────────────────┐
│ 🤖 RUNA — SLA İhlal Oranı            │
│ Mevcut filtre: PARAM · Son 7 gün     │
├──────────────────────────────────────┤
│ Bu metrik ne?                        │
│   Period içinde çözülmüş vakalardan  │
│   SLA süresini aşmış olanların       │
│   yüzdesi.                           │
│                                      │
│ Neden bu hafta yükseldi?             │
│   - Sanal POS kategorisinde 38 ihlal │
│     (geçen hafta 12)                 │
│   - Destek Takımı'nda 11 ihlal       │
│     (geçen hafta 4)                  │
│                                      │
│ Nereye bakılmalı?                    │
│   - "Sanal POS · son 7 gün · SLA     │
│     ihlal" kombinasyonunun drill-    │
│     down'ı [→ aç]                    │
│   - Destek Takımı yük dengesi        │
│     [→ Takım detayına git]           │
└──────────────────────────────────────┘
```

**Kurallar:**
- AI **yalnız** snapshot içindeki gerçek sayıları alıntılar (§2.6.1)
- "Neden değişti" yorumu **deterministik delta**'lardan türetilir; sebep **tahmin** olamaz
- Her satırda drill-down link (evidence)
- Şu metric'ler için zorunlu: slaViolationRatePct, avgTtrHours, firstResponseTimeMin, reopenRatePct, agentWorkload, qaScoreAvg, escalationRatePct, backlogChangePct, retentionSuccessPct

##### (c) Ask RUNA About This View — context-aware chat

Sağ alt köşede floating button (mevcut `RunaAiChatPanel` benzeri). Açılınca **mevcut dashboard scope'unu** bağlam olarak alır:

```
[Sticky chat panel — sağ alt]
┌────────────────────────────────────────────┐
│ 🤖 RUNA — Bu görünüm hakkında soru          │
│ Bağlam: PARAM · Son 7 gün · Destek Takımı  │
├────────────────────────────────────────────┤
│ Önerilen sorular:                          │
│  [SLA neden yükseldi?]                     │
│  [Hangi takımda birikme var?]              │
│  [Bu agent için dikkat edilecek örüntü?]   │
│  [Yöneticiye göndereceğim kısa özet hazırla]│
│                                            │
│ Veya kendi sorunu yaz...                   │
│ ┌────────────────────────────────────────┐ │
│ │ Sanal POS yığılması neden?             │ │
│ └────────────────────────────────────────┘ │
│                                  [Gönder] │
└────────────────────────────────────────────┘
```

**Bağlam payload'u (server-side enrichment):**
```jsonc
{
  "message": "Sanal POS yığılması neden?",
  "viewContext": {
    "scopeFingerprint": "...",                 // §2.2A
    "filterFingerprint": "...",                // §2.6.6
    "appliedFilters": { /* period, companies, teams, productGroups */ },
    "kpiSnapshot": { /* overview response özeti — sayılar deterministik */ },
    "selectedBucket": null | { /* drill-down açıksa */ },
    "selectedAgentId": null,
    "selectedAccountId": null
  }
}
```

**Önemli:**
- Sorular **scope-bound** yanıtlanır; AI başka filter'a kaçamaz
- Mevcut `RunaAiChatPanel` zaten dashboard chat yapıyor; context payload bu doc'un kuralı (mevcut endpoint reuse edilebilir)
- "Yöneticiye özet hazırla" → otomatik §2.7.2(d) AI Report Draft tetikler

##### (d) AI Generated Report Draft

Dashboard üst sağda **"Rapor Taslağı Hazırla"** butonu. Tıklandığında AI mevcut scope için Türkçe profesyonel rapor draft'ı üretir:

```
═══════════════════════════════════════════════════
RUNA AI tarafından oluşturulan TASLAK rapor

KAPSAM:   PARAM şirketi, Destek Takımı
DÖNEM:    6 May 2026 — 13 May 2026 (Europe/Istanbul)
ÜRETİLDİ: 13 May 2026 22:42 (Audit ID: m-cuid-xyz)
FORMÜL:   v1
═══════════════════════════════════════════════════

ÖZET
Geçen hafta itibarıyla Destek Takımı'nda toplam 412 vaka
işlendi (önceki haftaya göre +6%). Çözüm süresi
ortalaması 5.4 saat seviyesinde (önceki: 5.1). Açık
vaka sayısı haftalık 38'den 49'a yükseldi.

ÖNE ÇIKAN BULGULAR
• Sanal POS kategorisinde SLA ihlal oranı %12.4 (önceki
  %5.8). Bu kategoride 38 ihlal vakası mevcut.
• Müşteri "Kemal Mali Müşavirlik" için 3 açık vaka var;
  ikisi SLA risk altında.
• YenidenAcildi (reopen) oranı %3.1 — bir önceki hafta
  ile aynı seviyede.

ÖNERİLEN AKSİYONLAR
1. Sanal POS kategorisindeki ihlal vakalarının kök
   neden analizi.
2. Destek Takımı yük dengesinin gözden geçirilmesi
   (kuyrukta birikme var).
3. Kemal Mali Müşavirlik için proaktif iletişim
   planı.

NOTLAR
- Bu rapor RUNA AI tarafından mevcut filtrelerden
  TASLAK olarak hazırlandı. Yönetici onayı gerekir.
- Sayısal değerler deterministik backend
  sorgularından alınmıştır (formulaVersion v1).
- Audit ID: m-cuid-xyz
═══════════════════════════════════════════════════
```

**Format kuralları:**
- Türkçe, profesyonel ton (default — config ile İngilizce eklenebilir)
- **TASLAK** etiketi zorunlu (üstte ve altta)
- Üst metadata kutusu: kapsam, dönem, audit id, formulaVersion
- Sayılar AI tarafından **eklenmez**; backend snapshot'ından alıntılanır (§2.6.1)
- 3-4 bullet özet + 3 öneri yapısı (executive readable)
- AI HR/performance hükmü vermez (§2.7.5)
- Kullanıcı düzenleyebilir (textarea) + "Kopyala", "Mail draftı olarak indir (.eml)", "PDF'e çevir" (PDF Phase 5+)
- Generated rapor `MetricQueryAudit`'e log'lanır (`endpoint='ai-report-draft'`)

#### 2.7.3. AI insight card structure

Her insight kartının zorunlu şeması:

```jsonc
{
  "id": "ins-cuid",
  "title": "Sanal POS SLA ihlali son 24 saatte iki katı",   // ≤ 80 char
  "severity": "critical" | "warning" | "info",
  "explanation": "Mevcut filtrelerde (PARAM, son 7 gün) Sanal POS kategorisinde SLA ihlali geçen haftanın iki katı seviyesinde. Önceki dönem 6 vakaydı, bu dönem 12 vaka.",  // 1-3 cümle, scope açıkça belirtilir
  "evidence": [
    {
      "kind": "metric",
      "label": "SLA İhlal — Sanal POS",
      "value": "12 vaka",
      "change": "+100% (önceki 6 vaka)",
      "drilldown": {
        "bucket": { "kind": "category", "key": "Sanal POS" },
        "filterOverrides": { /* gerekirse */ }
      }
    },
    {
      "kind": "caseSample",
      "label": "Örnek vaka",
      "caseIds": ["cuid1","cuid2","cuid3"],         // max 5; cross-check edilir
      "drilldown": { "bucket": { "kind": "slaBreached" } }
    }
  ],
  "recommendedAction": {
    "summary": "Sanal POS kategorisindeki ihlal vakalarının kök neden analizi.",
    "ctaLabel": "İhlal vakalarını incele",
    "ctaTarget": { "bucket": { "kind": "slaBreached" }, "filterOverrides": { "categories": ["Yazılım/Sanal POS"] } }
  },
  "scopeNarrative": "Mevcut filtreler: PARAM · Son 7 gün · Destek Takımı",
  "dismissible": true,
  "generatedAt": "...",
  "metricAuditId": "..."     // hangi response snapshot'ına dayanıyor
}
```

**UI rendering kuralları:**
- Severity renk: critical=rose, warning=amber, info=blue (light + dark variant)
- Evidence chip'leri tıklanabilir → drilldown drawer açılır
- "Drill down" butonu primary CTA olarak sağ alt
- AI lozengesi (RUNA ikon + "AI Insight" badge) → kullanıcı her zaman AI üretimi olduğunu görür
- Dismiss → kart kaybolur, 24h aynı insight (id ile) gelmez
- Boş durumda (no insights): "Sapma yok — operasyon normal" yeşil empty state

#### 2.7.4. AI report draft — endpoint behavior

`POST /api/ai/operations-report-draft` (Phase 4):

**Request:**
```jsonc
{
  "scope": { /* §2.2A */ },             // server-side türetilir, body'den değil
  "snapshot": { /* overview response — sayılar buradan */ },
  "tone": "executive" | "operational",  // default executive
  "language": "tr" | "en"               // default tr
}
```

**Response:**
```jsonc
{
  "draftMarkdown": "...",                // §2.7.2(d) örnekteki format
  "draftHtml": "...",                    // opsiyonel — direct render için
  "wordCount": 280,
  "evidenceUsed": [
    { "metric": "slaViolationRatePct", "value": "12.4%", "scopeRef": "PARAM/Sanal POS" },
    // …rapor içinde geçen her sayı için audit
  ],
  "metricAuditId": "...",
  "generatedAt": "...",
  "formulaVersion": "v1",
  "warnings": []   // örn. ["minSampleViolations: qaScoreAvg → rapor bu metric'i kullanmadı"]
}
```

**Server-side guard:**
- AI prompt'una **sadece** deterministic snapshot'ı verir; kendi hesap yok
- AI response'da geçen her sayı `evidenceUsed`'ten cross-check edilir (regex `%?\d+`)
- Snapshot'ta olmayan sayı response'ta → reject + log warn + fallback "rapor üretilemedi"
- Minimum sample altındaki metric'ler hakkında **konuşamaz** (snapshot'ta `minSampleViolations` listesi prompt'a gömülür)

#### 2.7.5. Prompt safety rules for people analytics

Agent/Person-level analitikte AI dilini **HR-uygun**, **kanıt-dayalı**, **suçlayıcı olmayan** tutmak zorunludur.

##### Sistem prompt'una **zorunlu** kuralları gömerek (önemli kısımlar):

```
KURAL 1 — Hiçbir kişi hakkında performans hükmü verme. "Demir kötü performans
gösteriyor" gibi cümleler yasak. Yerine "Demir'in atandığı vakalarda ortalama
çözüm süresi takım ortalamasının üzerinde — yük dağılımı veya kategori
karmaşıklığı kontrol edilebilir" gibi yapı kullan.

KURAL 2 — Sayı veya istatistik ile kişiyi etiketlemekten kaçın. "Demir başarısız"
değil "Demir'in vakalarının %30'u SLA ihlali — kategori dağılımına bakılmalı".

KURAL 3 — Asla "düşük performansli", "yetersiz", "kötü agent" gibi etiketler
kullanma. Nötr açıklayıcı dil: "Yük dengesi", "ortalama dışı pattern",
"kategori dağılımı".

KURAL 4 — Davranış değil **iş akışı** sebep göster. "Kişi yavaş çalışıyor"
değil "Atanan vakaların %60'ı kritik öncelik — bu yük dağılımı sürdürülebilir
mi?".

KURAL 5 — Aksiyon dili yumuşak ve sorgulayıcı olsun. Doğrudan emir değil,
"İncelenebilir", "Kontrol etmeye değer", "Yönetici görüşüyle değerlendirilebilir".

KURAL 6 — Kişi-bazlı analizde her zaman alternatif açıklama öner: yük dağılımı,
kategori karmaşıklığı, müşteri zorluğu, takım kapasitesi.

KURAL 7 — "Disiplin", "uyarı", "ceza", "yetersizlik", "verimsiz" kelimelerini
asla kullanma.

KURAL 8 — Yalnız scope içindeki veriden konuş; başka takım, başka şirket
kıyaslaması yapma (CSLeadership/SystemAdmin haricinde, §2.2A).

KURAL 9 — Yetersiz veri durumunda (minSampleViolations) o metric hakkında
**hiç** yorum yapma. "Daha fazla veri toplanmalı" de.

KURAL 10 — Final karar her zaman yöneticide. AI çıktısı "öneri" çerçevesinde
sun: "Düşünebileceğiniz aksiyonlar", "Kontrol edilebilecek noktalar".
```

##### Server-side post-filter (defense in depth):

AI response Turkish-bana **yasak terim** listesi karşı geçer:

```ts
const FORBIDDEN_PEOPLE_LANGUAGE = [
  'başarısız', 'yetersiz', 'kötü performans', 'verimsiz',
  'uyarı verilmeli', 'ceza', 'disiplin', 'düşük performanslı',
  'tembel', 'ihmalkar', 'gevşek', 'agent\'ın hatası',
  // İngilizce de — çift dilli koruma
  'incompetent', 'lazy', 'underperforming', 'should be fired',
  'discipline', 'warning issued', 'fail',
];
```

Insight veya rapor draft response'unda bu kelimelerden biri varsa:
- **Reject** + log warn + fallback nötr versiyona dön
- Kullanıcıya gösterilen: "RUNA tarafından gözden geçirilmiş öneri" (yumuşatılmış)
- AIUsageLog'a `rejectedReason='unsafe_people_language'` flag

##### UI affordances (trust & safety):

1. **"Mevcut filtrelere dayanıyor" disclaimer** her AI kartında zorunlu
2. **"Bu bir öneridir, karar yöneticinindir" footer** kişi-bazlı insight'larda
3. **"Veri yetersiz" badge** sample threshold altında
4. **"AI taslağı" lozengesi** rapor draft'ında üst + alt çift gözükür
5. **Geri bildirim butonu**: "Bu öneri yardımcı mı?" 👍/👎 → AIUsageLog `accepted` flag (mevcut pattern)

#### 2.7.6. Good vs bad AI language — örnekler

| ❌ KÖTÜ — yasak | ✅ İYİ — kabul |
| --- | --- |
| "Demir kötü performans gösteriyor." | "Demir'in atandığı vakalarda ortalama çözüm süresi takım ortalamasının %18 üzerinde — yük dağılımı veya kategori karmaşıklığı kontrol edilebilir." |
| "Bu agent yetersiz, uyarılmalı." | "Bu agent için açık vaka sayısı kuyruk ortalamasının üzerinde. Yöneticisiyle iş yükü değerlendirilebilir." |
| "Destek Takımı başarısız bu hafta." | "Destek Takımı'nda bu hafta çözüm süresi %30 yükseldi. Volume artışı (+%18) ve eskalasyon oranı (+%12) sebep olabilir; takım kapasitesi gözden geçirilebilir." |
| "SLA ihlali muhtemelen Sanal POS'tan." | "Mevcut filtrelerde Sanal POS kategorisinde SLA ihlali 12 vaka (önceki dönem 6). Bu kategorinin son haftalık trendinin incelenmesi öneririm." |
| "Bu müşteri churn edecek kesin." | "Müşteri 'Kemal Mali Müşavirlik' için açık vaka sayısı 3, ikisi SLA risk altında. Customer Pulse 'Riskli' durumda — proaktif iletişim değerlendirilebilir." |
| "Yarın 8 SLA ihlali daha olacak." | "Mevcut trendle (son 7g ortalama günlük 1.7 ihlal), takip edilebilir bir risk söz konusu. Önce kategori dağılımı incelenmeli." |
| "Pınar agent'ı çok yavaş çalışıyor." | "Pınar'a atanmış vakalar arasında 'Kritik' önceliklilerin oranı takım ortalamasının %40 üzerinde. Kategori karmaşıklığı görüşülebilir." |
| "Bu vakalar duplicate, ekibin hatası." | "12 vaka aynı 'Sanal POS bilinmeyen hata' kategorisinde — kök neden tek bir altyapı sorunu olabilir; teknik takımla incelenebilir." |

**Kural:** AI cümleleri **kişi → akış**, **suçlama → soruşturma**, **kesinlik → öneri**, **etiket → veri** dönüştürür. Her AI çıktısı kontrol edilmeli: bu cümle yöneticinin önüne konsa karar **rahat alabilecek** mi?

#### 2.7.7. Implementation karşılığı (özet)

| Deneyim | Endpoint | Cache TTL | UI |
| --- | --- | --- | --- |
| Executive AI Brief | `POST /api/ai/operations-brief` | 5 dk per (user+scope+filter) | Sticky kart üst |
| Explain This Metric | `POST /api/ai/operations-explain-metric` | 10 dk (metric+scope+filter+delta) | Tile info popover → modal |
| Ask RUNA About This View | `POST /api/ai/operations-chat` (mevcut chat'i extend) | Yok (her mesaj canlı) | Floating panel |
| AI Report Draft | `POST /api/ai/operations-report-draft` | Cache yok (her tıklama yeni) | Modal + textarea + Kopyala/İndir |
| Insight cards (brief'in alt parçası) | Brief response'undan ayrı kart'lar | Brief TTL ile aynı | Brief altında kartlar |

Tüm 4 endpoint:
- `verifyJwt` + role-gate (Supervisor+)
- Scope **server-side** türetilir (§2.2A)
- Snapshot **server-side** hesaplanır (§2.6.1)
- `formulaVersion` + `metricAuditId` + `scope` response'ta zorunlu
- Post-filter: scope/caseId cross-check + forbidden language filter
- AI fail → 503 → UI amber state, dashboard etkilenmez

### 2.8. AI Fabric Positioning — RUNA dashboard'un birinci sınıf aktörü

> **Stratejik farklılaşma:** Bu ürünün diferansiyatörü AI Fabric. Dashboard
> AI'ı bir "yan chat widget" olarak gizlemez. RUNA aktif **analitik katman**
> olarak sayfanın **her yerinde** görünür — Command Strip üstte, Insight
> Cards akış içinde, Contextual Actions her major section'da, Drill-down'da
> assistant, dedicated Report Studio.
>
> **Ama:** Deterministik metrikler **kaynak gerçek**, AI **yorumlayıcı**.
> §2.6.1 (AI sayı hesaplamaz) + §2.7.5 (people-safe) kuralları **non-negotiable**.

#### 2.8.1. AI Fabric ilkesi

**AI = embedded operations analyst.** Bir insan analist yöneticiyle aynı odada otursa nasıl davranırdı? — RUNA o davranışı **dijital** ve **ölçeklenebilir** halde yapar:

- **Görünür**: Kullanıcı AI'ın orada olduğunu bilir; UI'da net bir RUNA yüzeyi var
- **Aktif**: Pasif "soruyu bekliyor" değil, **proaktif** insight üretir (Command Strip)
- **Bağlamsal**: Her section'da yerel context'e göre AI action vardır
- **Sorumlu**: Her ifade kanıt chip'i ve drill-down link'i ile gelir
- **Saygılı**: Karar yöneticide; AI öneri çerçevesinde konuşur
- **Entegre**: AI ayrı bir sayfa veya tab değil — workflow'un içine **gömülü**

**Mimari karşılık:** §2.7 endpoint'leri (brief, explain, chat, report-draft) bu fabric'in **omurgası**. §2.8 onların **dashboard'a yerleşimini** + **yeni surface'leri** (Command Strip, AI Report Studio mode, drill-down AI assistant) tanımlar.

#### 2.8.2. RUNA AI Command Strip

Dashboard'un **en görünür** AI yüzeyi. Filter bar'ın hemen altında, KPI tile row'unun üstünde sticky band:

```
┌────────────────────────────────────────────────────────────────────┐
│  🤖 RUNA — Operasyon Briefingi · PARAM · Son 7 gün                  │
│  Üretildi: 12 dk önce · Audit: m-cuid-xyz                  [🔄][▾] │
├────────────────────────────────────────────────────────────────────┤
│  Bu hafta dikkat:                                                   │
│  ① 🔴 Sanal POS SLA ihlali 2× → [12 vaka] [İncele]                  │
│  ② 🟠 Destek Takımı backlog %30 büyüdü → [49 açık] [Yük dengesi]    │
│  ③ 🟡 Kemal Mali Müşavirlik 3 açık vaka → [Müşteri] [Pulse]         │
│                                                                      │
│  Değişen: çözüm süresi +0.4h · açılan vaka -8%                      │
│  Önerilen ilk aksiyon: Sanal POS kategorisi kök neden analizi       │
│                                                                      │
│  [✨ Yönetici özeti hazırla]  [💬 Bu dashboard hakkında sor]        │
└────────────────────────────────────────────────────────────────────┘
```

**Davranış:**
- **Default expanded** — kullanıcı dashboard'a girince ilk gördüğü AI yüzeyi (filter rozetinden sonra)
- **Collapse** (▾) → tek satıra iner: `🤖 RUNA: 3 risk, 2 değişim, 1 öneri [aç]`
- **Refresh** (🔄) → scope/filter değişimsizse cache TTL'den (5dk) içinde önbellek; manuel refresh ignore cache
- Her bullet:
  - Severity ikon (🔴 critical / 🟠 warning / 🟡 info)
  - 1 cümle açıklama (≤ 100 char)
  - Deterministik sayı chip'i (drill-down link)
  - CTA buton (drill-down / ilgili section'a scroll)
- Alt satır CTA: **"Yönetici özeti hazırla"** → AI Report Studio mode (§2.8.6); **"Bu dashboard hakkında sor"** → Ask RUNA chat (§2.7.2c)
- Audit chip (Üretildi + auditId) → kullanıcı kanıt arayabilir
- **Scope rozet** zorunlu — kullanıcı hangi kapsamda konuştuğunu görür

**Endpoint:** `POST /api/ai/operations-brief` (§2.7.2a) — yeni endpoint değil, mevcut brief endpoint'inin UI presentation'ı.

#### 2.8.3. AI Insight Cards — dashboard içine yayılmış

Brief'in altında dashboard'un farklı section'larında **5 tip** insight kartı yer alır:

| Insight Tipi | Tetiklenme koşulu (deterministic) | Yerleştirildiği section |
| --- | --- | --- |
| **SLA Anomaly** | `slaViolationRatePct` delta > +20% PoP | Top KPI row altında |
| **Backlog Buildup** | `openCases` artış > +15% PoP | Time series altında |
| **Repeated Issue** | Aynı (category, subCategory) son 24h'ta >= 5 vaka | Kategori breakdown üstünde |
| **Customer Risk Cluster** | Aynı `accountId` >= 3 açık + Customer Pulse 'Riskli/Kritik' | Top accounts at risk üstünde |
| **Workload Imbalance** | Bir agent/takım yükü ortalamadan std-dev × 1.5 sapmış | Agent performance / Team load üstünde |

**Card shape (§2.7.3 ile aynı, hatırlatma):**

```
┌─────────────────────────────────────────────────────┐
│ 🤖 SLA Anomaly · 🔴 Critical          [👍] [👎] [✕]│
├─────────────────────────────────────────────────────┤
│ Sanal POS SLA ihlali son 7 günde 2× yükseldi.       │
│ Mevcut filtreler: PARAM · Son 7 gün                  │
│                                                       │
│ Kanıt:                                                │
│  [📊 12 ihlal (önceki 6)]                            │
│  [📋 3 örnek vaka: PAR-2025-0001234, …]              │
│                                                       │
│ Önerilen:                                             │
│  Sanal POS kategorisi kök neden analizi.              │
│                                                       │
│ [→ İhlal vakalarına git]   [💬 Daha fazla sor]      │
└─────────────────────────────────────────────────────┘
```

**Kurallar:**
- Tetikleme **deterministic** — AI değil, aggregator hesaplar; AI sadece narrative üretir
- Aynı insight 24h cache'inde tekrar gösterilmez (dismiss veya zaman aşımı)
- Severity renk: critical=rose, warning=amber, info=blue (light + dark)
- Boş durum: section'da insight yoksa **kart hiç render edilmez** (yapay "sapma yok" kartı gürültüdür)
- Tüm card'lar §2.7.3 zorunlu şemasını paylaşır

**Endpoint:** `POST /api/ai/operations-insights` (§2.7 ile aynı; brief endpoint snapshot'tan farklı insight kartları üretir — tek endpoint cards array döner, UI section'lara dağıtır)

#### 2.8.4. Contextual AI Actions — her major section'da

Her büyük section'ın header'ında küçük AI action menüsü:

```
┌───────────────────────────────────────────────────┐
│ Kategori & Ürün Grubu Sıcak Noktası      [🤖 ▾]  │
├───────────────────────────────────────────────────┤
│                       │ Bu trendi açıkla            │
│ Tablo görseli         │ Bu segmenti özetle          │
│                       │ Ne değişti?                  │
│                       │ Yöneticiye rapor hazırla     │
│                       │ Sonraki aksiyonu öner        │
└───────────────────────────────────────────────────┘
```

**5 zorunlu action** (her major section'da görünür):

| Action | Endpoint | Payload | Sonuç |
| --- | --- | --- | --- |
| "Bu trendi açıkla" | `operations-explain-metric` (§2.7.2b) | section snapshot | Inline AI metni veya modal |
| "Bu segmenti özetle" | `operations-explain-segment` (yeni — Phase 4b) | section data + scope | Modal: özet + öneri |
| "Ne değişti?" | `operations-explain-delta` (yeni — Phase 4b) | section data + previous period | Inline delta açıklaması |
| "Yöneticiye rapor hazırla" | `operations-report-draft` (§2.7.2d) | section scope | Modal: TASLAK rapor (segment-bound) |
| "Sonraki aksiyonu öner" | `operations-suggest-action` (yeni — Phase 4b) | section data + scope | Inline: 1-3 öneri (drill-down link'leri) |

**Payload garanti:** Her contextual action **scoped deterministic data** taşır:
```jsonc
{
  "sectionKey": "categoryBreakdown",   // hangi section
  "scope": { /* §2.2A */ },
  "snapshot": { /* o section'ın deterministic verisi */ },
  "selectedRows": [ /* opsiyonel — tabloda seçim varsa */ ],
  "previousPeriodSnapshot": { /* "ne değişti" için */ }
}
```

**UI affordance:** `🤖 ▾` chip'i her section header'ında yer alır; tıklanınca dropdown menu. Section spesifik action'lar (örn. tabloda seçim varsa "Seçilenleri özetle") menüye dinamik eklenir.

**Yetki:** Contextual actions Supervisor+ için açık. Agent rolünde menü gizli (Agent zaten kendi vakalarını görüyor; contextual analyst rolü Supervisor sorumluluğu).

#### 2.8.5. AI Presence in Drill-down

Drill-down drawer açıldığında (§2.1 drilldown endpoint sonucu listelendiğinde), drawer üst kısmında **RUNA assistant card'ı** otomatik gelir:

```
┌────────────────────────────────────────────────────────────┐
│  Drill-down: SLA İhlal Eden Vakalar (162)        [✕] [⤢]   │
├────────────────────────────────────────────────────────────┤
│  🤖 RUNA — Bu listeyi özetliyor                              │
│  Mevcut filtreler: PARAM · Son 7 gün                          │
│                                                               │
│  Bu 162 vakanın 38'i Sanal POS kategorisinde — yığılmanın     │
│  ana kaynağı. 24'ü Kemal Mali Müşavirlik müşterisine ait.    │
│  En yüksek öncelik 6 kritik vakaya bak (en üstte).           │
│                                                               │
│  Önemli satırlar (incele önerisi):                            │
│   • PAR-2025-0001234 — 36h gecikme, kritik                   │
│   • UNI-2025-0001003 — Kemal Mali, 3. tekrarlayan vaka       │
│   • PAR-2025-0001102 — eskalasyona giden                     │
│                                                               │
│  [✉ Takip mesajı hazırla]  [⚠ Eskalasyon özeti hazırla]    │
├────────────────────────────────────────────────────────────┤
│  Vaka tablosu... (50/sayfa)                                  │
└────────────────────────────────────────────────────────────┘
```

**Davranış:**
- Drawer açılır açılmaz **non-blocking** AI çağrısı; AI assistant card "Analiz ediliyor…" ile başlar
- AI **özetler**: sayı (kaç vaka), dominant kategori/müşteri, "incele önerisi" 3-5 satır
- **Asla** verinin kendisini değiştirmez (sıralama / filtreleme deterministic kalır)
- **CTA action'lar**:
  - "✉ Takip mesajı hazırla" → ilgili müşteriye yazılacak draft (Türkçe profesyonel)
  - "⚠ Eskalasyon özeti hazırla" → yöneticiye iletilecek özet (TASLAK etiketli)
- Tablodaki "incele önerisi" satırları **highlighted** olur (subtle ring); kullanıcı önce onlara bakabilir
- AI fail → assistant card amber state "AI özeti alınamadı"; tablo etkilenmez

**Endpoint:** `POST /api/ai/operations-drilldown-assist` (yeni — Phase 4b)
```jsonc
{
  "bucket": { /* drill-down bucket §2.1 */ },
  "scope": { /* §2.2A */ },
  "appliedFilters": { /* §2.6.6 */ },
  "topRows": [ /* drilldown response'unun ilk 50 satırı snapshot olarak */ ]
}
```
Response: insight card + recommended rows (caseIds[] cross-check edilir) + 2 CTA action.

#### 2.8.6. AI Report Studio — dedicated mode

§2.7.2(d) AI Report Draft, dashboard içinden tek tıkla çağrılır. **AI Report Studio** ise **dedicated bir mode** — daha çok kontrol + daha resmi çıktı.

**Erişim:** Dashboard üst sağda **"Rapor Studio"** butonu (veya Command Strip altındaki "Yönetici özeti hazırla" → "Daha fazla seçenek").

```
═══════════════════════════════════════════════════
🤖 RUNA AI Report Studio
═══════════════════════════════════════════════════

KAPSAM SEÇİMİ
  Şirket(ler):        [PARAM]
  Takım:              [Destek Takımı] [Finans Takımı]
  Tarih aralığı:      [Son 7 gün ▾]
  Segment (ops.):     [Sanal POS kategorisi]

İÇERİK
  ☑ Özet (executive)
  ☑ KPI tablosu (deterministic)
  ☑ Öne çıkan bulgular (3-5 madde)
  ☑ Önerilen aksiyonlar (1-3 madde)
  ☐ Tarihsel kıyas (önceki dönem)        ← ek option
  ☐ Agent dağılımı (sadece Admin+)        ← role-gated
  ☐ Customer pulse top 10                  ← ek option

ÇIKTI
  Dil:   ⦿ Türkçe   ○ İngilizce
  Ton:   ⦿ Yönetici (executive)   ○ Operasyonel
  Format:  ⦿ Markdown   ○ HTML   ○ PDF (Phase 5+)

[👁 Önizleme]  [💾 Oluştur ve İndir]
═══════════════════════════════════════════════════
```

**Çıktı sayfası** (Önizleme sonrası):

```
═══════════════════════════════════════════════════
🤖 RUNA AI TARAFINDAN OLUŞTURULAN TASLAK RAPOR

KAPSAM:    PARAM · Destek + Finans Takımı · Sanal POS
DÖNEM:     6 May 2026 — 13 May 2026 (Europe/Istanbul)
ÜRETİLDİ:  13 May 2026 22:42 (Audit: m-cuid-xyz)
FORMÜL:    v1
═══════════════════════════════════════════════════

[... §2.7.2(d) format — ÖZET, ÖNE ÇIKAN, ÖNERİLEN, NOTLAR ...]

═══════════════════════════════════════════════════
AŞAĞIDAKİ HER SAYI BACKEND METRIK SORGUSUNDAN ÜRETİLDİ.
AI YALNIZ ANLATIM HAZIRLADI. KARAR YÖNETİCİNİNDİR.
Audit ID: m-cuid-xyz · formulaVersion: v1
═══════════════════════════════════════════════════

[Kopyala]  [Mail draftı olarak indir (.eml)]  [Markdown indir]  [Düzenle]
```

**Özellikler:**
- **Kapsam locked**: Rapor üretilince scope **dondurulur**; tekrar üretmek için Studio'ya geri dönülür (audit consistency)
- **Numbers locked**: Rapor içindeki her sayı `evidenceUsed` array'ine girer; AI başka sayı uyduramaz (§2.7.4 regex doğrulama)
- **Editable**: Markdown textarea; kullanıcı düzenleyebilir ama "TASLAK" etiketi + audit footer **silinemez** (UI level constraint)
- **Export**: Markdown / HTML / Mail draft (.eml — kopyala-yapıştır için); PDF Phase 5+
- **Audit**: Her oluşturma `MetricQueryAudit` (`endpoint='ai-report-studio'`) + AIUsageLog rows üretir; admin "geçen ay X agent için hangi rapor üretildi" sorgulayabilir
- **Role-gated content**: "Agent dağılımı" checkbox sadece Admin+ rollere görünür; ihlalde 403

**Endpoint:** `POST /api/ai/operations-report-studio` (§2.7.4'ün genişletilmişi)
- Request: scope + content sections (boolean'lar) + language + tone + format
- Response: §2.7.4 ile aynı `draftMarkdown` + ek `sections` array (hangi içerikler dahil edildi)

#### 2.8.7. Visual design — RUNA surface'i

**Marka kimliği:**
- 🤖 ikon (mevcut RunaAiCard'ta zaten kullanılıyor) — tek noktada `<RunaIcon />` component
- Renk paleti: **violet** ailesi (mevcut "RUNA AI" rozetlerinde geçen `violet-50/200/600/900`) — AI yüzeylerinde tutarlı
- Light + dark mode tam destek

**Yüzey tipolojisi:**

| Yüzey | Görsel kimlik | Yerleştirme |
| --- | --- | --- |
| **Command Strip** | Sticky band, violet-tinted border (`border-violet-200 dark:border-violet-900/40`), 🤖 ikon sol | Filter bar altı, KPI üstü |
| **Insight Card** | Severity renk şeridi (sol kenar 3px); 🤖 lozengesi sağ üst; evidence chip'ler footer | Dashboard içine dağılmış |
| **Contextual Menu** | `🤖 ▾` chip — section header'ında ghost button | Her major section başlığı |
| **Drill-down assistant** | Drawer üst — violet-tinted card | Drill-down açıldığında |
| **Report Studio** | Tam ekran mode — violet header, beyaz body | Modal veya dedicated route |

**Tasarım kuralları (gimmick yasak):**
- ❌ Animasyonlu parıltı, neon gradient, "magical AI sparkle" overlay yok
- ❌ "Düşünüyorum…" pulsing dots dışında animasyon yok
- ❌ Sesli efekt yok
- ✅ Sakin, profesyonel, **embedded analyst** estetiği — RUNA "iş arkadaşı", showcase değil
- ✅ Evidence chip'leri tıklanabilir, drill-down hep bir tık uzakta
- ✅ Severity renkleri **anlam taşır** (rose=critical, amber=warning, blue=info), dekoratif değil
- ✅ Her AI yüzeyinde audit chip + scope rozeti zorunlu (kanıt zinciri görünür)

**RunaIcon component spec** (yeni — Phase 4):
```tsx
<RunaIcon size={16} variant="default" | "active" | "thinking" />
// "thinking" sadece pending state'te kullanılır; pulsing dot animasyonu OK
```

**Tutarlılık:** Mevcut `RunaAiCard`, `RunaAiChatPanel` componentleri var; bu doc'un yeni surface'leri **aynı görsel dilden** beslenir. Yeni primitive: `<RunaSurface variant="strip" | "insight" | "menu" | "drawer" | "studio">` — tek noktada styling.

#### 2.8.8. Trust / evidence rules — özet

§2.6.1 + §2.7.5'in dashboard ölçeğine yansıması. RUNA her yüzeyde aşağıdaki garantileri **görünür kılar**:

| Garanti | UI affordance |
| --- | --- |
| Sayı deterministic | Her AI cümlesinin yanında **rakam chip'i** (drill-down link'li) |
| Scope açık | Üst-sağda **"Mevcut filtreler: …"** rozeti her AI yüzeyinde |
| Generated time | **"Üretildi: X dk önce"** stamp; tıklayınca Audit ID kopyalanır |
| AI authorship | **🤖 ikon + "RUNA"** lozengesi her surface'te (rapor draft'ında çift) |
| Karar yöneticide | Kişi-bazlı insight'larda **"Bu bir öneridir, karar yöneticinindir"** footer |
| Veri yetersiz | **"Yetersiz veri (n=3, min=5)"** badge — misleading kesin değer yok |
| Drill-down hazır | Her evidence chip + her recommendation **tıklanabilir** → drill-down drawer |
| Feedback toplama | Her AI kartında **👍/👎** — AIUsageLog `accepted` flag |
| People-safe dil | Server-side post-filter (§2.7.5) + UI'da uyarı yok ama dil her zaman nötr |
| AI yanılırsa düzeltilebilir | Audit ID + scope + filter + formulaVersion ile herkes **replay** edebilir |

**People-safe örnek (Türkçe, design doc'a kalıcı):**

> ❌ **YASAK:** "Bu agent düşük performans gösteriyor."
>
> ✅ **KABUL:** "Bu agent üzerindeki açık vaka yaşı ekip ortalamasının üzerinde; iş yükü dağılımı gözden geçirilmeli."

Bu örnek prompt'a referans olarak gömülür (§2.7.5 K1-K10) + §2.7.6 örnekleri ile birlikte fixture testlerinde kontrol edilir.

### 2.9. Persona-Based Executive Intelligence — Lens system

> Aynı deterministik veri **dört farklı lens'ten** sunulur. CEO/GM ile Product
> Manager aynı KPI tablosunu farklı yorumlar; CS Manager ile Customer Success
> aynı drill-down'a farklı sorular sorar. Sayılar değişmez — **presentation
> + AI narrative** değişir.

#### 2.9.1. Lens architecture

**Tek arka uç, dört vitrin.** Aynı `operationsAggregator` + aynı `MetricQueryAudit` + aynı drill-down endpoint. Lens, **frontend rendering** + **AI prompt seçimi** + **rapor şablonu** demektir. Yeni endpoint **değil**, mevcut endpoint'lere `lens` parametresi:

```jsonc
// POST /api/analytics/cases/overview body'sine eklenir
{
  "lens": "executive" | "product" | "operations" | "customer",
  // … mevcut filter alanları
}
```

Backend `lens` değerine göre **vurgulanan metrik subset'ini** + (Phase 4 sonrası) **lens-specific insight tetiklerini** + **AI prompt versiyonunu** seçer. KPI hesabı **değişmez** (§2.6.1 + §2.6.2 ile birebir).

**UI:** Dashboard üstünde **lens switcher** (Tab veya Segmented Control):
```
[ 🎯 Yönetici ]  [ 📦 Ürün ]  [ ⚙ Operasyon ]  [ 👥 Müşteri ]
```
Default lens kullanıcı rolüne bağlı (§2.9.8 permission tablosu).

URL state: `?lens=executive` (deep-link-able + paylaşılabilir).

#### 2.9.2. Lens matrix

| Lens | Audience | Vurgu | Vurgulanan KPI'lar | AI'nın yanıtladığı sorular |
| --- | --- | --- | --- | --- |
| **🎯 Executive Overview** | CEO / GM / Senior leadership | Operasyonel sağlık, verimlilik, risk, darboğaz, maliyet/zaman etkisi, **alınacak top 3 karar** | totalCases, avgTtrHours, slaViolationRatePct, openCases trend, backlogChangePct, retentionSuccessPct, escalationRatePct, AI delta vurguları | "Bugün operasyon nasıl?" / "Geçen haftaya göre değişen ne?" / "Yöneticinin alması gereken 3 karar?" / "Genel sağlık iyi mi?" |
| **📦 Product Intelligence** | Product Manager / PO | Operasyonel yük yaratan ürün alanları, tekrar eden konu kümeleri, duplicate/linked clusters, redesign/bug ihtiyacı, roadmap aday'ları | byCategory + byProductGroup breakdown, repeated issue clusters, duplicate link count, escalation per product, customer impact per product, topAtRiskAccounts × product | "Hangi ürün alanı en çok operasyonel sürtünme yaratıyor?" / "Hangi sorunlar roadmap'e gidecek kadar tekrar ediyor?" / "Bu defect mi, entegrasyon mu, eğitim mi, süreç mi?" / "Roadmap'e neyi taşımalıyız?" |
| **⚙ CS / Operations Efficiency** | CS Manager / Support Ops Lead | Takım yükü, agent dağılımı, SLA risk, queue aging, transfer/escalation darboğazı, first response + resolution efficiency, collaboration | byTeam load, agentWorkload, slaRiskCount, queue aging (eski açık vakalar), transferRatePct, escalationRatePct, firstResponseTimeMin, watcher/mention/reply aktivitesi | "Darboğaz nerede?" / "Hangi takımın yardıma ihtiyacı var?" / "Hangi kuyruklar yaşlanıyor?" / "Süreç verimliliği nerede iyileştirilebilir?" / "Risk taşıyan yük dağılımı var mı?" |
| **👥 Customer / Account Risk** | Customer Success / Account Manager | Tekrar vakası olan müşteriler, customer risk clusters, eskalasyona giden müşteriler, SLA breach yaşayan müşteriler, churn/retention sinyalleri, proaktif outreach adayları | topAtRiskAccounts (Customer Pulse state ile), repeatedIssues per account, escalated accounts, SLA breached accounts, churn caseType count, retentionStatus per account | "Hangi müşterilere proaktif yaklaşmalıyım?" / "Hangi hesap riskleniyor?" / "Müşteriyi aramadan önce ne bilmeliyim?" |

#### 2.9.3. Metrics per lens (vurgu paterni)

Aynı `overview` response gelir; **lens** UI'da hangi tile/section'ı **öne çıkaracağını** seçer ve diğerlerini ikincil yapar.

**🎯 Executive** — Sade, üst-düzey:
- Hero KPI: `totalCases`, `openCases`, `avgTtrHours`, `slaViolationRatePct` — geniş tile'lar, period delta vurgulu
- Trend: 30 gün time series (executive view'da haftalık aggregation default; "Detaylı" tıklayınca günlük)
- AI Brief: kullanıcı sayfa açar açmaz **lens-specific** brief
- "Top 3 karar" insight section'ı (Phase 4b'den `operations-suggest-action` lens-aware)
- Çözünürlük: az kart, büyük tile, kısa bullet — okumadan anlaşılır
- Drill-down: özet seviye; daha derine inmek için lens değişimi öneriliyor

**📦 Product** — Ürün/kategori derinliği:
- Hero: `byCategory` × `byProductGroup` sıcak nokta tablosu
- "Repeated Issue Cluster" insight'ı vurgulu (§2.8.3)
- "Linked/Duplicate cluster" görünürlüğü artar (aynı müşteride veya farklı müşterilerde aynı kategori tekrarı)
- Customer Impact panel: müşteri sayısı × kategori (Univera × Stokbar, PARAM × Sanal POS)
- Drill-down filter: kategori bazlı önceden seçili
- AI insight: "Bu duplicate cluster bir backend bug işareti mi?", "Bu kategori CSAT'i düşürüyor mu?"
- Hidden: Agent-level metrics (PM'in işi değil)

**⚙ Operations Efficiency** — Takım & kuyruk derinliği:
- Hero: Team load chart + Agent workload distribution + Queue aging (eski açık vakalar)
- SLA Risk vurgulu — yaklaşan ihlal sayısı + kategori dağılımı
- Transfer/Escalation rate metric'leri ön planda
- Collaboration metric'leri görünür (watcher + mention + reply aktivitesi)
- Drill-down: takım + agent bazlı kolay
- People-safe dil §2.7.5 **özellikle** kritik bu lens'te — agent-bazlı görünürlük yüksek
- AI insight: "Hangi takım yorgun?", "Queue aging hangi kategoride?", "Transfer fazlalığı varsa neden?"

**👥 Customer / Account Risk** — Müşteri derinliği:
- Hero: Top 10-20 at-risk accounts (Customer Pulse state + açık + SLA + tekrar eden)
- Account drill-down: tıklayınca account-pulse panel açılır
- Churn signals: caseType=Churn + retentionStatus dağılımı
- Repeated issue per account
- Drill-down: account bazlı; her satır "Müşteri kartı" + customer pulse'a derin link
- AI insight: "Şu müşteri için proaktif outreach yapmalıyım, gerekçesi:…"
- Hidden: Team-level KPI'lar (CS / AM'in işi değil)

#### 2.9.4. AI questions per lens — soru kataloğu

Her lens'te **"Ask RUNA About This View"** chat panel'inde **önerilen sorular** lens-aware listelenir. Server-side prompt versiyonu lens'e göre seçilir.

**🎯 Executive — önerilen sorular:**
- "Bu hafta operasyonel sağlık nasıl?"
- "Önceki haftaya göre değişen 3 madde nedir?"
- "Yönetici olarak alacağım ilk karar ne olmalı?"
- "Bottom-line: ekibim bu hafta iyi mi kötü mü?"
- "CFO'ya 1 paragraflık özet hazırla"

**📦 Product — önerilen sorular:**
- "Hangi ürün alanı en çok destek yükü yaratıyor?"
- "Bu hafta tekrar eden konu kümeleri neler?"
- "Şu kategori için bug mı yoksa UX/eğitim sorunu mu?"
- "Hangi sorunları roadmap'e taşımalıyım?"
- "Bu müşterilerin etkilendiği ürün modüllerini özetle"
- "Product council için 5-bullet rapor hazırla"

**⚙ Operations — önerilen sorular:**
- "Darboğaz hangi takımda?"
- "Hangi kuyruk yaşlanıyor, neden?"
- "Transfer oranı arttı mı, hangi kategoride?"
- "Bu agent için iş yükü dağılımı sürdürülebilir mi?"
- "Hangi takım kapasite gerektiriyor?"
- "CS toplantısı için operasyon raporu hazırla"

**👥 Customer — önerilen sorular:**
- "Hangi müşterilere bu hafta proaktif aranmalı?"
- "Şu müşteriyi aramadan önce bilmem gerekenler?"
- "En çok churn riski taşıyan 5 müşteri kim?"
- "Bu müşteri için account review notu hazırla"
- "Hangi hesaplar repeat issue gösteriyor?"

**Tüm lens'lerde ortak:**
- "Bu bulgu için drill-down ver"
- "Sayıyı kim hesapladı? Formül göster" → §2.6.5 metric details popover'a yönlendirir
- "Bu rapor için onay e-postası hazırla" → Report Studio (§2.8.6)

#### 2.9.5. Report templates per lens

Her lens için **AI Report Studio** (§2.8.6) farklı şablon kullanır. Backend'de `report-studio` endpoint'i `lens` parametresi alır → ilgili prompt + section preset seçer. Sayılar **yine deterministic** (§2.6.1) — şablon sadece narrative + bölüm sıralaması belirler.

##### Şablon A — Executive Summary (`lens=executive`)

```
═══════════════════════════════════════════════════
🤖 RUNA — EXECUTIVE SUMMARY (TASLAK)
═══════════════════════════════════════════════════
KAPSAM:    PARAM · Tüm takımlar
DÖNEM:     6 May 2026 — 13 May 2026 (Europe/Istanbul)
ÜRETİLDİ:  13 May 2026 22:42 · Audit: m-cuid-xyz · v1
═══════════════════════════════════════════════════

OPERASYONEL SAĞLIK
  Bu hafta toplam 4,823 vaka açıldı (önceki +6%);
  ortalama çözüm 5.4 saat (önceki 5.1); SLA ihlal
  oranı %8.7 (önceki %7.5).

ÖNE ÇIKAN 3 KARAR
  1. Sanal POS SLA ihlali 2× — kök neden incelemesi
     için Destek Takımı'na öncelik verilebilir.
  2. Backlog %30 büyüdü — Destek Takımı kapasite
     değerlendirmesi.
  3. 1 stratejik hesap (Kemal Mali Müşavirlik)
     risk altında — CS Lead'in dikkati önerilir.

RISKLERIN ÖZETI
  - SLA: Sanal POS kategorisinde yığılma
  - Operasyonel: Backlog Destek Takımı'nda
  - Müşteri: 3 hesap "Riskli" durumda

[Audit footer — §2.6.8]
```

Ton: **kısa, üst-düzey, kararı çağıran**. 3-4 paragraf maks. Detay yok — drill-down link verir.

##### Şablon B — Product Insight Report (`lens=product`)

```
═══════════════════════════════════════════════════
🤖 RUNA — PRODUCT INSIGHT REPORT (TASLAK)
═══════════════════════════════════════════════════
KAPSAM:    PARAM, UNIVERA, FINROTA (cross-tenant)
DÖNEM:     1 May — 13 May 2026
═══════════════════════════════════════════════════

OPERASYONEL YÜK YARATAN ÜRÜN ALANLARI
  1. Sanal POS — 412 vaka (toplam %22)
     Ana alt-kategori: 3D Secure entegrasyonu (180)
  2. Stokbar — 308 vaka (toplam %16)
     Ana alt-kategori: Mobil senkronizasyon (122)
  3. Netahsilat — 198 vaka (toplam %10)
     Ana alt-kategori: Banka dosyası uyumsuzluğu (94)

TEKRAR EDEN KONU KÜMELERİ
  - Sanal POS · 3D Secure: 38 vaka 12 farklı müşteri
    (ortak hata kodu işaretler bug olabilir)
  - Stokbar · Mobil sync: 22 vaka 5 müşteri
    (entegrasyon değil, kullanıcı eğitimi olabilir)

DUPLICATE / LINKED CLUSTER
  - DEMO-PAR-DUP-A ↔ DUP-B + 9 benzer vaka:
    aynı müşteri ikinci vakası — ürün backend
    incelemesi öneririz.

ROADMAP ADAYI
  - "Sanal POS 3D Secure timeout"  — high impact /
    kök neden hala net değil
  - "Stokbar mobile push interval" — low effort /
    yüksek frequency

[Audit footer]
```

Ton: **ürün-bazlı küme analizi, redesign/bug ayrımı**.

##### Şablon C — CS Operations Report (`lens=operations`)

```
═══════════════════════════════════════════════════
🤖 RUNA — CS OPERATIONS REPORT (TASLAK)
═══════════════════════════════════════════════════
KAPSAM:    PARAM · Tüm takımlar
DÖNEM:     6 May — 13 May 2026
═══════════════════════════════════════════════════

TAKIM YÜKÜ
  - Destek Takımı: 49 açık (önceki 38; +30%)
  - Finans Takımı: 18 açık (stabil)
  - Customer Success: 12 açık (stabil)

DARBOĞAZ TESPİTİ
  Destek Takımı'nda Sanal POS kategorisi 38 vaka
  taşıyor; ortalama çözüm 7.2h takım ortalaması 5.4h
  üzerinde — kategori-spesifik kapasite/uzmanlık
  durumu değerlendirilebilir.

KUYRUK YAŞLANMASI
  4 vaka > 72 saat açık (Destek Takımı)
  2 vaka 3rdPartyBekleniyor 5+ gün (E-DBS)

TRANSFER & ESCALATION
  Transfer oranı %6.2 (önceki %4.8) — Sanal POS
  vakalarının %12'si bir kez transfer edildi.
  Direktör eskalasyon: 3 vaka.

İŞ YÜKÜ NOTLARI (people-safe)
  Bazı agent'larda atanmış kritik vaka oranı takım
  ortalamasının üzerinde — yük dağılımı
  yöneticisiyle değerlendirilebilir.

[Audit footer]
```

Ton: **darboğaz tespiti, süreç önerisi, agent yargısı yok**.

##### Şablon D — Customer Risk Report (`lens=customer`)

```
═══════════════════════════════════════════════════
🤖 RUNA — CUSTOMER RISK REPORT (TASLAK)
═══════════════════════════════════════════════════
KAPSAM:    PARAM · Tüm hesaplar
DÖNEM:     1 May — 13 May 2026
═══════════════════════════════════════════════════

PROAKTİF YAKLAŞIM ÖNERILEN HESAPLAR
  1. Kemal Mali Müşavirlik (FINROTA)
     - 3 açık vaka, 1 SLA ihlali, Pulse: Riskli
     - Tekrar eden: Netekstre · Banka uyumu (3 vaka)
     - Önerilen aksiyon: Account Manager teması;
       teknik kök neden ürün takımıyla paylaşıldı mı?

  2. Mavi Soğuk Zincir (UNIVERA)
     - 2 açık vaka, 1 eskalasyon, Pulse: Riskli
     - Önerilen: Operasyon yöneticisi review.

  3. GnG Online Mağaza (PARAM)
     - Duplicate vaka kümesi (DEMO-PAR-DUP-A/B)
     - Önerilen: Çözüm sonrası izleme.

CHURN SİNYALİ TAŞIYAN
  - 4 hesap son 30 günde caseType=Churn (PARAM 2,
    UNIVERA 1, FINROTA 1)

[Audit footer]
```

Ton: **müşteri-bazlı önerme, account manager için aksiyon dili**.

#### 2.9.6. Same data, different interpretation — Product vs CS

Aynı snapshot'tan iki farklı bakış:

**Senaryo:** Son 7 günde Sanal POS kategorisinde 38 SLA ihlali (önceki dönem 6). Destek Takımı bu kategoride 12 ihlal taşıyor. 8 farklı müşteri etkilenmiş. Agent Demir'e atanmış 3 ihlal var.

**📦 Product lens AI yorumu:**
> "Sanal POS kategorisinde son 7 günde SLA ihlali altı katına çıktı.
> 38 ihlal vakasının %71'i (27) aynı alt-kategoride: '3D Secure timeout'.
> 8 farklı müşteri etkilendi → muhtemelen **müşteriye özel değil,
> ürün-katmanı sorun**. Roadmap için aday: 3D Secure timeout retry
> mekanizması incelemesi. [→ 38 vakayı incele] [→ 3 örnek vaka]"

**⚙ Operations lens AI yorumu:**
> "Sanal POS kategorisi SLA ihlal oranı %12.4 (önceki %5.8). Destek
> Takımı ihlallerin %32'sini taşıyor (12/38) — ortalama 5.4h çözüm
> süresine karşı kategori için 7.2h. **Takımın bu kategoride
> uzmanlık veya kapasite ihtiyacı olabilir**; eğitim/transfer
> politikası değerlendirilebilir. [→ Destek Takımı ihlal vakaları]
> [→ Yük dağılımı]"

**👥 Customer lens AI yorumu:**
> "Sanal POS SLA ihlali olan 8 farklı müşteri var. Bunlardan
> 3'ü ('Kemal Mali Müşavirlik', 'Mavi Soğuk Zincir', 'GnG Online')
> Customer Pulse 'Riskli' durumda — **proaktif iletişim önerilir**.
> Mesajda 'sorunu fark ettik, üzerinde çalışıyoruz' diline yer
> verilebilir. [→ 8 müşterinin listesi] [→ Account drill-down]"

**🎯 Executive lens AI yorumu:**
> "Bu hafta SLA ihlali oranı %8.7 (önceki %7.5). Ana sebep: Sanal POS
> kategorisinde yığılma (kategori bazında 6× artış). Karar gerektiren
> alanlar: ürün kök neden (PM koordinasyonu), kapasite (Destek
> Takımı), 3 risk müşterisinde proaktif yaklaşım. [→ Detaylı analiz
> her lens'te]"

**Garanti:** 4 yorumda da **38 vaka**, **%12.4 oran**, **6× artış**, **8 müşteri** rakamları **birebir aynı** — backend snapshot'tan gelir, AI değiştiremez (§2.7.4 number regex doğrulama). Yorum **farklı**, sayı **aynı**.

#### 2.9.7. Implementation karşılığı

**Backend:**
- `POST /api/analytics/cases/overview` body'sine `lens` field eklenir; aggregator'da değişiklik **yok** (aynı KPI seti dönüyor)
- `POST /api/ai/operations-brief` `lens` parametre alır → prompt versiyonu seçer
- `POST /api/ai/operations-insights` `lens` parametre alır → insight tipleri sıralanır + tetik eşikleri lens'e göre tweak edilir (örn. customer lens'te repeated issue threshold daha düşük)
- `POST /api/ai/operations-report-studio` `lens` parametre alır → şablon A/B/C/D seçer
- `POST /api/ai/operations-explain-*` endpoint'leri `lens` alır → narrative tone değişir
- Cache key'i `lens` içerir (aynı snapshot, farklı lens'te farklı AI çıktısı)

**Frontend:**
- `<LensSwitcher>` componenti dashboard üstünde (Tab veya Segmented Control)
- URL state `?lens=…` deep-link
- Lens değişikliği:
  - Dashboard re-render (yeni layout — bazı section'lar gizlenir/öne çıkar)
  - Brief + insights yeniden fetch (lens parametresi ile)
  - User preference local storage (son seçilen lens kullanıcının default'u olur, role-default ile override edilebilir)

**Prompt yönetimi:**
- 4 lens × 5 endpoint = ~20 lens-aware prompt
- Her prompt `promptVersion` ile versionlanır (§2.6.6); değişiklik bump zorunlu
- Lens prompt'ları **kodda** tutulur (`server/lib/aiPrompts/lens-*.js`) — review + audit edilebilir; admin tarafından değiştirilemez

#### 2.9.8. Lens permission model

Tüm lens'ler aynı `verifyJwt` + base rol gate'inden geçer (Supervisor+) ama **default lens** + **görünürlük** rolden türetilir:

| Rol | Default lens | Görünür lens'ler |
| --- | --- | --- |
| Agent | (dashboard yok) | — |
| Supervisor / Team Lead | ⚙ Operations | Operations, Customer (read) |
| Operations Manager (Admin) | ⚙ Operations | Hepsi |
| Product Manager | 📦 Product | Product, Executive (read) |
| Customer Success Lead | 👥 Customer | Customer, Operations (read) |
| Company Admin / GM | 🎯 Executive | Hepsi |
| CS Leadership / SystemAdmin | 🎯 Executive | Hepsi (cross-tenant) |

**Notlar:**
- "Product Manager" + "Customer Success Lead" şu an `User.role` enum'unda yok — Phase 4 öncesi karar gerekir (§2.2A'daki CSLeadership örneğine benzer)
- Kullanıcı erişim hakkı olmayan lens'i URL ile dener → silent narrow + default lens'e fallback + scope metadata "lens-narrowed"
- Lens permission'ı role + opsiyonel `User.lensPreferences` (yeni field) ile yönetilir

#### 2.9.9. Lens-aware UI farkı — özet

| Lens | Header rengi | Lead KPI'lar | Insight tetik tipleri | Drill-down default | Hidden sections |
| --- | --- | --- | --- | --- | --- |
| 🎯 Executive | Brand blue | totalCases, avgTtrHours, slaViolationRatePct, backlogChangePct | SLA Anomaly, Backlog Buildup | "Top 3 decision" | Agent-level, granular per-team |
| 📦 Product | Violet | byCategory, byProductGroup, repeatedIssues | Repeated Issue, Duplicate Cluster | category | Agent-level, individual workload |
| ⚙ Operations | Amber | byTeam, agentWorkload, slaRiskCount, transferRatePct | Workload Imbalance, Backlog Buildup, SLA Anomaly | team / agent | byCompany (cross-tenant) |
| 👥 Customer | Teal | topAtRiskAccounts, churn signals, repeated per account | Customer Risk Cluster | account | Agent-level, team distribution |

Aynı `<RunaSurface>` primitive'i (§2.8.7), aynı `<RunaInsightCard>`, aynı drill-down drawer — yalnız **lens parametresi** ile içerik şekillenir.

### 2.10. Exportable Executive Reports — Report Studio (genişletilmiş)

> §2.8.6 Report Studio'yu **kapsamlı format yelpazesi, audit, template kataloğu**
> ile genişletir. Stakeholder'ların hepsi sistem kullanıcısı olmayacak —
> dashboard'tan **paylaşılabilir / yazdırılabilir / mail-yapıştırılabilir**
> rapor üretmek bu ürünün **iletişim katmanı**.

#### 2.10.1. Report Studio UX — kapsamlı versiyon

§2.8.6'daki temel UX'in **5 boyutlu** versiyonu:

```
═══════════════════════════════════════════════════════
🤖 RUNA AI Report Studio
═══════════════════════════════════════════════════════

ADIM 1 — RAPOR TÜRÜ (lens / template)
  ⦿ 🎯 Executive Weekly Operations Brief
  ○ 📦 Product Friction Report
  ○ ⚙ CS Efficiency & Bottleneck Report
  ○ 👥 Customer Risk Report
  ○ 🔔 SLA / Escalation Report

ADIM 2 — KAPSAM
  Şirket(ler):       [PARAM ▾] (allowedFilters'tan, §2.2A)
  Tarih aralığı:     [Son 7 gün ▾] (preset + custom)
  Takım:             [Tümü ▾]
  Ürün grubu:        [Tümü ▾]
  Müşteri:           [Tümü ▾]  ← yalnız Customer report'ta görünür
  Agent:             [—]      ← yalnız Operations/Executive ve Admin+ rolde

ADIM 3 — İÇERİK (lens'e göre default checked)
  ☑ Özet (executive narrative)
  ☑ KPI tablosu (deterministic)
  ☑ Trend grafiği (time series)
  ☑ Top breakdown (kategori/takım/müşteri — lens'e göre)
  ☑ Öne çıkan bulgular (3-5 madde)
  ☑ Önerilen aksiyonlar
  ☐ Tarihsel kıyas (önceki dönem PoP)
  ☐ Agent dağılımı                  ← role-gated (Admin+)
  ☐ Customer pulse top 10           ← Customer report'ta default checked
  ☐ Metrik appendix (formul + tanım)

ADIM 4 — AI NARRATIVE
  ⦿ AI ile (default — TASLAK etiketli)
  ○ Yalnız deterministik (AI yorumu yok, sadece KPI + chart)

ADIM 5 — ÇIKTI
  Dil:     ⦿ Türkçe   ○ İngilizce
  Format:  ⦿ PDF      ○ PPTX     ○ XLSX     ○ Mail draft (.eml)     ○ Markdown
  Ton:     ⦿ Executive   ○ Operational   ○ Technical

[👁 Önizleme]  [💾 Oluştur ve İndir]  [✉ Mail'e gönder (kopyala)]
═══════════════════════════════════════════════════════
```

**Davranış:**
- Lens (Adım 1) seçimi ADIM 3 içeriklerinin default'larını + AI prompt versiyonunu seçer
- **Section visibility** § 2.9.9 ile uyumlu — Product report'ta agent-level checkbox **gizli**
- **AI narrative toggle** önemli: kullanıcı AI'sız (pure deterministic) rapor da üretebilir → sayıları doğrulamak isteyen audit'çiler için
- **Önizleme**: Browser'da markdown render (PDF'i indirmeden önce); kullanıcı düzenleyebilir
- **Mail draft (.eml)**: Subject + body + audit footer ile dosya; mail client'a açar
- **Scope locked**: Rapor üretilince scope dondurulur (§2.8.6); değişiklik için Studio'ya dön

#### 2.10.2. Export formats — phased rollout

| Format | Use case | Phase | Tooling | Boyut/sayfa cap |
| --- | --- | --- | --- | --- |
| **Markdown** | Geliştirici/teknik paylaşım, version control | Phase 4b (mevcut Studio'da) | Server-side string composition | — |
| **Mail draft (.eml)** | Yöneticiye 1-2 paragraflık özet mail | Phase 4b | mime/eml composition | < 50KB |
| **HTML** | Tarayıcı önizleme, intranet/wiki yapıştırma | Phase 4b | Markdown → sanitize HTML | < 200KB |
| **PDF** | Resmi rapor, arşiv, mail eki | **Phase 5a** | Puppeteer (server-side Chrome) veya pdfkit | < 5MB, ≤ 30 sayfa |
| **XLSX (Excel)** | Veri ekibi, drill-down satırları | **Phase 5b** | exceljs / xlsx kütüphanesi | < 10MB, ≤ 50K satır |
| **CSV** | Hızlı veri export, Power BI / Tableau ingest | **Phase 5b** | csv-stringify | < 10MB |
| **PPTX (slide deck)** | Executive review meeting | **Phase 6** (sonra) | pptxgenjs | < 8MB, ≤ 20 slayt |

**Tasarım kuralı:** Tüm format'lar **aynı `reportComposer` helper'ından** akar (single source). Format-specific renderer farklı, **içerik ve sayılar aynı**. UI ↔ export ↔ farklı format'lar — hepsi tutarlı (§2.6.8).

**Phase planlama:**
- **Phase 4b** (Report Studio core): Markdown + Mail draft + HTML — minimum viable
- **Phase 5a** (PDF): Puppeteer setup; Vercel serverless'ta render karmaşık → opsiyonel ayrı microservice; başlangıçta synchronous, sonra async job
- **Phase 5b** (XLSX/CSV): büyük veri export — async job tablo (`ExportJob` audit'le birleşik)
- **Phase 6** (PPTX): templated slide; design ekip iş birliği gerekir

#### 2.10.3. Report content — zorunlu bölümler

Her exported rapor (format bağımsız) şu bölümleri içerir:

```
┌─────────────────────────────────────────────────────┐
│  BAŞLIK SAYFASI                                     │
│  ─────────────────────────────────────────────       │
│  🤖 RUNA — Executive Weekly Operations Brief         │
│  PARAM · 6 May 2026 — 13 May 2026                   │
│  Generated: 13 May 2026 22:42 Europe/Istanbul       │
│  Generated by: Demir Han (Operations Manager)        │
│  Report ID: rpt-cuid-xyz                             │
│                                                       │
│  KAPSAM ROZETİ:                                       │
│  Scope: PARAM · Son 7 gün · Destek + Finans Takımı   │
│                                                       │
│  ─── TASLAK — RUNA AI tarafından oluşturuldu ───    │
│  AI narrative: ☑ Dahil  ·  Formul versiyonu: v1     │
└─────────────────────────────────────────────────────┘

[Bölüm 1] YÖNETİCİ ÖZETİ (AI narrative — opsiyonel)
  3-4 paragraf executive özet (§2.9.5 şablon)

[Bölüm 2] ANAHTAR METRİKLER (deterministic)
  KPI tablo: totalCases, openCases, avgTtrHours,
  slaViolationRatePct, reopenRatePct, backlogChangePct
  Her satırda: Değer · Önceki dönem · Delta · Formula version

[Bölüm 3] TREND GRAFİĞİ (deterministic chart)
  30 gün time series — created vs resolved vs SLA breached
  Chart altında veri tablosu (mail-friendly fallback)

[Bölüm 4] BREAKDOWN'LAR (lens'e göre)
  Executive: byStatus, byPriority
  Product: byCategory + byProductGroup sıcak nokta
  Operations: byTeam + agentWorkload (Admin+ ise)
  Customer: topAtRiskAccounts

[Bölüm 5] ÖNE ÇIKAN BULGULAR (AI narrative — opsiyonel)
  3-5 bullet; her bullet'ta deterministic sayı + evidence ref

[Bölüm 6] ÖNERİLEN AKSİYONLAR (AI narrative — opsiyonel)
  Lens'e göre 1-3 öneri; her öneri "açıklama + drill-down ref"

[Bölüm 7] DRILL-DOWN EVIDENCE REFERANSLARI
  - Bulgu §5.1 → 38 vaka [link veya caseNumber listesi]
  - Bulgu §5.2 → 12 müşteri [...]
  PDF'te: tıklanabilir link (dashboard URL'i); XLSX'te: caseNumber sütunu

[Bölüm 8] METRİK APPENDIX (opsiyonel — Studio'da checked ise)
  §2.6.2 metric dictionary'den ilgili tanımlar:
  - slaViolationRatePct: 100 × (SLA ihlal eden çözülmüş) / (toplam çözülmüş)
  - avgTtrHours: AVG(resolvedAt - createdAt) - pause süresi
  - …
  Audit ID + formulaVersion ile birlikte

[Bölüm 9] DİSCLAIMER + AUDIT FOOTER
  ┌─────────────────────────────────────────────┐
  │ Bu rapor RUNA AI tarafından TASLAK olarak    │
  │ hazırlandı. Tüm sayısal değerler              │
  │ deterministik backend sorgularından gelir.    │
  │ AI narrative yardımcıdır; metrikler yetkilidir.│
  │ Final karar yönetici sorumluluğundadır.        │
  │                                                │
  │ Report ID: rpt-cuid-xyz                        │
  │ Audit ID:  m-cuid-xyz                          │
  │ Formula:   v1                                  │
  │ Generated: 13 May 2026 22:42 Istanbul           │
  └─────────────────────────────────────────────┘
```

**AI narrative kapalıysa**: Bölüm 1, 5, 6 atlanır; rapor tamamen deterministic KPI + chart + table'lardan oluşur. Disclaimer "AI narrative dahil değil" şeklinde değişir.

#### 2.10.4. Security / access — scope enforcement

Export tüm güvenlik kontrollerini §2.2A + §2.6 ile **aynı** uygular:

| Kural | Uygulanış |
| --- | --- |
| **Aynı backend scope rules** | `deriveAnalyticsScope` (§2.2A) export endpoint'inin **ilk satırında** çalışır; rapor ancak scope'taki veriye erişebilir |
| **Cross-tenant gate** | CSLeadership/SystemAdmin haricinde cross-company rapor üretilemez |
| **`scope.canExport=true` zorunlu** | Agent/Backoffice/CSM rolünde export endpoint 403; sadece Supervisor+ |
| **Görünür scope label** | Rapor başlık sayfasında **scope rozet** zorunlu (örn. `Scope: PARAM · Last 30 days · Support Team` veya `Scope: CS Leadership · All companies · Last 7 days`) |
| **Section role-gating** | Studio'da seçilebilir checkbox'lar role'e göre filtrelenir (Agent dağılımı Admin+ için, Customer pulse top 10 Customer report'ta default) |
| **Sayı tutarlılığı** | Export sayıları UI ile **bit-bit aynı** — `operationsAggregator` tek kaynak (§2.6.8); ayrı SQL yasak |
| **`MetricQueryAudit` row** | Her export → audit row (`endpoint='ai-report-export'`); 1 raporun tüm metrikleri replay edilebilir |

**Export retention**: Dosya kullanıcının cihazına iner — server'da **persist edilmez** (storage maliyeti + GDPR-soft). Yalnız **metadata** (`ReportGenerationLog` — §2.10.5) saklanır.

**İstisna:** Async job (PDF/XLSX büyük) için server-side temp storage (24h TTL); job complete olduğunda kullanıcı download link'i alır. TTL sonrası dosya otomatik silinir.

#### 2.10.5. Auditability — `ReportGenerationLog`

Her rapor üretimi DB'ye kaydedilir (export edilmese bile önizleme için):

```prisma
model ReportGenerationLog {
  id                String   @id @default(cuid())
  generatedBy       String   // User.id
  generatedByName   String   // User.fullName snapshot
  generatedAt       DateTime @default(now())

  reportType        String   // 'executive-brief' | 'product-friction' | 'cs-efficiency' | 'customer-risk' | 'sla-escalation'
  lens              String   // 'executive' | 'product' | 'operations' | 'customer'
  format            String   // 'markdown' | 'html' | 'eml' | 'pdf' | 'xlsx' | 'csv' | 'pptx'

  scopeFingerprint  String   // §2.2A hash
  scopeNarrative    String   // human-readable (örn. "PARAM · Son 7 gün · Destek Takımı")
  appliedFilters    Json     // tam filter set (from/to/companies/teams/...)

  includedSections  Json     // ["summary","kpi","trend",...] checkboxlar
  aiNarrativeIncluded Boolean
  formulaVersion    String
  metricAuditId     String   // bağlantılı MetricQueryAudit

  fileSizeBytes     Int?     // export edildiyse
  durationMs        Int      // üretim süresi
  status            String   // 'generated' | 'previewed' | 'downloaded' | 'failed'

  @@index([generatedBy, generatedAt])
  @@index([reportType, generatedAt])
  @@index([lens])
}
```

**Audit kullanım senaryoları:**

1. **"Geçen ay X agent için kaç rapor üretildi?"** — `WHERE generatedBy IN (...) AND generatedAt >= ...`
2. **"Bu raporu kim ne zaman üretti?"** — Report ID → ReportGenerationLog tek satır
3. **"Aynı dönem için kaç farklı rapor versiyonu üretildi?"** — `WHERE scopeFingerprint = X GROUP BY generatedAt`
4. **"AI narrative dahil edilen raporların oranı?"** — adoption metric
5. **HR şikâyeti**: çalışan "Bu rapor benim aleyhime kullanıldı" derse → ReportGenerationLog + MetricQueryAudit ile **kim ne zaman hangi scope'la** üretti tam izlenir

**Retention**: Min 1 yıl (HR/audit gereksinim); ileride cleanup cron eklenebilir (§Phase 5+).

**Görünürlük**: Kullanıcı kendi rapor geçmişini görebilir (Studio'da "Geçmiş raporlarım" tab). Admin tüm rapor geçmişini görebilir (yeni admin sayfası — opsiyonel, Phase 5+).

#### 2.10.6. AI narrative rules — özet (§2.7 + §2.8'in tekrarı)

Rapor export'una **özel** ek kurallar:

1. **AI narrative on/off togglu** — kullanıcı AI'sız pure deterministic rapor üretebilir
2. **TASLAK etiketi** — AI narrative içeren raporda **başlık + footer** çift gözükür; kullanıcı kasten silmedikçe (manuel düzenleme) kalır
3. **Number injection** — AI narrative'deki her sayı `evidenceUsed` array'ine kayıtlı; rapor üretilirken regex tarayıcı (§2.7.4) snapshot'a karşı doğrular; eşleşmezse build fail → kullanıcıya "rapor üretilemedi, AI fail" döner
4. **Disclaimer zorunlu** — §2.10.3 Bölüm 9; AI narrative dahilse "AI yardımcı, metrikler yetkili"; AI narrative hariçse "deterministik sayılar; AI narrative dahil değil"
5. **People-safe filter** — §2.7.5 forbidden language post-filter; ihlalde rapor build fail (export edilmez) + AIUsageLog `rejectedReason='unsafe_people_language'`
6. **Lens-aware prompt** — §2.9 prompt versiyonu; Executive narrative ile Operations narrative tonu farklı ama aynı sayılar
7. **Audit ID rapor içinde** — Bölüm 9'da `Audit ID: m-cuid-xyz`; kullanıcı bu ID ile `/api/analytics/cases/audit/:id` endpoint'inden tüm KPI'ları replay edebilir (Phase 5+ feature)

#### 2.10.7. Report template kataloğu

§2.9.5'teki 4 lens-bazlı şablona ek olarak **5. şablon** (cross-lens):

##### 1. 🎯 Executive Weekly Operations Brief
- **Lens**: executive
- **Hedef**: CEO/GM haftalık özet
- **Süre**: 1-2 sayfa PDF / 2-3 paragraf mail
- **Bölümler**: Özet → 3 karar → riskler → trend
- **Frekans önerisi**: Pazartesi sabahı (manuel veya cron — Phase 5+)

##### 2. 📦 Product Friction Report
- **Lens**: product
- **Hedef**: PM/PO ürün council toplantısı
- **Süre**: 3-5 sayfa PDF / 1 PPTX deck (5-10 slayt)
- **Bölümler**: Top sürtünme noktaları → repeated clusters → duplicate analysis → roadmap candidate
- **Frekans önerisi**: Sprint başı

##### 3. ⚙ CS Efficiency & Bottleneck Report
- **Lens**: operations
- **Hedef**: CS manager 1:1 / haftalık review
- **Süre**: 2-3 sayfa PDF
- **Bölümler**: Takım yükü → darboğaz → queue aging → transfer/escalation → süreç önerileri
- **People-safe dil** (§2.7.5) **özellikle** kritik

##### 4. 👥 Customer Risk Report
- **Lens**: customer
- **Hedef**: Account manager / CS Lead müşteri planlaması
- **Süre**: 1-2 sayfa PDF / XLSX (account-bazlı satır)
- **Bölümler**: At-risk accounts → churn signals → proaktif outreach listesi → her account için kısa context
- **Müşteri-spesifik aksiyon önerileri**

##### 5. 🔔 SLA / Escalation Report (yeni — cross-lens)
- **Lens**: operations (ama executive özeti de var)
- **Hedef**: SLA komitesi / aylık review
- **Süre**: 2-3 sayfa PDF
- **Bölümler**: SLA ihlal sayıları + oranları → eskalasyona giden vakalar → kategori dağılımı → kök neden önerileri → trend (3 ay)
- **Detay**: Her SLA ihlal/eskalasyon vakası için caseNumber + kategori + sebep özeti (top 20)

**Yeni report type**: `'sla-escalation'` — `ReportGenerationLog.reportType` enum'una eklenir.

#### 2.10.8. UX edge cases

| Durum | Davranış |
| --- | --- |
| Kullanıcı AI fail durumunda rapor istiyor | "AI narrative yüklenemedi. Yalnız deterministik rapor üretilebilir." → kullanıcı confirm → rapor builds without narrative |
| Snapshot'ta `minSampleViolations` var | Rapor o metrik için "Yetersiz veri (n=3)" değer + AI narrative bu metrik hakkında konuşmaz; appendix'te min sample notu |
| Export büyük (XLSX 50K satır) | Async job: "Hazırlanıyor… 2 dk sürebilir"; tamamlanınca email/in-app notification + indirme link'i (24h TTL) |
| Aynı scope için bir başkası saatler önce rapor üretti | Studio'da "Bu kapsam için son rapor: 3 saat önce (Demir Han) [Görüntüle]" — duplicate effort uyarısı |
| Studio açıkken kullanıcı dashboard filter'ını değiştirdi | Studio "Filter'lar değişti, kapsamı güncelle?" prompt |
| Cross-tenant rapor isteyen role'siz kullanıcı | UI'da bu option disabled + tooltip "Bu yetki Customer Success Leadership rolüne aittir" |
| Export PDF render timeout (Puppeteer) | Fail-safe: Markdown export'a düş + "PDF üretilemedi, Markdown indirildi" toast |

#### 2.10.9. Implementation karşılığı

**Backend endpoint'ler:**

- `POST /api/analytics/cases/export-preview` — kullanıcının seçtiği config ile rapor markdown'ını döner (önizleme); henüz dosya üretmez
- `POST /api/analytics/cases/export` — gerçek dosya üretir (sync veya async, format'a göre); response ya dosya URL'i (async) ya da direct binary (sync, küçük formatlar)
- `GET /api/analytics/cases/reports/history` — kullanıcının `ReportGenerationLog` geçmişi
- `GET /api/analytics/cases/reports/:id` — tek rapor metadata (regenerate veya share için)

**Server-side composition:**

- `server/analytics/reportComposer.js` (yeni dosya) — tek kaynak helper:
  - Input: scope + sections + format + lens + aiNarrative
  - Output: format-specific binary/text
- `reportComposer` internally uses:
  - `operationsAggregator` (§2.6.2 — sayılar buradan)
  - `aiPrompts/report-*.js` (lens'e göre AI narrative)
  - Format renderer'lar: `renderMarkdown`, `renderPdf` (Puppeteer), `renderXlsx` (exceljs), `renderEml`, `renderPptx`
- Hepsi **aynı snapshot**'tan beslenir → sayılar tüm format'larda **birebir aynı**

**Frontend:**

- `<ReportStudioModal>` (§2.8.6 + bu doc) — 5 adımlı wizard
- `<ReportPreviewPane>` — markdown render
- `<ReportHistoryDrawer>` — kullanıcının geçmiş raporları (yeni Phase 5+)

**Migration:**

- `ReportGenerationLog` tablosu Phase 4b'de (Studio core) eklenir
- PDF Puppeteer setup Phase 5a'da (Vercel function süre limiti dikkat — opsiyonel external worker)
- XLSX/CSV Phase 5b'de async job altyapısı ile (ExportJob audit'le birleşik)
- PPTX Phase 6 — design ekip iş birliği

#### 2.10.10. Acceptance — Report Studio için

(§5'e taşınacak — burada kısa özet)

- AI narrative on/off toggle çalışır; AI'sız rapor sadece deterministic KPI + chart
- Scope label başlık sayfasında **görünür** ve **doğru**
- Export sayıları dashboard'taki UI sayıları ile **birebir aynı**
- `ReportGenerationLog` her oluşturma satırı yazar (failed dahil)
- Cross-tenant rapor sadece CSLeadership/SystemAdmin için
- People-safe filter aktif — ihlalde rapor build fail
- AI narrative içinde geçen sayılar `evidenceUsed`'a karşı regex-doğrulanır
- 5 template tetiklenir + uygun lens prompt seçilir
- Audit footer her formatta zorunlu görünür

### 2.11. Premium Executive Analytics UX — low-fatigue cockpit

> **Tasarım hedefi:** Yöneticiler bu sayfada **uzun saatler** geçirecek.
> Premium, sakin, hızlı, keyifli hissettirmek **fonksiyonel zorunluluk**.
> Yoğun dashboard değil, **operasyon kokpiti**.
>
> **Hedef his:** Linear / Notion / Stripe Dashboard kalitesi; SAP / Salesforce
> yoğunluğu değil.

#### 2.11.1. UX prensipleri

1. **Premium operational cockpit**
   - Yüksek kalite hissi (Linear/Stripe/Notion estetiği)
   - Yeterli yoğunluk var ama görsel olarak sakin
   - Dashboard-card clutter yok
   - Dekoratif gürültü yok
   - Gimmicky AI görsel (parlayan ışıklar, magical icons) yok
   - AI varlığı polish ve güvenilir hissettirir, demo-app gibi değil

2. **Low cognitive fatigue**
   - **Net hiyerarşi**: Scope → AI Brief → KPI'lar → Trend → Drill-down — kullanıcı gözü hep aynı sırayla akar
   - **Progressive disclosure**: Önce özet, detay isteğe bağlı (Drill-down, "AI ile açıkla", "Önizleme")
   - Tek ekranda **çok grafik yok** — section'lar dikey akış; lateral karmaşıklık az
   - Spacing, grouping, typography taraması kolaylaştırır
   - Uzun oturum (1-3 saat) sonunda **göz yorgunluğu** olmaz

3. **Beautiful but practical**
   - Grafikler elegant, okunabilir, **interactive** (hover tooltip, zoom-on-bar)
   - Refined renk paleti; semantic anlamlı kullanım
   - Tek tonlu (tüm sayfa violet!) yasak — denge
   - Dark mode **birinci sınıf** (afterthought değil)
   - Text overlap yok, cramped card yok, tiny unreadable label yok

4. **Drill-down elegance**
   - Drawer smooth (transition 200-250ms, ease-out)
   - Açılırken arka plan kararmaz tamamen — kullanıcı **bağlamı kaybetmez**
   - Seçili filter/metric chip drawer üstünde sticky
   - Evidence kolay incelenebilir + export'a 1 tık uzaklıkta

5. **AI visual identity (§2.8.7 + bu doc tutarlılığı)**
   - RUNA tutarlı surface'lerle görünür: Command Strip, Insight Card, Contextual Menu, Drawer Assistant, Report Studio
   - "Pasted on" değil, dashboard'a **entegre** hissettirir
   - Evidence chip + scope label + confidence/source label her yerde

6. **Interaction quality**
   - Loading **polished skeleton** (gri pulsing yok; layout-aware shimmer)
   - Empty state yardımcı + actionable
   - Error state calm + "Yeniden dene" CTA
   - Filter immediate hissi (debounce 150ms; >300ms olunca pending state)
   - Transition'lar subtle + hızlı (60fps)
   - Hover/focus state **explore** keyifli — micro-feedback (subtle border + raise)

7. **Outcome (kullanıcı hissi)**
   - "Operasyonu **hızlı** anlıyorum."
   - "Sayılara **güveniyorum**."
   - "AI bana **düşünmeye yardım** ediyor."
   - "Bu **ciddi** bir enterprise ürünü."
   - "Burada **yorulmadan** vakit geçirebiliyorum."

#### 2.11.2. Visual hierarchy — 5 katman

Yukarıdan aşağıya bilgi akışı:

```
┌─────────────────────────────────────────────────────────────────┐
│  Katman 1 — SCOPE & KAPSAM (dikkat: en az görsel ağırlık)        │
│  Filter chip'leri (collapsed); "Kapsam: PARAM · 7g" rozet        │
│  Lens switcher (subtle segmented control)                         │
│  Sağ: refresh, export, settings                                   │
├─────────────────────────────────────────────────────────────────┤
│  Katman 2 — AI BRIEF (dikkat: yüksek; gözün önce gittiği yer)    │
│  🤖 RUNA Command Strip — top 3 risk + değişim + karar CTA         │
│  Audit stamp, scope rozeti, dismiss/refresh                       │
├─────────────────────────────────────────────────────────────────┤
│  Katman 3 — TOP KPI (dikkat: dengeli; karar verici sayılar)      │
│  6 tile — büyük rakam + period delta + (i) info + 🤖 explain      │
│  Tile'lar arası 16px gap; tile içi calm padding                   │
├─────────────────────────────────────────────────────────────────┤
│  Katman 4 — TREND & BREAKDOWN (dikkat: pattern keşfi)            │
│  Full-width time series (genişlik = beyaz alan)                   │
│  2-col grid: status/priority — eşit ağırlık                       │
│  AI Insight Card lere arada gömülü (proaktif)                     │
│  Section başlıkları küçük UPPERCASE; içerik büyük yumuşak          │
├─────────────────────────────────────────────────────────────────┤
│  Katman 5 — DEEP TABLES (dikkat: drill için aktivasyon)           │
│  Kategori sıcak nokta + Top accounts + Agent performance          │
│  Her satır click → drill-down drawer                              │
│  Tablo dense ama padded; sticky header; alternating row subtle    │
└─────────────────────────────────────────────────────────────────┘

      Drill-down drawer (overlay'den yarı şeffaf değil — solid):
      ┌─────────────────────────────────────────────────────────┐
      │ Drill-down: "SLA İhlal" (162) · Kapsam chip · Audit ID   │
      │ ──────────────                                            │
      │ 🤖 RUNA özet card (toplam farkındalık)                    │
      │ ──────────────                                            │
      │ Vaka tablosu — server pagination, sort, ✉/⚠ row actions   │
      └─────────────────────────────────────────────────────────┘
```

**Görsel ağırlık tonlama:**
- Filter bar / scope: **subtle** (gri, küçük) — operasyonel ama dikkat çekmez
- AI Brief: **medium-high** — gözün ilk gittiği yer, ama "scream" değil
- KPI tile: **high** — büyük rakam, sade tile
- Trend chart: **medium** — büyük canvas ama tek renk dominant
- Breakdown/table: **medium-low** — yoğunluk var ama row spacing rahat

#### 2.11.3. Layout proposal — spacing, grouping, typography

**Spacing scale (tek tutarlı sistem — Tailwind 4-base):**

| Token | Pixel | Kullanım |
| --- | --- | --- |
| `gap-1` (4px) | KPI tile içindeki delta + ikon | İçi sıkı, yorulmayan |
| `gap-2` (8px) | Form elements, chip'ler arası | İlişkili öğeler |
| `gap-3` (12px) | Card içi sub-sections | İkincil ilişkili |
| `gap-4` (16px) | Tile'lar arası, breakdown card'lar | Eşit ağırlık paneller |
| `gap-6` (24px) | Section'lar arası (KPI ↔ Trend) | Belirgin ayrım |
| `gap-8` (32px) | Major hierarchy (AI Brief ↔ KPI) | Katman geçişi |

**Page max-width:**
- Min: 1280px tasarım hedefi; daha küçükte responsive collapse
- Max: 1680px (XL desktop) — daha geniş ekranda **page genişlemez**, beyaz alan yan kenarlarda. Cocokpit hissi için constrained width tercih edilir
- Mobile: dashboard mobile-friendly **değil** (known limitation §ROADMAP); >= 768px desktop hedefi

**Typography (var olan Tailwind palet'i; bu doc'ta tek standart):**

| Token | Size · Weight · Line-height | Kullanım |
| --- | --- | --- |
| `text-3xl font-semibold` | 30/36, 600 | Page title ("Operasyon Panosu") |
| `text-xl font-semibold` | 20/28, 600 | KPI tile büyük rakamı |
| `text-base font-medium` | 16/24, 500 | Card başlığı, body |
| `text-sm` | 14/20, 400 | Tablo hücre, secondary metin |
| `text-xs text-slate-500` | 12/16, 400 | Label, scope rozet, metadata |
| `text-[10px] uppercase tracking-wide` | 10/14, 500 | Section başlık ("BREAKDOWN"), KPI label |

**Color palette (semantic + restrained):**

| Semantic | Light | Dark | Kullanım |
| --- | --- | --- | --- |
| **healthy / success** | `emerald-500` / `emerald-50` bg | `emerald-400` / `emerald-950/30` | İyi durumda KPI delta (TTR düştü, SLA% düştü) |
| **warning** | `amber-500` / `amber-50` | `amber-400` / `amber-950/30` | Yaklaşan SLA risk, backlog buildup, attention |
| **risk / critical** | `rose-600` / `rose-50` | `rose-400` / `rose-950/30` | SLA ihlali, kritik, churn risk |
| **neutral** | `slate-700` / `slate-50` | `ndark-text` / `ndark-bg` | Standart KPI, sayı |
| **AI insight** | `violet-600` / `violet-50` | `violet-400` / `violet-950/30` | RUNA surface'leri (Command Strip, Insight Card) |
| **info** | `blue-500` / `blue-50` | `blue-400` / `blue-950/30` | Pattern alert, tooltip, info |

**Anti-rule:** Tek bir lens'in tüm renkleri tek tonu olmasın. Executive lens "neutral + brand blue" ağırlıklı; Product "violet accent + neutral"; Operations "amber accent + neutral"; Customer "teal accent + neutral". Yani **her şey RUNA violet değil** — RUNA yalnız AI surface'lerde dominant.

**Grid system:**

- KPI tile row: `grid grid-cols-6 gap-4` (XL) → `grid-cols-3 gap-4` (lg) → `grid-cols-2 gap-3` (md)
- Breakdown 2-col: `grid grid-cols-2 gap-4` (lg) → `grid-cols-1 gap-4` (md)
- Card padding: `p-5` (genişlikte cömert), `p-4` (kalabalıkta)

#### 2.11.4. Interaction model — micro-quality

| Etkileşim | Spec |
| --- | --- |
| **Page load** | Skeleton tile'lar 200ms içinde görünür; gerçek veri 600ms p95; cross-fade 150ms |
| **Filter change** | 150ms debounce; chart re-render 250ms; spinner KPI tile'ında subtle (sağ üstte 12px) |
| **Hover row** | `bg-slate-50 dark:bg-ndark-bg/40` + cursor pointer; 100ms transition |
| **Click row → drill-down** | Drawer 250ms slide-in from right; backdrop 200ms fade; ESC kapatır |
| **Tooltip (chart hover)** | 100ms delay; fade-in 150ms; stays until mouse leave |
| **Chart zoom (brush)** | Mouse drag selects range; release applies filter (debounce 200ms) |
| **Empty state** | Layout korunur (zıplama yok); ikon + 2 cümle + CTA |
| **Error state** | Card içinde inline; "Yeniden dene" button; smaller scale, calm |
| **AI loading** | "🤖 Düşünüyorum…" pulsing dot animasyonu (1.5s loop); diğer animasyon yok |
| **Refresh** | `refresh` icon spinning 600ms; finish'te subtle "Güncel" check 800ms sonra fade |
| **Notification (cross-section sync)** | Toast üst-orta; 3s görünür; "Filter güncellendi: …" gibi context tutar |

**Loading state taxonomy:**

- `skeleton-tile` — KPI tile için: başlık placeholder 60% width + value placeholder 40% width + chart-line placeholder
- `skeleton-row` — Tablo satırı için: 5-6 column shimmer
- `skeleton-chart` — Time series için: axis bars + smooth wave shimmer
- `spinner-inline` — refresh sırasında card kornere; full-screen spinner yasak

**Empty state copy patterns (Türkçe):**

```
Henüz veri yok                            ← genel
─────────────
"Bu filter aralığında veri yok"            ← filter sonucu
"Önceki haftaya göre değişiklik yok"       ← delta gösteren tile'da
"Sapma yok — operasyon normal"             ← AI insight yokken
"Drill-down için bir KPI veya satır seç"   ← drawer boş
"Henüz izlediğin vaka yok"                 ← watcher inbox tarzı
```

Empty state'lerde **eylem öner**: "Filter aralığını genişlet", "Yeni vaka oluştur", vs.

#### 2.11.5. Chart design guidance

**Genel kurallar:**

- **Recharts** kullan (mevcut bundle); custom chart kütüphanesi (D3 raw, etc.) avoid edilir
- Her chart **max 4 data series** — daha fazlası okunmaz
- Legend her zaman görünür (chart altında); legend item tıklanabilir → o series'i göster/gizle
- Axis label'ları **küçük + grey** — chart'a baskın olmasın
- Grid line'lar **yumuşak** (`stroke-slate-200 dark:stroke-ndark-border`); ana çizgi vurgulu
- Time series x-axis: tarih formatı tutarlı (`13 May`); zoom yapılınca saat detayı

**Time series (Açılan vs Çözülen vs SLA İhlali):**

```
   Vaka Sayısı
   ────────
   1500│                            ╱╲
   1200│                         ╱╲╱  ╲    ── Açılan
    900│                     ╱╲╱       ╲
    600│            ╱╲    ╱╲╱
    300│     ╱╲╱╲╱╲╱  ╲╱╲╱
      0└────────────────────────────────────  ── SLA ihlali (rose, ince)
       6 May   8 May   10 May   12 May
```

- Renkler: Açılan `blue-500`, Çözülen `emerald-500`, SLA ihlali `rose-500` (ince, distinguish)
- Line smoothing: `monotone` (Recharts) — agresif curve yok
- Hover: dikey vertical-line + tooltip (her series için değer + total)
- Annotation: dramatic spike olunca subtle marker + AI Insight Card section'da

**Bar / breakdown (Status, Priority, Team):**

- Horizontal bar (mobile-friendly + label okuma)
- Bar height: 28px tutarlı (clamp); aşırı kalın yok
- Bar arka planı: faint track (`bg-slate-100 dark:bg-ndark-bg/30`)
- Bar fill: semantic renk (status enum'una göre)
- Sağda value + opsiyonel delta (`+12%` chip)
- Hover: bar parlar (5% lighten); tooltip "Bu segmente git" CTA

**Sıcak nokta tablosu (Category × ProductGroup):**

- Heat-style: arka plan opaklığı magnitude'a göre (`opacity-30` → `opacity-90`)
- Renk: amber gradient (low) → rose (high) — risk yoğunluğu
- Row click → drill-down; sticky header on scroll

**Donut / pie yasaklı:**

- 4'ten fazla segment donut'ta yok (okunmaz)
- 2-3 segment için **stacked bar** tercih (daha okunabilir)
- Görsel zayıflık + label çakışması — anti-pattern listesi (§2.11.9)

**Aggressive yasaklar:**

- **3D chart yok** (kötü tasarım sinyali)
- **Animated gradient stroke** yok (Tableau-fancy değil)
- **Rainbow palette** yok (semantic anlam yok)
- **Pie chart 5+ segment** yok

#### 2.11.6. AI visual system — RUNA premium surface

§2.8.7 ile tutarlı + bu doc'tan ek **kalite hedefleri**:

**RUNA Surface palette:**

| Surface | Light bg | Light border | Light text | Dark bg | Dark border |
| --- | --- | --- | --- | --- | --- |
| Command Strip | `violet-50/40` (soft tint) | `violet-200` | `violet-900` | `violet-950/20` | `violet-900/40` |
| Insight Card | `white` | severity renk (rose/amber/blue) | `slate-900` | `ndark-card` | severity dark variant |
| Contextual Menu (`🤖 ▾`) | `transparent` (ghost) | hover violet-200 | `slate-700` | `transparent` | hover violet-900/40 |
| Drill-down Assistant | `violet-50/30` (very soft) | `violet-200` | normal text | `violet-950/15` | `violet-900/30` |
| Report Studio Modal | `white` | `slate-200` | normal | `ndark-card` | `ndark-border` |
| Studio TASLAK banner | `amber-50` (alert tone) | `amber-300` | `amber-900` | `amber-950/30` | `amber-900/40` |

**Visual rules:**

- **AI Brief** dashboard'da **bir tane** — multiple yarışmaz; Command Strip tek pozisyon
- **Insight Card'lar** dashboard içine **maks 3-4** yayılır; daha fazlası noise
- **🤖 ikon** her surface'te tek konum (sol veya sağ — tutarlı section başına)
- **RUNA tipografisi**: surface başlığında `font-medium` + violet-900 (light) / violet-300 (dark)
- **Audit chip** her AI surface'in alt-sağ köşesinde; `text-[10px] text-slate-400`; hover'da Audit ID görünür
- **Evidence chip'leri** small pill (`px-2 py-0.5 rounded-full text-[11px]`) — tıklanabilir, drill-down

**Premium dokunuşlar:**

- Card border `border-violet-200/60` (yarı opak) — sert kontur yerine yumuşak
- Subtle inner shadow (`shadow-sm`) — flat değil ama heavy değil
- Tıklanabilir AI evidence chip'leri hover'da `bg-violet-100/50` — feedback hissi
- AI assistant card'ında "Düşünüyorum…" animasyon: 3 pulsing dot (`...`) sade

**Yasaklar:**

- Neon gradient AI badge yok
- Spinning sparkle icon yok (`✨` emoji ile durağan kullanılır, animate edilmez)
- "AI-generated" watermark yarı şeffaf overlay yasak (dikkat dağıtıcı)
- Rainbow / hologram efekti yasak

#### 2.11.7. Long-session usability — yorgunluk önleme

Yöneticiler 1-3 saat oturum geçirir. Tasarım kararları yorgunluğu **yapısal** olarak azaltır:

1. **Sticky scope/lens chip** — Sayfa scroll ederken bile "neyi okuyorum" görünür kalır (üst 56px sticky bar)
2. **No autoplay animations** — chart, AI loading, refresh hariç animasyon yok
3. **Predictable layout** — KPI tile sırası lens'e göre değişse de section sırası **sabit** (Brief → KPI → Trend → Breakdown → Table)
4. **Cursor friendly** — interactive area'lar büyük (min 32px); küçük buton yorucu
5. **No modal trapping** — drill-down drawer ESC + click-outside ile kapanır; modal stack 2'den fazla olmaz
6. **Eye-rest patterns** — section'lar arası `mt-6` (24px); aynı renkte 3'ten fazla card yan yana değil
7. **Refresh rate awareness** — auto-refresh **yok** (kullanıcı kontrolü); 5dk'da bir "Veri 5 dk eski, yeniler misin?" subtle banner
8. **Comfortable contrast** — text/bg kontrast **AA** standart minimum; light mode'da `slate-700` ile bg arasında (AAA hedef)
9. **No flicker on data refresh** — soft transition (cross-fade, ölçek değişimi yok)
10. **Print-friendly** — `@media print` rule: AI surface gizli, chart static, scope rozet üstte (yöneticinin PDF'sini browser print ile alabilmesi için fallback)

**Dark mode özel kuralları:**

- Dark mode `bg-slate-950` (gerçek koyu, gri tonlama değil) — uzun oturumda göz konforu
- AI surface'leri dark mode'da **çok parlak değil** (`violet-950/20` yumuşak, `violet-500` sert değil)
- Chart line'ları dark mode'da `2-3 px stroke` light yerine `2-3 px stroke` + saturation düşürme (parlaklık azalır)
- Skeleton shimmer dark mode'da `from-slate-800 via-slate-700 to-slate-800` — yumuşak

#### 2.11.8. Light / Dark mode — first-class

Smoke audit Phase 3'te öğrendik: dark mode afterthought olmaz. Bu dashboard için her component **her iki mode'da test edilir**.

| Yüzey | Light spec | Dark spec |
| --- | --- | --- |
| Page bg | `bg-slate-50` | `bg-ndark-bg` |
| Card bg | `bg-white` | `bg-ndark-card` |
| Card border | `border-slate-200` | `border-ndark-border` |
| Text body | `text-slate-800` | `text-ndark-text` |
| Text muted | `text-slate-500` | `text-ndark-muted` |
| KPI value | `text-slate-900` | `text-ndark-text` |
| Chart axis | `stroke-slate-300` | `stroke-ndark-border` |
| Chart grid | `stroke-slate-200` | `stroke-ndark-border/50` |
| Hover bg | `bg-slate-50` | `bg-ndark-bg/40` |
| Focus ring | `ring-brand-400` | `ring-brand-500` |
| Skeleton shimmer | `bg-slate-100 ... bg-slate-200` | `bg-ndark-bg ... bg-ndark-card` |

**Test:** Her phase'in PR'ında "Bu surface dark mode'da nasıl?" screenshot zorunlu (smoke audit kuralı).

#### 2.11.9. Anti-patterns — KAÇINILACAKLAR

| ❌ Kaçın | ✅ Tercih et |
| --- | --- |
| Tek ekranda 8+ chart | 3-4 ana chart + drill-down detay |
| 12 segmentli donut chart | Top 5 + "Diğer" stacked bar |
| Dashboard tüm renkleri kullansın gradient | Semantic palette + neutral baskın |
| Animated rainbow border AI card | Sade card + violet accent + audit chip |
| "Excel-like" cramped table — 50 satır, küçük font | Spacious table (28-32px row), sticky header, pagination |
| Tıklanabilir alan küçük (16px button) | Min 32px hit area |
| Modal içinde modal içinde modal | Max 2 stack; drawer + 1 confirm dialog |
| Sayı + emoji + ikon + delta tek hücrede | Sayı **dominant**, delta küçük, ikon opsiyonel |
| Multi-color KPI tile (her tile farklı renk) | Tüm tile'lar neutral; **delta** rengi semantic |
| Skeleton "gray rectangle" pulse | Layout-aware shimmer (chart skeleton chart şekli) |
| Auto-refresh 30 sn'de bir | Manuel refresh; "veri X dk eski" banner |
| 3D chart, neon glow, holographic | Flat, calm, semantic |
| "Loading..." text spinner | Polished skeleton + invisible'a yakın text |
| "AI generating sparkles ✨✨✨" decoration | Sade 🤖 + "Düşünüyorum…" dot pulse |
| Tablo başlığı tıklanmıyor (sıralama yok) | Tüm tablo başlıkları clickable sort + asc/desc indicator |
| "Yetkin değil!" red bold modal | "Bu içerik için yetkiniz yok" inline gri |
| KPI rakamı yanında %50 width değişen sayı | Tabular nums + sabit genişlik (`tabular-nums`) |
| Drag-and-drop dashboard widget builder | Sabit layout, lens switcher + filter yeterli |
| Onboarding 5-step tour her sayfa açılışta | Tek tooltip Lens'i ilk kullananın gördüğü, dismissable |

#### 2.11.10. Component primitives — yeni eklemeler

§2.8.7 mevcut RUNA primitive'lerine ek olarak **dashboard-spesifik** primitive'ler:

```tsx
// Premium KPI tile — büyük rakam + delta + info
<KpiTile
  label="SLA İhlal Oranı"
  value="8.7"
  unit="%"
  delta={{ value: 1.2, direction: 'up', semantic: 'risk' }}
  approximate={false}
  minSampleViolation={false}
  onInfoClick={() => openMetricDetails(...)}
  onAiExplainClick={() => openExplainModal(...)}
/>

// Layout-aware skeleton
<KpiTileSkeleton />
<ChartSkeleton variant="timeSeries" />
<TableRowSkeleton cols={6} />

// Scope rozet
<ScopeBadge
  kind="team"
  narrative="Destek Takımı (PARAM)"
  asOf="2026-05-13T22:42Z"
  auditId="m-cuid-xyz"
  narrowedFrom={null}
/>

// Lens switcher
<LensSwitcher value="executive" onChange={...} allowed={["executive","operations"]} />

// Drill-down drawer (premium)
<DrilldownDrawer
  open
  title="SLA İhlal Eden Vakalar (162)"
  scopeBadge={<ScopeBadge ... />}
  assistantCard={<RunaDrilldownCard ... />}
  onClose={...}
>
  <CaseTable ... />
</DrilldownDrawer>

// Empty state — helpful
<EmptyState
  variant="filter"
  title="Bu filter aralığında veri yok"
  hint="Tarih aralığını genişletmeyi dene"
  cta={{ label: "Son 30 güne genişlet", onClick: ... }}
/>
```

Tüm primitive'ler light + dark mode test edilir; Storybook (opsiyonel — gelecek faz) ile dokümante edilir.

#### 2.11.11. Acceptance — premium UX için

(§5'e taşındı — burada kısa özet)

- KPI sıralaması lens'e göre değişmez ama **vurgu** değişir
- 1-3 saat oturum testinde göz yorgunluğu yok (subjective + 5 test kullanıcı)
- Dark mode + light mode her surface'te birebir kalite
- Loading/empty/error state'leri standardize edilmiş
- Anti-pattern listesinde geçen hiçbir kalıp dashboard'da yok
- Smoke audit Phase 3'teki dark mode kuralları yeni dashboard'da retrospektif geçer
- AI surface'leri "embedded analyst" hissi — gimmick yok

---

## 3. Fazlı uygulama planı

### Phase 1 — Backend overview endpoint (1 PR)
- `POST /api/analytics/cases/overview` — tek tek KPI section'ları + breakdown + time series
- `server/analytics/operationsAggregator.js` (yeni dosya, raw SQL CTE'ler — tek kaynak; export ve drilldown da aynı helper'ı kullanır)
- 6 yeni composite index migration (additive)
- `deriveAnalyticsScope` helper (§2.2A) + `applyMetricFilters`
- **`MetricQueryAudit` tablosu + migration** (§2.6.6) — her response audit row üretir
- **formulaVersion = "v1"** sabit; metric dictionary §2.6.2'de donmuş
- **Formula unit tests** (`server/analytics/__tests__/operationsAggregator.test.ts`) — her metric için min 3 case (happy, null-divide, edge)
- **Golden fixture** (`__tests__/golden/operations-overview.json`) — DEMO seed üzerinden donmuş snapshot
- **`docs/METRIC_FIXTURES.md`** prework — DEMO seed için her metrik elle hesaplanır, fixture'a yazılır
- Manual smoke (cURL fixture filter ile) — `response.scope`, `metricAuditId`, `formulaVersion`, `approximations` alanları doğrulanır
- **Çıktı**: endpoint + audit + test fixture'ı çalışır, eski page hâlâ kullanılıyor

### Phase 2 — Redesigned UI on new endpoint (1 PR — §2.11 premium UX uygulanır)

§2.11 tüm UX prensiplerini Phase 2'de uygula:

- `CaseAnalyticsPage.tsx` rewrite → yeni `OperationsDashboardPage` (eski yan yana kalır)
- **Layout** §2.11.2: 5-katman hiyerarşi (Scope → AI Brief slot → KPI → Trend → Breakdown → Table)
- **Component primitives** §2.11.10:
  - `<KpiTile>` — büyük rakam + delta + (i) + 🤖 info; tabular nums
  - `<KpiTileSkeleton>`, `<ChartSkeleton variant="timeSeries">`, `<TableRowSkeleton>`
  - `<ScopeBadge>` — sticky scope chip + audit ID
  - `<LensSwitcher>` (Phase 4c'ye kadar tek lens default; switcher dummy)
  - `<DrilldownDrawer>` shell (Phase 3'te full implement)
  - `<EmptyState variant>` — copy patterns (§2.11.4)
- **Recharts** time-series + horizontal bar breakdown'lar:
  - Max 4 data series rule (§2.11.5)
  - Semantic palette (status enum'una göre renk)
  - Hover tooltip + brush zoom + legend toggle
  - **Donut yasağı** — donut 4+ segment varsa stacked bar'a düş
- **Sticky filter bar** + URL state (`?from=...&to=...&lens=...&companies=...`)
- **Loading / empty / error states** her tile için ayrı tanımlı; §2.11.4 copy patterns
- **Dark mode** tüm surface'lerde **eşit kalite** — smoke audit Phase 3 kuralları retrospective geçer
- **Spacing scale** §2.11.3 tablosuna uygun (gap-4 tile, gap-6 section, gap-8 katman)
- **Typography scale** §2.11.3 tablosu — `tabular-nums` KPI'larda
- **Color palette** §2.11.3 — neutral baskın; KPI tile'ları tek-tonsuz; **delta** semantic renk
- **Anti-pattern audit** §2.11.9 — PR review checklist'te
- `analyticsService.getOperationsOverview()` method
- Eski "Vaka Raporları" page sidebar'da kalır (deprecated banner); yeni "Operasyon Panosu" sidebar entry
- **Screenshot test**: light + dark her view için PR'da screenshot zorunlu
- **Çıktı**: production-ready dashboard; premium hissi var ama AI Brief / drill-down / lens henüz minimal (Phase 3-4'e bırakılır)

### Phase 3 — Drill-down drawer + table (1 PR)
- `POST /api/analytics/cases/drilldown` endpoint
- `<DrilldownDrawer>` componenti (mevcut `Modal`/`Drawer` primitive'i)
- Her KPI tile + breakdown bar tıklanabilir → drawer açar
- Drawer'da pagination, sort, "CasesList'e git" deep-link
- **Çıktı**: dashboard'tan vaka detayına 2-click yolu

### Phase 4 — AI Analyst Companion + AI Fabric (2 PR — 4a / 4b split önerilir)

§2.7 (AI Companion) + §2.8 (AI Fabric) — büyük scope nedeniyle iki PR'a bölünür.

#### Phase 4a — Core AI experiences (1 PR)
- `POST /api/ai/operations-brief` — **Executive AI Brief** (§2.7.2a + §2.8.2 Command Strip)
- `POST /api/ai/operations-explain-metric` — **Explain This Metric** (§2.7.2b)
- `POST /api/ai/operations-chat` extend — **Ask RUNA About This View** (§2.7.2c, view-context payload)
- `POST /api/ai/operations-report-draft` — **AI Report Draft** (§2.7.2d)
- `POST /api/ai/operations-insights` — **Insight cards** (§2.8.3, 5 tip — SLA Anomaly, Backlog Buildup, Repeated Issue, Customer Risk Cluster, Workload Imbalance)
- UI:
  - **`<RunaCommandStrip>`** sticky band (§2.8.2 layout)
  - **`<RunaInsightCard>`** dashboard içinde (§2.8.3 shape)
  - `<ExplainMetricModal>` (sensitive KPI info popover'ından)
  - `<RunaAiChatPanel>` extend (view-context)
  - `<AiReportDraftModal>` (markdown, Kopyala/İndir/Mail)
  - **`<RunaSurface variant>`** primitive (§2.8.7) — tek noktada görsel tutarlılık
- **`<RunaIcon>`** component (sized + thinking variant)
- Brief + insights snapshot **server-side** → AI narrate
- "Mevcut filtrelere dayanıyor" disclaimer, "Karar yöneticinindir" footer, scope rozet, Audit ID stamp

#### Phase 4b — Contextual AI + Drill-down assistant + Report Studio (1 PR)
- `POST /api/ai/operations-explain-segment` — **"Bu segmenti özetle"** (§2.8.4)
- `POST /api/ai/operations-explain-delta` — **"Ne değişti?"** (§2.8.4)
- `POST /api/ai/operations-suggest-action` — **"Sonraki aksiyonu öner"** (§2.8.4)
- `POST /api/ai/operations-drilldown-assist` — **Drill-down RUNA assistant** (§2.8.5)
- `POST /api/ai/operations-report-studio` — **Report Studio** (§2.8.6, full mode)
- UI:
  - **`<RunaContextMenu>`** her major section header'ında (§2.8.4 — 5 action)
  - **`<DrilldownAssistantCard>`** drawer üstünde otomatik (§2.8.5)
  - **`<ReportStudioModal>`** kapsam + içerik seçimi + tone/dil (§2.8.6 layout)
  - Highlighted "incele önerisi" satırları drill-down tablo'da subtle ring
- Report Studio export: Markdown / HTML / Mail draft (.eml); PDF Phase 5+
- Studio output `MetricQueryAudit` (endpoint='ai-report-studio') + AIUsageLog row üretir

#### Phase 4c — Persona Lens system (1 PR)

§2.9'da tanımlanan 4 lens (Executive / Product / Operations / Customer) sistemi:

- **Backend**: tüm overview + AI endpoint'lerine `lens` parametre eklenir; aggregator değişmez (KPI hesabı aynı); AI prompt'ları lens-aware (`server/lib/aiPrompts/lens-executive.js`, `lens-product.js`, `lens-operations.js`, `lens-customer.js`) — toplam ~20 prompt versiyonu
- **Report templates**: §2.9.5'teki 4 şablon (Executive Summary / Product Insight / CS Operations / Customer Risk)
- **Insight tetik eşikleri lens-aware**: Customer lens'te repeated issue threshold daha düşük, Product lens'te duplicate cluster ön planda, Operations'ta workload imbalance vurgulu
- **Permission model**: §2.9.8 tablosu — rol → default lens + görünür lens'ler
- **UI**:
  - `<LensSwitcher>` dashboard üstünde (Tab veya Segmented Control); URL state `?lens=…`
  - Lens değişimi → section layout, brief + insights yeniden fetch, prompt versiyon değişimi
  - `user.lensPreferences` local storage; role-default override edilebilir
  - Section visibility lens'e göre (§2.9.9 tablosu): Agent-level metric'ler Product/Customer lens'te gizli, byCompany Operations'ta gizli, vs.
- **Same data, different narrative testing**: §2.9.6 senaryosu (38 SLA ihlali Product vs CS vs Customer vs Executive yorumu) fixture testinde doğrulanır — **4 lens'te de aynı sayılar** çıkar, narrative farklı
- **Promptu sürdürülebilirlik**: Her lens promptu kodda, `promptVersion` ile versionlu; admin tarafından düzenlenemez (audit)
- **`User.role` enum kararı** (§7 soru 26): "Product Manager" + "Customer Success Lead" şu an enum'da yok; Phase 4c başlamadan önce karar gerekir

**Çıktı**: Aynı veri, 4 farklı persona için farklı vitrin. CEO, PM, CS Manager, Account Manager hepsi kendi dilinde konuşan dashboard görür.

#### Tüm AI endpoint'leri için ortak guard'lar (her iki phase)

- **AI sayı hesaplamaz** (§2.6.1): snapshot zaten hesaplanmış değerleri içerir; AI **narrate** eder
- **Server-side scope derivation** (§2.2A): body filter scope'u genişletemez
- **Evidence cross-check**: response `evidence.caseIds` scope.companyIds ile doğrulanır; **scope dışı caseId** veya **snapshot'ta olmayan sayı** → reject + log warn + nötr fallback
- **Number regex cross-check** (§2.7.4): response metni içindeki sayılar `evidenceUsed` array'ine karşı doğrulanır; eşleşmezse reject
- **`minSampleViolations` AI gate** (§2.6.7): yetersiz veri olan metric'ler hakkında AI konuşamaz
- **People-safe language post-filter** (§2.7.5): yasak terim listesi (TR + EN); ihlalde reject + AIUsageLog `rejectedReason='unsafe_people_language'`
- **`metricAuditId`** her response'ta

#### Rate limit (mevcut `rateLimit` middleware)

| Endpoint | Per-user limit |
| --- | --- |
| `operations-brief` | 5/dk |
| `operations-insights` | 5/dk |
| `operations-explain-metric` | 10/dk |
| `operations-explain-segment` / `-delta` / `-suggest-action` | 10/dk |
| `operations-chat` | 20/dk |
| `operations-drilldown-assist` | 5/dk |
| `operations-report-draft` / `report-studio` | 2/dk |

Tüm AI endpoint'ler **5-10 dk in-process cache** (`scopeFingerprint + filterFingerprint + endpoint + sectionKey`).

#### Fail-safe + adoption

- AI 503 → ilgili kart amber state "AI önerisi alınamadı"; dashboard etkilenmez
- 👍/👎 feedback her AI kartında — AIUsageLog `accepted` flag (mevcut pattern)
- AI Usage analytics page'inde RUNA endpoint'leri için adoption + rejection rate görülür

#### Çıktı

Dashboard **AI Fabric** ürün vaadini taşır:
- RUNA üstte (Command Strip), arada (Insight Cards), section'larda (Contextual Actions), drill-down'da (Assistant), report'ta (Studio)
- Metrikler **deterministic** (§2.6); AI sadece yorum/öneri/anlatım
- People-safe dil + scope-bound + evidence-cited (§2.7 + §2.8)

### Phase 4b (genişletilmiş) — Report Studio core formatlar (Markdown/HTML/Mail)

§2.10'da tanımlanan Report Studio'nun **minimum viable** versiyonu Phase 4b'ye dahildir:

- `POST /api/analytics/cases/export-preview` + `POST /api/analytics/cases/export`
- Format: **Markdown**, **HTML**, **Mail draft (.eml)** — server-side composition
- `server/analytics/reportComposer.js` (yeni dosya — tek kaynak helper; tüm format renderer'lar buradan akar)
- `ReportGenerationLog` tablo migration + her oluşturma row yazar
- `<ReportStudioModal>` 5-adım wizard UI (§2.10.1)
- 5 template (executive-brief, product-friction, cs-efficiency, customer-risk, sla-escalation)
- AI narrative on/off toggle; pure deterministic mode mevcut
- Number regex doğrulama (§2.7.4) + people-safe filter (§2.7.5)
- Scope label + audit footer her format'ta

### Phase 5a — PDF export + Scale hardening (1 PR + ops)

- **PDF export** (Puppeteer veya pdfkit) — `renderPdf` helper:
  - Vercel serverless'ta 10s limiti riskli → "Async job" pattern: küçük raporlar sync (< 5 sayfa), büyük raporlar async (job tablo + email notification + 24h TTL signed URL)
  - Opsiyonel: ayrı microservice (Render.com / Railway) — eğer Vercel function süresi yetmez
- 800 agent / 30K-40K daily case fixture seed (`db:seed:scale-load` — yalnız stress test)
- p95 latency hedefi: overview < 600ms, drilldown < 800ms, AI insights < 4s, PDF (≤ 5 sayfa) < 6s
- Eksik index'ler + raw SQL EXPLAIN ANALYZE
- In-process cache yetmezse Redis/Upstash — opsiyonel
- `BacklogSnapshot` günlük cron (opsiyonel — `backlogChangePct` approximate flag'ini kaldırmak için)
- Load test sonuçları → `docs/SCALE_READINESS.md`

### Phase 5b — XLSX/CSV export + async job altyapısı (1 PR)

- **XLSX/CSV export** — `exceljs` / `csv-stringify`
- **`ExportJob` audit + queue** (yeni tablo): büyük export'lar async; status pending/processing/complete/failed; 24h TTL signed URL
- Cleanup cron: 24h sonra dosya silme
- `<ReportHistoryDrawer>` UI — kullanıcının geçmiş raporları + tekrar indirme
- **Çıktı**: enterprise data export — Power BI / Tableau ingest hazır

### Phase 6 — PPTX export + Scheduled reports (gelecek — opsiyonel)

- **PPTX slide deck** (`pptxgenjs`) — executive review meeting için
- **Scheduled reports** — kullanıcı "Her Pazartesi sabahı Executive Brief üret + mail at" planlayabilir
- Design ekip iş birliği gerekir (PPTX template hazırlığı)

---

## 4. Risk analizi

| # | Risk | Etki | Mitigation |
| --- | --- | --- | --- |
| R1 | **Data volume**: 30K case/gün × 90g aralık = 2.7M+ satır taranır. Yanlış index → 5–10s+ sorgu. | Dashboard kullanılmaz | Composite indexler (Phase 1); raw SQL CTE + EXPLAIN ANALYZE (Phase 5); 90 gün üst sınır + tarih range zorunlu |
| R2 | **Slow query / serverless timeout**: Vercel function 10s, beklenmedik filter (örn. tüm şirket × 90g) bunu aşar. | 504 → kullanıcı boş ekran | Per-section parallel query (Promise.all); kötü-case'leri kısa kessin (örn. category breakdown top 20 cap); query timeout = 8s + partial response |
| R3 | **AI cost / abuse**: 800 supervisor × dakikada 1 insight çağrısı = $$$ + rate limit | OpenAI fatura şoku | Per-user rate limit (1 dk 3 çağrı); 5 dk in-process cache; filterFingerprint dedup; AI snapshot küçük (top 5 breakdown yeter) |
| R4 | **Stale data**: Cache 30 sn → ops manager 30 sn eski veri görür. Pattern alert ile çelişkili olabilir. | Algı: "tutarsız" | Üst-sağda "Son güncelleme: 12 sn önce" + Yenile butonu; pattern alert'ler ayrı endpoint (real-time) |
| R5 | **Tenant leakage**: Drilldown vakaları companyId IN allowedCompanyIds filtresi atlanırsa cross-tenant sızıntı | P0 güvenlik | Aggregator helper'ı **tek noktada** filtreyi uygular (`narrowToAllowed`); her endpoint test'i bunu doğrular; raw SQL'lerde `companyId = ANY($1)` parametresi zorunlu |
| R5b | **Role-scope bypass**: Agent body'de team filter göndererek başka agent vakalarını görmeye çalışır | P0 güvenlik | `deriveAnalyticsScope` her endpoint'in **ilk satırında** çağrılır + body filter sadece **scope içinde daraltma** yapar (genişletemez); test matrisi §2.2A'da |
| R5c | **AI cross-tenant payload**: AI insight prompt'una scope dışı caseId/snapshot gönderilirse model hallucination + veri sızıntısı | P0 güvenlik | Snapshot server-side **scope-bound** üretilir; AI response `evidence.caseIds` scope.companyIds ile cross-check edilir; CSLeadership/SystemAdmin haricinde cross-tenant prompt yasak |
| R5d | **Filter UI sızıntısı**: Agent UI'da tüm şirket dropdown'unu görür ve seçer (frontend cache'inden lookup) | P1 güvenlik | Filter dropdown'ları `allowedFilters` (server-driven) ile beslenir; lookup cache'inden filter yasak |
| R5e | **Export abuse**: Düşük rol export endpoint'ini çağırır veya cross-company export yapar | P0 güvenlik | `scope.canExport` + `scope.canCrossCompanyAgg` gate; export job audit (ExportJob audit table); 100K satır cap |
| R6 | **Index bloat**: 6 yeni composite index = ~6× write amplification (her case insert/update). Yazma yükü 800 agent için kritik. | Insert latency artışı | Index'ler **selective** seçildi (companyId + 1-2 boyut); `slaViolation` partial index. Phase 1 deploy sonrası Supabase Postgres index size monitör |
| R7 | **Migration süresi**: 2.7M satırda `CREATE INDEX` 10-30 dk sürebilir, lock alır | Prod downtime | `CREATE INDEX CONCURRENTLY` (Supabase manual SQL); ya da pre-launch DB için anlamlı boyuta gelmeden |
| R8 | **Recharts bundle size**: zaten 1.3MB bundle var, daha fazla chart eklemek frontend perf'i bozar | Sayfa açılış yavaşlığı | Lazy-load OperationsDashboardPage (mevcut bundle-splitting önerisi); chart'ları dynamic import |
| R9 | **Filter fingerprint collision**: aynı hash farklı filter'a denk gelirse cache yanlış sonuç verir | Veri tutarsızlığı | Stable JSON.stringify + sha256; collision olasılığı astronomik düşük; doğrulama amaçlı filter set'i response'a echo et |
| R10 | **AI hallucination on KPIs**: insight "Stokbar şikayetleri 2.3× arttı" derken metrik yanlış olabilir | Yanıltıcı bilgi | Evidence-based output: AI sadece snapshot içindeki metrik'ten alıntılar yapabilir; strict JSON schema; sadece **gerçek caseIds** + **gerçek metric** referans alır; **AI sayı hesaplamaz** (§2.6.1) |
| R11 | **Metric formula divergence**: UI ile export farklı sayı verir (ayrı SQL veya client-side calc) | Performans değerlendirmesi yanlış sonuç doğurur | §2.6.8 tek-kaynak ilkesi — tüm yüzeyler `operationsAggregator` helper'ından geçer; ayrı SQL **yasak**; golden fixture testleri her PR'da koşar |
| R12 | **Formula değişikliği geriye dönük**: v2 formula eski raporları "yeniden hesaplar", PM "rakamım değişti" der | Güven kaybı | `formulaVersion` her response'ta; v2'ye geçişte v1 erişilebilir kalır; MetricQueryAudit ile her response replay edilebilir |
| R13 | **Yetersiz veri ile karar verme**: `n=2` agent için QA ortalaması gösterilir, kariyer kararı verilir | İnsani etki | Min sample threshold (§2.6.7); altında ise "Yetersiz veri" badge + AI bu metric'i konuşmaz |
| R14 | **Timezone hatası**: Gece 23:55 vakası "ertesi güne" düşer, agent'a yanlış kredi | Yanlış atfetme | `AT TIME ZONE 'Europe/Istanbul'` tüm time series'ta; DST regresyon testi (§2.6.9 edge case) |
| R15 | **Rounding tutarsızlığı**: Aynı veri farklı yerde `8.7%` vs `8.65%` görünür | Algı: "sistem hesap bilmiyor" | §2.6.3 rounding kuralları doc'ta donmuş; ortak `roundPct`, `roundHours` helper'lar tek noktada |
| R16 | **`avgTtrHours` pause süresi kafa karışıklığı**: Bir formül "net çalışma", diğeri "wall-clock"; PM hangisini gördü? | Audit/itiraz | Tek formül (`avgTtrHours` = pause çıkarılmış net); wall-clock istenirse ayrı metric (`avgTtrWallClockHours`) eklenir, asla aynı isim altında değiştirilmez |
| R17 | **AI HR-uygun olmayan dil**: agent-bazlı insight'ta "kötü performans", "yetersiz", "uyarı verilmeli" gibi cümle çıkar | Disiplin/HR riski; çalışan haklarının ihlali | §2.7.5 prompt safety rules + 10 system prompt kuralı + server-side forbidden language post-filter; reject + nötr fallback; AIUsageLog `rejectedReason='unsafe_people_language'` |
| R18 | **AI tahmin/kehanet**: "Yarın 8 SLA ihlali olacak" gibi kesin gelecek tahmini | Yanıltıcı + kararı AI veriyor algısı | Prompt'ta "tahmin yapma, mevcut veriyi yorumla" zorunlu; response post-filter "olacak", "kesinlikle" gibi kelimeleri taramak (Phase 5+) |
| R19 | **AI sayı uydurması**: AI report draft'ında snapshot'ta olmayan sayı yazar | Audit ihlali + güven kaybı | §2.6.1 zorunlu + §2.7.4 server-side regex tarayıcı (`%?\d+`) snapshot evidenceUsed'a karşı doğrular; eşleşmezse reject |
| R20 | **AI bağlam yanıltma — başka kapsamdan konuşma**: scope=PARAM iken AI Univera'dan örnek verir | Cross-tenant + scope ihlali | Prompt'ta scope açıkça gömülür + response caseId'leri scope.companyIds ile cross-check; ihlalde reject |
| R21 | **AI kararı yöneticinin yerine geçer algısı**: "AI dedi ki Pınar'ı uyar" → otomasyon olarak alınır | Hukuki + etik | "Bu bir öneridir, karar yöneticinindir" disclaimer zorunlu; report draft'ında çift "TASLAK" etiketi; AI HR aksiyonu önermez (§2.7.5 K1, K7) |
| R22 | **AI rate-limit aşımı (mass usage)**: 800 supervisor × 5 explain/dk = OpenAI fatura şoku | Maliyet | Per-user rate limit (§Phase 4); 5-10 dk cache scopeFingerprint+filterFingerprint+metric ile; AIUsageLog kotalama |
| R23 | **Geri bildirim olmadan körlük**: AI yardımcı mı, kullanıcı kullanıyor mu? | Adoption belirsizliği | 👍/👎 feedback `accepted` flag mevcut; AI Usage dashboard'unda adoption + rejection rate görülür |
| R24 | **AI Fabric noise / cognitive overload**: 5+ insight card + Command Strip + per-section AI action → sayfa boğulur, kullanıcı yorulur | Adoption düşüşü, AI'a güven kaybı | Insight card'lar yalnız **tetiklendiğinde** render (boş "sapma yok" kart yasak); collapsed Command Strip default opsiyonu; per-section menu açılır-kapanır, baskın değil; §2.8.7 gimmick yasağı |
| R25 | **AI Fabric latency yığılması**: Brief + 5 insight + her section'da Explain çağrısı → page load'da 6-10 paralel AI request | p95 > 5s, kullanıcı yavaş hisseder | Brief ve insights tek endpoint'ten gelir (`operations-brief` insight'ları içerir); Contextual actions **on-demand** (tıklayınca); page load AI çağrısı maksimum 1 (brief) |
| R26 | **Vendor lock / OpenAI dependency**: AI Fabric Brief+Insights+Studio şu an OpenAI'ya bağlı; downtime'da tüm "AI-first" deneyim çöker | İş etkisi büyük (dashboard hâlâ deterministic çalışsa da pazarlama vaadi kırılır) | AI fail amber state mevcut; uzun vade için provider abstraction layer (§ARCHITECTURE.md TBD) — Phase 5+ |
| R27 | **Report Studio export şişmesi**: Studio "Agent dağılımı + Customer pulse top 10 + tarihsel kıyas" hepsini seçen kullanıcı → 50+ sayfa output | Karmaşa + AI cost | Section başına satır cap (top 20); max section sayısı = 6; AI'a giden snapshot küçültücü; "Bu kadar içerik manuel düzenleme gerektirir" uyarısı |
| R28 | **AI Insight tetik eşiklerinin manipülasyonu**: Eşik %20 PoP delta → kullanıcı "neden bu hafta yok" diye sorar | Algı "AI uyumadı" | Insight tetik eşikleri **doc'ta belirtilir** (§2.8.3 tablo); response metadata'sında `notTriggeredBecause: "PoP delta %12 (eşik %20)"` debug bilgisi opsiyonel; Phase 4b'de açılabilir/kapanabilir |
| R29 | **Lens narrative tutarsızlığı**: 4 lens AI prompt'unun aynı veriyi farklı yorumlaması beklenir ama sayıları farklı söyleyebilir (örn. "38 vaka" vs "yaklaşık 40") | Audit'te tutarsızlık + güven kaybı | §2.7.4 number regex doğrulama + §2.9.6 same-data-different-narrative fixture testi her PR'da koşar |
| R30 | **Lens prompt sürdürülebilirliği**: 4 lens × 5 endpoint = ~20 prompt; her biri ayrı bakım | Prompt drift, lens'ler arası tutarsızlık | Prompt'lar kodda + `promptVersion`; "shared base prompt" + lens-specific append yaklaşımı; lens prompt change → PR review zorunlu |
| R31 | **User.role enum eksikliği**: "Product Manager" + "Customer Success Lead" mevcut enum'da yok; Phase 4c başlamadan eklenmeli | Phase 4c blocked | Phase 4c prework: enum migration (`ProductManager`, `CustomerSuccessLead`) + UserCompany.role expansion + lens permission seed |
| R32 | **Lens drift over time**: Tek lens kullanılmaya, diğerleri bakımsız kalmaya başlarsa fixture testler eskir | Bozulan lens'ler | Adoption metric'i AIUsageLog'tan: hangi lens hangi rolle kaç kez kullanıldı; bakımsız lens'ler için "Bu lens 90 gündür kullanılmadı, deprecate edelim mi" şeklinde quarterly review |
| R33 | **Lens UX karmaşıklığı**: 4 tab, lens-aware section show/hide → kullanıcı kafa karışıklığı yaşar ("Az önce gördüğüm metrik nereye gitti?") | Kullanıcı kaybolması | Lens switch sırasında **kısa toast** "Bu lens'te X section gizlendi" (5 sn); preference local storage; on-boarding tooltip (ilk kullanıcı için) |
| R34 | **PDF render Vercel timeout**: Puppeteer 10s function limit'i aşar | PDF üretilemez | Sync sadece ≤ 5 sayfa rapor; büyükler async job (Phase 5b queue); fallback Markdown export'a düş + toast |
| R35 | **Export sayı tutarsızlığı (UI ≠ PDF/XLSX)**: Farklı format renderer'lar farklı snapshot'tan beslenirse | Audit ihlali | Tek `reportComposer` helper; tüm renderer'lar aynı snapshot input alır; golden fixture test her format için (§2.6.8) |
| R36 | **Async job kaybolması**: Kullanıcı XLSX export başlattı, 5 dk sonra geri geldi, link yok | UX fail | `ExportJob` audit + in-app notification (mevcut bell sistemi); 24h TTL signed URL; "Geçmiş raporlarım" tab'ında görünür |
| R37 | **People-safe ihlal export'ta yakalanmadı**: AI narrative on/off + lens'e göre prompt farklı → bir lens kombinasyonunda yasak kelime kaçabilir | HR/etik risk | Export build sırasında `forbiddenLanguageFilter` run; ihlalde build fail + log + kullanıcıya "AI narrative üretilemedi, deterministic mode kullanın" |
| R38 | **Storage maliyeti**: PDF/XLSX büyük + persist edilirse Supabase storage şişer | Maliyet | Server-side persist **yok** (kullanıcı dosyaya iner); async job için 24h TTL temp storage; cleanup cron |
| R39 | **GDPR / personal data export**: Kullanıcı raporda agent ismini gördü → çalışan haklarının ihlali iddia edebilir | Hukuki | `ReportGenerationLog` audit ile kim ne zaman ne ürettiği izlenir; people-safe dil zorunlu; agent-level section role-gated; çalışan istediğinde kendine ait audit logları extract edilebilir |
| R40 | **PPTX template bakımı**: Slide template'leri design takımıyla senkron tutulmalı | Tasarım drift'i | PPTX Phase 6'ya defer; başlangıçta PDF/Markdown yeterli; design ekiple template review sonra |
| R41 | **UX subjective ölçüm zorluğu**: "Premium hissi" + "long-session yorgunluğu" subjective; PR'da kanıtlamak zor | Quality drift over time | Phase 2 sonrası 5-kullanıcı oturum testi (1 saat) + feedback form; her phase'in PR'ında light+dark screenshot zorunlu; anti-pattern audit code review checklist'i |
| R42 | **Dark mode regression**: Mevcut smoke audit Phase 3'te düzelttiğimiz dark mode kırıkları yeni component'lerde tekrar oluşur | Kalite degradation | `<KpiTile>`, `<ScopeBadge>`, vs. her primitive **light + dark** PR'da test edilir; Storybook (gelecek) veya screenshot diff testleri |
| R43 | **Chart bundle bloat**: Recharts + AI surface'ler + drill-down → bundle > 1.5MB | Sayfa load yavaşlığı | Lazy-load: dashboard route'u kendi chunk'ında (mevcut bundle splitting önerisi); Recharts dynamic import; eski Vaka Raporları'ndan farklı bundle |
| R44 | **Long-session yorgunluk gerçeği test edilmedi**: Doc subjective hedefler koydu ama gerçek yorgunluk ölçülmedi | Hedef kaçırma | Phase 2 sonrası 5-kullanıcı × 1 saat oturum (ekran kayıt + feedback); subjective gözle "yoruldum?" + scroll/click pattern analiz; Phase 5'te yeniden ölçüm |
| R45 | **Anti-pattern dökümanı drift**: §2.11.9 listesi güncellenmezse zamanla geçersizleşir | Dökümantasyon değer kaybı | Her major UX değişikliğinde §2.11.9 review zorunlu; PR template'inde "anti-pattern check" satırı |

---

## 5. Acceptance criteria

- [ ] **No client-side full case-list aggregation**: `caseService.list()` artık dashboard tarafından çağrılmaz; tüm KPI/breakdown server-side gelir
- [ ] **Hızlı yüklenme**: p95 overview latency < 600 ms (10K vaka fixture), < 1.2 s (100K vaka fixture)
- [ ] **Drill-down**: her KPI tile + her breakdown bar + her tablo satırı tıklanabilir → drawer açar
- [ ] **AI insights non-blocking**: overview yüklendikten sonra arka planda gelir; fail edince dashboard etkilenmez
- [ ] **Evidence-based AI**: her insight `evidence.caseIds` + `metric` taşır; "Vakaları gör" çalışır
- [ ] **Tenant isolation**: SystemAdmin/CSLeadership olmayan kullanıcı body'de farklı şirket istese bile sonuç **sadece kendi şirketlerini** kapsar
- [ ] **Role-based scope**: Agent yalnız kendi vakaları, Supervisor yalnız kendi takımı, Admin yalnız kendi şirketleri görür (silent narrowing, body filter scope'u genişletemez)
- [ ] **Cross-company aggregation**: yalnız CSLeadership/SystemAdmin için açık; `byCompany` breakdown diğer rollerde gizli
- [ ] **`response.scope` metadata**: tüm 3 endpoint'in response'unda `scope` alanı zorunlu; UI üst-sağda kapsam rozeti gösterir
- [ ] **`allowedFilters` server-driven**: filter dropdown'ları server'dan gelir; frontend lookup cache'inden filter setleme yasak
- [ ] **AI scope-bound**: AI snapshot scope-içi, response `evidence.caseIds` scope.companyIds ile doğrulanır; ihlalde insight reject + log
- [ ] **Export gate**: `scope.canExport` + cross-company export `scope.canCrossCompanyAgg` zorunlu; ExportJob audit row
- [ ] **Test matrisi (§2.2A son)** — 8 senaryo geçer
- [ ] **Empty / loading / error / stale states**: her tile için ayrı tanımlı; smoke audit Phase 3 dark mode kuralları uygulanır
- [ ] **Light + dark mode**: tüm chart'lar, KPI tile'ları, drawer dark variant'lı
- [ ] **Filter URL-syncable**: deep-link / refresh sonrası filter korunur
- [ ] **Pattern alert entegrasyonu**: dashboard üst bandında aktif pattern sayısı + tıklayınca PatternsPage'e veya drill-down'a gider
- [ ] **Smoke audit Phase 3 öğrendiğimiz UI kuralları** uygulanır: aria-label, optimistic-revert closure, empty/error state copy farkı

### Metric accuracy (§2.6 — non-negotiable)

- [ ] **AI sayı hesaplamaz**: her numerik değer deterministic backend sorgusundan; AI sadece narrate eder (§2.6.1)
- [ ] **Metric Dictionary** §2.6.2 implementation ile bire bir uyumlu; formula divergence yok
- [ ] **`formulaVersion`** her response'ta; v1 sabit, değişiklikte bump + golden fixture güncellenir
- [ ] **`metricAuditId`** her response'ta; `MetricQueryAudit` tablosu her endpoint çağrısında satır yazar
- [ ] **Rounding kuralları** §2.6.3'tekiyle aynı; `roundPct`/`roundHours` tek helper
- [ ] **Timezone** Europe/Istanbul tüm time series'ta; cross-midnight + DST regression testleri geçer
- [ ] **Drill-down traceability**: her sensitive metric tile'ında info icon + popover (formula/n/d/scope/asOf/auditId) + "Vakaları gör" link drilldown ile **bit-bit aynı** WHERE clause
- [ ] **Min sample threshold**: yetersiz veri durumunda "Yetersiz veri" badge; misleading precise değer gösterilmez
- [ ] **Approximation labeling**: kesinleştirilemeyen metric'ler `~` + tooltip; default value değil
- [ ] **Export = dashboard**: aynı aggregator helper; ayrı SQL yasak; footer'da audit metadata (§2.6.8)
- [ ] **Formula unit tests**: her metric için min 3 case (happy + null-divide + edge)
- [ ] **Golden fixture**: DEMO seed üzerinden donmuş JSON snapshot; her PR'da diff kontrol
- [ ] **Edge case matrisi** (§2.6.9 C) regression suite'de geçer: reopened, canceled, paused SLA, cross-midnight, unassigned, transferred, duplicate, multi-tenant, empty scope, period boundary
- [ ] **`METRIC_FIXTURES.md`** Phase 1 prework'ünde tamamlanır + repo'ya commit'lenir

### AI as Analyst Companion (§2.7)

- [ ] **Executive AI Brief** dashboard üstünde sticky; top 3 insight + scope rozeti + Yenile + Kapat (5 dk cache)
- [ ] **Explain This Metric** action her sensitive KPI tile info popover'ında (§2.6.5 listesi)
- [ ] **Ask RUNA About This View** chat panel view-context payload alır (scope/filter/snapshot/selectedBucket)
- [ ] **AI Report Draft** modal Türkçe profesyonel format, çift TASLAK etiketi, audit metadata + Kopyala/İndir
- [ ] **Insight card shape** zorunlu alanlar: title, severity, explanation, evidence chips, recommendedAction, scopeNarrative, generatedAt, metricAuditId
- [ ] **AI sayı uydurmaz**: response'taki her sayı snapshot evidenceUsed'a karşı doğrulanır (regex `%?\d+`); eşleşmezse reject
- [ ] **People-safe language post-filter**: yasak terim listesi (§2.7.5); ihlalde reject + log warn + AIUsageLog `rejectedReason`
- [ ] **Scope-bound prompts**: system prompt'a scope description + KURAL 1-10 gömülür
- [ ] **Trust UI affordances**: "Mevcut filtrelere dayanıyor" disclaimer, "Bu bir öneridir, karar yöneticinindir" footer kişi-bazlı insight'ta, "Veri yetersiz" badge, "AI taslağı" lozengesi
- [ ] **Feedback toplama**: 👍/👎 buton AIUsageLog `accepted` flag günceller (mevcut pattern)
- [ ] **People analytics test matrisi** (§2.7.6): "kötü performans / yetersiz / uyarı verilmeli" gibi cümleler **asla** çıkmaz; nötr alternatif çıkar
- [ ] **AI fail amber state**: 503 → dashboard çökmez, ilgili kart "AI önerisi alınamadı"

### AI Fabric — first-class actor (§2.8)

- [ ] **RUNA AI Command Strip** filter bar altında sticky band; top 3 risk + değişim + önerilen aksiyon + "Yönetici özeti hazırla" + "Bu dashboard hakkında sor" CTA'ları (§2.8.2)
- [ ] **5 tip Insight Card** dashboard içine dağılmış (SLA anomaly, Backlog buildup, Repeated issue, Customer risk cluster, Workload imbalance); tetikleme deterministic, AI yalnız narrate (§2.8.3)
- [ ] **Contextual AI menu** (`🤖 ▾`) her major section header'ında; 5 action minimum (Bu trendi açıkla / segment özetle / Ne değişti / Rapor hazırla / Sonraki aksiyon) (§2.8.4)
- [ ] **Drill-down RUNA assistant** drawer açıldığında otomatik özet + "incele önerisi" highlighted satırlar + ✉/⚠ CTA (§2.8.5)
- [ ] **AI Report Studio** dedicated mode: kapsam seçimi + içerik checkboxları + tone/dil + Önizleme/İndir; çıktıda audit metadata zorunlu, scope locked, numbers regex-validated (§2.8.6)
- [ ] **RUNA visual identity**: 🤖 ikon + violet palet + `<RunaSurface>` primitive tüm AI yüzeylerinde; gimmick yasağı (animasyonlu parıltı/neon yok); embedded-analyst estetik (§2.8.7)
- [ ] **`<RunaIcon>`** component (size + thinking variant); tek noktada
- [ ] **Trust chain UI**: her AI yüzeyinde scope rozet + Audit ID + "Üretildi" stamp + 🤖 lozengesi (§2.8.8)
- [ ] **People-safe örnek doğrulaması**: §2.8.8'deki Türkçe iyi/kötü çift örnek fixture testinde geçer
- [ ] **AI-first sayfa düzeni**: §1 mockup'una uygun; AI bir secondary widget değil, dashboard içine dokumentlu

### Persona Lens system (§2.9)

- [ ] **4 lens** mevcut: 🎯 Executive, 📦 Product, ⚙ Operations, 👥 Customer
- [ ] **`<LensSwitcher>`** dashboard üstünde; URL state (`?lens=…`) deep-link
- [ ] **Same data, different narrative**: 4 lens'te de KPI rakamları **birebir aynı** (sayı = backend, narrative = AI); §2.9.6 fixture testinde doğrulanır
- [ ] **Lens-aware insight tetikleri** (§2.8.3 ile uyumlu, lens'e göre eşik tweak): Customer'da repeated issue daha düşük threshold, Product'ta duplicate cluster ön planda, Operations'ta workload imbalance vurgulu
- [ ] **4 lens report template**: §2.9.5 (Executive Summary / Product Insight / CS Operations / Customer Risk) — her biri farklı tone + section sıralaması
- [ ] **Permission model** (§2.9.8): rol → default lens + görünür lens'ler; izinsiz lens URL'i silent narrow + fallback
- [ ] **Section visibility lens-aware** (§2.9.9): Product lens'te agent-level gizli, Operations'ta byCompany gizli, Customer'da team-distribution gizli
- [ ] **Lens prompt versionlama**: 4 lens × 5 endpoint = ~20 prompt; `promptVersion` ile bump'lı; kod-yönetimli (admin değişemez)
- [ ] **Aynı veri, farklı yorum testi**: aynı snapshot 4 lens'ten render edilince **sayılar değişmiyor, narrative değişiyor**

### Exportable Reports / Report Studio (§2.10)

- [ ] **5 lens-bazlı template**: executive-brief, product-friction, cs-efficiency, customer-risk, sla-escalation
- [ ] **5-adım Studio UX**: lens → scope → content checkboxes → AI on/off → format (§2.10.1)
- [ ] **Format phased rollout**:
  - Phase 4b: Markdown / HTML / Mail draft (.eml)
  - Phase 5a: PDF (sync küçük, async büyük)
  - Phase 5b: XLSX / CSV (async job)
  - Phase 6: PPTX (opsiyonel)
- [ ] **Tek kaynak `reportComposer`**: tüm format'lar aynı snapshot'tan; sayı tutarlılığı garantili (§2.10.2, §2.6.8)
- [ ] **Report content** zorunlu bölümler (§2.10.3): başlık + scope rozet + KPI tablo + trend + breakdown + AI narrative (opsiyonel) + drill-down evidence + appendix + disclaimer/audit footer
- [ ] **AI narrative on/off toggle**: kullanıcı pure deterministic rapor üretebilir
- [ ] **Scope label görünür**: başlık sayfasında "Scope: PARAM · Last 30 days · Support Team"
- [ ] **Number regex validation**: AI narrative içindeki her sayı snapshot evidenceUsed'a karşı doğrulanır; eşleşmezse build fail
- [ ] **People-safe filter**: AI narrative ihlal ederse export reject (§2.7.5)
- [ ] **`ReportGenerationLog` audit table**: her üretim (preview/download/failed) row yazar; 1 yıl retention min
- [ ] **Scope enforcement**: aynı `deriveAnalyticsScope` (§2.2A); export hakkı `scope.canExport=true` zorunlu
- [ ] **Cross-tenant export**: yalnız CSLeadership/SystemAdmin için
- [ ] **Section role-gating**: Agent dağılımı Admin+ checkbox; izinsiz seçim engellenir
- [ ] **TASLAK etiketi**: AI narrative dahilse başlık + footer çift gözükür
- [ ] **Async job altyapısı (Phase 5b)**: büyük export 24h TTL signed URL + cleanup cron
- [ ] **Disclaimer footer**: her formatta "AI yardımcı, metrikler yetkili"; AI'sız raporda "AI narrative dahil değil"

### Premium executive UX (§2.11)

- [ ] **5-katman hiyerarşi** uygulanır (Scope → AI Brief → KPI → Trend → Drill-down) — §2.11.2 layout
- [ ] **Spacing + typography scale** §2.11.3 tablolarına uygun; `tabular-nums` KPI sayılarında
- [ ] **Color palette semantic + restrained** — neutral baskın, her lens tek-tonlu değil; AI yalnız violet
- [ ] **Loading / empty / error states** standardize edilmiş skeleton + copy pattern (§2.11.4)
- [ ] **Chart design** §2.11.5 — max 4 series, donut 4+ segment yasak, axis labels küçük + grey
- [ ] **AI surface kalitesi** §2.11.6 — Command Strip / Insight Card / Drill-down assistant / Studio her biri premium violet palet + audit chip + evidence chip
- [ ] **Long-session usability** §2.11.7 — sticky scope chip, no autoplay animation, predictable layout, no auto-refresh, AA contrast min
- [ ] **Dark mode birinci sınıf** §2.11.8 — her surface light + dark eşit kalite; PR'da screenshot test zorunlu
- [ ] **Anti-pattern audit** §2.11.9 — code review checklist'te; 3D chart / rainbow / 50-row cramped table / animated sparkle / vs. yasak
- [ ] **Premium primitives** §2.11.10 — `<KpiTile>`, `<ScopeBadge>`, `<LensSwitcher>`, `<DrilldownDrawer>`, `<EmptyState>` standart; her component light+dark test edilir
- [ ] **Subjective UX validation** — Phase 2 sonrası 5 test kullanıcısı (Supervisor/PM/CS Manager/Admin/GM rolünde) ile 1 saat oturum testi; "yorgunluk" + "anlama hızı" feedback formu

---

## 6. Out of scope (bu doc kapsamı dışında)

- **PPTX slide deck**: Phase 6 — design ekip işbirliği gerekir; başlangıçta PDF yeterli
- **Scheduled reports** (Pazartesi sabahı otomatik mail): Phase 6 — opsiyonel; mail kanalı altyapısı gerekir (known limitation)
- **Custom KPI builder** / kullanıcı tanımlı widget: scope creep
- **Predictive analytics** (gelecek 24h trend tahmini): AI insights v2
- **Real-time WebSocket push**: şimdilik polling/refresh yeterli (audit notes)

---

## 7. Açık sorular → [docs/OPEN_DECISIONS.md](OPEN_DECISIONS.md)

**Canonical karar register'ı:** `docs/OPEN_DECISIONS.md`. Aşağıdaki 50 numbered soru **tarihsel referans** olarak korunmuştur — canlı statü için OPEN_DECISIONS.md'deki OD-XXX ID'leri (Q11 → OD-089 RESOLVED, Q26 → OD-172 OBSOLETE, geri kalanlar PENDING/DEFERRED) izleyin. Bu liste güncellenmez; yeni karar verildiğinde **önce** OPEN_DECISIONS.md güncellenir.

> _Aşağıdaki 50-soru listesi 2026-05-27 PR-C oluşturma anındaki snapshot'tır; yalnız tarihsel referans amaçlıdır. Her sorunun bireysel OD-XXX karşılığı OPEN_DECISIONS.md'de §"5. Analytics / Reporting" ve §"7. Architecture / Operations" + §"8. UX / Help / Quality" bölümlerinde dağılmış durumda._

1. **Granularity hour vs day**: 7 günden kısa aralıkta hour, fazla aralıkta day mı? Yoksa kullanıcı seçimi mi? (Önerilen: otomatik — aralık ≤ 7g → hour)
2. **Top N kaç olsun**: Top 10 takım, top 20 kategori, top 10 müşteri yeterli mi? Çoğu enterprise dashboard 10 ile başlar; "Tümünü gör" link'i drill-down açar.
3. **Saat dilimi**: Tüm metrikler `Europe/Istanbul` timezone'da göster (Action Summary'deki kural). Backend UTC, frontend convert.
4. **Eski "Vaka Raporları" page'i ne olacak?** Phase 2'de yeni page ile aynı sidebar entry'sine devralacak mı, deprecated banner mı?
5. **AI insight prompt versionlama**: Insights output şeması zamanla evrilirse client-side cache invalidation nasıl? Önerilen: response'ta `promptVersion: "v1"` alanı.
6. **CSLeadership rolü**: `User.role` enum'una `CSLeadership` eklemek mi yoksa `crossTenantAnalytics` Boolean flag mi (§2.2A'da seçim "enum"). Onay bekliyor.
7. **Supervisor takım eşlemesi**: Mevcut DB'de "supervisor → yönettiği takımlar" lookup'ı net değil. Iki yol: (a) UserCompany.role='Supervisor' olduğu şirketin **tüm** takımları (geniş), (b) Person/Team modeline `supervisorId` eklemek (precise, migration). Hangisi?
8. **Drilldown 403 vs silent narrow**: Agent başka takım için drill-down isterse 403 mı dönsün (açık reject) yoksa silent 0-result + scope metadata mı (UX dostu)? Default önerilen: **silent narrow + scope metadata**. Onay?
9. **`firstResponseTimeMin` field eklensin mi?**: Şu an `Case.firstAgentResponseAt` yok. Eklenirse: (a) schema migration + cron backfill veya (b) "Eklenince aktif olur" şeklinde gizli/disabled metric. Hangisi? (§2.6.2)
10. **`avgTtrHours` formülü — pause süresi çıkar mı?**: Doc'ta "net çalışma süresi" (pause çıkarılır) seçildi. Wall-clock alternatifi de eklenmeli mi (ayrı metric `avgTtrWallClockHours`)? PM'in beklentisi hangisi? (§2.6.2, R16)
11. ~~**`reopenRatePct` denominator**~~: **Karar verildi (Phase 1).** Resolved-based payda — period içinde çözülen vakalardan kaçı sonradan reopen oldu. Quality signal semantiği ile uyumlu. (§2.6.2 reopenRatePct + Phase 1 blocker kararı §5)
12. **`MetricQueryAudit` retention**: Audit row'ları sınırsız tutulsun mu, yoksa 90 gün cleanup cron'u eklensin mi? PM/HR şikâyetlerinde 1 yıl önceki rapor talep edilebilir.
13. **Min sample thresholds**: §2.6.2'de tahmini değerler (5, 10, 20). Domain expert/HR onayı gerekli — özellikle QA score (n=5 az olabilir).
14. **`BacklogSnapshot` cron**: Phase 5 opsiyonel diye işaretlendi. Eğer "yaklaşık ~" prefix kabul edilmiyorsa Phase 1'e çekilebilir (daha büyük scope). PM kararı.
15. **AI Brief frekansı**: Brief sticky kalsın mı yoksa dismiss sonrası kullanıcı manuel açsın mı? Default: sticky + dismiss → 24h hide. Onay?
16. **AI Report Draft tone presetleri**: "executive" + "operational" yeterli mi yoksa "technical / detailed / summary" gibi ek preset? PM önerisi?
17. **AI Report Draft language**: Default Türkçe. Çok dilli (TR/EN) Phase 4'te mi yoksa sonraya mı?
18. **People-safe forbidden list bakımı**: Yasak terim listesi config dosyasında mı (admin tarafından güncellenebilir) yoksa kodda mı (PR ile güncellenir)? Önerilen: kodda (audit + review zorunlu).
19. **AI Brief — admin role'ler**: Brief CSLeadership için cross-tenant insight'lar göstermeli mi (örn. "PARAM'da SLA Univera'ya göre 2× kötü") yoksa her tenant'ı ayrı mı? PM kararı.
20. **Feedback (👍/👎) — sonuç**: Bu feedback AI prompt'unu zamanla iyileştirmek için mi kullanılacak (fine-tune / prompt tune) yoksa sadece monitoring mu? Phase 5+ kararı.
21. **Insight tetik eşikleri**: §2.8.3 tabloda sezgisel değerler (SLA +20%, Backlog +15%, Repeat ≥5/24h, Customer ≥3 açık+pulse, Workload std-dev × 1.5). Domain uzmanı (Ops Manager) onayı gerekli; eşikler config'e mi (admin tunable) yoksa kodda mı?
22. **Command Strip default state**: Sticky band default expanded mi yoksa collapsed mi başlasın? Cognitive overload riski (R24) için collapsed öneriliyor mu? PM kararı.
23. **AI Fabric — Agent rolü**: Agent için AI yüzeyi ne kadar görünür? §2.8.4 contextual actions Supervisor+ olarak işaretlendi. Agent için sadece "Bu metrikim ne anlama geliyor?" gibi kişisel explainer açık mı yoksa AI Fabric tamamen Supervisor+ mı? PM kararı.
24. **Report Studio output formatı önceliği**: Markdown / HTML / .eml ilk versiyon yeterli mi yoksa PDF Phase 4b'ye çekilsin mi? PDF Puppeteer/pdfkit setup gerekir.
25. **`<RunaSurface>` primitive — yeniden kullanım**: Bu surface'ler mevcut `RunaAiCard`/`RunaAiChatPanel`'i replace mi edecek yoksa yan yana mı duracak? Eski component'lerin sidelined edilmesi büyük bir refactor — Phase 4a kapsamına dahil mi (önerilen) yoksa ayrı bir Phase 4c mi?
26. **`User.role` enum genişlemesi**: §2.9.8 permission tablosu "Product Manager" + "Customer Success Lead" rollerini varsayar. Mevcut enum'da yok. Phase 4c başlamadan migration gerekir. Önerilen: enum'a `ProductManager` + `CustomerSuccessLead` ekle (CSLeadership örneğine benzer). Onay?
27. **Lens default örtüşmesi**: Bir kullanıcı "Operations" rolündeyken "Customer" lens'i kullanmak isterse görmeli mi? §2.9.8'de "read-only" şeklinde işaretlendi. Tam görünür mü, kısıtlı mı (örn. yalnız özet bölüm)?
28. **Lens cache stratejisi**: Aynı snapshot 4 lens'ten farklı AI narrative üretir → 4× cache key (snapshot+lens). Cache hit oranı düşer. Bu kabul edilebilir mi yoksa lens'leri tek prompt + lens output formatting şeklinde mi yapılsın? (Daha az cache miss ama tek prompt karmaşık olur.)
29. **Lens-specific report saklama**: §2.9.5'teki 4 şablon Studio'da on-demand mı yoksa "Her Pazartesi otomatik üret + arşivle" özelliği de gerek mi? Phase 5+ kararı.
30. **Cross-lens drill-down**: Customer lens'te bir müşteriye tıkladığımda Operations lens'e mi geçeyim yoksa aynı lens'te kalıp müşteri detayı mı? UX kararı. Önerilen: aynı lens'te kal; ayrı bir "Operasyonu Gör" butonu lens switch yapsın.

### Report Studio / Export soruları

31. **PDF rendering altyapısı**: Puppeteer mı (browser-based, daha güvenilir layout) yoksa `pdfkit` mi (Node-native, daha hızlı, daha az feature)? Vercel function 10s limiti hangi seçenekte güvenli kalır? Pre-implementation karar gerekir.
32. **Async export job kuyruğu**: Mevcut altyapıda job queue yok. Seçenek: (a) Supabase Postgres `ExportJob` tablo + cron worker, (b) Vercel Cron + 1 endpoint, (c) ayrı microservice (Render/Railway). Phase 5b prework.
33. **Report retention**: `ReportGenerationLog` 1 yıl min önerildi. HR/audit talepleri için 3 yıl mı? Cron cleanup eşik kararı.
34. **Scope label dilini lokalize et**: Türkçe rapor → Türkçe label; İngilizce rapor → İngilizce. Otomatik mi yoksa kullanıcı seçimi mi?
35. **Mail draft (.eml) → SMTP gönderme**: Şu an `.eml` indirilir (kullanıcı mail client'a açar). Doğrudan SMTP ile gönderme isteği var mı? Phase 6+ (mail kanal altyapısı gerekir — known limitation).
36. **PPTX template design**: Slide deck template'ini hangi ekip hazırlayacak? Marketing/Design ekibi mi yoksa product team mi? Phase 6 öncesi.
37. **AI narrative for SLA/Escalation Report**: Bu cross-lens template; AI hangi lens'in tonu ile narrative yazsın? Önerilen: Operations base + Executive overlay (kısa özet üstte, detay altta).
38. **"Pure deterministic" mod isimlendirmesi**: AI'sız raporun UI'da etiketi ne olsun? "AI narrative dahil değil" / "Yalnız deterministik" / "Raw KPI raporu"? PM kararı.
39. **Drill-down evidence rapor içinde**: §2.10.3 Bölüm 7'de "caseNumber listesi" önerildi. PDF'te tıklanabilir link (dashboard URL'i) yeterli mi yoksa rapor offline okunabilir olmalı (full case detayı embed)? Boyut/usability trade-off.
40. **Audit footer'da "düzenlemeler"**: AI çıktısını kullanıcı modife ederse rapor footer'da "Düzenlendi: Demir Han · 13 May" notu çıksın mı? Default önerilen: evet — şeffaflık için.

### Premium UX (§2.11) soruları

41. **5-kullanıcı oturum testi planı**: Phase 2 sonrası kim test eder, hangi sürede, hangi feedback toplama yöntemi (form / interview / screen recording)? PM kararı.
42. **Page max-width**: Doc'ta 1280-1680px aralığı önerildi. Geniş ekranlar 4K monitor) için 1920+ destek gerekir mi? Önerilen: hayır — cockpit hissi için constrained kalsın.
43. **Mobile responsive yatırımı**: ROADMAP'te "not mobile-first" diyor. Dashboard tablet (768-1024px) için ne kadar adapte? Yöneticiler tablet kullanır mı? PM kararı.
44. **Storybook / component docs**: Premium primitive'ler (KpiTile, ScopeBadge, vs.) için Storybook kurulsun mu? Adoption'a katkı sağlar mı bakım yükü? Phase 5+ kararı.
45. **Auto-refresh yok kuralı**: Doc'ta auto-refresh yasaklandı (long-session konforu için). Critical Ops kullanıcısı "5 dk'da bir otomatik yenilesin" isterse kullanıcı tercihi olarak açılabilir mi? Hidden setting önerilir.
46. **Subjective "premium hissi" kalite kontrolü**: Doc'taki anti-pattern listesi bağlayıcı. PR review'da kim "anti-pattern var" diye işaretler? Önerilen: PR template'inde checklist (PR açan da diğer reviewer da işaretler).
47. **Animation library**: Subtle transitions için Framer Motion eklensin mi yoksa Tailwind transition'larıyla yetinilsin mi? Framer Motion +30KB bundle. Önerilen: Tailwind yeterli; framer sadece drawer slide gibi karmaşık karelerde gerekir.
48. **Print stylesheet**: §2.11.7'de print-friendly @media rule eklendi. Bu Phase 2'de mi yoksa Phase 5+'da mı? PDF export geldiğinde print'e ihtiyaç azalır — defer önerilir.
49. **Accessibility (a11y) hedefi**: Doc AA contrast minimum dedi. WCAG 2.1 AA tüm dashboard? Screen reader uyumu? Phase 5'te dedicated audit?
50. **Empty state copy lokalizasyonu**: Tüm copy Türkçe; İngilizce desteklenecekse her empty state için EN string + i18n setup. Phase 4c (lens'lerle birlikte language toggle) sırasında mı eklensin?

Bu sorulara cevap alınmadan **Phase 1'e başlanmaz**.

---

## 8. Sonraki adım

Bu doküman onaylanır onaylanmaz:
1. **Açık sorulara cevap** (yukarıdaki §7)
2. **Phase 1 PR** — backend overview endpoint + 6 composite index migration
3. Migration ve endpoint dev'de doğrulandıktan sonra Phase 2'ye geçilir

Her phase ayrı PR; her phase sonunda smoke test + merge + release.
