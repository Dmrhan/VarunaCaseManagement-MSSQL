import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, BrainCircuit, CheckCircle2, Clock, Sparkles, TrendingUp } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { analyticsService, type AIUsagePeriod, type AIUsageReport } from '@/services/analyticsService';

/**
 * Analytics — AI Kullanım Panosu (Faz 1.5 Madde 7).
 *
 * Kim için: Supervisor / Admin / SystemAdmin. Multi-tenant scope backend'de
 * uygulanıyor (allowedCompanyIds). UI tarafında ek scope yok.
 */

const ENDPOINT_LABELS: Record<string, string> = {
  'suggest-category': 'Kategori Önerisi',
  'draft-resolution': 'Çözüm Taslağı',
  'churn-conversion': 'Churn Dönüştürme',
  'supervisor-summary': 'Yönetici Özeti',
  'dashboard-chat': 'Dashboard Sohbeti',
  'call-summary': 'Çağrı Özeti',
  'qa-score': 'QA Skoru',
  other: 'Diğer',
};

function endpointLabel(key: string): string {
  return ENDPOINT_LABELS[key] ?? key;
}

export function AIUsagePage() {
  const [period, setPeriod] = useState<AIUsagePeriod>('7d');
  const [report, setReport] = useState<AIUsageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const r = await analyticsService.getAIUsage(period);
      setReport(r ?? null);
    } catch (e) {
      setError((e as Error).message ?? 'Bilinmeyen hata');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const chartData = useMemo(
    () =>
      (report?.dailyTrend ?? []).map((d) => ({
        date: d.date.slice(5), // YYYY-MM-DD → MM-DD
        count: d.count,
      })),
    [report?.dailyTrend],
  );

  const isEmpty = !loading && !error && (report?.totalCalls ?? 0) === 0;

  return (
    <div className="space-y-4">
      {/* Header + period selector */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-ndark-text">AI Kullanım Panosu</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-ndark-muted">
            AI önerilerinin kabul oranı, yanıt süresi ve tahmini zaman tasarrufu.
          </p>
        </div>
        <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 dark:border-ndark-border dark:bg-ndark-card">
          {(['7d', '30d'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded-[5px] px-3 py-1.5 text-xs font-medium transition ${
                period === p
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-600 hover:text-slate-800 dark:text-ndark-muted dark:hover:text-ndark-text'
              }`}
            >
              {p === '7d' ? 'Son 7 gün' : 'Son 30 gün'}
            </button>
          ))}
        </div>
      </div>

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

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile
          icon={<Activity size={14} />}
          label="Toplam AI Çağrısı"
          value={loading ? '…' : String(report?.totalCalls ?? 0)}
          tint="bg-slate-50 ring-slate-200 text-slate-700 dark:bg-ndark-card dark:ring-ndark-border dark:text-ndark-text"
        />
        <KpiTile
          icon={<CheckCircle2 size={14} />}
          label="Kabul Oranı"
          value={
            loading
              ? '…'
              : report?.acceptanceRate == null
              ? '—'
              : `%${report.acceptanceRate}`
          }
          tint="bg-emerald-50 ring-emerald-200 text-emerald-800 dark:bg-emerald-950/30 dark:ring-emerald-900/40 dark:text-emerald-200"
        />
        <KpiTile
          icon={<Clock size={14} />}
          label="Ort. Yanıt Süresi"
          value={
            loading
              ? '…'
              : report?.avgResponseMs == null
              ? '—'
              : `${report.avgResponseMs} ms`
          }
          tint="bg-blue-50 ring-blue-200 text-blue-800 dark:bg-blue-950/30 dark:ring-blue-900/40 dark:text-blue-200"
        />
        <KpiTile
          icon={<Sparkles size={14} />}
          label="Tahmini Zaman Tasarrufu"
          value={loading ? '…' : `${report?.estimatedTimeSavedMin ?? 0} dk`}
          tint="bg-amber-50 ring-amber-200 text-amber-800 dark:bg-amber-950/30 dark:ring-amber-900/40 dark:text-amber-200"
        />
      </div>

      {isEmpty ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<BrainCircuit size={22} />}
              title="Henüz AI kullanım verisi yok"
              description={
                period === '7d'
                  ? 'Son 7 günde kayıt yok. 30 günü deneyin veya AI özelliklerini kullanmaya başlayın.'
                  : 'Bu dönemde AI çağrısı kaydedilmedi.'
              }
            />
          </CardBody>
        </Card>
      ) : (
        <>
          {/* Endpoint breakdown */}
          <Card>
            <div className="border-b border-slate-200 px-4 py-3 dark:border-ndark-border">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-ndark-text">
                Endpoint Kırılımı
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 dark:divide-ndark-border">
                <thead className="bg-slate-50 dark:bg-ndark-bg">
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
                    <th className="px-4 py-2.5">Endpoint</th>
                    <th className="px-4 py-2.5 text-right">Çağrı Sayısı</th>
                    <th className="px-4 py-2.5 text-right">Kabul Oranı</th>
                    <th className="px-4 py-2.5 text-right">Ort. Yanıt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-ndark-border">
                  {(report?.byEndpoint ?? []).map((row) => (
                    <tr key={row.endpoint} className="text-sm hover:bg-slate-50 dark:hover:bg-ndark-bg/40">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <BrainCircuit size={13} className="text-slate-400" />
                          <span className="font-medium text-slate-800 dark:text-ndark-text">
                            {endpointLabel(row.endpoint)}
                          </span>
                          <span className="font-mono text-[11px] text-slate-400">{row.endpoint}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-700 dark:text-ndark-text">
                        {row.count}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {row.acceptRate == null ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : (
                          <Badge tint={row.acceptRate >= 70 ? 'emerald' : row.acceptRate >= 40 ? 'amber' : 'rose'}>
                            %{row.acceptRate}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-600 dark:text-ndark-muted">
                        {row.avgResponseMs == null ? '—' : `${row.avgResponseMs} ms`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Daily trend chart */}
          <Card>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-ndark-border">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-ndark-text">
                Günlük Çağrı Trendi
              </h2>
              <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-ndark-muted">
                <TrendingUp size={11} /> {period === '7d' ? '7 gün' : '30 gün'}
              </span>
            </div>
            <CardBody>
              {loading ? (
                <div className="h-[260px] animate-pulse rounded bg-slate-100 dark:bg-ndark-bg" />
              ) : (
                <div className="text-slate-500 dark:text-ndark-muted">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.2} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11, fill: 'currentColor' }}
                        tickLine={false}
                        axisLine={{ stroke: 'currentColor', strokeOpacity: 0.3 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: 'currentColor' }}
                        tickLine={false}
                        axisLine={false}
                        width={32}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--color-background-primary, #ffffff)',
                          border: '1px solid var(--color-border-tertiary, #e2e8f0)',
                          borderRadius: 6,
                          fontSize: 12,
                          color: 'var(--color-text-primary, #1e293b)',
                        }}
                        labelStyle={{ color: 'var(--color-text-secondary, #64748b)' }}
                        cursor={{ fill: 'currentColor', fillOpacity: 0.05 }}
                      />
                      <Bar dataKey="count" fill="#7C3AED" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}

function KpiTile({
  icon,
  label,
  value,
  tint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tint: string;
}) {
  return (
    <div className={`rounded-xl p-4 ring-1 ring-inset ${tint}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide opacity-80">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
