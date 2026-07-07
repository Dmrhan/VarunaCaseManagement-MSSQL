/**
 * Performans Panosu — Ekip Koçluk Görünümü (FAZ 1b).
 *
 * Kişi/takım performansını KOÇLUK merceğiyle gösterir (sıralama tahtası değil).
 * İlkeler (maket + kullanıcı kararları, docs/CASE_PERFORMANCE_DASHBOARD.md):
 *  - Yöneticinin dili (backend etiketleri); istatistik terimi ⓘ'de
 *  - Her metrik birim + hesap taşır (backend tek kaynak; UI uydurmaz)
 *  - Guardrail: az örneklem (insufficient) → "—" + not
 *  - Bağlam: ekip ortancasına (teamBenchmark) göre çip
 * Backend: POST /api/analytics/people-performance (Supervisor+).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Users2, Info, RefreshCw } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  analyticsService,
  type PeoplePerformanceResponse,
  type PersonMetric,
  type PersonPerformance,
} from '@/services/analyticsService';

const DAY = 86400000;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
// Codex #454 P2 — backend `resolvedAt < to` kullanır; gün sonunu kapsamak ve
// aynı-gün seçimini (from<to) geçerli kılmak için ops panosuyla aynı desen:
// başlangıç = günün 00:00'ı, bitiş = ERTESİ günün 00:00'ı (dışlayıcı).
const rangeStartIso = (day: string) => new Date(`${day}T00:00:00.000Z`).toISOString();
const rangeEndIso = (day: string) => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
};

function formatMetric(m: PersonMetric): string {
  if (m.value === null) return '—';
  if (m.unit === '%') return `%${m.value}`;
  return `${m.value} ${m.unit}`;
}

// ⓘ — tam tanım (Ne/Nasıl/Birim) hover tooltip.
function InfoDot({ metric }: { metric: PersonMetric }) {
  return (
    <span className="group relative inline-flex">
      <Info size={12} className="cursor-help text-slate-300 hover:text-brand-600 dark:text-ndark-dim" />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-[calc(100%+6px)] z-30 w-56 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-[11px] leading-relaxed text-slate-100 opacity-0 shadow-xl transition-opacity group-hover:opacity-100 dark:bg-black"
      >
        <span className="block"><span className="font-semibold text-slate-400">HESAP</span> — {metric.formula}</span>
        <span className="block"><span className="font-semibold text-slate-400">BİRİM</span> — {metric.unit}</span>
        <span className="block"><span className="font-semibold text-slate-400">ÖRNEKLEM</span> — {metric.sampleSize} vaka</span>
      </span>
    </span>
  );
}

type Tone = 'good' | 'warn' | 'bad' | 'flat';
const TONE_CLS: Record<Tone, string> = {
  good: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40',
  warn: 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40',
  bad: 'text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-950/40',
  flat: 'text-slate-500 bg-slate-100 dark:text-ndark-muted dark:bg-ndark-bg',
};

// Kişi değerini ekip ortancasına göre yorumla — betterWhenLower: küçük iyi mi.
function contextChip(
  value: number | null,
  benchmark: number | null,
  betterWhenLower: boolean,
): { tone: Tone; text: string } | null {
  if (value === null || benchmark === null) return null;
  if (benchmark === 0 && value === 0) return { tone: 'flat', text: 'ekip seviyesinde' };
  const diff = value - benchmark;
  const denom = benchmark === 0 ? Math.max(value, 1) : Math.abs(benchmark);
  const pct = Math.round((Math.abs(diff) / denom) * 100);
  if (pct < 12) return { tone: 'flat', text: 'ekip seviyesinde' };
  const better = betterWhenLower ? diff < 0 : diff > 0;
  const arrow = diff < 0 ? '▼' : '▲';
  const dirWord = betterWhenLower ? (better ? 'hızlı' : 'yavaş') : (better ? 'fazla' : 'az');
  return { tone: better ? 'good' : 'warn', text: `${arrow} ekipten %${pct} ${dirWord}` };
}

function ContextChip({ chip }: { chip: { tone: Tone; text: string } | null }) {
  if (!chip) return <span className="text-[11px] text-slate-400 dark:text-ndark-dim">—</span>;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_CLS[chip.tone]}`}>
      {chip.text}
    </span>
  );
}

function MetricCell({
  metric,
  chip,
}: {
  metric: PersonMetric;
  chip: { tone: Tone; text: string } | null;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-ndark-muted">
        {metric.label} <InfoDot metric={metric} />
      </div>
      <div className={`mt-0.5 text-xl font-bold tabular-nums tracking-tight ${metric.value === null ? 'text-slate-300 dark:text-ndark-dim' : 'text-slate-900 dark:text-ndark-text'}`}>
        {formatMetric(metric)}
      </div>
      <div className="mt-0.5 text-[10px] text-slate-400 dark:text-ndark-dim">{metric.formula}</div>
      <div className="mt-1.5">
        {metric.insufficient
          ? <span className="text-[11px] text-slate-400 dark:text-ndark-dim">henüz {metric.sampleSize} vaka — yorum için yetersiz</span>
          : <ContextChip chip={chip} />}
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
}

function PersonCard({ p, bench }: { p: PersonPerformance; bench: PeoplePerformanceResponse['teamBenchmark'] }) {
  const m = p.metrics;
  return (
    <Card>
      <CardBody className="!p-0">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-ndark-border">
          <div className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-gradient-to-br from-brand-600 to-brand-700 text-sm font-bold text-white">
            {initials(p.name)}
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-ndark-text">{p.name}</h3>
            <span className="text-[11px] text-slate-500 dark:text-ndark-muted">{p.sampleSize} vaka çözdü · bu dönem</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3">
          <MetricCell metric={m.resolved} chip={contextChip(m.resolved.value, bench.resolved, false)} />
          <MetricCell metric={m.medianHours} chip={contextChip(m.medianHours.value, bench.medianHours, true)} />
          <MetricCell metric={m.reopenRatePct} chip={contextChip(m.reopenRatePct.value, bench.reopenRatePct, true)} />
          <MetricCell metric={m.openWip} chip={contextChip(m.openWip.value, bench.openWip, true)} />
        </div>
      </CardBody>
    </Card>
  );
}

function TeamSummary({ data }: { data: PeoplePerformanceResponse }) {
  const totalResolved = data.people.reduce((s, p) => s + (p.metrics.resolved.value ?? 0), 0);
  const maxWip = data.people.reduce((mx, p) => Math.max(mx, p.metrics.openWip.value ?? 0), 0);
  const b = data.teamBenchmark;
  const tiles: { layer: string; label: string; value: string; sub: string }[] = [
    { layer: '① Hacim', label: 'Toplam çözülen', value: `${totalResolved} vaka`, sub: `${data.people.length} kişi` },
    { layer: '② Süre', label: 'Tipik çözüm (ekip ort.)', value: b.medianHours === null ? '—' : `${b.medianHours} saat`, sub: 'ortadaki vaka' },
    { layer: '③ Kalite', label: 'Yeniden açılma (ekip ort.)', value: b.reopenRatePct === null ? '—' : `%${b.reopenRatePct}`, sub: `zamanında çözüm %${b.slaCompliancePct ?? '—'}` },
    { layer: '④ Yük', label: 'Elindeki açık iş (ekip ort.)', value: b.openWip === null ? '—' : `${b.openWip} vaka`, sub: `en yüklü ${maxWip} vaka` },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => (
        <Card key={t.layer}>
          <CardBody>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-ndark-dim">{t.layer}</div>
            <div className="mt-1 text-[11px] font-medium text-slate-500 dark:text-ndark-muted">{t.label}</div>
            <div className="mt-0.5 text-2xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-ndark-text">{t.value}</div>
            <div className="mt-1 border-t border-dashed border-slate-200 pt-1.5 text-[11px] text-slate-500 dark:border-ndark-border dark:text-ndark-muted">{t.sub}</div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

export function PeoplePerformancePage() {
  const [dateFrom, setDateFrom] = useState(() => isoDate(new Date(Date.now() - 30 * DAY)));
  const [dateTo, setDateTo] = useState(() => isoDate(new Date()));
  const [data, setData] = useState<PeoplePerformanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const out = await analyticsService.peoplePerformance({ from: rangeStartIso(dateFrom), to: rangeEndIso(dateTo) });
    setLoading(false);
    if (!out) { setError('Performans verisi yüklenemedi.'); return; }
    setData(out);
  }, [dateFrom, dateTo]);

  useEffect(() => { void load(); }, [load]);

  const people = useMemo(() => data?.people ?? [], [data]);

  return (
    <div className="space-y-5">
      {/* Başlık + dönem */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 text-white"><Users2 size={18} /></div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-ndark-text">Performans Panosu</h1>
            <p className="text-xs text-slate-500 dark:text-ndark-muted">Ekip koçluk görünümü · yük adil mi, kim neyde güçlü</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={dateFrom} max={dateTo} onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text" />
          <span className="text-slate-400">–</span>
          <input type="date" value={dateTo} min={dateFrom} max={isoDate(new Date())} onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text" />
          <Button size="sm" variant="outline" leftIcon={<RefreshCw size={13} />} onClick={() => void load()} disabled={loading}>Yenile</Button>
        </div>
      </div>

      {/* Koçluk bandı */}
      <div className="flex items-start gap-3 rounded-xl border border-brand-100 bg-brand-50/40 px-4 py-3 dark:border-ndark-border dark:bg-ndark-card">
        <Info size={16} className="mt-0.5 flex-none text-brand-600" />
        <p className="text-xs text-slate-600 dark:text-ndark-muted">
          <span className="font-semibold text-slate-800 dark:text-ndark-text">Bu pano sıralama değil, koçluk içindir.</span>{' '}
          Her sayı ekip ortancasına göre bağlamıyla gösterilir; yetersiz örneklemli
          (&lt;{data?.meta.minSampleAgent ?? 20} vaka) değerler yorum yerine gizlenir. Her metrik birimini + hesabını taşır (ⓘ).
          Amaç "en yavaş kim" değil, "nerede destek gerekiyor".
        </p>
      </div>

      {loading && !data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={92} />)}</div>
          <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={190} />)}</div>
        </div>
      ) : error ? (
        <Card><CardBody><div className="flex items-center justify-between gap-3">
          <span className="text-sm text-rose-700 dark:text-rose-300">{error}</span>
          <Button size="sm" variant="outline" onClick={() => void load()}>Tekrar dene</Button>
        </div></CardBody></Card>
      ) : people.length === 0 ? (
        <Card><CardBody><p className="py-8 text-center text-sm text-slate-500 dark:text-ndark-muted">Bu dönemde gösterilecek kişi verisi yok.</p></CardBody></Card>
      ) : (
        <>
          <TeamSummary data={data!} />
          <div>
            <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
              Kişi koçluk kartları — ekip ortancasına göre
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              {people.map((p) => <PersonCard key={p.id} p={p} bench={data!.teamBenchmark} />)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
