import { useEffect, useState } from 'react';
import { Award, Heart, MessageSquare, Star, TrendingDown, TrendingUp, Zap } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  analyticsService,
  type AIUsagePeriod,
  type QAScoresReport,
} from '@/services/analyticsService';

/**
 * QA Skor Panosu — Faz 1.5 Madde 4 (Smart QA Lite).
 * Kapatılmış vakaların AI 3-kriter değerlendirmesi → agent breakdown.
 *
 * Erişim: Supervisor / Admin / SystemAdmin (sidebar koşullu render).
 * Backend GET /api/analytics/qa-scores ek olarak rol kontrolü yapar.
 */
export function QAScoresPage() {
  const [period, setPeriod] = useState<AIUsagePeriod>('7d');
  const [report, setReport] = useState<QAScoresReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const r = await analyticsService.getQAScores(period);
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

  const isEmpty = !loading && !error && (report?.scoredCaseCount ?? 0) === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-ndark-text">QA Skorları</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-ndark-muted">
            Kapatılmış vakaların AI değerlendirmesi: empati, çözüm netliği, yanıt hızı.
            Her gece otomatik puanlama (max 10 vaka/gece).
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

      {/* Şirket ortalaması KPI'ları */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile
          icon={<Heart size={14} />}
          label="Ort. Empati"
          value={loading ? '…' : formatScore(report?.companyAvg.empathy)}
          tone={scoreTone(report?.companyAvg.empathy)}
        />
        <KpiTile
          icon={<MessageSquare size={14} />}
          label="Ort. Netlik"
          value={loading ? '…' : formatScore(report?.companyAvg.clarity)}
          tone={scoreTone(report?.companyAvg.clarity)}
        />
        <KpiTile
          icon={<Zap size={14} />}
          label="Ort. Hız"
          value={loading ? '…' : formatScore(report?.companyAvg.speed)}
          tone={scoreTone(report?.companyAvg.speed)}
        />
        <KpiTile
          icon={<Star size={14} />}
          label="Genel Ort."
          value={loading ? '…' : formatScore(report?.companyAvg.overall)}
          tone={scoreTone(report?.companyAvg.overall)}
        />
      </div>

      {isEmpty ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<Award size={22} />}
              title="Henüz skorlanmış vaka yok"
              description={
                period === '7d'
                  ? 'Son 7 günde QA puanı verilen vaka yok. 30 günü deneyin veya gece cron çalışmasını bekleyin.'
                  : 'Bu dönemde puanlanmış vaka yok. Kapatılmış vakalar her gece batch olarak skorlanır (max 10).'
              }
            />
          </CardBody>
        </Card>
      ) : (
        <>
          {/* Top / Bottom highlights */}
          {(report?.topAgent || report?.bottomAgent) && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {report.topAgent && (
                <HighlightCard
                  type="top"
                  agentName={report.topAgent.agentName}
                  score={report.topAgent.avgOverall}
                  caseCount={report.topAgent.caseCount}
                />
              )}
              {report.bottomAgent && report.bottomAgent.agentId !== report.topAgent?.agentId && (
                <HighlightCard
                  type="bottom"
                  agentName={report.bottomAgent.agentName}
                  score={report.bottomAgent.avgOverall}
                  caseCount={report.bottomAgent.caseCount}
                />
              )}
            </div>
          )}

          {/* Agent breakdown table */}
          <Card>
            <div className="border-b border-slate-200 px-4 py-3 dark:border-ndark-border">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-ndark-text">
                Agent Kırılımı
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-ndark-muted">
                {report?.scoredCaseCount} skorlanmış vaka, {report?.byAgent.length} agent
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 dark:divide-ndark-border">
                <thead className="bg-slate-50 dark:bg-ndark-bg">
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
                    <th className="px-4 py-2.5">Agent</th>
                    <th className="px-4 py-2.5 text-right">Vaka</th>
                    <th className="px-4 py-2.5 text-right">Empati</th>
                    <th className="px-4 py-2.5 text-right">Netlik</th>
                    <th className="px-4 py-2.5 text-right">Hız</th>
                    <th className="px-4 py-2.5 text-right">Genel</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-ndark-border">
                  {(report?.byAgent ?? []).map((row) => (
                    <tr
                      key={row.agentId ?? 'unassigned'}
                      className="text-sm hover:bg-slate-50 dark:hover:bg-ndark-bg/40"
                    >
                      <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-ndark-text">
                        {row.agentName}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-700 dark:text-ndark-text">
                        {row.caseCount}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <ScorePill value={row.avgEmpathy} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <ScorePill value={row.avgClarity} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <ScorePill value={row.avgSpeed} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <ScorePill value={row.avgOverall} bold />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

/* ─── helpers ─────────────────────────────────────────────────── */

function formatScore(v: number | null | undefined): string {
  return v == null ? '—' : v.toFixed(1);
}

function scoreTone(v: number | null | undefined): 'emerald' | 'amber' | 'rose' | 'slate' {
  if (v == null) return 'slate';
  if (v >= 4) return 'emerald';
  if (v >= 3) return 'amber';
  return 'rose';
}

const TONE_TILE: Record<'emerald' | 'amber' | 'rose' | 'slate', string> = {
  emerald: 'bg-emerald-50 ring-emerald-200 text-emerald-800 dark:bg-emerald-950/30 dark:ring-emerald-900/40 dark:text-emerald-200',
  amber: 'bg-amber-50 ring-amber-200 text-amber-800 dark:bg-amber-950/30 dark:ring-amber-900/40 dark:text-amber-200',
  rose: 'bg-rose-50 ring-rose-200 text-rose-800 dark:bg-rose-950/30 dark:ring-rose-900/40 dark:text-rose-200',
  slate: 'bg-slate-50 ring-slate-200 text-slate-700 dark:bg-ndark-card dark:ring-ndark-border dark:text-ndark-text',
};

const TONE_PILL: Record<'emerald' | 'amber' | 'rose' | 'slate', string> = {
  emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  rose: 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
  slate: 'bg-slate-100 text-slate-700 dark:bg-ndark-card dark:text-ndark-muted',
};

function KpiTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'emerald' | 'amber' | 'rose' | 'slate';
}) {
  return (
    <div className={`rounded-xl p-4 ring-1 ring-inset ${TONE_TILE[tone]}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide opacity-80">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function ScorePill({ value, bold }: { value: number; bold?: boolean }) {
  const tone = scoreTone(value);
  return (
    <span
      className={`inline-flex min-w-[40px] items-center justify-center rounded-md px-2 py-0.5 text-xs ${
        bold ? 'font-semibold' : 'font-medium'
      } ${TONE_PILL[tone]}`}
    >
      {value.toFixed(1)}
    </span>
  );
}

function HighlightCard({
  type,
  agentName,
  score,
  caseCount,
}: {
  type: 'top' | 'bottom';
  agentName: string;
  score: number;
  caseCount: number;
}) {
  const isTop = type === 'top';
  return (
    <div
      className={`rounded-xl border p-4 ${
        isTop
          ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/30'
          : 'border-rose-200 bg-rose-50 dark:border-rose-900/40 dark:bg-rose-950/30'
      }`}
    >
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide opacity-80">
        {isTop ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
        {isTop ? 'En Yüksek Skor' : 'En Düşük Skor'}
      </div>
      <div className="mt-1.5 flex items-baseline gap-3">
        <span
          className={`text-2xl font-semibold ${
            isTop ? 'text-emerald-800 dark:text-emerald-200' : 'text-rose-800 dark:text-rose-200'
          }`}
        >
          {score.toFixed(1)}
        </span>
        <span className="text-sm text-slate-700 dark:text-ndark-text">{agentName}</span>
        <span className="text-xs text-slate-500 dark:text-ndark-muted">({caseCount} vaka)</span>
      </div>
    </div>
  );
}
