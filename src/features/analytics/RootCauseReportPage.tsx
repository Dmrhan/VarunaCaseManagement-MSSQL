import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Filter,
  Loader2,
  Network,
  RefreshCw,
  X,
} from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, TextInput } from '@/components/ui/Field';
import { caseService } from '@/services/caseService';
import { useToast } from '@/components/ui/Toast';
import type { Case } from '@/features/cases/types';

/**
 * Kök Neden Analiz Raporu — Supervisor / Admin / SystemAdmin için.
 *
 * Mevcut vaka verilerindeki 4 düz etiket alanını (rootCauseGroup /
 * rootCauseDetail / resolutionType / permanentPrevention) 4 seviyeli
 * hiyerarşik ağaca dönüştürür. Her seviyede koşullu yüzde hesaplar:
 *   L1 yüzdesi: grup / GENEL_TOPLAM
 *   L2 yüzdesi: detay / grubun toplamı
 *   L3 yüzdesi: çözüm / detayın toplamı
 *   L4 yüzdesi: önlem / çözümün toplamı
 *
 * Tüm hesaplama frontend'de — yeni backend endpoint yok.
 * Veriye erişim: customFields.smartTicket.closure (mevcut alan).
 */

interface RootCauseReportPageProps {
  onSelectCase: (id: string) => void;
}

// ─── Veri çıkarımı ────────────────────────────────────────────────

const UNSPECIFIED = '(Belirtilmemiş)';

interface ClosureFields {
  rootCauseGroup: string | null;
  rootCauseDetail: string;
  resolutionType: string;
  permanentPrevention: string;
}

function extractClosure(c: Case): ClosureFields {
  const st = (c.customFields?.smartTicket) as Record<string, unknown> | undefined;
  const cl = (st?.closure) as Record<string, unknown> | undefined;
  const label = (k: string): string | null =>
    ((cl?.[`${k}Label`] ?? cl?.[k] ?? null) as string | null) || null;
  return {
    rootCauseGroup: label('rootCauseGroup'),
    rootCauseDetail: label('rootCauseDetail') ?? UNSPECIFIED,
    resolutionType: label('resolutionType') ?? UNSPECIFIED,
    permanentPrevention: label('permanentPrevention') ?? UNSPECIFIED,
  };
}

interface OpeningFields {
  businessProcess: string | null;
  operationType: string | null;
  affectedObject: string | null;
}

function extractOpening(c: Case): OpeningFields {
  const st = (c.customFields?.smartTicket) as Record<string, unknown> | undefined;
  const label = (k: string): string | null =>
    ((st?.[`${k}Label`] ?? st?.[k] ?? null) as string | null) || null;
  return {
    businessProcess: label('businessProcess'),
    operationType: label('operationType'),
    affectedObject: label('affectedObject'),
  };
}

// ─── Ağaç tipleri ─────────────────────────────────────────────────

interface PreventionNode {
  name: string;
  count: number;
  pctOfResolution: number;
  caseIds: string[];
}

interface ResolutionNode {
  name: string;
  count: number;
  pctOfDetail: number;
  caseIds: string[];
  preventions: PreventionNode[];
}

interface DetailNode {
  name: string;
  count: number;
  pctOfGroup: number;
  pctOfTotal: number;
  caseIds: string[];
  resolutions: ResolutionNode[];
}

interface GroupNode {
  name: string;
  count: number;
  pctOfTotal: number;
  caseIds: string[];
  details: DetailNode[];
}

interface ReportTree {
  total: number;
  groups: GroupNode[];
}

// ─── Ağaç oluşturucu ──────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function groupByKey<T>(arr: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of arr) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return map;
}

function sortedEntries<T>(map: Map<string, T[]>): [string, T[]][] {
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
}

function buildTree(cases: Case[]): ReportTree {
  // Kök neden grubu boş olanları hariç tut (spec madde 1).
  const filtered = cases.filter(c => !!extractClosure(c).rootCauseGroup);
  const total = filtered.length;
  if (total === 0) return { total: 0, groups: [] };

  const groupMap = groupByKey(filtered, c => extractClosure(c).rootCauseGroup!);

  const groups: GroupNode[] = sortedEntries(groupMap).map(([groupName, groupCases]) => {
    const groupTotal = groupCases.length;

    const detailMap = groupByKey(groupCases, c => extractClosure(c).rootCauseDetail);
    const details: DetailNode[] = sortedEntries(detailMap).map(([detailName, detailCases]) => {
      const detailTotal = detailCases.length;

      const resMap = groupByKey(detailCases, c => extractClosure(c).resolutionType);
      const resolutions: ResolutionNode[] = sortedEntries(resMap).map(([resName, resCases]) => {
        const resTotal = resCases.length;

        const prevMap = groupByKey(resCases, c => extractClosure(c).permanentPrevention);
        const preventions: PreventionNode[] = sortedEntries(prevMap).map(([prevName, prevCases]) => ({
          name: prevName,
          count: prevCases.length,
          pctOfResolution: round1(prevCases.length / resTotal * 100),
          caseIds: prevCases.map(c => c.id),
        }));

        return {
          name: resName,
          count: resTotal,
          pctOfDetail: round1(resTotal / detailTotal * 100),
          caseIds: resCases.map(c => c.id),
          preventions,
        };
      });

      return {
        name: detailName,
        count: detailTotal,
        pctOfGroup: round1(detailTotal / groupTotal * 100),
        pctOfTotal: round1(detailTotal / total * 100),
        caseIds: detailCases.map(c => c.id),
        resolutions,
      };
    });

    return {
      name: groupName,
      count: groupTotal,
      pctOfTotal: round1(groupTotal / total * 100),
      caseIds: groupCases.map(c => c.id),
      details,
    };
  });

  return { total, groups };
}

// ─── İçgörü Haritası — problem kümeleri ───────────────────────────

interface NameCount {
  name: string;
  count: number;
}

interface InsightCluster {
  key: string;
  name: string;
  openingKind: 'businessProcess' | 'operationType';
  openingLabel: string;
  rootCauseGroup: string;
  affectedObject: string | null;
  count: number;
  pctOfClassified: number;
  pctOfAllCases: number;
  caseIds: string[];
  topRootCauseDetail: string;
  topPreventions: NameCount[];
  detailBreakdown: NameCount[];
  resolutionBreakdown: NameCount[];
  preventionBreakdown: NameCount[];
}

interface InsightMap {
  clusters: InsightCluster[];
  classifiedTotal: number;
  unclassifiedCount: number;
}

function buildInsightMap(cases: Case[]): InsightMap {
  interface Bucket {
    openingKind: 'businessProcess' | 'operationType';
    openingLabel: string;
    rootCauseGroup: string;
    affectedObject: string | null;
    cases: Case[];
  }

  const buckets = new Map<string, Bucket>();
  let unclassifiedCount = 0;

  for (const c of cases) {
    const op = extractOpening(c);
    const cl = extractClosure(c);
    const hasBp = !!op.businessProcess;
    const hasOt = !!op.operationType;
    const hasRcg = !!cl.rootCauseGroup;

    // Spec madde — üçü de boşsa kümeye dahil etme.
    if (!hasBp && !hasOt && !hasRcg) {
      unclassifiedCount++;
      continue;
    }

    const openingKind: 'businessProcess' | 'operationType' = hasBp ? 'businessProcess' : 'operationType';
    const openingLabel = hasBp ? op.businessProcess! : hasOt ? op.operationType! : UNSPECIFIED;
    const rootCauseGroup = cl.rootCauseGroup ?? UNSPECIFIED;
    const affectedObject = op.affectedObject;
    const key = `${openingKind}::${openingLabel}::${rootCauseGroup}::${affectedObject ?? ''}`;

    if (!buckets.has(key)) {
      buckets.set(key, { openingKind, openingLabel, rootCauseGroup, affectedObject, cases: [] });
    }
    buckets.get(key)!.cases.push(c);
  }

  const classifiedTotal = cases.length - unclassifiedCount;
  const allCasesTotal = cases.length;

  const clusters: InsightCluster[] = [...buckets.entries()]
    .map(([key, b]) => {
      // Set ile aynı vakanın bir kümede tekrar etmemesi garanti edilir.
      const caseIds = [...new Set(b.cases.map(c => c.id))];
      const count = caseIds.length;

      const detailMap = groupByKey(b.cases, c => extractClosure(c).rootCauseDetail);
      const resMap = groupByKey(b.cases, c => extractClosure(c).resolutionType);
      const prevMap = groupByKey(b.cases, c => extractClosure(c).permanentPrevention);

      const detailBreakdown = sortedEntries(detailMap).map(([name, arr]) => ({ name, count: arr.length }));
      const resolutionBreakdown = sortedEntries(resMap).map(([name, arr]) => ({ name, count: arr.length }));
      const preventionBreakdown = sortedEntries(prevMap).map(([name, arr]) => ({ name, count: arr.length }));

      const topRootCauseDetail = detailBreakdown[0]?.name ?? UNSPECIFIED;
      const topPreventions = preventionBreakdown.filter(p => p.name !== UNSPECIFIED).slice(0, 3);

      const objectSuffix = b.affectedObject ? ` (${b.affectedObject})` : '';
      const name = `${b.openingLabel} – ${b.rootCauseGroup}${objectSuffix}`;

      return {
        key,
        name,
        openingKind: b.openingKind,
        openingLabel: b.openingLabel,
        rootCauseGroup: b.rootCauseGroup,
        affectedObject: b.affectedObject,
        count,
        pctOfClassified: classifiedTotal === 0 ? 0 : round1(count / classifiedTotal * 100),
        pctOfAllCases: allCasesTotal === 0 ? 0 : round1(count / allCasesTotal * 100),
        caseIds,
        topRootCauseDetail,
        topPreventions,
        detailBreakdown,
        resolutionBreakdown,
        preventionBreakdown,
      };
    })
    .sort((a, b) => b.count - a.count);

  return { clusters, classifiedTotal, unclassifiedCount };
}

// ─── Progress bar bileşeni ────────────────────────────────────────

function PctBar({
  pct,
  color = 'bg-brand-500',
}: {
  pct: number;
  color?: string;
}) {
  return (
    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-ndark-bg/40">
      <div
        className={`h-full rounded-full ${color}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

// ─── Vaka listesi paneli ──────────────────────────────────────────

interface CasePanelProps {
  title: string;
  caseIds: string[];
  caseMap: Map<string, Case>;
  onSelectCase: (id: string) => void;
  onClose: () => void;
}

function CaseListPanel({ title, caseIds, caseMap, onSelectCase, onClose }: CasePanelProps) {
  return (
    <div className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white dark:border-ndark-border dark:bg-ndark-card">
      {/* Başlık */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-ndark-border">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
            Vakalar
          </p>
          <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-ndark-text">
            {title}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          <X size={14} />
        </Button>
      </div>

      {/* Liste */}
      <div className="flex-1 overflow-y-auto">
        <ul className="divide-y divide-slate-100 dark:divide-ndark-border">
          {caseIds.map((id) => {
            const c = caseMap.get(id);
            return (
              <li key={id}>
                <button
                  type="button"
                  className="flex w-full items-start gap-2 px-4 py-2.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-ndark-bg/40"
                  onClick={() => onSelectCase(id)}
                >
                  <ExternalLink
                    size={12}
                    className="mt-0.5 shrink-0 text-brand-500"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-800 dark:text-ndark-text">
                      {c?.caseNumber ?? `#${id}`}
                    </p>
                    {c?.title && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500 dark:text-ndark-muted">
                        {c.title}
                      </p>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-slate-200 px-4 py-2 dark:border-ndark-border">
        <p className="text-[11px] text-slate-400 dark:text-ndark-dim">
          {caseIds.length} vaka
        </p>
      </div>
    </div>
  );
}

// ─── İçgörü Haritası — küme detay dağılımı ────────────────────────

function BreakdownList({ title, items }: { title: string; items: NameCount[] }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-ndark-dim">
        {title}
      </p>
      <ul className="space-y-0.5">
        {items.map(item => (
          <li key={item.name} className="truncate text-xs text-slate-600 dark:text-ndark-muted">
            {item.name} <span className="text-slate-400 dark:text-ndark-dim">· {item.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Satır bileşenleri ────────────────────────────────────────────

function RowButton({
  label,
  count,
  pct,
  barColor,
  indent,
  expanded,
  hasChildren,
  onToggle,
  onShowCases,
}: {
  label: string;
  count: number;
  pct: number;
  barColor: string;
  indent: number;
  expanded?: boolean;
  hasChildren: boolean;
  onToggle?: () => void;
  onShowCases: () => void;
}) {
  return (
    <div
      className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-slate-50 dark:hover:bg-ndark-bg/40"
      style={{ paddingLeft: `${8 + indent * 20}px` }}
    >
      {/* Toggle */}
      <button
        type="button"
        className="flex shrink-0 items-center justify-center text-slate-400"
        onClick={hasChildren ? onToggle : undefined}
        disabled={!hasChildren}
        aria-label={expanded ? 'Daralt' : 'Genişlet'}
      >
        {hasChildren ? (
          expanded ? (
            <ChevronDown size={13} />
          ) : (
            <ChevronRight size={13} />
          )
        ) : (
          <span className="inline-block h-3 w-3" />
        )}
      </button>

      {/* Etiket */}
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left text-sm text-slate-800 dark:text-ndark-text"
        onClick={hasChildren ? onToggle : undefined}
      >
        {label}
      </button>

      {/* Yüzde + bar */}
      <div className="flex shrink-0 items-center gap-2">
        <PctBar pct={pct} color={barColor} />
        <span className="w-10 text-right text-[11px] tabular-nums text-slate-500 dark:text-ndark-muted">
          {pct}%
        </span>
        <span className="w-12 text-right text-[11px] tabular-nums text-slate-700 dark:text-ndark-text">
          {count} vaka
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="opacity-0 transition-opacity group-hover:opacity-100"
          onClick={onShowCases}
          title="Vakaları listele"
        >
          <ExternalLink size={11} />
        </Button>
      </div>
    </div>
  );
}

// ─── Ana sayfa ────────────────────────────────────────────────────

export function RootCauseReportPage({ onSelectCase }: RootCauseReportPageProps) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Çekilen tüm vakalar
  const [fetchedCases, setFetchedCases] = useState<Case[] | null>(null);
  // Hızlı arama için Map
  const caseMap = useMemo<Map<string, Case>>(
    () => new Map((fetchedCases ?? []).map(c => [c.id, c])),
    [fetchedCases],
  );

  // Ağaç hesabı — veri değişince yeniden hesapla
  const tree = useMemo<ReportTree | null>(
    () => (fetchedCases ? buildTree(fetchedCases) : null),
    [fetchedCases],
  );

  // İçgörü Haritası — veri değişince yeniden hesapla
  const insightMap = useMemo<InsightMap | null>(
    () => (fetchedCases ? buildInsightMap(fetchedCases) : null),
    [fetchedCases],
  );

  // Sekme: ağaç görünümü ya da içgörü haritası
  const [viewMode, setViewMode] = useState<'tree' | 'insights'>('tree');

  // İçgörü Haritası — eşik altındaki kümeleri gizle
  const [minClusterSize, setMinClusterSize] = useState(1);
  const thresholdClusters = useMemo(
    () => (insightMap ? insightMap.clusters.filter(cl => cl.count >= minClusterSize) : []),
    [insightMap, minClusterSize],
  );
  const hiddenClusterCount = insightMap ? insightMap.clusters.length - thresholdClusters.length : 0;
  const [openClusters, setOpenClusters] = useState<Set<string>>(new Set());

  // İçgörü Haritası — kök neden grubu ve iş süreci filtreleri (eşik filtreli liste üzerinden)
  const [selectedRootCauseGroup, setSelectedRootCauseGroup] = useState<string | null>(null);
  const [selectedBusinessProcess, setSelectedBusinessProcess] = useState<string | null>(null);

  const rootCauseGroups = useMemo(() => {
    const groups = new Set<string>();
    thresholdClusters.forEach(cluster => {
      if (cluster.rootCauseGroup && cluster.rootCauseGroup !== UNSPECIFIED) {
        groups.add(cluster.rootCauseGroup);
      }
    });
    return Array.from(groups).sort((a, b) => a.localeCompare(b, 'tr'));
  }, [thresholdClusters]);

  const businessProcesses = useMemo(() => {
    const procs = new Set<string>();
    thresholdClusters.forEach(cluster => {
      if (cluster.openingKind === 'businessProcess' && cluster.openingLabel !== UNSPECIFIED) {
        procs.add(cluster.openingLabel);
      }
    });
    return Array.from(procs).sort((a, b) => a.localeCompare(b, 'tr'));
  }, [thresholdClusters]);

  const visibleClusters = useMemo(
    () =>
      thresholdClusters.filter(cluster => {
        if (selectedRootCauseGroup !== null && cluster.rootCauseGroup !== selectedRootCauseGroup) return false;
        if (
          selectedBusinessProcess !== null &&
          !(cluster.openingKind === 'businessProcess' && cluster.openingLabel === selectedBusinessProcess)
        ) {
          return false;
        }
        return true;
      }),
    [thresholdClusters, selectedRootCauseGroup, selectedBusinessProcess],
  );

  // Accordion open state'leri
  const [openGroups, setOpenGroups]     = useState<Set<string>>(new Set());
  const [openDetails, setOpenDetails]   = useState<Set<string>>(new Set());
  const [openRes, setOpenRes]           = useState<Set<string>>(new Set());

  // Vaka paneli
  const [panel, setPanel] = useState<{ title: string; caseIds: string[] } | null>(null);

  const { toast } = useToast();
  const aliveRef = useRef(true);

  // Tüm sayfaları çekerek vaka listesi al
  async function fetchAll() {
    setLoading(true);
    setError(null);
    setFetchedCases(null);
    setPanel(null);
    setOpenGroups(new Set());
    setOpenDetails(new Set());
    setOpenRes(new Set());
    setOpenClusters(new Set());

    const PAGE_SIZE = 200;
    const accumulated: Case[] = [];
    let page = 1;

    try {
      while (true) {
        const { items, total } = await caseService.list(
          {
            dateFrom: dateFrom || undefined,
            dateTo:   dateTo   || undefined,
          },
          { page, pageSize: PAGE_SIZE },
        );
        if (!aliveRef.current) return;
        accumulated.push(...items);
        if (accumulated.length >= total || items.length === 0) break;
        page++;
      }
      setFetchedCases(accumulated);
    } catch (e) {
      if (!aliveRef.current) return;
      const msg = (e as Error)?.message ?? 'Veriler yüklenemedi.';
      setError(msg);
      toast({ type: 'error', message: msg });
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }

  // Toggle helpers
  function toggleGroup(name: string) {
    setOpenGroups(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }
  function toggleDetail(key: string) {
    setOpenDetails(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  function toggleRes(key: string) {
    setOpenRes(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  function toggleCluster(key: string) {
    setOpenClusters(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function handleRootCauseGroupChange(value: string) {
    setSelectedRootCauseGroup(value || null);
    setOpenClusters(new Set());
    setPanel(null);
  }

  function handleBusinessProcessChange(value: string) {
    setSelectedBusinessProcess(value || null);
    setOpenClusters(new Set());
    setPanel(null);
  }

  // Tarih/eşik değişimi seçili filtreyi geçersiz kılarsa "Tümü"ye dön ve açık satır/paneli temizle.
  useEffect(() => {
    if (selectedRootCauseGroup && !rootCauseGroups.includes(selectedRootCauseGroup)) {
      setSelectedRootCauseGroup(null);
      setOpenClusters(new Set());
      setPanel(null);
    }
  }, [rootCauseGroups, selectedRootCauseGroup]);

  useEffect(() => {
    if (selectedBusinessProcess && !businessProcesses.includes(selectedBusinessProcess)) {
      setSelectedBusinessProcess(null);
      setOpenClusters(new Set());
      setPanel(null);
    }
  }, [businessProcesses, selectedBusinessProcess]);

  const hasFetched = fetchedCases !== null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Başlık & filtre ── */}
      <div className="flex flex-wrap items-end gap-3 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Network size={18} className="text-brand-500" />
            <h1 className="text-lg font-semibold text-slate-900 dark:text-ndark-text">
              Kök Neden Analiz Raporu
            </h1>
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-ndark-muted">
            Kapanış kategorilerinin 4 seviyeli hiyerarşik analizi
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-end gap-2">
          <Field label="Başlangıç tarihi" className="w-36">
            <TextInput
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              max={dateTo || undefined}
            />
          </Field>
          <Field label="Bitiş tarihi" className="w-36">
            <TextInput
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              min={dateFrom || undefined}
            />
          </Field>
          <Button
            leftIcon={loading ? <Loader2 size={13} className="animate-spin" /> : <Filter size={13} />}
            disabled={loading}
            onClick={() => void fetchAll()}
          >
            {loading ? 'Yükleniyor…' : 'Analiz Et'}
          </Button>
          {hasFetched && (
            <Button
              variant="outline"
              leftIcon={<RefreshCw size={13} />}
              disabled={loading}
              onClick={() => void fetchAll()}
              title="Yenile"
            />
          )}
        </div>
      </div>

      {/* ── İçerik ── */}
      <div className="flex min-h-0 flex-1 gap-4">
        {/* Ana kart */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          {/* Başlangıç durumu */}
          {!hasFetched && !loading && !error && (
            <Card>
              <CardBody>
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Network size={32} className="mb-3 text-slate-300 dark:text-ndark-dim" />
                  <p className="text-sm font-medium text-slate-600 dark:text-ndark-muted">
                    Tarih aralığı seçin ve "Analiz Et"e tıklayın
                  </p>
                  <p className="mt-1 text-xs text-slate-400 dark:text-ndark-dim">
                    Tarih filtresi opsiyoneldir — boş bırakırsanız tüm vakalar analiz edilir.
                  </p>
                </div>
              </CardBody>
            </Card>
          )}

          {/* Yükleniyor */}
          {loading && (
            <Card>
              <CardBody>
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500 dark:text-ndark-muted">
                  <Loader2 size={16} className="animate-spin text-brand-500" />
                  Vakalar yükleniyor…
                </div>
              </CardBody>
            </Card>
          )}

          {/* Hata */}
          {error && !loading && (
            <Card>
              <CardBody>
                <div className="flex items-center justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200">
                  <span>{error}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    leftIcon={<RefreshCw size={11} />}
                    onClick={() => void fetchAll()}
                  >
                    Tekrar dene
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}

          {/* Sekmeler */}
          {hasFetched && !loading && tree && (
            <div className="mb-3 flex items-center gap-1 border-b border-slate-200 dark:border-ndark-border">
              <button
                type="button"
                onClick={() => setViewMode('tree')}
                className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  viewMode === 'tree'
                    ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-ndark-muted'
                }`}
              >
                Kök Neden Dağılımı
              </button>
              <button
                type="button"
                onClick={() => setViewMode('insights')}
                className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  viewMode === 'insights'
                    ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-ndark-muted'
                }`}
              >
                İçgörü Haritası
              </button>
            </div>
          )}

          {/* Ağaç */}
          {hasFetched && !loading && tree && viewMode === 'tree' && (
            <Card>
              <CardBody>
                {/* Özet başlık */}
                <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-slate-100 pb-3 dark:border-ndark-border">
                  <span className="text-sm font-semibold text-slate-700 dark:text-ndark-text">
                    Genel Toplam:
                  </span>
                  <Badge tint="slate">{tree.total} vaka</Badge>
                  <Badge tint="emerald">{tree.groups.length} kök neden grubu</Badge>
                  {(dateFrom || dateTo) && (
                    <span className="text-xs text-slate-400 dark:text-ndark-dim">
                      {dateFrom && dateTo
                        ? `${dateFrom} – ${dateTo} arası`
                        : dateFrom
                        ? `${dateFrom} tarihinden itibaren`
                        : `${dateTo} tarihine kadar`}
                    </span>
                  )}
                </div>

                {tree.total === 0 && (
                  <p className="py-6 text-center text-sm text-slate-400 dark:text-ndark-dim">
                    Seçili aralıkta kök neden grubu dolu vaka bulunamadı.
                  </p>
                )}

                {/* Sütun başlıkları */}
                {tree.total > 0 && (
                  <div className="mb-1 flex items-center gap-2 px-2 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-ndark-dim">
                    <span className="ml-5 flex-1">Kategori</span>
                    <span className="w-24 text-right">Yüzde</span>
                    <span className="w-10 text-right">%</span>
                    <span className="w-12 text-right">Adet</span>
                    <span className="w-7" />
                  </div>
                )}

                {/* ── Level 1: Kök Neden Grubu ── */}
                {tree.groups.map(group => {
                  const gOpen = openGroups.has(group.name);
                  return (
                    <div key={group.name}>
                      <RowButton
                        label={group.name}
                        count={group.count}
                        pct={group.pctOfTotal}
                        barColor="bg-brand-500"
                        indent={0}
                        expanded={gOpen}
                        hasChildren={group.details.length > 0}
                        onToggle={() => toggleGroup(group.name)}
                        onShowCases={() =>
                          setPanel({ title: group.name, caseIds: group.caseIds })
                        }
                      />

                      {/* ── Level 2: Kök Neden Detayı ── */}
                      {gOpen &&
                        group.details.map(detail => {
                          const dKey = `${group.name}||${detail.name}`;
                          const dOpen = openDetails.has(dKey);
                          return (
                            <div key={dKey}>
                              <RowButton
                                label={detail.name}
                                count={detail.count}
                                pct={detail.pctOfGroup}
                                barColor="bg-sky-500"
                                indent={1}
                                expanded={dOpen}
                                hasChildren={detail.resolutions.length > 0}
                                onToggle={() => toggleDetail(dKey)}
                                onShowCases={() =>
                                  setPanel({ title: `${group.name} › ${detail.name}`, caseIds: detail.caseIds })
                                }
                              />

                              {/* ── Level 3: Çözüm Tipi ── */}
                              {dOpen &&
                                detail.resolutions.map(res => {
                                  const rKey = `${dKey}||${res.name}`;
                                  const rOpen = openRes.has(rKey);
                                  return (
                                    <div key={rKey}>
                                      <RowButton
                                        label={res.name}
                                        count={res.count}
                                        pct={res.pctOfDetail}
                                        barColor="bg-amber-500"
                                        indent={2}
                                        expanded={rOpen}
                                        hasChildren={res.preventions.length > 0}
                                        onToggle={() => toggleRes(rKey)}
                                        onShowCases={() =>
                                          setPanel({
                                            title: `${detail.name} › ${res.name}`,
                                            caseIds: res.caseIds,
                                          })
                                        }
                                      />

                                      {/* ── Level 4: Kalıcı Önlem ── */}
                                      {rOpen &&
                                        res.preventions.map(prev => (
                                          <div
                                            key={`${rKey}||${prev.name}`}
                                            className="group flex items-center gap-2 rounded-md py-1.5 transition-colors hover:bg-slate-50 dark:hover:bg-ndark-bg/40"
                                            style={{ paddingLeft: `${8 + 3 * 20}px` }}
                                          >
                                            <span className="inline-block h-3 w-3 shrink-0" />
                                            <span className="min-w-0 flex-1 truncate text-[12px] text-slate-600 dark:text-ndark-muted">
                                              {prev.name}
                                            </span>
                                            <div className="flex shrink-0 items-center gap-2">
                                              <PctBar pct={prev.pctOfResolution} color="bg-violet-500" />
                                              <span className="w-10 text-right text-[11px] tabular-nums text-slate-500 dark:text-ndark-muted">
                                                {prev.pctOfResolution}%
                                              </span>
                                              <span className="w-12 text-right text-[11px] tabular-nums text-slate-700 dark:text-ndark-text">
                                                {prev.count} vaka
                                              </span>
                                              <Button
                                                size="sm"
                                                variant="ghost"
                                                className="opacity-0 transition-opacity group-hover:opacity-100"
                                                onClick={() =>
                                                  setPanel({
                                                    title: `${res.name} › ${prev.name}`,
                                                    caseIds: prev.caseIds,
                                                  })
                                                }
                                                title="Vakaları listele"
                                              >
                                                <ExternalLink size={11} />
                                              </Button>
                                            </div>
                                          </div>
                                        ))}
                                    </div>
                                  );
                                })}
                            </div>
                          );
                        })}
                    </div>
                  );
                })}
              </CardBody>
            </Card>
          )}

          {/* İçgörü Haritası */}
          {hasFetched && !loading && insightMap && viewMode === 'insights' && (
            <Card>
              <CardBody>
                {/* Özet başlık */}
                <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-slate-100 pb-3 dark:border-ndark-border">
                  <span className="text-sm font-semibold text-slate-700 dark:text-ndark-text">
                    Sınıflandırılan Toplam:
                  </span>
                  <Badge tint="slate">{insightMap.classifiedTotal} vaka</Badge>
                  <Badge tint="emerald">{visibleClusters.length} problem kümesi</Badge>

                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-slate-500 dark:text-ndark-muted">Min. küme büyüklüğü</span>
                    <select
                      value={minClusterSize}
                      onChange={e => setMinClusterSize(Number(e.target.value))}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
                    >
                      {[1, 3, 5, 10].map(n => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Kök neden grubu ve iş süreci filtre alanları */}
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 dark:text-ndark-muted">İş Süreci</span>
                    <select
                      value={selectedBusinessProcess ?? ''}
                      onChange={e => handleBusinessProcessChange(e.target.value)}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
                    >
                      <option value="">Tümü · {thresholdClusters.length}</option>
                      {businessProcesses.map(proc => {
                        const count = thresholdClusters.filter(
                          c => c.openingKind === 'businessProcess' && c.openingLabel === proc,
                        ).length;
                        return (
                          <option key={proc} value={proc}>
                            {proc} · {count}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 dark:text-ndark-muted">Kök Neden Grubu</span>
                    <select
                      value={selectedRootCauseGroup ?? ''}
                      onChange={e => handleRootCauseGroupChange(e.target.value)}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
                    >
                      <option value="">Tümü · {thresholdClusters.length}</option>
                      {rootCauseGroups.map(group => {
                        const count = thresholdClusters.filter(c => c.rootCauseGroup === group).length;
                        return (
                          <option key={group} value={group}>
                            {group} · {count}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>

                {/* Seçim özeti */}
                {(selectedRootCauseGroup !== null || selectedBusinessProcess !== null) && (
                  <p className="mb-3 text-xs text-slate-400 dark:text-ndark-dim">
                    {[selectedRootCauseGroup, selectedBusinessProcess].filter(Boolean).join(' · ')} · {visibleClusters.length} küme
                  </p>
                )}

                {visibleClusters.length === 0 && (
                  <p className="py-6 text-center text-sm text-slate-400 dark:text-ndark-dim">
                    {selectedRootCauseGroup === null && selectedBusinessProcess === null
                      ? 'Seçili eşikte gösterilecek problem kümesi bulunamadı.'
                      : 'Bu filtreye ait küme bulunamadı.'}
                  </p>
                )}

                {/* Sütun başlıkları */}
                {visibleClusters.length > 0 && (
                  <div className="mb-1 grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,1.2fr)] gap-3 px-2 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-ndark-dim">
                    <span>Problem Kümesi</span>
                    <span>Veri Yorumu</span>
                    <span>Ürün Aksiyonu</span>
                  </div>
                )}

                <div className="space-y-1">
                  {visibleClusters.map(cluster => {
                    const isOpen = openClusters.has(cluster.key);
                    return (
                      <div
                        key={cluster.key}
                        className="rounded-md border border-slate-100 dark:border-ndark-border"
                      >
                        <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,1.2fr)] gap-3 px-2 py-2">
                          {/* Sütun 1 — Problem Kümesi */}
                          <div className="min-w-0">
                            <button
                              type="button"
                              className="flex items-center gap-1.5 text-left text-sm font-medium text-slate-800 dark:text-ndark-text"
                              onClick={() => toggleCluster(cluster.key)}
                            >
                              {isOpen ? (
                                <ChevronDown size={13} className="shrink-0 text-slate-400" />
                              ) : (
                                <ChevronRight size={13} className="shrink-0 text-slate-400" />
                              )}
                              <span className="truncate">{cluster.name}</span>
                            </button>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <Badge tint="slate">{cluster.count} vaka</Badge>
                              <Badge tint="sky">
                                {cluster.openingKind === 'businessProcess' ? 'İş Süreci' : 'İşlem Tipi'}: {cluster.openingLabel}
                              </Badge>
                              <Badge tint="amber">Kök Neden: {cluster.rootCauseGroup}</Badge>
                            </div>
                          </div>

                          {/* Sütun 2 — Veri Yorumu */}
                          <div className="space-y-0.5 text-xs leading-relaxed text-slate-600 dark:text-ndark-muted">
                            <p>
                              {cluster.count} vaka, analiz edilen vakaların %{cluster.pctOfClassified}'sini oluşturuyor.
                            </p>
                            <p>Tüm vakaların %{cluster.pctOfAllCases}'ini oluşturuyor.</p>
                            {cluster.topRootCauseDetail !== UNSPECIFIED && (
                              <p>En sık kök neden detayı: {cluster.topRootCauseDetail}.</p>
                            )}
                          </div>

                          {/* Sütun 3 — Ürün Aksiyonu */}
                          <div>
                            <p className="text-[10px] text-slate-400 dark:text-ndark-dim">
                              Mevcut kalıcı önlem etiketlerinden türetilmiştir.
                            </p>
                            {cluster.topPreventions.length === 0 ? (
                              <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">
                                Kalıcı önlem önerisi gerekli
                              </p>
                            ) : (
                              <ul className="mt-1 space-y-0.5">
                                {cluster.topPreventions.map(p => (
                                  <li
                                    key={p.name}
                                    className="truncate text-xs text-slate-700 dark:text-ndark-text"
                                  >
                                    {p.name} · {p.count} vaka
                                  </li>
                                ))}
                              </ul>
                            )}
                            <div className="mt-2">
                              <Button
                                size="sm"
                                variant="outline"
                                leftIcon={<ExternalLink size={11} />}
                                onClick={() => setPanel({ title: cluster.name, caseIds: cluster.caseIds })}
                              >
                                Vakaları Gör
                              </Button>
                            </div>
                          </div>
                        </div>

                        {/* Genişletildiğinde — detay dağılımı */}
                        {isOpen && (
                          <div className="grid grid-cols-3 gap-3 border-t border-slate-100 px-3 py-2 dark:border-ndark-border">
                            <BreakdownList title="Kök Neden Detayı" items={cluster.detailBreakdown} />
                            <BreakdownList title="Çözüm Tipi" items={cluster.resolutionBreakdown} />
                            <BreakdownList title="Kalıcı Önlem" items={cluster.preventionBreakdown} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {hiddenClusterCount > 0 && (
                  <p className="mt-3 text-xs text-slate-400 dark:text-ndark-dim">
                    {hiddenClusterCount} küme eşik altında gizlendi.
                  </p>
                )}
                {insightMap.unclassifiedCount > 0 && (
                  <p className="mt-1 text-xs text-slate-400 dark:text-ndark-dim">
                    {insightMap.unclassifiedCount} vaka etiket eksikliği nedeniyle sınıflandırılamadı.
                  </p>
                )}
              </CardBody>
            </Card>
          )}

        </div>

        {/* ── Vaka paneli ── */}
        {panel && (
          <CaseListPanel
            title={panel.title}
            caseIds={panel.caseIds}
            caseMap={caseMap}
            onSelectCase={onSelectCase}
            onClose={() => setPanel(null)}
          />
        )}
      </div>
    </div>
  );
}
