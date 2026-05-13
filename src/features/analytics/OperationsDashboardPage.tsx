import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Clock,
  Inbox,
  Layers,
  Minus,
  RefreshCw,
  ShieldAlert,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge, type BadgeTint } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton, MetricTileSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { BarList, type BarListItem } from '@/components/charts/BarList';
import { TrendLine } from '@/components/charts/TrendLine';
import {
  analyticsService,
  type OperationsOverviewResponse,
  type OverviewKpi,
  type OverviewRequest,
} from '@/services/analyticsService';

/**
 * Operations Intelligence — Dashboard (Phase 2 UI)
 * Backend: POST /api/analytics/cases/overview (Phase 1)
 * Tek kaynak: docs/OPERATIONS_DASHBOARD_DESIGN.md §2.1 + §2.6
 *
 * Tüm metric'ler deterministic; UI hesaplama yapmaz, sadece formatlar.
 * Scope server-side türetilir; body filter scope'u daraltabilir ama genişletemez.
 */

// ----- Label & color maps -----------------------------------------

const STATUS_LABEL: Record<string, string> = {
  Acik:              'Açık',
  Incelemede:        'İncelemede',
  ThirdPartyWaiting: '3. Parti Bekleniyor',
  Eskalasyon:        'Eskalasyon',
  Cozuldu:           'Çözüldü',
  YenidenAcildi:     'Yeniden Açıldı',
  IptalEdildi:       'İptal',
};
const STATUS_COLOR: Record<string, string> = {
  Acik:              'bg-blue-500',
  Incelemede:        'bg-amber-500',
  ThirdPartyWaiting: 'bg-slate-500',
  Eskalasyon:        'bg-rose-500',
  Cozuldu:           'bg-emerald-500',
  YenidenAcildi:     'bg-violet-500',
  IptalEdildi:       'bg-slate-300',
};
const STATUS_ORDER = [
  'Acik',
  'Incelemede',
  'ThirdPartyWaiting',
  'Eskalasyon',
  'Cozuldu',
  'YenidenAcildi',
  'IptalEdildi',
];

const PRIORITY_LABEL: Record<string, string> = {
  Critical: 'Critical',
  High:     'Yüksek',
  Medium:   'Orta',
  Low:      'Düşük',
};
const PRIORITY_COLOR: Record<string, string> = {
  Critical: 'bg-rose-600',
  High:     'bg-amber-500',
  Medium:   'bg-blue-500',
  Low:      'bg-slate-400',
};

const CASE_TYPE_LABEL: Record<string, string> = {
  GeneralSupport:    'Genel Destek',
  ProactiveTracking: 'Proaktif Takip',
  Churn:             'Churn',
};
const CASE_TYPE_COLOR: Record<string, string> = {
  GeneralSupport:    'bg-teal-500',
  ProactiveTracking: 'bg-violet-500',
  Churn:             'bg-rose-500',
};

const SCOPE_KIND_LABEL: Record<string, string> = {
  self:            'Kendi vakalarım',
  team:            'Takım',
  company:         'Şirket',
  'cross-company': 'Tüm şirketler',
};
const SCOPE_KIND_TINT: Record<string, BadgeTint> = {
  self:            'slate',
  team:            'sky',
  company:         'indigo',
  'cross-company': 'violet',
};

// ----- Quick range chips ------------------------------------------

const QUICK_RANGES: Array<{ key: '7d' | '30d' | '90d'; label: string; days: number }> = [
  { key: '7d',  label: 'Son 7 gün',  days: 7 },
  { key: '30d', label: 'Son 30 gün', days: 30 },
  { key: '90d', label: 'Son 90 gün', days: 90 },
];

// ----- Helpers ----------------------------------------------------

function toDayIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function rangeStartIso(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toISOString();
}
function rangeEndIso(day: string): string {
  // dahil değil — backend `< to` kullanır, gün sonu için ertesi günün 00:00'ını gönder
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `%${value.toFixed(1)}`;
}
function formatHours(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  if (value < 1) return `${(value * 60).toFixed(0)} dk`;
  if (value < 48) return `${value.toFixed(1)} sa`;
  return `${(value / 24).toFixed(1)} gün`;
}
function formatInt(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString('tr-TR');
}
function formatDateLabel(iso: string): string {
  // YYYY-MM-DD → DD.MM
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
}

// ----- Component --------------------------------------------------

export function OperationsDashboardPage() {
  // Filter state
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - 29);
    return toDayIso(d);
  });
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return toDayIso(d);
  });
  const [statuses, setStatuses] = useState<string[]>([]);
  const [caseTypes, setCaseTypes] = useState<string[]>([]);
  const [refetchTick, setRefetchTick] = useState(0);

  // Data state
  const [data, setData] = useState<OperationsOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable serialized deps for useEffect
  const statusesKey = statuses.slice().sort().join(',');
  const caseTypesKey = caseTypes.slice().sort().join(',');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    // Guard: from < to + max 90 days (backend de doğrular)
    const fromMs = Date.parse(`${dateFrom}T00:00:00.000Z`);
    const toMs = Date.parse(`${dateTo}T00:00:00.000Z`);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
      setError('Tarih aralığı geçersiz.');
      setLoading(false);
      return;
    }

    const body: OverviewRequest = {
      from: rangeStartIso(dateFrom),
      to: rangeEndIso(dateTo),
      statuses: statuses.length > 0 ? statuses : undefined,
      caseTypes: caseTypes.length > 0 ? caseTypes : undefined,
      granularity: 'day',
    };

    void analyticsService.getOperationsOverview(body).then((r) => {
      if (!alive) return;
      if (r) {
        setData(r);
      } else {
        setError('Operasyon panosu yüklenemedi.');
      }
      setLoading(false);
    });

    return () => {
      alive = false;
    };
  }, [dateFrom, dateTo, statusesKey, caseTypesKey, refetchTick]);

  function toggleStatus(s: string) {
    setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  }
  function toggleCaseType(t: string) {
    setCaseTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  }
  function applyQuickRange(days: number) {
    const to = new Date();
    to.setUTCHours(0, 0, 0, 0);
    const from = new Date(to);
    from.setUTCDate(to.getUTCDate() - (days - 1));
    setDateFrom(toDayIso(from));
    setDateTo(toDayIso(to));
  }
  function refresh() {
    setRefetchTick((n) => n + 1);
  }

  // -------------------------------------------------------------- render

  return (
    <div className="space-y-5">
      <DashboardHeader
        dateFrom={dateFrom}
        dateTo={dateTo}
        onChangeFrom={setDateFrom}
        onChangeTo={setDateTo}
        onQuickRange={applyQuickRange}
        onRefresh={refresh}
        loading={loading}
        scope={data?.scope}
        asOfLocal={data?.asOfLocal}
      />

      <FilterBar
        statuses={statuses}
        caseTypes={caseTypes}
        onToggleStatus={toggleStatus}
        onToggleCaseType={toggleCaseType}
        onClear={() => {
          setStatuses([]);
          setCaseTypes([]);
        }}
      />

      {error && (
        <Card>
          <CardBody>
            <div className="text-sm text-rose-700 dark:text-rose-300">{error}</div>
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={refresh}>
                Tekrar dene
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {data?.scope.narrowedFromBody && (
        <NoticeBanner
          tone="amber"
          icon={<AlertTriangle size={14} />}
          text="Talep edilen filtre yetkili kapsamın dışına çıktığı için daraltıldı."
        />
      )}

      {data && data.minSampleViolations.length > 0 && (
        <NoticeBanner
          tone="slate"
          icon={<AlertTriangle size={14} />}
          text={`Bazı metrikler yetersiz örneklem nedeniyle gösterilmiyor (${data.minSampleViolations.length} metrik).`}
        />
      )}

      <KpiGrid kpis={data?.kpis} loading={loading} minSampleMetrics={mapMinSample(data)} />

      <TimeSeriesCard
        loading={loading}
        series={data?.timeSeries ?? []}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BreakdownCard
          title="Statü Dağılımı"
          icon={<Layers size={16} />}
          loading={loading}
          items={mapStatusItems(data?.byStatus ?? [])}
          emptyHint="Bu dönemde vaka oluşturulmamış."
        />
        <BreakdownCard
          title="Önceliğe Göre"
          icon={<AlertTriangle size={16} />}
          loading={loading}
          items={mapPriorityItems(data?.byPriority ?? [])}
          emptyHint="Veri yok."
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BreakdownCard
          title="Vaka Tipi"
          icon={<Target size={16} />}
          loading={loading}
          items={mapCaseTypeItems(data?.byCaseType ?? [])}
          emptyHint="Veri yok."
        />
        {data?.byCompany && data.byCompany.length > 0 && (
          <BreakdownCard
            title="Şirkete Göre"
            icon={<Building2 size={16} />}
            loading={loading}
            items={mapCompanyItems(data.byCompany)}
            emptyHint="Veri yok."
          />
        )}
      </div>

      <TeamBreakdownCard loading={loading} rows={data?.byTeam ?? []} />

      <CategoryBreakdownCard loading={loading} rows={data?.byCategory ?? []} />

      <AtRiskAccountsCard loading={loading} rows={data?.topAtRiskAccounts ?? []} />

      {!loading && data && (data.kpis.totalCases.value ?? 0) === 0 && (
        <Card>
          <CardBody>
            <EmptyState
              icon={<Inbox size={22} />}
              title="Bu dönem için kapsamda vaka yok"
              description="Tarih aralığını veya filtreleri değiştirip tekrar dene."
            />
          </CardBody>
        </Card>
      )}

      {data && (
        <div className="text-[11px] text-slate-400 dark:text-ndark-muted">
          Formül: {data.formulaVersion} · TZ: {data.timezone} ·
          {' '}Yanıt: {data.durationMs} ms
          {data.metricAuditId && <> · Audit: <code className="font-mono">{data.metricAuditId}</code></>}
        </div>
      )}
    </div>
  );
}

// ===== Header & filters ===========================================

function DashboardHeader({
  dateFrom,
  dateTo,
  onChangeFrom,
  onChangeTo,
  onQuickRange,
  onRefresh,
  loading,
  scope,
  asOfLocal,
}: {
  dateFrom: string;
  dateTo: string;
  onChangeFrom: (v: string) => void;
  onChangeTo: (v: string) => void;
  onQuickRange: (days: number) => void;
  onRefresh: () => void;
  loading: boolean;
  scope: OperationsOverviewResponse['scope'] | undefined;
  asOfLocal: string | undefined;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-ndark-text">Operasyon Panosu</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-ndark-muted">
            Vaka operasyonlarının özet performansı — son veri{asOfLocal ? `: ${asOfLocal}` : ''}.
          </p>
        </div>
        {scope && (
          <Badge tint={SCOPE_KIND_TINT[scope.kind] ?? 'slate'}>
            <span className="font-semibold uppercase tracking-wide">
              {SCOPE_KIND_LABEL[scope.kind] ?? scope.kind}
            </span>
            <span className="opacity-70">·</span>
            <span className="opacity-90">{scope.narrative}</span>
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 dark:border-ndark-border dark:bg-ndark-card">
          {QUICK_RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => onQuickRange(r.days)}
              className="rounded-[5px] px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:text-ndark-muted dark:hover:bg-ndark-bg"
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-ndark-border dark:bg-ndark-card">
          <label className="text-slate-500 dark:text-ndark-muted">Başlangıç</label>
          <input
            type="date"
            value={dateFrom}
            max={dateTo}
            onChange={(e) => onChangeFrom(e.target.value)}
            className="border-0 bg-transparent text-slate-700 focus:outline-none dark:text-ndark-text"
          />
        </div>
        <div className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-ndark-border dark:bg-ndark-card">
          <label className="text-slate-500 dark:text-ndark-muted">Bitiş</label>
          <input
            type="date"
            value={dateTo}
            min={dateFrom}
            onChange={(e) => onChangeTo(e.target.value)}
            className="border-0 bg-transparent text-slate-700 focus:outline-none dark:text-ndark-text"
          />
        </div>

        <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Yenile
        </Button>
      </div>
    </div>
  );
}

function FilterBar({
  statuses,
  caseTypes,
  onToggleStatus,
  onToggleCaseType,
  onClear,
}: {
  statuses: string[];
  caseTypes: string[];
  onToggleStatus: (s: string) => void;
  onToggleCaseType: (t: string) => void;
  onClear: () => void;
}) {
  const anyActive = statuses.length > 0 || caseTypes.length > 0;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2 dark:border-ndark-border dark:bg-ndark-bg/30">
      <span className="text-xs font-medium text-slate-500 dark:text-ndark-muted">Statü:</span>
      {STATUS_ORDER.map((s) => (
        <FilterChip
          key={s}
          active={statuses.includes(s)}
          label={STATUS_LABEL[s] ?? s}
          onClick={() => onToggleStatus(s)}
        />
      ))}
      <span className="ml-2 text-xs font-medium text-slate-500 dark:text-ndark-muted">Tip:</span>
      {Object.keys(CASE_TYPE_LABEL).map((t) => (
        <FilterChip
          key={t}
          active={caseTypes.includes(t)}
          label={CASE_TYPE_LABEL[t]}
          onClick={() => onToggleCaseType(t)}
        />
      ))}
      {anyActive && (
        <button
          type="button"
          onClick={onClear}
          className="ml-auto text-xs font-medium text-slate-500 underline-offset-2 hover:underline dark:text-ndark-muted"
        >
          Filtreleri temizle
        </button>
      )}
    </div>
  );
}

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset transition ${
        active
          ? 'bg-brand-600 text-white ring-brand-600 hover:bg-brand-700'
          : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-100 dark:bg-ndark-card dark:text-ndark-text dark:ring-ndark-border dark:hover:bg-ndark-bg'
      }`}
    >
      {label}
    </button>
  );
}

function NoticeBanner({
  tone,
  icon,
  text,
}: {
  tone: 'amber' | 'slate';
  icon: React.ReactNode;
  text: string;
}) {
  const tones = {
    amber: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-200',
    slate: 'border-slate-300 bg-slate-50 text-slate-700 dark:border-ndark-border dark:bg-ndark-bg/40 dark:text-ndark-text',
  };
  return (
    <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${tones[tone]}`}>
      {icon}
      <span>{text}</span>
    </div>
  );
}

// ===== KPI Grid ===================================================

function mapMinSample(data: OperationsOverviewResponse | null): Set<string> {
  if (!data) return new Set();
  return new Set(data.minSampleViolations.map((v) => v.metric));
}

interface KpiTileSpec {
  key: keyof OperationsOverviewResponse['kpis'];
  label: string;
  icon: React.ReactNode;
  format: 'int' | 'pct' | 'hours';
  positiveIsGood?: boolean; // true: artış iyi (yeşil) — false: artış kötü (kırmızı)
  hideDelta?: boolean;
}

const KPI_TILES: KpiTileSpec[] = [
  { key: 'totalCases',                  label: 'Toplam Vaka',         icon: <Inbox size={12} />,        format: 'int',   hideDelta: false, positiveIsGood: true },
  { key: 'openCases',                   label: 'Açık Vaka',           icon: <Layers size={12} />,       format: 'int',   hideDelta: true },
  { key: 'createdInPeriod',             label: 'Dönemde Açılan',      icon: <TrendingUp size={12} />,   format: 'int',   positiveIsGood: true },
  { key: 'resolvedInPeriod',            label: 'Dönemde Çözülen',     icon: <CheckCircle2 size={12} />, format: 'int',   positiveIsGood: true },
  { key: 'slaRiskCount',                label: 'SLA Riski',           icon: <ShieldAlert size={12} />,  format: 'int',   hideDelta: true },
  { key: 'slaViolationRatePct',         label: 'SLA İhlal %',         icon: <ShieldAlert size={12} />,  format: 'pct',   positiveIsGood: false },
  { key: 'avgResolutionWallClockHours', label: 'Ort. Çözüm',          icon: <Clock size={12} />,        format: 'hours', positiveIsGood: false },
  { key: 'reopenRatePct',               label: 'Yeniden Açılma %',    icon: <TrendingDown size={12} />, format: 'pct',   positiveIsGood: false },
  { key: 'escalationRatePct',           label: 'Eskalasyon %',        icon: <AlertTriangle size={12} />,format: 'pct',   positiveIsGood: false },
  { key: 'transferRatePct',             label: 'Aktarım %',           icon: <Users size={12} />,        format: 'pct',   positiveIsGood: false },
  { key: 'retentionSuccessPct',         label: 'Retention Başarı %',  icon: <CheckCircle2 size={12} />, format: 'pct',   positiveIsGood: true },
];

function KpiGrid({
  kpis,
  loading,
  minSampleMetrics,
}: {
  kpis: OperationsOverviewResponse['kpis'] | undefined;
  loading: boolean;
  minSampleMetrics: Set<string>;
}) {
  if (loading && !kpis) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {Array.from({ length: 11 }).map((_, i) => (
          <MetricTileSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (!kpis) return null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {KPI_TILES.map((spec) => (
        <KpiCard
          key={spec.key}
          spec={spec}
          kpi={kpis[spec.key]}
          minSample={minSampleMetrics.has(spec.key)}
        />
      ))}
    </div>
  );
}

function KpiCard({
  spec,
  kpi,
  minSample,
}: {
  spec: KpiTileSpec;
  kpi: OverviewKpi;
  minSample: boolean;
}) {
  const valueText = useMemo(() => {
    if (kpi.value == null) return '—';
    if (spec.format === 'pct') return formatPct(kpi.value);
    if (spec.format === 'hours') return formatHours(kpi.value);
    return formatInt(kpi.value);
  }, [kpi.value, spec.format]);

  const showDelta = !spec.hideDelta && kpi.delta.value != null && !kpi.delta.sourceMissing;
  const positiveIsGood = spec.positiveIsGood ?? true;

  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-inset ring-slate-200 shadow-sm dark:bg-ndark-card dark:ring-ndark-border">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
        {spec.icon}
        <span>{spec.label}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold text-slate-900 dark:text-ndark-text">{valueText}</div>
      <div className="mt-1 flex items-center gap-1.5 text-xs">
        {minSample ? (
          <span className="text-slate-400 dark:text-ndark-muted" title="Yetersiz örneklem">
            Yetersiz veri
          </span>
        ) : showDelta ? (
          <DeltaPill
            value={kpi.delta.value as number}
            direction={kpi.delta.direction}
            positiveIsGood={positiveIsGood}
          />
        ) : (
          <span className="text-slate-400 dark:text-ndark-muted">—</span>
        )}
        <span className="text-slate-400 dark:text-ndark-muted">önceki döneme göre</span>
      </div>
    </div>
  );
}

function DeltaPill({
  value,
  direction,
  positiveIsGood,
}: {
  value: number;
  direction: 'up' | 'down' | 'flat' | null;
  positiveIsGood: boolean;
}) {
  const isFlat = direction === 'flat' || value === 0;
  const isUp = !isFlat && value > 0;
  const good = isFlat ? null : (isUp ? positiveIsGood : !positiveIsGood);
  const cls = good == null
    ? 'bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300'
    : good
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
      : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300';
  const Icon = isFlat ? Minus : isUp ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-medium ${cls}`}>
      <Icon size={11} />
      {value > 0 ? '+' : ''}
      {value.toFixed(1)}%
    </span>
  );
}

// ===== Time series ================================================

function TimeSeriesCard({
  loading,
  series,
}: {
  loading: boolean;
  series: OperationsOverviewResponse['timeSeries'];
}) {
  const labels = series.map((p) => formatDateLabel(p.bucket));
  const created = series.map((p) => p.created);
  const resolved = series.map((p) => p.resolved);
  const slaBreached = series.map((p) => p.slaBreached);
  const totalCreated = created.reduce((a, b) => a + b, 0);
  const totalResolved = resolved.reduce((a, b) => a + b, 0);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-slate-500 dark:text-ndark-muted" />
          <h2 className="text-sm font-semibold text-slate-800 dark:text-ndark-text">
            Açılan / Çözülen / SLA İhlali
          </h2>
        </div>
        <span className="text-xs text-slate-500 dark:text-ndark-muted">
          {totalCreated} yeni · {totalResolved} çözüm
        </span>
      </CardHeader>
      <CardBody>
        {loading ? (
          <Skeleton height={260} />
        ) : series.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<TrendingUp size={16} />}
            title="Bu dönemde veri yok"
            description="Filtreleri genişletip tekrar dene."
          />
        ) : (
          <TrendLine
            series={[
              { label: 'Açılan',     color: '#3b62f5', values: created },
              { label: 'Çözülen',    color: '#10b981', values: resolved },
              { label: 'SLA İhlal',  color: '#e11d48', values: slaBreached },
            ]}
            xLabels={labels}
            height={280}
          />
        )}
      </CardBody>
    </Card>
  );
}

// ===== Breakdown cards ============================================

function BreakdownCard({
  title,
  icon,
  loading,
  items,
  emptyHint,
}: {
  title: string;
  icon: React.ReactNode;
  loading: boolean;
  items: BarListItem[];
  emptyHint: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <span className="text-slate-500 dark:text-ndark-muted">{icon}</span>
          <h2 className="text-sm font-semibold text-slate-800 dark:text-ndark-text">{title}</h2>
        </div>
      </CardHeader>
      <CardBody>
        {loading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={14} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState size="sm" title={emptyHint} />
        ) : (
          <BarList items={items} showPct />
        )}
      </CardBody>
    </Card>
  );
}

function mapStatusItems(rows: { key: string; count: number }[]): BarListItem[] {
  // Bilinen statüleri sabit sırada göster, bilinmeyenleri sonuna ekle
  const known = STATUS_ORDER
    .map((s) => rows.find((r) => r.key === s))
    .filter((r): r is { key: string; count: number } => r != null && r.count > 0)
    .map((r) => ({
      key: r.key,
      label: STATUS_LABEL[r.key] ?? r.key,
      value: r.count,
      color: STATUS_COLOR[r.key] ?? 'bg-slate-500',
    }));
  const unknown = rows
    .filter((r) => !STATUS_ORDER.includes(r.key))
    .map((r) => ({
      key: r.key,
      label: r.key,
      value: r.count,
      color: 'bg-slate-400',
    }));
  return [...known, ...unknown];
}

function mapPriorityItems(rows: { key: string; count: number }[]): BarListItem[] {
  const order = ['Critical', 'High', 'Medium', 'Low'];
  return order
    .map((p) => rows.find((r) => r.key === p))
    .filter((r): r is { key: string; count: number } => r != null && r.count > 0)
    .map((r) => ({
      key: r.key,
      label: PRIORITY_LABEL[r.key] ?? r.key,
      value: r.count,
      color: PRIORITY_COLOR[r.key] ?? 'bg-slate-500',
    }));
}

function mapCaseTypeItems(rows: { key: string; count: number }[]): BarListItem[] {
  return rows.map((r) => ({
    key: r.key,
    label: CASE_TYPE_LABEL[r.key] ?? r.key,
    value: r.count,
    color: CASE_TYPE_COLOR[r.key] ?? 'bg-slate-500',
  }));
}

function mapCompanyItems(rows: { id: string; name: string; count: number }[]): BarListItem[] {
  const palette = ['bg-brand-500', 'bg-amber-500', 'bg-emerald-500', 'bg-violet-500', 'bg-rose-500'];
  return rows.map((r, i) => ({
    key: r.id,
    label: r.name || r.id,
    value: r.count,
    color: palette[i % palette.length],
  }));
}

// ===== Team breakdown =============================================

function TeamBreakdownCard({
  loading,
  rows,
}: {
  loading: boolean;
  rows: OperationsOverviewResponse['byTeam'];
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Users size={16} className="text-slate-500 dark:text-ndark-muted" />
          <h2 className="text-sm font-semibold text-slate-800 dark:text-ndark-text">Takım Yükü</h2>
        </div>
        <span className="text-xs text-slate-500 dark:text-ndark-muted">İlk {rows.length} takım</span>
      </CardHeader>
      <CardBody className="!p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={14} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState size="sm" title="Takıma atanmış vaka yok" />
        ) : (
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-ndark-border">
            <thead className="bg-slate-50 dark:bg-ndark-bg">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
                <th className="px-4 py-2.5">Takım</th>
                <th className="px-4 py-2.5 text-right">Vaka</th>
                <th className="px-4 py-2.5 text-right">Ort. Çözüm</th>
                <th className="px-4 py-2.5">Dağılım</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-ndark-border">
              {rows.map((r) => {
                const max = Math.max(1, ...rows.map((x) => x.count));
                return (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-ndark-bg/40">
                    <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-ndark-text">{r.name}</td>
                    <td className="px-4 py-2.5 text-right text-slate-700 dark:text-ndark-text">{r.count}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600 dark:text-ndark-muted">
                      {formatHours(r.avgTtrHours)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="h-2 w-40 overflow-hidden rounded-full bg-slate-100 dark:bg-ndark-bg">
                        <div
                          className="h-full rounded-full bg-brand-500"
                          style={{ width: `${(r.count / max) * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}

// ===== Category breakdown =========================================

function CategoryBreakdownCard({
  loading,
  rows,
}: {
  loading: boolean;
  rows: OperationsOverviewResponse['byCategory'];
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-slate-500 dark:text-ndark-muted" />
          <h2 className="text-sm font-semibold text-slate-800 dark:text-ndark-text">Kategori Dağılımı</h2>
        </div>
        <span className="text-xs text-slate-500 dark:text-ndark-muted">İlk {rows.length} kategori</span>
      </CardHeader>
      <CardBody className="!p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} height={14} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState size="sm" title="Kategori verisi yok" />
        ) : (
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-ndark-border">
            <thead className="bg-slate-50 dark:bg-ndark-bg">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
                <th className="px-4 py-2.5">Kategori</th>
                <th className="px-4 py-2.5">Alt Kategori</th>
                <th className="px-4 py-2.5 text-right">Toplam</th>
                <th className="px-4 py-2.5 text-right">Açık</th>
                <th className="px-4 py-2.5 text-right">SLA İhlal</th>
                <th className="px-4 py-2.5 text-right">Ort. Çözüm</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-ndark-border">
              {rows.map((r, i) => (
                <tr key={`${r.category}-${r.subCategory ?? '-'}-${i}`} className="hover:bg-slate-50 dark:hover:bg-ndark-bg/40">
                  <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-ndark-text">{r.category}</td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-ndark-muted">{r.subCategory ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right text-slate-700 dark:text-ndark-text">{r.total}</td>
                  <td className="px-4 py-2.5 text-right text-slate-700 dark:text-ndark-text">{r.open}</td>
                  <td className="px-4 py-2.5 text-right">
                    {r.slaBreachCount > 0 ? (
                      <Badge tint="rose">{r.slaBreachCount}</Badge>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-600 dark:text-ndark-muted">
                    {formatHours(r.avgTtrHours)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}

// ===== At-risk accounts ===========================================

function AtRiskAccountsCard({
  loading,
  rows,
}: {
  loading: boolean;
  rows: OperationsOverviewResponse['topAtRiskAccounts'];
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldAlert size={16} className="text-rose-500" />
          <h2 className="text-sm font-semibold text-slate-800 dark:text-ndark-text">Riskli Müşteriler</h2>
        </div>
        <span className="text-xs text-slate-500 dark:text-ndark-muted">
          SLA ihlali ve açık vaka yığılması
        </span>
      </CardHeader>
      <CardBody className="!p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} height={14} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState size="sm" title="Bu kapsamda riskli müşteri yok" />
        ) : (
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-ndark-border">
            <thead className="bg-slate-50 dark:bg-ndark-bg">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
                <th className="px-4 py-2.5">Müşteri</th>
                <th className="px-4 py-2.5 text-right">Açık Vaka</th>
                <th className="px-4 py-2.5 text-right">SLA İhlal</th>
                <th className="px-4 py-2.5 text-right">Eskalasyon</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-ndark-border">
              {rows.map((r) => (
                <tr key={r.accountId} className="hover:bg-slate-50 dark:hover:bg-ndark-bg/40">
                  <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-ndark-text">{r.accountName}</td>
                  <td className="px-4 py-2.5 text-right text-slate-700 dark:text-ndark-text">{r.openCount}</td>
                  <td className="px-4 py-2.5 text-right">
                    {r.slaBreachCount > 0 ? (
                      <Badge tint="rose">{r.slaBreachCount}</Badge>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {r.escalatedCount > 0 ? (
                      <Badge tint="amber">{r.escalatedCount}</Badge>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}
