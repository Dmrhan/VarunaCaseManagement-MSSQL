import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  Inbox,
  Layers,
  ShieldAlert,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { BarList } from '@/components/charts/BarList';
import { Donut } from '@/components/charts/Donut';
import { TrendLine } from '@/components/charts/TrendLine';
import { MetricTile } from '@/components/charts/MetricTile';
import { caseService } from '@/services/caseService';
import {
  CASE_PRIORITIES,
  CASE_PRIORITY_LABELS,
  CASE_STATUSES,
  CASE_TYPE_LABELS,
  type Case,
  type CasePriority,
  type CaseStatus,
  type CaseType,
} from '@/features/cases/types';

const STATUS_COLOR: Record<CaseStatus, string> = {
  'Açık':                'bg-blue-500',
  'İncelemede':          'bg-amber-500',
  '3rdPartyBekleniyor':  'bg-slate-500',
  'Eskalasyon':          'bg-rose-500',
  'Çözüldü':             'bg-emerald-500',
  'YenidenAcildi':       'bg-violet-500',
  'İptalEdildi':         'bg-slate-300',
};

const PRIORITY_COLOR: Record<CasePriority, string> = {
  Low:      'bg-slate-400',
  Medium:   'bg-blue-500',
  High:     'bg-amber-500',
  Critical: 'bg-rose-600',
};

const TYPE_HEX: Record<CaseType, string> = {
  GeneralSupport:    '#0d9488', // teal-600
  ProactiveTracking: '#7c3aed', // violet-600
  Churn:             '#e11d48', // rose-600
};

const COMPANY_HEX: Record<string, string> = {
  PARAM:    '#3b62f5', // brand-500
  UNIVERA:  '#f59e0b', // amber-500
  FINROTA:  '#10b981', // emerald-500
};

export function CaseAnalyticsPage() {
  const [items, setItems] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void caseService.list().then(({ items }) => {
      if (alive) {
        setItems(items);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const stats = useMemo(() => computeStats(items), [items]);

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Analytics yükleniyor…</div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Case Analytics</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Vaka yönetiminin genel performansını izle. Veriler son 30 gün penceresinde.
        </p>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <MetricTile
          label="Toplam Vaka"
          value={stats.total}
          hint={`Açık: ${stats.open}`}
          icon={<Inbox size={12} />}
          tone="info"
        />
        <MetricTile
          label="Ort. Çözüm Süresi"
          value={stats.avgTtrText}
          hint={`${stats.resolvedCount} çözülen vaka`}
          icon={<Clock size={12} />}
          tone="neutral"
        />
        <MetricTile
          label="SLA İhlal"
          value={`%${stats.slaBreachRate.toFixed(0)}`}
          hint={`${stats.slaBreachCount} ihlal / ${stats.openOrTerminal} aktif`}
          icon={<ShieldAlert size={12} />}
          tone={stats.slaBreachRate > 15 ? 'danger' : stats.slaBreachRate > 8 ? 'warn' : 'good'}
        />
        <MetricTile
          label="Yeniden Açılma"
          value={`%${stats.reopenRate.toFixed(0)}`}
          hint={`${stats.reopenedCount} vaka`}
          icon={<TrendingDown size={12} />}
          tone={stats.reopenRate > 8 ? 'warn' : 'neutral'}
        />
        <MetricTile
          label="Critical Açık"
          value={stats.criticalOpen}
          hint={`Toplam: ${stats.byPriority.find((p) => p.key === 'Critical')?.value ?? 0}`}
          icon={<AlertTriangle size={12} />}
          tone={stats.criticalOpen > 0 ? 'danger' : 'good'}
        />
        <MetricTile
          label="Retention Başarı"
          value={`%${stats.retentionRate.toFixed(0)}`}
          hint={`${stats.retentionSuccess} / ${stats.retentionTotal} Churn`}
          icon={<CheckCircle2 size={12} />}
          tone={stats.retentionRate > 60 ? 'good' : stats.retentionRate > 30 ? 'warn' : 'danger'}
        />
      </div>

      {/* Trend grafikleri */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-800">Son 30 Gün — Açılan / Çözülen</h2>
          </div>
          <Badge tint="slate">{stats.trend.totalCreated} yeni · {stats.trend.totalResolved} çözüm</Badge>
        </CardHeader>
        <CardBody>
          <TrendLine
            series={[
              { label: 'Açılan',   color: '#3b62f5', values: stats.trend.created },
              { label: 'Çözülen',  color: '#10b981', values: stats.trend.resolved },
            ]}
            xLabels={stats.trend.labels}
            height={140}
          />
        </CardBody>
      </Card>

      {/* Funnel + Tip donutu */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Layers size={16} className="text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-800">Statü Dağılımı</h2>
            </div>
            <span className="text-xs text-slate-500">{stats.total} vaka</span>
          </CardHeader>
          <CardBody>
            <BarList items={stats.byStatus} showPct />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Target size={16} className="text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-800">Vaka Tipi</h2>
            </div>
          </CardHeader>
          <CardBody>
            <Donut
              slices={stats.byType}
              centerValue={String(stats.total)}
              centerLabel="Toplam"
            />
          </CardBody>
        </Card>
      </div>

      {/* Şirket + Priority */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 size={16} className="text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-800">Şirkete Göre Vakalar</h2>
            </div>
          </CardHeader>
          <CardBody>
            <BarList items={stats.byCompany} showPct />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-800">Önceliğe Göre Vakalar</h2>
            </div>
          </CardHeader>
          <CardBody>
            <BarList items={stats.byPriority} showPct />
          </CardBody>
        </Card>
      </div>

      {/* Kategori breakdown */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-800">Kategori Dağılımı</h2>
          </div>
          <span className="text-xs text-slate-500">{stats.byCategory.length} kategori</span>
        </CardHeader>
        <CardBody className="!p-0">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5">Kategori</th>
                <th className="px-4 py-2.5 text-right">Toplam</th>
                <th className="px-4 py-2.5 text-right">Açık</th>
                <th className="px-4 py-2.5 text-right">SLA İhlal</th>
                <th className="px-4 py-2.5 text-right">Ort. TTR (saat)</th>
                <th className="px-4 py-2.5">Dağılım</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stats.byCategory.map((c) => (
                <tr key={c.category} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{c.category}</td>
                  <td className="px-4 py-2.5 text-right text-slate-700">{c.total}</td>
                  <td className="px-4 py-2.5 text-right text-slate-700">{c.open}</td>
                  <td className="px-4 py-2.5 text-right">
                    {c.breach > 0 ? (
                      <Badge tint="rose">{c.breach}</Badge>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-700">
                    {c.avgTtrHours > 0 ? c.avgTtrHours.toFixed(1) : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-brand-500"
                        style={{ width: `${(c.total / stats.byCategoryMax) * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {/* Churn risk kartı + ekip yükü */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Wallet size={16} className="text-rose-500" />
              <h2 className="text-sm font-semibold text-slate-800">Churn Risk Paneli</h2>
            </div>
            <Badge tint="rose">{stats.churn.openCount} açık</Badge>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 gap-3">
              <ChurnTile label="Açık Churn"        value={stats.churn.openCount}     tone="rose" />
              <ChurnTile label="Bekleyen Teklif"   value={stats.churn.pendingOffers} tone="amber" />
              <ChurnTile label="Teklif Kabul"      value={stats.churn.acceptedOffers} tone="emerald" />
              <ChurnTile label="Reddedilen Teklif" value={stats.churn.rejectedOffers} tone="slate" />
            </div>
            <div className="mt-4 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Retention Sonucu
              </div>
              <BarList
                items={[
                  { key: 'success', label: 'Başarılı',     value: stats.churn.retentionSuccess, color: 'bg-emerald-500' },
                  { key: 'fail',    label: 'Başarısız',    value: stats.churn.retentionFail,    color: 'bg-rose-500' },
                  { key: 'cont',    label: 'Devam Ediyor', value: stats.churn.retentionPending, color: 'bg-slate-400' },
                ]}
                showPct
              />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users size={16} className="text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-800">Takım Yükü</h2>
            </div>
            <span className="text-xs text-slate-500">Aktif vakalar</span>
          </CardHeader>
          <CardBody>
            <BarList items={stats.byTeam} showPct />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function ChurnTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'rose' | 'amber' | 'emerald' | 'slate';
}) {
  const tones = {
    rose:    'bg-rose-50 ring-rose-200 text-rose-800',
    amber:   'bg-amber-50 ring-amber-200 text-amber-800',
    emerald: 'bg-emerald-50 ring-emerald-200 text-emerald-800',
    slate:   'bg-slate-50 ring-slate-200 text-slate-700',
  };
  return (
    <div className={`rounded-md p-2.5 ring-1 ring-inset ${tones[tone]}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-0.5 text-xl font-semibold">{value}</div>
    </div>
  );
}

// ----------------------------------------------------------------
// Stats computation
// ----------------------------------------------------------------

function computeStats(items: Case[]) {
  const total = items.length;
  const isOpen = (c: Case) => c.status !== 'Çözüldü' && c.status !== 'İptalEdildi';
  const open = items.filter(isOpen).length;
  const openOrTerminal = open || 1;

  const resolvedItems = items.filter((c) => c.resolvedAt);
  const resolvedCount = resolvedItems.length;
  const avgTtrMin =
    resolvedItems.length > 0
      ? resolvedItems.reduce(
          (sum, c) => sum + (new Date(c.resolvedAt!).getTime() - new Date(c.createdAt).getTime()) / 60000,
          0,
        ) / resolvedItems.length
      : 0;
  const avgTtrText = formatMinutes(avgTtrMin);

  const slaBreachCount = items.filter((c) => c.slaViolation).length;
  const slaBreachRate = open > 0 ? (slaBreachCount / open) * 100 : 0;

  const reopenedCount = items.filter((c) =>
    c.history.some((h) => h.toValue === 'YenidenAcildi'),
  ).length;
  const reopenRate = total > 0 ? (reopenedCount / total) * 100 : 0;

  const criticalOpen = items.filter((c) => c.priority === 'Critical' && isOpen(c)).length;

  // Status dağılımı
  const byStatus = CASE_STATUSES.map((s) => ({
    key: s,
    label: <span className="inline-flex items-center gap-1.5">{s}</span>,
    value: items.filter((c) => c.status === s).length,
    color: STATUS_COLOR[s],
  }));

  // Tip dağılımı (donut)
  const byType = (Object.keys(CASE_TYPE_LABELS) as CaseType[]).map((t) => ({
    key: t,
    label: CASE_TYPE_LABELS[t],
    value: items.filter((c) => c.caseType === t).length,
    color: TYPE_HEX[t],
  }));

  // Şirket
  const companies = ['PARAM', 'UNIVERA', 'FINROTA'];
  const byCompany = companies.map((name) => {
    const v = items.filter((c) => c.companyName === name).length;
    return {
      key: name,
      label: <span className="inline-flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: COMPANY_HEX[name] }} />
        {name}
      </span>,
      value: v,
      color: name === 'PARAM' ? 'bg-brand-500' : name === 'UNIVERA' ? 'bg-amber-500' : 'bg-emerald-500',
    };
  });

  // Priority
  const byPriority = CASE_PRIORITIES.map((p) => ({
    key: p,
    label: CASE_PRIORITY_LABELS[p],
    value: items.filter((c) => c.priority === p).length,
    color: PRIORITY_COLOR[p],
  }));

  // Kategori breakdown
  const categories = Array.from(new Set(items.map((c) => c.category)));
  const byCategory = categories
    .map((cat) => {
      const inCat = items.filter((c) => c.category === cat);
      const openCnt = inCat.filter(isOpen).length;
      const ttrItems = inCat.filter((c) => c.resolvedAt);
      const avgTtrHours =
        ttrItems.length > 0
          ? ttrItems.reduce(
              (sum, c) =>
                sum + (new Date(c.resolvedAt!).getTime() - new Date(c.createdAt).getTime()) / 3600000,
              0,
            ) / ttrItems.length
          : 0;
      const breach = inCat.filter((c) => c.slaViolation).length;
      return { category: cat, total: inCat.length, open: openCnt, avgTtrHours, breach };
    })
    .sort((a, b) => b.total - a.total);
  const byCategoryMax = Math.max(1, ...byCategory.map((c) => c.total));

  // Trend — son 30 gün
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const labels: string[] = [];
  const created: number[] = [];
  const resolved: number[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(today);
    day.setDate(day.getDate() - i);
    const dayMs = day.getTime();
    const nextMs = dayMs + 24 * 60 * 60 * 1000;
    const cCount = items.filter((c) => {
      const t = new Date(c.createdAt).getTime();
      return t >= dayMs && t < nextMs;
    }).length;
    const rCount = items.filter((c) => {
      if (!c.resolvedAt) return false;
      const t = new Date(c.resolvedAt).getTime();
      return t >= dayMs && t < nextMs;
    }).length;
    labels.push(day.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }));
    created.push(cCount);
    resolved.push(rCount);
  }
  const trend = {
    labels,
    created,
    resolved,
    totalCreated: created.reduce((a, b) => a + b, 0),
    totalResolved: resolved.reduce((a, b) => a + b, 0),
  };

  // Churn metrikleri
  const churnAll = items.filter((c) => c.caseType === 'Churn');
  const churnOpen = churnAll.filter(isOpen);
  const pendingOffers = churnAll.filter((c) => c.offerOutcome === 'Beklemede').length;
  const acceptedOffers = churnAll.filter((c) => c.offerOutcome === 'KabulEdildi').length;
  const rejectedOffers = churnAll.filter((c) => c.offerOutcome === 'Reddedildi').length;
  const retentionSuccess = churnAll.filter((c) => c.retentionStatus === 'Başarılı').length;
  const retentionFail = churnAll.filter((c) => c.retentionStatus === 'Başarısız').length;
  const retentionPending = churnAll.filter((c) => c.retentionStatus === 'DevamEdiyor').length;
  const retentionTotal = retentionSuccess + retentionFail + retentionPending;
  const retentionRate = retentionTotal > 0 ? (retentionSuccess / retentionTotal) * 100 : 0;

  // Takım yükü (sadece açık vakalar)
  const teams = Array.from(new Set(items.map((c) => c.assignedTeamName).filter(Boolean))) as string[];
  const byTeam = teams
    .map((name) => ({
      key: name,
      label: name,
      value: items.filter((c) => c.assignedTeamName === name && isOpen(c)).length,
      color: 'bg-slate-500',
    }))
    .sort((a, b) => b.value - a.value);

  return {
    total,
    open,
    openOrTerminal,
    resolvedCount,
    avgTtrText,
    slaBreachCount,
    slaBreachRate,
    reopenedCount,
    reopenRate,
    criticalOpen,
    byStatus,
    byType,
    byCompany,
    byPriority,
    byCategory,
    byCategoryMax,
    byTeam,
    trend,
    churn: {
      openCount: churnOpen.length,
      pendingOffers,
      acceptedOffers,
      rejectedOffers,
      retentionSuccess,
      retentionFail,
      retentionPending,
    },
    retentionSuccess,
    retentionTotal,
    retentionRate,
  };
}

function formatMinutes(min: number): string {
  if (min < 1) return '—';
  if (min < 60) return `${Math.round(min)} dk`;
  const h = min / 60;
  if (h < 48) return `${h.toFixed(1)} saat`;
  return `${(h / 24).toFixed(1)} gün`;
}
