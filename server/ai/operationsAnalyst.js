/**
 * Operations Intelligence — AI Analyst helpers (Phase 4a)
 *
 * docs/OPERATIONS_DASHBOARD_DESIGN.md §2.8 (AI as Analyst Companion)
 *
 * AI rolü: scoped deterministic snapshot uzerinden Turkce ozet/insight uretmek.
 * AI metric HESAPLAMAZ; sadece anlatim, oncelendirme ve aksiyon onerisi yapar.
 *
 * Bu modul:
 *   - buildOperationsSnapshot(scope, payload, filters): AI'a verilecek kompakt snapshot
 *   - buildBriefPrompt / buildInsightsPrompt / buildExplainPrompt / buildReportPrompt
 *   - sanitizeBrief / sanitizeInsights / sanitizeExplain / sanitizeReport
 *
 * Her sanitize* fonksiyonu AI'in dondurdugu json'u istenen shape'e zorlar:
 * eksik alanlari default'larla doldurur, fazlaliklari atar. Bu sayede AI'in
 * "yaratici" cikislari frontend type'ini bozmaz.
 */

const ALLOWED_METRIC_KEYS = new Set([
  'totalCases',
  'openCases',
  'createdInPeriod',
  'resolvedInPeriod',
  'slaRiskCount',
  'slaViolationRatePct',
  'avgResolutionWallClockHours',
  'reopenRatePct',
  'escalationRatePct',
  'transferRatePct',
  'retentionSuccessPct',
]);

const ALLOWED_INSIGHT_TYPES = new Set([
  'sla-anomaly',
  'backlog-buildup',
  'repeated-issue',
  'customer-risk-cluster',
  'workload-imbalance',
]);

const ALLOWED_INSIGHT_SEVERITIES = new Set(['info', 'warning', 'critical']);

const ALLOWED_BUCKET_KINDS = new Set([
  'totalCases', 'createdInPeriod', 'resolvedInPeriod', 'openCases',
  'slaRiskCount', 'slaBreached', 'slaViolationRatePct', 'reopened',
  'reopenRatePct', 'escalationRatePct', 'transferRatePct', 'retentionSuccessPct',
  'status', 'priority', 'caseType', 'team', 'company', 'category', 'atRiskAccount',
]);

const METRIC_FORMULAS = Object.freeze({
  totalCases: 'COUNT(vaka) WHERE createdAt ∈ [from, to)',
  openCases: 'COUNT(vaka) WHERE status ∈ {Acik, Incelemede, ThirdPartyWaiting, Eskalasyon, YenidenAcildi} (snapshot, donemden bagimsiz)',
  createdInPeriod: 'COUNT(vaka) WHERE createdAt ∈ [from, to)',
  resolvedInPeriod: 'COUNT(vaka) WHERE resolvedAt ∈ [from, to)',
  slaRiskCount: 'COUNT(vaka) WHERE acik AND SLA dolmadan once 4 saatten az kaldi AND ihlal degil AND pause yok',
  slaViolationRatePct: '100 * COUNT(cozulen & slaViolation) / COUNT(cozulen) — payda: donemde cozulen vakalar',
  avgResolutionWallClockHours: 'AVG(resolvedAt - createdAt) saat cinsinden — pause cikarilmaz (wall-clock)',
  reopenRatePct: '100 * COUNT(cozulen & yenidenAcildi) / COUNT(cozulen) — kalite sinyali',
  escalationRatePct: '100 * COUNT(acilan & escalationLevel != Yok) / COUNT(acilan)',
  transferRatePct: '100 * COUNT(acilan & transferCount > 0) / COUNT(acilan)',
  retentionSuccessPct: '100 * COUNT(Churn & retention=Basarili) / COUNT(Churn & retention karar verilmis) — DevamEdiyor hariç',
});

// ──────────────────────────────────────────────────────────────────
// Snapshot builder
// ──────────────────────────────────────────────────────────────────

/**
 * AI'a verilecek kompakt, tip-temiz snapshot. Raw vaka aciklamasi/notu YOK —
 * sadece aggregated KPI + breakdown + scope metadata.
 */
export function buildOperationsSnapshot(scope, payload, filters) {
  const pickKpi = (k) => {
    const m = payload.kpis?.[k];
    if (!m) return null;
    return {
      value: m.value,
      deltaPct: m.delta?.value ?? null,
      direction: m.delta?.direction ?? null,
    };
  };
  return {
    period: { from: filters.from, to: filters.to },
    scope: {
      kind: scope.scopeKind,
      narrative: payload.scope?.narrative ?? null,
      canCrossCompanyAgg: !!scope.canCrossCompanyAgg,
      companyCount: scope.companyIds?.length ?? 0,
    },
    formulaVersion: payload.formulaVersion ?? 'v1',
    timezone: payload.timezone ?? 'Europe/Istanbul',
    kpis: {
      totalCases: pickKpi('totalCases'),
      openCases: pickKpi('openCases'),
      createdInPeriod: pickKpi('createdInPeriod'),
      resolvedInPeriod: pickKpi('resolvedInPeriod'),
      slaRiskCount: pickKpi('slaRiskCount'),
      slaViolationRatePct: pickKpi('slaViolationRatePct'),
      avgResolutionWallClockHours: pickKpi('avgResolutionWallClockHours'),
      reopenRatePct: pickKpi('reopenRatePct'),
      escalationRatePct: pickKpi('escalationRatePct'),
      transferRatePct: pickKpi('transferRatePct'),
      retentionSuccessPct: pickKpi('retentionSuccessPct'),
    },
    byStatus: (payload.byStatus ?? []).slice(0, 7),
    byPriority: payload.byPriority ?? [],
    byCaseType: payload.byCaseType ?? [],
    byCompany: scope.canCrossCompanyAgg ? (payload.byCompany ?? null) : null,
    byTeam: (payload.byTeam ?? []).slice(0, 6),
    byCategory: (payload.byCategory ?? []).slice(0, 8),
    topAtRiskAccounts: (payload.topAtRiskAccounts ?? []).slice(0, 6),
    minSampleViolations: payload.minSampleViolations ?? [],
    notAvailable: payload.notAvailable ?? [],
  };
}

// ──────────────────────────────────────────────────────────────────
// Common prompt building blocks
// ──────────────────────────────────────────────────────────────────

const ROLE_PERSONA_SELF = [
  'Sen bir kullanicinin KISISEL operasyon asistanisin.',
  'Sadece kullanicinin atandigi vakalar uzerinden konus.',
  'Takim/organizasyon dusey aksiyon önerme; sadece kullanicinin yapabileceklerini öner.',
].join(' ');

const ROLE_PERSONA_TEAM = [
  'Sen takim performansini takip eden bir operasyon analistisin.',
  'Takim duzeyinde oncelendirme ve yetistirme aksiyonlari onerebilirsin.',
].join(' ');

const ROLE_PERSONA_COMPANY = [
  'Sen sirket-cap operasyonu izleyen kıdemli bir analistisin.',
  'Sirket stratejisi, kapasite planlama, segment risk kumelemesi onerebilirsin.',
  'Cok-sirket karsilastirmasi YAPMA (yetkin sadece bir sirket icin).',
].join(' ');

const ROLE_PERSONA_CROSS = [
  'Sen sirketler arasi karsilastirma yapan bir Insights direktorusun.',
  'Sirketler arasi performans farklarini, ortak risk gostergelerini ve oncelikli aksiyon kumelerini öner.',
].join(' ');

function rolePersona(scope) {
  if (scope.scopeKind === 'self') return ROLE_PERSONA_SELF;
  if (scope.scopeKind === 'team') return ROLE_PERSONA_TEAM;
  if (scope.scopeKind === 'cross-company') return ROLE_PERSONA_CROSS;
  return ROLE_PERSONA_COMPANY;
}

const COMMON_RULES = [
  'TURKCE yaz; teknik dili sadelestirilmis tut.',
  'METRIK HESAPLAMA YAPMA. Verilen sayilari kullan, kendi sayilarini uretme.',
  'Belirsiz veriyi "yetersiz veri" olarak isaretle; var olmayan trendlerden bahsetme.',
  'minSampleViolations veya notAvailable listesindeki metriklerden konusurken bunu söyle ("yetersiz örneklem").',
  'Insan ismi (sahip/agent) konusunda yargilayici cumle KURMA — bireysel performansi sayilarla, nötr dilde aktar.',
  'Aksiyon önerirken aksiyonu kim ne zaman yapacagini netlestir.',
  'SADECE JSON dondür — markdown code fence kullanma.',
].join('\n');

function snapshotBlock(snapshot) {
  return [
    '=== SCOPED OPERATIONS SNAPSHOT (deterministik, server-side) ===',
    JSON.stringify(snapshot, null, 2),
    '=== SON ===',
  ].join('\n');
}

// ──────────────────────────────────────────────────────────────────
// 1) Brief
// ──────────────────────────────────────────────────────────────────

export function buildBriefPrompt(scope, snapshot) {
  const system = [
    rolePersona(scope),
    '',
    COMMON_RULES,
    '',
    'GOREV: Mevcut dashboard kapsamindan bir "yönetici özeti" üret.',
    '',
    'JSON formati:',
    '{',
    '  "title": "kisa baslik, max 60 karakter",',
    '  "summary": "2-3 cumle ozet",',
    '  "bullets": ["maddeli 3-5 satir, sayisal", ...],',
    '  "risks": ["1-3 risk noktasi"],',
    '  "recommendedActions": ["1-3 somut aksiyon"]',
    '}',
  ].join('\n');
  const user = snapshotBlock(snapshot);
  return { system, user };
}

export function sanitizeBrief(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      title: 'Özet üretilemedi',
      summary: 'AI bu kapsam için anlamlı bir özet üretemedi.',
      bullets: [],
      risks: [],
      recommendedActions: [],
    };
  }
  return {
    title: trimStr(raw.title, 120) || 'Operasyon Özeti',
    summary: trimStr(raw.summary, 800) || '',
    bullets: toStringArray(raw.bullets, 8, 240),
    risks: toStringArray(raw.risks, 6, 240),
    recommendedActions: toStringArray(raw.recommendedActions, 6, 240),
  };
}

// ──────────────────────────────────────────────────────────────────
// 2) Insights
// ──────────────────────────────────────────────────────────────────

export function buildInsightsPrompt(scope, snapshot) {
  const system = [
    rolePersona(scope),
    '',
    COMMON_RULES,
    '',
    'GOREV: Snapshot uzerinden 0-5 adet "insight kart" üret.',
    'Her insight muhakkak SAYISAL evidence icermeli. Evidence yoksa insight uretme.',
    'Evidence bucket yapisi Phase 3 drilldown ile birebir uyumlu olmali.',
    '',
    'INSIGHT TIPI:',
    ' - sla-anomaly: SLA ihlal oraninda artis veya kume',
    ' - backlog-buildup: Acik vakalarda birikme veya cozum yetistirememe',
    ' - repeated-issue: Tek kategoride/subkategoride yogunlasma',
    ' - customer-risk-cluster: Birkac musteride SLA/eskalasyon kumesi',
    ' - workload-imbalance: Takimlar arasi yuk farki',
    '',
    'SEVERITY: info | warning | critical',
    '',
    'BUCKET KINDS (drilldown icin):',
    ' - status, priority, caseType, category, team, company, atRiskAccount',
    ' - openCases, slaRiskCount, slaViolationRatePct, reopenRatePct',
    ' - escalationRatePct, transferRatePct, retentionSuccessPct',
    '',
    'JSON formati (her insight icin):',
    '{',
    '  "insights": [',
    '    {',
    '      "id": "kisa stable id (orn: sla-anomaly-1)",',
    '      "type": "sla-anomaly | backlog-buildup | repeated-issue | customer-risk-cluster | workload-imbalance",',
    '      "severity": "info | warning | critical",',
    '      "title": "kisa baslik",',
    '      "narrative": "2-3 cumle aciklama",',
    '      "evidence": [',
    '        { "label": "Acik vaka", "value": "137", "bucketKind": "openCases", "bucketKey": null },',
    '        { "label": "Acik (Acik statusu)", "value": "51", "bucketKind": "status", "bucketKey": "Acik" }',
    '      ],',
    '      "suggestedAction": "1 cumle somut aksiyon",',
    '      "drilldownBucketKind": "openCases | status | category | team | ... | null",',
    '      "drilldownBucketKey": "(varsa) | null",',
    '      "drilldownBucketCategory": "(category icin) | null",',
    '      "drilldownBucketSubCategory": "(category icin) | null"',
    '    }',
    '  ]',
    '}',
  ].join('\n');
  const user = snapshotBlock(snapshot);
  return { system, user };
}

export function sanitizeInsights(raw) {
  const arr = Array.isArray(raw?.insights) ? raw.insights : [];
  const insights = [];
  for (const r of arr.slice(0, 5)) {
    if (!r || typeof r !== 'object') continue;
    const type = ALLOWED_INSIGHT_TYPES.has(r.type) ? r.type : 'sla-anomaly';
    const severity = ALLOWED_INSIGHT_SEVERITIES.has(r.severity) ? r.severity : 'info';
    const title = trimStr(r.title, 160);
    const narrative = trimStr(r.narrative, 600);
    if (!title) continue;
    const evidence = Array.isArray(r.evidence)
      ? r.evidence
          .slice(0, 6)
          .map((e) => ({
            label: trimStr(e?.label, 100) || '—',
            value: trimStr(typeof e?.value === 'number' ? String(e.value) : e?.value, 60) || '',
            bucket: toBucket(e),
          }))
          .filter((e) => e.value)
      : [];
    insights.push({
      id: trimStr(r.id, 60) || `${type}-${insights.length + 1}`,
      type,
      severity,
      title,
      narrative,
      evidence,
      suggestedAction: trimStr(r.suggestedAction, 280) || '',
      drilldown: toBucket({
        bucketKind: r.drilldownBucketKind,
        bucketKey: r.drilldownBucketKey,
        bucketCategory: r.drilldownBucketCategory,
        bucketSubCategory: r.drilldownBucketSubCategory,
        label: r.title,
      }),
    });
  }
  return insights;
}

// ──────────────────────────────────────────────────────────────────
// 3) Explain metric
// ──────────────────────────────────────────────────────────────────

export function isAllowedMetricKey(k) {
  return typeof k === 'string' && ALLOWED_METRIC_KEYS.has(k);
}

export function buildExplainPrompt(scope, snapshot, metricKey) {
  const kpiSlice = snapshot.kpis?.[metricKey] ?? null;
  const formula = METRIC_FORMULAS[metricKey] ?? '(formul kayitli degil)';
  const system = [
    rolePersona(scope),
    '',
    COMMON_RULES,
    '',
    `GOREV: "${metricKey}" metrigini operasyon yöneticisine aciklayan kompakt yardim icerigi üret.`,
    'Mevcut donem icin oncekiyle karsilastirmali bir whatChanged cümlesi yaz.',
    'Aciklamada formul açik şekilde belirtilsin.',
    'Onerilen drilldown ile mevcut Phase 3 endpoint uyumlu olsun.',
    '',
    'JSON formati:',
    '{',
    '  "explanation": "2-3 cumle nedir/nasil yorumlanir",',
    '  "formula": "formul / payda-pay aciklamasi",',
    '  "whatChanged": "1 cumle gecmis donemle karsilastirma; mumkun degilse \\"yetersiz veri\\"",',
    '  "watchouts": ["1-3 dikkat noktasi"],',
    '  "suggestedDrilldowns": [',
    '    { "label": "...", "bucketKind": "openCases|status|...", "bucketKey": "(varsa) | null" }',
    '  ]',
    '}',
  ].join('\n');
  const user = [
    snapshotBlock(snapshot),
    '',
    `=== HEDEF METRIK: ${metricKey} ===`,
    `Mevcut deger: ${kpiSlice?.value ?? '(yok)'} (delta %${kpiSlice?.deltaPct ?? '—'})`,
    `Backend formul tanimi: ${formula}`,
  ].join('\n');
  return { system, user };
}

export function sanitizeExplain(raw, metricKey) {
  if (!raw || typeof raw !== 'object') {
    return {
      explanation: '',
      formula: METRIC_FORMULAS[metricKey] ?? '',
      whatChanged: '',
      watchouts: [],
      suggestedDrilldowns: [],
    };
  }
  const sd = Array.isArray(raw.suggestedDrilldowns) ? raw.suggestedDrilldowns : [];
  return {
    explanation: trimStr(raw.explanation, 600) || '',
    formula: trimStr(raw.formula, 280) || METRIC_FORMULAS[metricKey] || '',
    whatChanged: trimStr(raw.whatChanged, 280) || '',
    watchouts: toStringArray(raw.watchouts, 4, 200),
    suggestedDrilldowns: sd
      .slice(0, 4)
      .map((d) => ({
        label: trimStr(d?.label, 80) || 'Vakaları gör',
        bucket: toBucket(d),
      }))
      .filter((d) => d.bucket != null),
  };
}

// ──────────────────────────────────────────────────────────────────
// 4) Report draft
// ──────────────────────────────────────────────────────────────────

export function buildReportPrompt(scope, snapshot) {
  const system = [
    rolePersona(scope),
    '',
    COMMON_RULES,
    '',
    'GOREV: Yonetime sunulacak kisa operasyon raporu taslagini Markdown formatinda üret.',
    'Bolum: Yonetici Ozeti, Donem Performansi, Riskler ve Onceliklendirme, Onerilen Aksiyonlar.',
    'Maksimum 300 kelime. Hicbir sayi uretme — sadece snapshot icindeki sayilari kullan.',
    '',
    'JSON formati:',
    '{',
    '  "markdown": "tam markdown",',
    '  "sections": {',
    '    "summary": "...",',
    '    "risks": "...",',
    '    "actions": "..."',
    '  }',
    '}',
  ].join('\n');
  const user = snapshotBlock(snapshot);
  return { system, user };
}

export function sanitizeReport(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      markdown: '_Rapor üretilemedi._',
      sections: { summary: '', risks: '', actions: '' },
    };
  }
  return {
    markdown: trimStr(raw.markdown, 6000) || '_Rapor üretilemedi._',
    sections: {
      summary: trimStr(raw.sections?.summary, 1500) || '',
      risks: trimStr(raw.sections?.risks, 1500) || '',
      actions: trimStr(raw.sections?.actions, 1500) || '',
    },
  };
}

// ──────────────────────────────────────────────────────────────────
// utils
// ──────────────────────────────────────────────────────────────────

function trimStr(v, max) {
  if (v == null) return '';
  if (typeof v !== 'string') {
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '';
  }
  const t = v.trim();
  return t.length > max ? t.slice(0, max) : t;
}

function toStringArray(v, maxItems, maxLen) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const item of v.slice(0, maxItems)) {
    const s = trimStr(item, maxLen);
    if (s) out.push(s);
  }
  return out;
}

function toBucket(src) {
  if (!src) return null;
  const kind = typeof src.bucketKind === 'string' ? src.bucketKind : null;
  if (!kind || !ALLOWED_BUCKET_KINDS.has(kind)) return null;
  const out = { kind };
  const key = typeof src.bucketKey === 'string' && src.bucketKey.length > 0 ? src.bucketKey : null;
  const category = typeof src.bucketCategory === 'string' && src.bucketCategory.length > 0 ? src.bucketCategory : null;
  const subCategory = typeof src.bucketSubCategory === 'string' && src.bucketSubCategory.length > 0 ? src.bucketSubCategory : null;
  // Bucket gerekirligine gore key/category eksikse drop et
  const keyRequired = ['status', 'priority', 'caseType', 'team', 'company', 'atRiskAccount'];
  if (keyRequired.includes(kind)) {
    if (!key) return null;
    out.key = key;
  } else if (kind === 'category') {
    if (!category && !key) return null;
    if (category) out.category = category;
    else out.key = key;
    if (subCategory) out.subCategory = subCategory;
  }
  if (typeof src.label === 'string' && src.label.length > 0) out.label = src.label.slice(0, 120);
  return out;
}
