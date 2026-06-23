import { Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import type { OperationsOverviewResponse, OverviewKpi } from '@/services/analyticsService';
import type { OperationsReportResponse } from '@/services/aiService';
import type { ReportSectionToggles, ReportFilterSummary } from './reportMarkdownBuilder';

interface ReportPreviewProps {
  title: string;
  overview: OperationsOverviewResponse;
  ai: OperationsReportResponse | null;
  aiLoading: boolean;
  aiError: string | null;
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
  avgResolutionWallClockHours: 'Ort. Çözüm',
  reopenRatePct:               'Yeniden Açılma %',
  escalationRatePct:           'Eskalasyon %',
  transferRatePct:             'Aktarım %',
  retentionSuccessPct:         'Retention Başarı %',
};

const KPI_ORDER = [
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
] as const;

const KPI_FORMAT: Record<string, 'int' | 'pct' | 'hours'> = {
  totalCases: 'int', openCases: 'int', createdInPeriod: 'int', resolvedInPeriod: 'int',
  slaRiskCount: 'int', slaViolationRatePct: 'pct', avgResolutionWallClockHours: 'hours',
  reopenRatePct: 'pct', escalationRatePct: 'pct', transferRatePct: 'pct', retentionSuccessPct: 'pct',
};

/**
 * Report Studio — Önizleme görünümü. Aynı zamanda yazdırılabilir alan.
 * `printable-report` class'ı global @media print kuralında hedeflenir.
 */
export function ReportPreview(props: ReportPreviewProps) {
  const { title, overview, ai, aiLoading, aiError, sections, filters, statusLabels, priorityLabels, caseTypeLabels } = props;
  const generatedAt = new Date();
  const filterPieces = filterSummaryPieces(filters, statusLabels, caseTypeLabels);

  return (
    <div className="printable-report mx-auto max-w-3xl space-y-6 rounded-md bg-white p-6 text-slate-900 ring-1 ring-inset ring-slate-200 dark:bg-ndark-card dark:text-ndark-text dark:ring-ndark-border">
      <header className="space-y-1 border-b border-slate-200 pb-4 dark:border-ndark-border">
        <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
        <p className="text-sm text-slate-600 dark:text-ndark-muted">
          <strong>Kapsam:</strong> {overview.scope.narrative}
        </p>
        <p className="text-sm text-slate-600 dark:text-ndark-muted">
          <strong>Dönem:</strong> {fmtDate(filters.from)} – {fmtDate(filters.to)}
          {'  '}·{'  '}
          <strong>Oluşturuldu:</strong> {fmtDateTime(generatedAt.toISOString())}
        </p>
        {filterPieces.length > 0 && (
          <p className="text-xs text-slate-500 dark:text-ndark-muted">
            <strong>Filtreler:</strong> {filterPieces.join(' · ')}
          </p>
        )}
      </header>

      {sections.kpis && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Anahtar Metrikler</h2>
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-ndark-border">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
                <th className="py-1.5">Metrik</th>
                <th className="py-1.5 text-right">Değer</th>
                <th className="py-1.5 text-right">Önceki döneme göre</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-ndark-border">
              {KPI_ORDER.map((key) => {
                const kpi = overview.kpis[key as keyof typeof overview.kpis] as OverviewKpi | undefined;
                if (!kpi) return null;
                return (
                  <tr key={key}>
                    <td className="py-1.5 pr-2 font-medium">{KPI_LABELS[key] ?? key}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatKpi(kpi.value, KPI_FORMAT[key])}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-600 dark:text-ndark-muted">{formatDelta(kpi.delta)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {sections.timeSeries && overview.timeSeries.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Açılan / Çözülen / SLA İhlal (günlük)</h2>
          <TrendTable points={overview.timeSeries} />
        </section>
      )}

      {sections.breakdowns && (
        <section className="space-y-4">
          <h2 className="text-base font-semibold">Kırılımlar</h2>
          <BreakdownTable title="Statü Dağılımı" rows={overview.byStatus} labelFor={(r) => statusLabels[r.key] ?? r.key} />
          <BreakdownTable title="Önceliğe Göre" rows={overview.byPriority} labelFor={(r) => priorityLabels[r.key] ?? r.key} />
          <BreakdownTable title="Vaka Tipi" rows={overview.byCaseType} labelFor={(r) => caseTypeLabels[r.key] ?? r.key} />
          {overview.byCompany && overview.byCompany.length > 0 && (
            <CompanyTable rows={overview.byCompany} />
          )}
          {overview.byTeam.length > 0 && <TeamTable rows={overview.byTeam} />}
          {overview.byCategory.length > 0 && <CategoryTable rows={overview.byCategory} />}
        </section>
      )}

      {sections.riskAccounts && overview.topAtRiskAccounts.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Riskli Müşteriler</h2>
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-ndark-border">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
                <th className="py-1.5">Müşteri</th>
                <th className="py-1.5 text-right">Açık</th>
                <th className="py-1.5 text-right">SLA İhlal</th>
                <th className="py-1.5 text-right">Eskale Edildi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-ndark-border">
              {overview.topAtRiskAccounts.map((r) => (
                <tr key={r.accountId}>
                  <td className="py-1.5 pr-2 font-medium">{r.accountName}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.openCount}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.slaBreachCount}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.escalatedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {sections.aiNarrative && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-1.5 text-base font-semibold">
            <Sparkles size={14} className="text-violet-500" /> AI Özet
            <Badge tint="violet" className="font-normal">Runa AI</Badge>
          </h2>
          {aiLoading && (
            <p className="text-sm text-slate-500 dark:text-ndark-muted">AI özet üretiliyor…</p>
          )}
          {!aiLoading && aiError && (
            <p className="text-sm text-rose-700 dark:text-rose-300">{aiError}</p>
          )}
          {!aiLoading && !aiError && !ai && (
            <p className="text-sm text-slate-500 dark:text-ndark-muted">Henüz AI özet üretilmedi.</p>
          )}
          {!aiLoading && ai && (
            <div className="space-y-3 text-sm leading-relaxed">
              {ai.sections.summary && (
                <div>
                  <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">Yönetici özeti</h3>
                  <p className="mt-1 whitespace-pre-line">{ai.sections.summary}</p>
                </div>
              )}
              {ai.sections.risks && (
                <div>
                  <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">Riskler</h3>
                  <p className="mt-1 whitespace-pre-line">{ai.sections.risks}</p>
                </div>
              )}
              {ai.sections.actions && (
                <div>
                  <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">Önerilen aksiyonlar</h3>
                  <p className="mt-1 whitespace-pre-line">{ai.sections.actions}</p>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {sections.appendix && (
        <section className="space-y-1 border-t border-slate-200 pt-3 text-xs text-slate-500 dark:border-ndark-border dark:text-ndark-muted">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide">Ek</h2>
          <ul className="space-y-0.5">
            <li>Formül versiyonu: <code className="font-mono">{overview.formulaVersion}</code></li>
            <li>Saat dilimi: {overview.timezone}</li>
            {overview.metricAuditId && (
              <li>metricAuditId: <code className="font-mono">{overview.metricAuditId}</code></li>
            )}
            {ai?.usageLogId && (
              <li>AI usageLogId: <code className="font-mono">{ai.usageLogId}</code></li>
            )}
            {overview.minSampleViolations.length > 0 && (
              <li>Yetersiz örneklem: {overview.minSampleViolations.map((v) => v.metric).join(', ')}</li>
            )}
            {overview.notAvailable.length > 0 && (
              <li>Mevcut değil: {overview.notAvailable.join(', ')}</li>
            )}
          </ul>
          <p className="pt-2 italic">
            AI özet, deterministic kapsamlı metriklerden üretilmiştir. Sayısal değerler dashboard kaynak metrikleridir.
          </p>
        </section>
      )}
    </div>
  );
}

// ---- subtables ----

function TrendTable({ points }: { points: OperationsOverviewResponse['timeSeries'] }) {
  const totals = points.reduce(
    (a, b) => ({ created: a.created + b.created, resolved: a.resolved + b.resolved, slaBreached: a.slaBreached + b.slaBreached }),
    { created: 0, resolved: 0, slaBreached: 0 },
  );
  return (
    <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-ndark-border">
      <thead>
        <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
          <th className="py-1.5">Gün</th>
          <th className="py-1.5 text-right">Açılan</th>
          <th className="py-1.5 text-right">Çözülen</th>
          <th className="py-1.5 text-right">SLA İhlal</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-ndark-border">
        {points.map((p) => (
          <tr key={p.bucket}>
            <td className="py-1.5 pr-2 font-mono text-xs">{p.bucket}</td>
            <td className="py-1.5 text-right tabular-nums">{p.created}</td>
            <td className="py-1.5 text-right tabular-nums">{p.resolved}</td>
            <td className="py-1.5 text-right tabular-nums">{p.slaBreached}</td>
          </tr>
        ))}
        <tr className="font-semibold">
          <td className="py-1.5 pr-2">Toplam</td>
          <td className="py-1.5 text-right tabular-nums">{totals.created}</td>
          <td className="py-1.5 text-right tabular-nums">{totals.resolved}</td>
          <td className="py-1.5 text-right tabular-nums">{totals.slaBreached}</td>
        </tr>
      </tbody>
    </table>
  );
}

function BreakdownTable({
  title,
  rows,
  labelFor,
}: {
  title: string;
  rows: { key: string; count: number }[];
  labelFor: (r: { key: string; count: number }) => string;
}) {
  if (!rows || rows.length === 0) return null;
  const total = rows.reduce((a, b) => a + b.count, 0);
  return (
    <div>
      <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">{title}</h3>
      <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-ndark-border">
        <thead>
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
            <th className="py-1.5">Etiket</th>
            <th className="py-1.5 text-right">Adet</th>
            <th className="py-1.5 text-right">Pay</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-ndark-border">
          {rows.map((r) => {
            const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
            return (
              <tr key={r.key}>
                <td className="py-1.5 pr-2">{labelFor(r)}</td>
                <td className="py-1.5 text-right tabular-nums">{r.count}</td>
                <td className="py-1.5 text-right tabular-nums">%{pct}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CompanyTable({ rows }: { rows: NonNullable<OperationsOverviewResponse['byCompany']> }) {
  return (
    <div>
      <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">Şirkete Göre</h3>
      <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-ndark-border">
        <thead>
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
            <th className="py-1.5">Şirket</th>
            <th className="py-1.5 text-right">Vaka</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-ndark-border">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="py-1.5 pr-2 font-medium">{r.name || r.id}</td>
              <td className="py-1.5 text-right tabular-nums">{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamTable({ rows }: { rows: OperationsOverviewResponse['byTeam'] }) {
  return (
    <div>
      <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">Takım Yükü</h3>
      <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-ndark-border">
        <thead>
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
            <th className="py-1.5">Takım</th>
            <th className="py-1.5 text-right">Vaka</th>
            <th className="py-1.5 text-right">Ort. Çözüm</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-ndark-border">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="py-1.5 pr-2 font-medium">{r.name}</td>
              <td className="py-1.5 text-right tabular-nums">{r.count}</td>
              <td className="py-1.5 text-right tabular-nums">{formatHoursStr(r.avgTtrHours)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CategoryTable({ rows }: { rows: OperationsOverviewResponse['byCategory'] }) {
  return (
    <div>
      <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">Kategori Dağılımı</h3>
      <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-ndark-border">
        <thead>
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
            <th className="py-1.5">Kategori</th>
            <th className="py-1.5">Alt Kategori</th>
            <th className="py-1.5 text-right">Toplam</th>
            <th className="py-1.5 text-right">Açık</th>
            <th className="py-1.5 text-right">SLA İhlal</th>
            <th className="py-1.5 text-right">Ort. Çözüm</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-ndark-border">
          {rows.map((r, i) => (
            <tr key={`${r.category}-${r.subCategory ?? '-'}-${i}`}>
              <td className="py-1.5 pr-2 font-medium">{r.category}</td>
              <td className="py-1.5 text-slate-600 dark:text-ndark-muted">{r.subCategory ?? '—'}</td>
              <td className="py-1.5 text-right tabular-nums">{r.total}</td>
              <td className="py-1.5 text-right tabular-nums">{r.open}</td>
              <td className="py-1.5 text-right tabular-nums">{r.slaBreachCount}</td>
              <td className="py-1.5 text-right tabular-nums">{formatHoursStr(r.avgTtrHours)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- helpers ----

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
  try { return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(new Date(iso)); }
  catch { return iso; }
}

function fmtDateTime(iso: string): string {
  try { return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)); }
  catch { return iso; }
}
