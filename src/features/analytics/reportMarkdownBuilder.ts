import type {
  OperationsOverviewResponse,
  OverviewKpi,
} from '@/services/analyticsService';
import type { OperationsReportResponse } from '@/services/aiService';

/**
 * Report Studio — Markdown serializer.
 *
 * Pure function: dashboard'un current overview verisini + opsiyonel AI
 * narrative'i + section toggle'larini alir; tek string Markdown dondurur.
 * Sayisal degerler yalnizca overview payload'undan gelir; AI sayilarini
 * tekrar yazmaz.
 */

export interface ReportSectionToggles {
  kpis: boolean;
  timeSeries: boolean;
  breakdowns: boolean;
  riskAccounts: boolean;
  aiNarrative: boolean;
  appendix: boolean;
}

export interface ReportFilterSummary {
  from: string;
  to: string;
  statuses: string[] | null | undefined;
  caseTypes: string[] | null | undefined;
  productGroups: string[] | null | undefined;
}

export interface BuildMarkdownInput {
  title: string;
  overview: OperationsOverviewResponse;
  ai: OperationsReportResponse | null;
  sections: ReportSectionToggles;
  filters: ReportFilterSummary;
  statusLabels: Record<string, string>;
  priorityLabels: Record<string, string>;
  caseTypeLabels: Record<string, string>;
}

const KPI_LABELS: Record<string, string> = {
  totalCases:                  'Toplam Vaka',
  openCases:                   'Açık Vaka',
  createdInPeriod:             'Dönemde Açılan',
  resolvedInPeriod:            'Dönemde Çözülen',
  slaRiskCount:                'SLA Riski',
  slaViolationRatePct:         'SLA İhlal %',
  avgResolutionWallClockHours: 'Ort. Çözüm (saat)',
  reopenRatePct:               'Yeniden Açılma %',
  escalationRatePct:           'Eskalasyon %',
  transferRatePct:             'Aktarım %',
  retentionSuccessPct:         'Retention Başarı %',
};

const KPI_ORDER: string[] = [
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
];

const KPI_FORMAT: Record<string, 'int' | 'pct' | 'hours'> = {
  totalCases: 'int',
  openCases: 'int',
  createdInPeriod: 'int',
  resolvedInPeriod: 'int',
  slaRiskCount: 'int',
  slaViolationRatePct: 'pct',
  avgResolutionWallClockHours: 'hours',
  reopenRatePct: 'pct',
  escalationRatePct: 'pct',
  transferRatePct: 'pct',
  retentionSuccessPct: 'pct',
};

export function buildReportMarkdown(input: BuildMarkdownInput): string {
  const { title, overview, ai, sections, filters, statusLabels, priorityLabels, caseTypeLabels } = input;
  const out: string[] = [];

  // Header
  out.push(`# ${escapeMd(title)}`);
  out.push('');
  out.push(`**Kapsam**: ${escapeMd(overview.scope.narrative)}`);
  out.push(`**Dönem**: ${fmtDate(filters.from)} – ${fmtDate(filters.to)}`);
  out.push(`**Oluşturuldu**: ${fmtDateTime(new Date().toISOString())}`);
  const filterPieces = filterSummaryPieces(filters, statusLabels, caseTypeLabels);
  if (filterPieces.length > 0) {
    out.push(`**Filtreler**: ${filterPieces.join(' · ')}`);
  }
  out.push('');

  if (sections.kpis) {
    out.push('## Anahtar Metrikler');
    out.push('');
    out.push('| Metrik | Değer | Önceki döneme göre |');
    out.push('|---|---:|---:|');
    for (const key of KPI_ORDER) {
      const kpi = overview.kpis[key as keyof typeof overview.kpis] as OverviewKpi | undefined;
      if (!kpi) continue;
      const valueText = formatKpi(kpi.value, KPI_FORMAT[key]);
      const deltaText = formatDelta(kpi.delta);
      out.push(`| ${KPI_LABELS[key] ?? key} | ${valueText} | ${deltaText} |`);
    }
    out.push('');
  }

  if (sections.timeSeries && overview.timeSeries.length > 0) {
    out.push('## Açılan / Çözülen / SLA İhlal (günlük)');
    out.push('');
    out.push('| Gün | Açılan | Çözülen | SLA İhlal |');
    out.push('|---|---:|---:|---:|');
    for (const p of overview.timeSeries) {
      out.push(`| ${p.bucket} | ${p.created} | ${p.resolved} | ${p.slaBreached} |`);
    }
    const totals = overview.timeSeries.reduce(
      (a, b) => ({
        created: a.created + b.created,
        resolved: a.resolved + b.resolved,
        slaBreached: a.slaBreached + b.slaBreached,
      }),
      { created: 0, resolved: 0, slaBreached: 0 },
    );
    out.push(`| **Toplam** | **${totals.created}** | **${totals.resolved}** | **${totals.slaBreached}** |`);
    out.push('');
  }

  if (sections.breakdowns) {
    pushBreakdown(out, 'Statü Dağılımı', overview.byStatus, (r) => statusLabels[r.key] ?? r.key);
    pushBreakdown(out, 'Önceliğe Göre', overview.byPriority, (r) => priorityLabels[r.key] ?? r.key);
    pushBreakdown(out, 'Vaka Tipi', overview.byCaseType, (r) => caseTypeLabels[r.key] ?? r.key);

    // byCompany sadece response'da null degilse (canCrossCompanyAgg = true)
    if (overview.byCompany && overview.byCompany.length > 0) {
      out.push('### Şirkete Göre');
      out.push('');
      out.push('| Şirket | Vaka |');
      out.push('|---|---:|');
      for (const r of overview.byCompany) out.push(`| ${escapeMd(r.name || r.id)} | ${r.count} |`);
      out.push('');
    }

    if (overview.byTeam.length > 0) {
      out.push('### Takım Yükü');
      out.push('');
      out.push('| Takım | Vaka | Ort. Çözüm |');
      out.push('|---|---:|---:|');
      for (const r of overview.byTeam) {
        out.push(`| ${escapeMd(r.name)} | ${r.count} | ${formatHoursStr(r.avgTtrHours)} |`);
      }
      out.push('');
    }

    if (overview.byCategory.length > 0) {
      out.push('### Kategori Dağılımı');
      out.push('');
      out.push('| Kategori | Alt Kategori | Toplam | Açık | SLA İhlal | Ort. Çözüm |');
      out.push('|---|---|---:|---:|---:|---:|');
      for (const r of overview.byCategory) {
        out.push(
          `| ${escapeMd(r.category)} | ${escapeMd(r.subCategory ?? '—')} | ${r.total} | ${r.open} | ${r.slaBreachCount} | ${formatHoursStr(r.avgTtrHours)} |`,
        );
      }
      out.push('');
    }
  }

  if (sections.riskAccounts && overview.topAtRiskAccounts.length > 0) {
    out.push('## Riskli Müşteriler');
    out.push('');
    out.push('| Müşteri | Açık | SLA İhlal | Eskalasyon |');
    out.push('|---|---:|---:|---:|');
    for (const r of overview.topAtRiskAccounts) {
      out.push(`| ${escapeMd(r.accountName)} | ${r.openCount} | ${r.slaBreachCount} | ${r.escalatedCount} |`);
    }
    out.push('');
  }

  if (sections.aiNarrative && ai) {
    out.push('## AI Özet');
    out.push('');
    if (ai.sections.summary) {
      out.push('### Yönetici özeti');
      out.push('');
      out.push(ai.sections.summary);
      out.push('');
    }
    if (ai.sections.risks) {
      out.push('### Riskler');
      out.push('');
      out.push(ai.sections.risks);
      out.push('');
    }
    if (ai.sections.actions) {
      out.push('### Önerilen aksiyonlar');
      out.push('');
      out.push(ai.sections.actions);
      out.push('');
    }
  }

  if (sections.appendix) {
    out.push('## Ek (Appendix)');
    out.push('');
    out.push(`- Formül versiyonu: \`${overview.formulaVersion}\``);
    out.push(`- Saat dilimi: ${overview.timezone}`);
    if (overview.metricAuditId) out.push(`- metricAuditId: \`${overview.metricAuditId}\``);
    if (ai?.usageLogId) out.push(`- AI usageLogId: \`${ai.usageLogId}\``);
    if (overview.minSampleViolations.length > 0) {
      out.push(`- Yetersiz örneklem: ${overview.minSampleViolations.map((v) => v.metric).join(', ')}`);
    }
    if (overview.notAvailable.length > 0) {
      out.push(`- Mevcut değil: ${overview.notAvailable.join(', ')}`);
    }
    out.push('');
    out.push('_AI özet, deterministic kapsamlı metriklerden üretilmiştir. Sayısal değerler dashboard kaynak metrikleridir._');
    out.push('');
  }

  return out.join('\n');
}

// ---- helpers ----

function pushBreakdown(
  out: string[],
  title: string,
  rows: { key: string; count: number }[],
  labelFor: (r: { key: string; count: number }) => string,
) {
  if (!rows || rows.length === 0) return;
  const total = rows.reduce((a, b) => a + b.count, 0);
  out.push(`### ${title}`);
  out.push('');
  out.push('| Etiket | Adet | Pay |');
  out.push('|---|---:|---:|');
  for (const r of rows) {
    const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
    out.push(`| ${escapeMd(labelFor(r))} | ${r.count} | %${pct} |`);
  }
  out.push('');
}

function filterSummaryPieces(
  f: ReportFilterSummary,
  statusLabels: Record<string, string>,
  caseTypeLabels: Record<string, string>,
): string[] {
  const out: string[] = [];
  if (f.statuses && f.statuses.length > 0) {
    out.push(`Statü: ${f.statuses.map((s) => statusLabels[s] ?? s).join(', ')}`);
  }
  if (f.caseTypes && f.caseTypes.length > 0) {
    out.push(`Tip: ${f.caseTypes.map((t) => caseTypeLabels[t] ?? t).join(', ')}`);
  }
  if (f.productGroups && f.productGroups.length > 0) {
    out.push(`Ürün: ${f.productGroups.join(', ')}`);
  }
  return out;
}

function formatKpi(value: number | null | undefined, kind: 'int' | 'pct' | 'hours'): string {
  if (value == null || Number.isNaN(value)) return '—';
  if (kind === 'pct') return `%${value.toFixed(1)}`;
  if (kind === 'hours') {
    if (value < 1) return `${(value * 60).toFixed(0)} dk`;
    if (value < 48) return `${value.toFixed(1)} sa`;
    return `${(value / 24).toFixed(1)} gün`;
  }
  return value.toLocaleString('tr-TR');
}

function formatDelta(d: OverviewKpi['delta']): string {
  if (!d || d.value == null || d.sourceMissing) return '—';
  const sign = d.value > 0 ? '+' : '';
  return `${sign}${d.value.toFixed(1)}%`;
}

function formatHoursStr(h: number | null | undefined): string {
  if (h == null || Number.isNaN(h)) return '—';
  if (h < 1) return `${(h * 60).toFixed(0)} dk`;
  if (h < 48) return `${h.toFixed(1)} sa`;
  return `${(h / 24).toFixed(1)} gün`;
}

function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function fmtDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function escapeMd(value: string | null | undefined): string {
  if (value == null) return '';
  return String(value).replace(/\|/g, '\\|');
}
