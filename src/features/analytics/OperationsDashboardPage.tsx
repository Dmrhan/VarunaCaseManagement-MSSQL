import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Inbox,
  Info,
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
import type { BarListItem } from '@/components/charts/BarList';
import { TrendLine } from '@/components/charts/TrendLine';
import {
  analyticsService,
  type DrilldownBucket,
  type DrilldownCaseRow,
  type DrilldownResponse,
  type OperationsOverviewResponse,
  type OverviewKpi,
  type OverviewRequest,
} from '@/services/analyticsService';
import {
  aiService,
  type AiError,
  type OperationsBriefResponse,
  type OperationsInsight,
  type OperationsReportResponse,
} from '@/services/aiService';
import { RunaCommandStrip, type AiCommandKey } from './RunaCommandStrip';
import { AiBriefCard } from './AiBriefCard';
import { RunaInsightCard } from './RunaInsightCard';
import { ExplainMetricModal } from './ExplainMetricModal';
import { AiReportDraftModal } from './AiReportDraftModal';
import { ReportStudioModal } from './ReportStudioModal';
import { DrilldownAssistantCard } from './DrilldownAssistantCard';
import { LensSelector } from './LensSelector';
import {
  LENS_BY_KEY,
  availableLensesForRole,
  defaultLensForRole,
  type DashboardSectionKey,
  type LensConfig,
  type LensKey,
} from './operationsLensConfig';
import { useAuth } from '@/services/AuthContext';

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
  // LBD A9 — display rename (DB identifier 'Eskalasyon' korunur)
  Eskalasyon:        'Eskale Edildi',
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
  Critical: 'Kritik',
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

export function OperationsDashboardPage({ onSelectCase }: { onSelectCase?: (caseId: string) => void }) {
  const { user } = useAuth();

  // Lens (persona) — role bazli default. Lens YALNIZCA sunum katmaninda etkili.
  const availableLenses = useMemo(() => availableLensesForRole(user?.role), [user?.role]);
  const [lensKey, setLensKey] = useState<LensKey>(() => defaultLensForRole(user?.role));
  // Role degisirse default'a don (login transition).
  useEffect(() => {
    setLensKey(defaultLensForRole(user?.role));
  }, [user?.role]);
  // Lens role icin available degilse default'a dus.
  useEffect(() => {
    if (!availableLenses.some((l) => l.key === lensKey)) {
      setLensKey(defaultLensForRole(user?.role));
    }
  }, [availableLenses, lensKey, user?.role]);
  const lens: LensConfig = LENS_BY_KEY[lensKey];

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
  const [companies, setCompanies] = useState<string[]>([]);
  // Mevcut kapsam icindeki sirket listesi — overview response'larindan birlestirilerek
  // toplanir; user PARAM'a daraltinca byCompany kuculur ama allCompanies kuculmesin
  // diye ayri tutuyoruz. SystemAdmin disindaki rollerde byCompany null → bos kalir.
  const [allCompanies, setAllCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [refetchTick, setRefetchTick] = useState(0);

  // Data state
  const [data, setData] = useState<OperationsOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drilldown, setDrilldown] = useState<{
    bucket: DrilldownBucket;
    title: string;
    page: number;
    sortBy: 'createdAt' | 'priority' | 'slaResolutionDueAt' | 'ageHours';
    sortDir: 'asc' | 'desc';
  } | null>(null);
  const [drilldownData, setDrilldownData] = useState<DrilldownResponse | null>(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownError, setDrilldownError] = useState<string | null>(null);

  // ---- AI state (Phase 4a) ----
  const [brief, setBrief] = useState<OperationsBriefResponse | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<AiError | null>(null);
  const [briefDismissed, setBriefDismissed] = useState(false);

  const [insights, setInsights] = useState<OperationsInsight[] | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<AiError | null>(null);

  const [report, setReport] = useState<OperationsReportResponse | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<AiError | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const [explainTarget, setExplainTarget] = useState<{ key: string; label: string } | null>(null);
  const [studioOpen, setStudioOpen] = useState(false);

  // Stable serialized deps for useEffect
  const statusesKey = statuses.slice().sort().join(',');
  const caseTypesKey = caseTypes.slice().sort().join(',');
  const companiesKey = companies.slice().sort().join(',');
  const overviewBody = useMemo<OverviewRequest>(() => ({
    from: rangeStartIso(dateFrom),
    to: rangeEndIso(dateTo),
    companies: companies.length > 0 ? companies : undefined,
    statuses: statuses.length > 0 ? statuses : undefined,
    caseTypes: caseTypes.length > 0 ? caseTypes : undefined,
    granularity: 'day',
  }), [dateFrom, dateTo, statusesKey, caseTypesKey, companiesKey]);

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

    void analyticsService.getOperationsOverview(overviewBody).then((r) => {
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
  }, [dateFrom, dateTo, statusesKey, caseTypesKey, companiesKey, refetchTick, overviewBody]);

  // Cross-company role: byCompany dolu donerse allCompanies'e merge et.
  // Filtre daralinca byCompany kuculur ama listeyi kuculmemesi icin sakliyoruz.
  useEffect(() => {
    if (!data?.byCompany || data.byCompany.length === 0) return;
    setAllCompanies((cur) => {
      const map = new Map(cur.map((c) => [c.id, c.name]));
      let changed = false;
      for (const c of data.byCompany!) {
        if (!map.has(c.id)) { map.set(c.id, c.name || c.id); changed = true; }
      }
      if (!changed) return cur;
      return Array.from(map, ([id, name]) => ({ id, name }));
    });
  }, [data?.byCompany]);

  useEffect(() => {
    if (!drilldown) return;
    let alive = true;
    setDrilldownLoading(true);
    setDrilldownError(null);
    void analyticsService.getOperationsDrilldown({
      ...overviewBody,
      bucket: drilldown.bucket,
      page: drilldown.page,
      pageSize: 50,
      sortBy: drilldown.sortBy,
      sortDir: drilldown.sortDir,
    }).then((r) => {
      if (!alive) return;
      if (r) {
        setDrilldownData(r);
      } else {
        setDrilldownError('Vaka listesi yüklenemedi.');
      }
      setDrilldownLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [drilldown, overviewBody]);

  function toggleStatus(s: string) {
    setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  }
  function toggleCaseType(t: string) {
    setCaseTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  }
  function toggleCompany(id: string) {
    setCompanies((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
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
  function openDrilldown(bucket: DrilldownBucket, title: string) {
    setDrilldown({ bucket, title, page: 1, sortBy: 'createdAt', sortDir: 'desc' });
    setDrilldownData(null);
  }
  function setDrilldownPage(page: number) {
    setDrilldown((cur) => (cur ? { ...cur, page } : cur));
  }
  function setDrilldownSort(sortBy: 'createdAt' | 'priority' | 'slaResolutionDueAt' | 'ageHours') {
    setDrilldown((cur) => {
      if (!cur) return cur;
      const sortDir = cur.sortBy === sortBy && cur.sortDir === 'desc' ? 'asc' : 'desc';
      return { ...cur, sortBy, sortDir, page: 1 };
    });
  }

  // ---- AI command handlers (Phase 4a) ----
  // Filtre değişince mevcut AI çıktıları artık eski kapsama ait — temizle.
  useEffect(() => {
    setBrief(null);
    setBriefError(null);
    setBriefDismissed(false);
    setInsights(null);
    setInsightsError(null);
    setReport(null);
    setReportError(null);
  }, [dateFrom, dateTo, statusesKey, caseTypesKey, companiesKey, lensKey]);

  function runBrief() {
    setBriefLoading(true);
    setBriefError(null);
    setBriefDismissed(false);
    void aiService.operationsBrief({ ...overviewBody, lens: lensKey }).then((r) => {
      if (r.ok) setBrief(r.data);
      else setBriefError(r.error);
      setBriefLoading(false);
    });
  }
  function runInsights() {
    setInsightsLoading(true);
    setInsightsError(null);
    void aiService.operationsInsights({ ...overviewBody, lens: lensKey }).then((r) => {
      if (r.ok) setInsights(r.data.insights);
      else setInsightsError(r.error);
      setInsightsLoading(false);
    });
  }
  function runReport() {
    setReportOpen(true);
    setReportLoading(true);
    setReportError(null);
    void aiService.operationsReportDraft({ ...overviewBody, lens: lensKey }).then((r) => {
      if (r.ok) setReport(r.data);
      else setReportError(r.error);
      setReportLoading(false);
    });
  }
  function handleCommand(cmd: AiCommandKey) {
    if (cmd === 'brief') runBrief();
    else if (cmd === 'insights') runInsights();
    else if (cmd === 'report') runReport();
    else if (cmd === 'studio') setStudioOpen(true);
  }
  function openExplain(metricKey: string, metricLabel: string) {
    setExplainTarget({ key: metricKey, label: metricLabel });
  }

  // -------------------------------------------------------------- render

  // "Refetching" = filtre/tarih/şirket degisiminde arka planda yenileme.
  // Initial yukleme zaten skeleton ile kaplanir; refetch sirasinda kullanici
  // hicbir geri bildirim gormuyordu — top progress bar + "Yukleniyor..." rozeti
  // bu durumda goz onunde olsun.
  const refetching = loading && data !== null;

  return (
    <div className="relative space-y-5" aria-busy={loading || undefined}>
      {refetching && (
        <div className="sticky top-0 z-30 -mx-6 -mt-6 mb-1 h-1 overflow-hidden bg-brand-100/70 dark:bg-brand-900/30">
          <div className="animate-progress-slide bg-brand-500/90 dark:bg-brand-400/90" />
        </div>
      )}
      <DashboardHeader
        dateFrom={dateFrom}
        dateTo={dateTo}
        onChangeFrom={setDateFrom}
        onChangeTo={setDateTo}
        onQuickRange={applyQuickRange}
        onRefresh={refresh}
        loading={loading}
        refetching={refetching}
        scope={data?.scope}
        asOfLocal={data?.asOfLocal}
        lens={lens}
        availableLenses={availableLenses}
        onLensChange={setLensKey}
      />

      <FilterBar
        statuses={statuses}
        caseTypes={caseTypes}
        companies={companies}
        availableCompanies={allCompanies}
        onToggleStatus={toggleStatus}
        onToggleCaseType={toggleCaseType}
        onToggleCompany={toggleCompany}
        onClear={() => {
          setStatuses([]);
          setCaseTypes([]);
          setCompanies([]);
        }}
      />

      <RunaCommandStrip
        briefLoading={briefLoading}
        insightsLoading={insightsLoading}
        reportLoading={reportLoading}
        briefError={briefError ? aiErrorShort(briefError) : null}
        insightsError={insightsError ? aiErrorShort(insightsError) : null}
        reportError={reportError ? aiErrorShort(reportError) : null}
        hasBrief={!!brief && !briefDismissed}
        hasInsights={!!insights && insights.length > 0}
        studioDisabled={!data}
        onRun={handleCommand}
      />

      {(brief || briefLoading || briefError) && !briefDismissed && (
        <AiBriefCard
          data={brief}
          loading={briefLoading}
          error={briefError}
          onRetry={runBrief}
          onDismiss={() => {
            setBrief(null);
            setBriefError(null);
            setBriefDismissed(true);
          }}
        />
      )}

      {insights && insights.length > 0 && (
        <div className="space-y-3">
          {insights.map((ins) => (
            <RunaInsightCard key={ins.id} insight={ins} onOpenDrilldown={openDrilldown} />
          ))}
        </div>
      )}

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

      {renderLensSections({
        lens,
        data,
        loading,
        refetching,
        openDrilldown,
        openExplain,
      })}

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

      <DrilldownDrawer
        open={drilldown != null}
        title={drilldown?.title ?? 'Vaka listesi'}
        request={drilldown}
        bucket={drilldown?.bucket ?? null}
        body={overviewBody}
        lens={lensKey}
        data={drilldownData}
        loading={drilldownLoading}
        error={drilldownError}
        onClose={() => {
          setDrilldown(null);
          setDrilldownData(null);
        }}
        onPageChange={setDrilldownPage}
        onSort={setDrilldownSort}
        onSelectCase={onSelectCase}
        onOpenDrilldown={openDrilldown}
      />

      <ExplainMetricModal
        open={explainTarget != null}
        metricKey={explainTarget?.key ?? null}
        metricLabel={explainTarget?.label ?? ''}
        body={overviewBody}
        onClose={() => setExplainTarget(null)}
        onOpenDrilldown={openDrilldown}
      />

      <AiReportDraftModal
        open={reportOpen}
        data={report}
        loading={reportLoading}
        error={reportError}
        onClose={() => setReportOpen(false)}
      />

      <ReportStudioModal
        open={studioOpen}
        overview={data}
        body={overviewBody}
        lens={lens}
        statusLabels={STATUS_LABEL}
        priorityLabels={PRIORITY_LABEL}
        caseTypeLabels={CASE_TYPE_LABEL}
        seedReport={report}
        onClose={() => setStudioOpen(false)}
      />
    </div>
  );
}

function aiErrorShort(err: AiError): string {
  // Kompakt rozet metni; full mesaj komponent-içi aiErrorMessage() ile gosterilir.
  return err.kind;
}

// ===== Lens-aware section renderer ================================
//
// Lens config'ten gelen sectionOrder + hiddenSections'a gore section'lari
// dinamik render eder. Her section yatay full-width; statusPriorityGroup
// kompozit (byStatus + byPriority 2-col).

function renderLensSections({
  lens,
  data,
  loading,
  refetching,
  openDrilldown,
  openExplain,
}: {
  lens: LensConfig;
  data: OperationsOverviewResponse | null;
  loading: boolean;
  refetching: boolean;
  openDrilldown: (bucket: DrilldownBucket, title: string) => void;
  openExplain: (metricKey: string, metricLabel: string) => void;
}) {
  const visibleOrder = lens.sectionOrder.filter((k) => !lens.hiddenSections.includes(k));
  return (
    <>
      {visibleOrder.map((key) => (
        <SectionRenderer
          key={key}
          sectionKey={key}
          lens={lens}
          data={data}
          loading={loading}
          refetching={refetching}
          openDrilldown={openDrilldown}
          openExplain={openExplain}
        />
      ))}
    </>
  );
}

function SectionRenderer({
  sectionKey,
  lens,
  data,
  loading,
  refetching,
  openDrilldown,
  openExplain,
}: {
  sectionKey: DashboardSectionKey;
  lens: LensConfig;
  data: OperationsOverviewResponse | null;
  loading: boolean;
  refetching: boolean;
  openDrilldown: (bucket: DrilldownBucket, title: string) => void;
  openExplain: (metricKey: string, metricLabel: string) => void;
}) {
  switch (sectionKey) {
    case 'kpiGrid':
      return (
        <div className={refetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
          <KpiGrid
            kpis={data?.kpis}
            loading={loading}
            minSampleMetrics={mapMinSample(data)}
            kpiOrder={lens.kpiOrder}
            onOpenDrilldown={openDrilldown}
            onExplain={openExplain}
          />
        </div>
      );
    case 'timeSeries':
      return <TimeSeriesCard loading={loading} series={data?.timeSeries ?? []} />;
    case 'statusPriorityGroup':
      return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BreakdownCard
            title="Statü Dağılımı"
            icon={<Layers size={16} />}
            loading={loading}
            items={mapStatusItems(data?.byStatus ?? [])}
            emptyHint="Bu dönemde vaka oluşturulmamış."
            onOpenDrilldown={openDrilldown}
          />
          <BreakdownCard
            title="Önceliğe Göre"
            icon={<AlertTriangle size={16} />}
            loading={loading}
            items={mapPriorityItems(data?.byPriority ?? [])}
            emptyHint="Veri yok."
            onOpenDrilldown={openDrilldown}
          />
        </div>
      );
    case 'byCaseType':
      return (
        <BreakdownCard
          title="Vaka Tipi"
          icon={<Target size={16} />}
          loading={loading}
          items={mapCaseTypeItems(data?.byCaseType ?? [])}
          emptyHint="Veri yok."
          onOpenDrilldown={openDrilldown}
        />
      );
    case 'byCompany':
      // byCompany sadece backend null degilse render — scope guard server-side.
      if (!data?.byCompany || data.byCompany.length === 0) return null;
      return (
        <BreakdownCard
          title="Şirkete Göre"
          icon={<Building2 size={16} />}
          loading={loading}
          items={mapCompanyItems(data.byCompany)}
          emptyHint="Veri yok."
          onOpenDrilldown={openDrilldown}
        />
      );
    case 'byTeam':
      return <TeamBreakdownCard loading={loading} rows={data?.byTeam ?? []} onOpenDrilldown={openDrilldown} />;
    case 'byCategory':
      return <CategoryBreakdownCard loading={loading} rows={data?.byCategory ?? []} onOpenDrilldown={openDrilldown} />;
    case 'atRiskAccounts':
      return <AtRiskAccountsCard loading={loading} rows={data?.topAtRiskAccounts ?? []} onOpenDrilldown={openDrilldown} />;
    default:
      return null;
  }
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
  refetching,
  scope,
  asOfLocal,
  lens,
  availableLenses,
  onLensChange,
}: {
  dateFrom: string;
  dateTo: string;
  onChangeFrom: (v: string) => void;
  onChangeTo: (v: string) => void;
  onQuickRange: (days: number) => void;
  onRefresh: () => void;
  loading: boolean;
  refetching: boolean;
  scope: OperationsOverviewResponse['scope'] | undefined;
  asOfLocal: string | undefined;
  lens: LensConfig;
  availableLenses: LensConfig[];
  onLensChange: (k: LensKey) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900 dark:text-ndark-text">
            Operasyon Panosu
            {refetching && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 ring-1 ring-inset ring-brand-200 dark:bg-brand-900/30 dark:text-brand-300 dark:ring-brand-800/40"
                role="status"
                aria-live="polite"
              >
                <RefreshCw size={11} className="animate-spin" />
                Yükleniyor…
              </span>
            )}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-ndark-muted">
            <span>{lens.description}</span>
            {asOfLocal && <span> · son veri: {asOfLocal}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LensSelector
            current={lens.key}
            options={availableLenses}
            onChange={onLensChange}
          />
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
  companies,
  availableCompanies,
  onToggleStatus,
  onToggleCaseType,
  onToggleCompany,
  onClear,
}: {
  statuses: string[];
  caseTypes: string[];
  companies: string[];
  availableCompanies: Array<{ id: string; name: string }>;
  onToggleStatus: (s: string) => void;
  onToggleCaseType: (t: string) => void;
  onToggleCompany: (id: string) => void;
  onClear: () => void;
}) {
  const anyActive = statuses.length > 0 || caseTypes.length > 0 || companies.length > 0;
  // Tek sirket icin chip gostermek anlamsiz (zaten daraltma yapilamaz).
  const showCompanies = availableCompanies.length > 1;
  return (
    <div className="space-y-1.5 rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2 dark:border-ndark-border dark:bg-ndark-bg/30">
      <div className="flex flex-wrap items-center gap-2">
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
      {showCompanies && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500 dark:text-ndark-muted">Şirket:</span>
          {availableCompanies.map((c) => (
            <FilterChip
              key={c.id}
              active={companies.includes(c.id)}
              label={c.name}
              onClick={() => onToggleCompany(c.id)}
            />
          ))}
        </div>
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
  kpiOrder,
  onOpenDrilldown,
  onExplain,
}: {
  kpis: OperationsOverviewResponse['kpis'] | undefined;
  loading: boolean;
  minSampleMetrics: Set<string>;
  kpiOrder?: ReadonlyArray<string>;
  onOpenDrilldown: (bucket: DrilldownBucket, title: string) => void;
  onExplain: (metricKey: string, metricLabel: string) => void;
}) {
  // Lens'ten gelen kpiOrder default sirayi override eder. Bilinmeyen keyler
  // dizinin sonuna duser. Lens hicbir reorder vermezse default KPI_TILES sirasi.
  const orderedTiles = useMemo(() => {
    if (!kpiOrder || kpiOrder.length === 0) return KPI_TILES;
    const indexOf = new Map<string, number>();
    kpiOrder.forEach((k, i) => indexOf.set(k, i));
    return KPI_TILES.slice().sort((a, b) => {
      const ai = indexOf.has(a.key) ? indexOf.get(a.key)! : 999;
      const bi = indexOf.has(b.key) ? indexOf.get(b.key)! : 999;
      return ai - bi;
    });
  }, [kpiOrder]);
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
      {orderedTiles.map((spec) => (
        <KpiCard
          key={spec.key}
          spec={spec}
          kpi={kpis[spec.key]}
          minSample={minSampleMetrics.has(spec.key)}
          onOpenDrilldown={onOpenDrilldown}
          onExplain={onExplain}
        />
      ))}
    </div>
  );
}

function KpiCard({
  spec,
  kpi,
  minSample,
  onOpenDrilldown,
  onExplain,
}: {
  spec: KpiTileSpec;
  kpi: OverviewKpi;
  minSample: boolean;
  onOpenDrilldown: (bucket: DrilldownBucket, title: string) => void;
  onExplain: (metricKey: string, metricLabel: string) => void;
}) {
  const valueText = useMemo(() => {
    if (kpi.value == null) return '—';
    if (spec.format === 'pct') return formatPct(kpi.value);
    if (spec.format === 'hours') return formatHours(kpi.value);
    return formatInt(kpi.value);
  }, [kpi.value, spec.format]);

  const showDelta = !spec.hideDelta && kpi.delta.value != null && !kpi.delta.sourceMissing;
  const positiveIsGood = spec.positiveIsGood ?? true;

  const clickable = (kpi.value ?? 0) > 0;
  return (
    <div className="relative">
      <button
        type="button"
        disabled={!clickable}
        onClick={() => onOpenDrilldown({ kind: spec.key, label: spec.label } as DrilldownBucket, spec.label)}
        className={`block w-full rounded-xl bg-white p-4 pr-8 text-left ring-1 ring-inset ring-slate-200 shadow-sm transition dark:bg-ndark-card dark:ring-ndark-border ${
          clickable
            ? 'hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-500'
            : 'cursor-default opacity-95'
        }`}
        title={clickable ? 'Vakaları gör' : undefined}
      >
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
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onExplain(spec.key, spec.label);
        }}
        className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-violet-600 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:hover:bg-ndark-bg dark:hover:text-violet-300"
        aria-label="Metriği AI ile açıkla"
        title="Metriği AI ile açıkla"
      >
        <Info size={12} />
      </button>
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

interface DrilldownBarItem extends BarListItem {
  bucket?: DrilldownBucket;
}

function BreakdownCard({
  title,
  icon,
  loading,
  items,
  emptyHint,
  onOpenDrilldown,
}: {
  title: string;
  icon: React.ReactNode;
  loading: boolean;
  items: DrilldownBarItem[];
  emptyHint: string;
  onOpenDrilldown: (bucket: DrilldownBucket, title: string) => void;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const sum = items.reduce((a, b) => a + b.value, 0);
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
          <ul className="space-y-2">
            {items.map((it) => {
              const widthPct = (it.value / max) * 100;
              const sharePct = sum > 0 ? (it.value / sum) * 100 : 0;
              const content = (
                <>
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-700 dark:text-ndark-text">{it.label}</span>
                    <span className="font-medium text-slate-800 dark:text-ndark-text">
                      {it.value}
                      <span className="ml-1 text-slate-400">({sharePct.toFixed(0)}%)</span>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-ndark-bg">
                    <div className={`h-full rounded-full transition-all ${it.color}`} style={{ width: `${widthPct}%` }} />
                  </div>
                </>
              );
              return (
                <li key={it.key}>
                  {it.bucket ? (
                    <button
                      type="button"
                      onClick={() => onOpenDrilldown(it.bucket as DrilldownBucket, String(it.label))}
                      className="w-full rounded-md p-1 text-left transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:hover:bg-ndark-bg/50"
                      title="Vakaları gör"
                    >
                      {content}
                    </button>
                  ) : content}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function mapStatusItems(rows: { key: string; count: number }[]): DrilldownBarItem[] {
  // Bilinen statüleri sabit sırada göster, bilinmeyenleri sonuna ekle
  const known: DrilldownBarItem[] = STATUS_ORDER
    .map((s) => rows.find((r) => r.key === s))
    .filter((r): r is { key: string; count: number } => r != null && r.count > 0)
    .map((r) => ({
      key: r.key,
      label: STATUS_LABEL[r.key] ?? r.key,
      value: r.count,
      color: STATUS_COLOR[r.key] ?? 'bg-slate-500',
      bucket: { kind: 'status', key: r.key, label: STATUS_LABEL[r.key] ?? r.key },
    }));
  const unknown: DrilldownBarItem[] = rows
    .filter((r) => !STATUS_ORDER.includes(r.key))
    .map((r) => ({
      key: r.key,
      label: r.key,
      value: r.count,
      color: 'bg-slate-400',
      bucket: { kind: 'status', key: r.key, label: r.key },
    }));
  return [...known, ...unknown];
}

function mapPriorityItems(rows: { key: string; count: number }[]): DrilldownBarItem[] {
  const order = ['Critical', 'High', 'Medium', 'Low'];
  return order
    .map((p) => rows.find((r) => r.key === p))
    .filter((r): r is { key: string; count: number } => r != null && r.count > 0)
    .map((r) => ({
      key: r.key,
      label: PRIORITY_LABEL[r.key] ?? r.key,
      value: r.count,
      color: PRIORITY_COLOR[r.key] ?? 'bg-slate-500',
      bucket: { kind: 'priority', key: r.key, label: PRIORITY_LABEL[r.key] ?? r.key },
    }));
}

function mapCaseTypeItems(rows: { key: string; count: number }[]): DrilldownBarItem[] {
  return rows.map((r) => ({
    key: r.key,
    label: CASE_TYPE_LABEL[r.key] ?? r.key,
    value: r.count,
    color: CASE_TYPE_COLOR[r.key] ?? 'bg-slate-500',
    bucket: { kind: 'caseType', key: r.key, label: CASE_TYPE_LABEL[r.key] ?? r.key },
  }));
}

function mapCompanyItems(rows: { id: string; name: string; count: number }[]): DrilldownBarItem[] {
  const palette = ['bg-brand-500', 'bg-amber-500', 'bg-emerald-500', 'bg-violet-500', 'bg-rose-500'];
  return rows.map((r, i) => ({
    key: r.id,
    label: r.name || r.id,
    value: r.count,
    color: palette[i % palette.length],
    bucket: { kind: 'company', key: r.id, label: r.name || r.id },
  }));
}

// ===== Team breakdown =============================================

function TeamBreakdownCard({
  loading,
  rows,
  onOpenDrilldown,
}: {
  loading: boolean;
  rows: OperationsOverviewResponse['byTeam'];
  onOpenDrilldown: (bucket: DrilldownBucket, title: string) => void;
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
                    <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-ndark-text">
                      <button
                        type="button"
                        onClick={() => onOpenDrilldown({ kind: 'team', key: r.id, label: r.name }, r.name)}
                        className="rounded text-left hover:underline focus:outline-none focus:ring-2 focus:ring-brand-500"
                      >
                        {r.name}
                      </button>
                    </td>
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
  onOpenDrilldown,
}: {
  loading: boolean;
  rows: OperationsOverviewResponse['byCategory'];
  onOpenDrilldown: (bucket: DrilldownBucket, title: string) => void;
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
                  <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-ndark-text">
                    <button
                      type="button"
                      onClick={() => onOpenDrilldown({
                        kind: 'category',
                        category: r.category,
                        subCategory: r.subCategory,
                        label: r.subCategory ? `${r.category} / ${r.subCategory}` : r.category,
                      }, r.subCategory ? `${r.category} / ${r.subCategory}` : r.category)}
                      className="rounded text-left hover:underline focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      {r.category}
                    </button>
                  </td>
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
  onOpenDrilldown,
}: {
  loading: boolean;
  rows: OperationsOverviewResponse['topAtRiskAccounts'];
  onOpenDrilldown: (bucket: DrilldownBucket, title: string) => void;
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
                <th className="px-4 py-2.5 text-right">Eskale Edildi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-ndark-border">
              {rows.map((r) => (
                <tr key={r.accountId} className="hover:bg-slate-50 dark:hover:bg-ndark-bg/40">
                  <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-ndark-text">
                    <button
                      type="button"
                      onClick={() => onOpenDrilldown({ kind: 'atRiskAccount', key: r.accountId, label: r.accountName }, r.accountName)}
                      className="rounded text-left hover:underline focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      {r.accountName}
                    </button>
                  </td>
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

// ===== Drill-down drawer ==========================================

function DrilldownDrawer({
  open,
  title,
  request,
  bucket,
  body,
  lens,
  data,
  loading,
  error,
  onClose,
  onPageChange,
  onSort,
  onSelectCase,
  onOpenDrilldown,
}: {
  open: boolean;
  title: string;
  request: {
    page: number;
    sortBy: 'createdAt' | 'priority' | 'slaResolutionDueAt' | 'ageHours';
    sortDir: 'asc' | 'desc';
  } | null;
  bucket: DrilldownBucket | null;
  body: OverviewRequest;
  lens: LensKey;
  data: DrilldownResponse | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onPageChange: (page: number) => void;
  onSort: (sortBy: 'createdAt' | 'priority' | 'slaResolutionDueAt' | 'ageHours') => void;
  onSelectCase?: (caseId: string) => void;
  onOpenDrilldown: (bucket: DrilldownBucket, title: string) => void;
}) {
  // Stale-guard: bucket / page / sort / body degisirse assistant cevabini sifirla.
  const staleKey = useMemo(() => JSON.stringify({
    bucket,
    page: request?.page,
    sortBy: request?.sortBy,
    sortDir: request?.sortDir,
    body,
  }), [bucket, request?.page, request?.sortBy, request?.sortDir, body]);

  const [highlighted, setHighlighted] = useState<Set<string>>(() => new Set());

  // staleKey degistiginde highlight kapanir. Assistant card kendi state'ini
  // bu key'i prop olarak alip resetler.
  useEffect(() => {
    setHighlighted(new Set());
  }, [staleKey]);

  if (!open) return null;
  const page = data?.page ?? request?.page ?? 1;
  const pageSize = data?.pageSize ?? 50;
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Drill-down drawer kapat"
        className="absolute inset-0 bg-slate-900/35"
        onClick={onClose}
      />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-5xl flex-col bg-white shadow-2xl dark:bg-ndark-card">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-ndark-border">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-ndark-text">{data?.appliedBucket.label ?? title}</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-ndark-muted">
              {data ? `${formatInt(total)} vaka · Sayfa ${page}/${pageCount}` : 'Vaka listesi yükleniyor'}
              {data?.metricAuditId && <> · Audit <code className="font-mono">{data.metricAuditId}</code></>}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:text-ndark-muted dark:hover:bg-ndark-bg"
            aria-label="Kapat"
          >
            ×
          </button>
        </header>

        {data?.scope.narrowedFromBody && (
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-900 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-200">
            Kapsam server tarafında yetkili veriyle daraltıldı.
          </div>
        )}

        {bucket && (
          <div key={staleKey} className="border-b border-slate-200 px-5 py-2 dark:border-ndark-border">
            <DrilldownAssistantCard
              bucket={bucket}
              body={body}
              lens={lens}
              onAnswerChange={(ans) => {
                const set = new Set<string>();
                if (ans) {
                  for (const ev of ans.evidence) {
                    for (const n of ev.caseNumbers) set.add(n);
                  }
                }
                setHighlighted(set);
              }}
              onOpenDrilldown={onOpenDrilldown}
            />
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {error ? (
            <div className="p-5 text-sm text-rose-700 dark:text-rose-300">{error}</div>
          ) : loading && !data ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={18} />)}
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={<Inbox size={20} />}
                title="Bu kırılımda vaka yok"
                description="Filtreleri değiştirip tekrar deneyebilirsin."
              />
            </div>
          ) : (
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-ndark-border">
              <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-ndark-bg">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
                  <SortableDrawerTh label="Vaka" sortKey="createdAt" request={request} onSort={onSort} />
                  <th className="px-4 py-2.5">Müşteri</th>
                  <th className="px-4 py-2.5">Statü</th>
                  <SortableDrawerTh label="Öncelik" sortKey="priority" request={request} onSort={onSort} align="right" />
                  <th className="px-4 py-2.5">Atanan</th>
                  <SortableDrawerTh label="SLA" sortKey="slaResolutionDueAt" request={request} onSort={onSort} align="right" />
                  <SortableDrawerTh label="Yaş" sortKey="ageHours" request={request} onSort={onSort} align="right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-ndark-border">
                {data.items.map((row) => (
                  <DrilldownRow
                    key={row.id}
                    row={row}
                    highlighted={highlighted.has(row.caseNumber)}
                    onSelectCase={onSelectCase}
                    onClose={onClose}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 text-xs dark:border-ndark-border">
          <div className="text-slate-500 dark:text-ndark-muted">
            {data ? `${formatInt(Math.min(total, (page - 1) * pageSize + 1))}-${formatInt(Math.min(total, page * pageSize))} / ${formatInt(total)}` : '—'}
            {data && <span> · {data.durationMs} ms</span>}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)}>
              <ChevronLeft size={13} />
              Önceki
            </Button>
            <Button size="sm" variant="outline" disabled={page >= pageCount || loading} onClick={() => onPageChange(page + 1)}>
              Sonraki
              <ChevronRight size={13} />
            </Button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function SortableDrawerTh({
  label,
  sortKey,
  request,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: 'createdAt' | 'priority' | 'slaResolutionDueAt' | 'ageHours';
  request: { sortBy: string; sortDir: 'asc' | 'desc' } | null;
  onSort: (sortBy: 'createdAt' | 'priority' | 'slaResolutionDueAt' | 'ageHours') => void;
  align?: 'left' | 'right';
}) {
  const active = request?.sortBy === sortKey;
  return (
    <th className={`px-4 py-2.5 ${align === 'right' ? 'text-right' : ''}`}>
      <button type="button" onClick={() => onSort(sortKey)} className="rounded hover:underline focus:outline-none focus:ring-2 focus:ring-brand-500">
        {label}
        {active && <span className="ml-1">{request?.sortDir === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </th>
  );
}

function DrilldownRow({
  row,
  highlighted,
  onSelectCase,
  onClose,
}: {
  row: DrilldownCaseRow;
  highlighted?: boolean;
  onSelectCase?: (caseId: string) => void;
  onClose: () => void;
}) {
  return (
    <tr className={`hover:bg-slate-50 dark:hover:bg-ndark-bg/40 ${highlighted ? 'bg-violet-50/60 ring-1 ring-inset ring-violet-200 dark:bg-violet-900/20 dark:ring-violet-700/40' : ''}`}>
      <td className="px-4 py-3 align-top">
        <button
          type="button"
          onClick={() => {
            onSelectCase?.(row.id);
            onClose();
          }}
          className="group block w-[280px] max-w-full text-left focus:outline-none"
          title={row.title}
        >
          <span className="flex items-center gap-1.5 font-mono text-xs text-brand-700 group-hover:underline dark:text-brand-300">
            {row.caseNumber}
            <ExternalLink size={11} />
          </span>
          <span className="mt-0.5 block truncate text-sm font-medium text-slate-800 dark:text-ndark-text">{row.title}</span>
          <span className="mt-0.5 block text-[11px] text-slate-400">{formatDateTime(row.createdAt)}</span>
        </button>
      </td>
      <td className="px-4 py-3 align-top text-slate-700 dark:text-ndark-text">
        <div className="block w-[200px] max-w-full truncate" title={row.accountName ?? undefined}>{row.accountName}</div>
        <div className="block w-[200px] max-w-full truncate text-[11px] text-slate-400" title={row.companyName ?? undefined}>{row.companyName}</div>
      </td>
      <td className="px-4 py-3">
        <Badge tint={statusTint(row.status)}>{STATUS_LABEL[row.status] ?? row.status}</Badge>
      </td>
      <td className="px-4 py-3 text-right">
        <Badge tint={row.priority === 'Critical' ? 'rose' : row.priority === 'High' ? 'amber' : 'slate'}>
          {PRIORITY_LABEL[row.priority] ?? row.priority}
        </Badge>
      </td>
      <td className="px-4 py-3 text-slate-600 dark:text-ndark-muted">
        <div>{row.assignedPersonName ?? 'Atanmamış'}</div>
        <div className="text-[11px] text-slate-400">{row.assignedTeamName ?? 'Takım yok'}</div>
      </td>
      <td className="px-4 py-3 text-right text-slate-600 dark:text-ndark-muted">
        {row.slaViolation ? <Badge tint="rose">İhlal</Badge> : row.slaResolutionDueAt ? formatDateTime(row.slaResolutionDueAt) : '—'}
      </td>
      <td className="px-4 py-3 text-right text-slate-600 dark:text-ndark-muted">{formatHours(row.ageHours)}</td>
    </tr>
  );
}

function statusTint(status: string): BadgeTint {
  if (status === 'Çözüldü' || status === 'Cozuldu') return 'emerald';
  if (status === 'Eskalasyon') return 'rose';
  if (status === 'İncelemede' || status === 'Incelemede') return 'amber';
  return 'slate';
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}
