/**
 * Performans Panosu — Ekip Koçluk Görünümü (FAZ 1b).
 *
 * Kişi/takım performansını KOÇLUK merceğiyle gösterir (sıralama tahtası değil).
 * İlkeler (maket + kullanıcı kararları, docs/CASE_PERFORMANCE_DASHBOARD.md):
 *  - Yöneticinin dili (backend etiketleri); istatistik terimi ⓘ'de
 *  - Her metrik birim + hesap taşır (backend tek kaynak; UI uydurmaz)
 *  - Guardrail: az örneklem (insufficient) → "—" + not
 *  - Bağlam: ekip ortalamasına (teamBenchmark) göre çip
 * Backend: POST /api/analytics/people-performance (Supervisor+).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Users2, Info, RefreshCw, Lightbulb } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  analyticsService,
  type PeoplePerformanceResponse,
  type PersonMetric,
  type PersonPerformance,
} from '@/services/analyticsService';
import { lookupService } from '@/services/caseService';
import { PersonProfileView } from './PersonProfileView';

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

// Kişi değerini ekip ortalamasına göre yorumla — betterWhenLower: küçük iyi mi.
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

// Yeniden açılma · Kalite birleşik hücre (maket deseni). Reopen değeri + QA puanı;
// bağlam çipi reopen üzerinden (kalite guardrail altında "—").
function ReopenQualityCell({ reopen, qa, chip }: { reopen: PersonMetric; qa: PersonMetric; chip: { tone: Tone; text: string } | null }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-ndark-muted">
        Yeniden açılma · Kalite <InfoDot metric={reopen} />
      </div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className={`text-xl font-bold tabular-nums tracking-tight ${reopen.value === null ? 'text-slate-300 dark:text-ndark-dim' : 'text-slate-900 dark:text-ndark-text'}`}>{formatMetric(reopen)}</span>
        <span className="text-sm font-semibold tabular-nums text-slate-400 dark:text-ndark-dim">· {qa.value === null ? '—' : `${qa.value}/5`}</span>
      </div>
      <div className="mt-0.5 text-[10px] text-slate-400 dark:text-ndark-dim">tekrar açılan ÷ çözülen · kalite (QA)</div>
      <div className="mt-1.5">
        {reopen.insufficient
          ? <span className="text-[11px] text-slate-400 dark:text-ndark-dim">henüz {reopen.sampleSize} vaka — yorum için yetersiz</span>
          : <ContextChip chip={chip} />}
      </div>
    </div>
  );
}

const COACH_CLS: Record<'watch' | 'info' | 'good', string> = {
  watch: 'border-amber-200 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/30',
  info: 'border-sky-200 bg-sky-50/70 dark:border-sky-900/50 dark:bg-sky-950/30',
  good: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/50 dark:bg-emerald-950/30',
};
const COACH_TXT: Record<'watch' | 'info' | 'good', string> = {
  watch: 'text-amber-900 dark:text-amber-200',
  info: 'text-sky-900 dark:text-sky-200',
  good: 'text-emerald-900 dark:text-emerald-200',
};

function CoachingSignal({ coaching }: { coaching: PersonPerformance['coaching'] }) {
  if (!coaching?.text || !coaching.tone) return null;
  const tone = coaching.tone;
  return (
    <div className={`mx-4 mb-3 rounded-lg border px-3 py-2.5 ${COACH_CLS[tone]}`}>
      <div className={`flex items-start gap-2 text-[12px] leading-relaxed ${COACH_TXT[tone]}`}>
        <Lightbulb size={13} className="mt-0.5 flex-none" />
        <span><b className="font-semibold">Koçluk sinyali:</b> {coaching.text}</span>
      </div>
    </div>
  );
}

function PersonCard({ p, bench, onOpen }: { p: PersonPerformance; bench: PeoplePerformanceResponse['teamBenchmark']; onOpen: () => void }) {
  const m = p.metrics;
  return (
    <Card>
      <CardBody className="!p-0">
        <button type="button" onClick={onOpen} className="group flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:border-ndark-border dark:hover:bg-ndark-card">
          <span className="sr-only">{p.name} profilini aç</span>
          <div className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-gradient-to-br from-brand-600 to-brand-700 text-sm font-bold text-white">
            {initials(p.name)}
          </div>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-slate-900 dark:text-ndark-text">{p.name}</span>
            <span className="text-[11px] text-slate-500 dark:text-ndark-muted">{p.sampleSize} vaka çözdü · bu dönem</span>
          </span>
          <span className="flex-none text-[11px] font-medium text-brand-600 opacity-0 transition-opacity group-hover:opacity-100">Profili aç →</span>
        </button>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3">
          <MetricCell metric={m.resolved} chip={contextChip(m.resolved.value, bench.resolved, false)} />
          <MetricCell metric={m.medianHours} chip={contextChip(m.medianHours.value, bench.medianHours, true)} />
          <ReopenQualityCell reopen={m.reopenRatePct} qa={m.qaScore} chip={contextChip(m.reopenRatePct.value, bench.reopenRatePct, true)} />
          <MetricCell metric={m.openWip} chip={contextChip(m.openWip.value, bench.openWip, true)} />
        </div>
        <CoachingSignal coaching={p.coaching} />
      </CardBody>
    </Card>
  );
}

// Zengin ⓘ — serbest metin (özet kartı için; metrik-sözleşme dışı açıklama).
function InfoText({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <Info size={12} className="cursor-help text-slate-300 hover:text-brand-600 dark:text-ndark-dim" />
      <span role="tooltip"
        className="pointer-events-none absolute right-0 top-[calc(100%+6px)] z-30 w-64 rounded-lg bg-slate-900 px-3 py-2 text-[11px] leading-relaxed text-slate-100 opacity-0 shadow-xl transition-opacity group-hover:opacity-100 dark:bg-black">
        {text}
      </span>
    </span>
  );
}

type SecTone = 'good' | 'bad' | 'flat';
function SummaryCard({
  layer, label, value, hint, tip, secondaries,
}: {
  layer: string; label: string; value: string; hint: string; tip?: string;
  secondaries: { k: string; v: string; tone?: SecTone }[];
}) {
  const toneCls: Record<SecTone, string> = {
    good: 'text-emerald-600 dark:text-emerald-400',
    bad: 'text-rose-600 dark:text-rose-400',
    flat: 'text-slate-700 dark:text-ndark-text',
  };
  return (
    <Card>
      <CardBody>
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-ndark-dim">{layer}</div>
          {tip && <InfoText text={tip} />}
        </div>
        <div className="mt-1 text-[11px] font-medium text-slate-500 dark:text-ndark-muted">{label}</div>
        <div className="mt-0.5 text-2xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-ndark-text">{value}</div>
        <div className="mt-0.5 text-[10.5px] text-slate-400 dark:text-ndark-dim">{hint}</div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-dashed border-slate-200 pt-2 dark:border-ndark-border">
          {secondaries.map((s, i) => (
            <div key={i} className="text-[11px]">
              <span className="text-slate-500 dark:text-ndark-muted">{s.k} </span>
              <b className={`tabular-nums ${toneCls[s.tone ?? 'flat']}`}>{s.v}</b>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function TeamSummary({ data }: { data: PeoplePerformanceResponse }) {
  const s = data.teamSummary;
  const hrs = (v: number | null) => (v === null ? '—' : `${v} saat`);
  const pct = (v: number | null) => (v === null ? '—' : `%${v}`);
  const melt = s.netMelted;
  return (
    <div>
      <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
        Takım özeti · 4 katman — yöneticinin dili; teknik karşılığı ⓘ'de
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          layer="① İş hacmi" label="Çözülen iş" value={`${s.resolvedTotal} vaka`} hint="bu dönemde çözüme ulaşan"
          secondaries={[
            { k: 'Biriken (backlog)', v: `${s.backlog} vaka` },
            { k: 'Bu dönem net', v: melt >= 0 ? `+${melt} ▲` : `${melt} ▼`, tone: melt >= 0 ? 'good' : 'bad' },
          ]}
        />
        <SummaryCard
          layer="② Çözüm hızı" label="Tipik çözüm süresi" value={hrs(s.medianHours)} hint="ortadaki vaka (medyan)"
          tip="TIPIK = MEDYAN — vakaları hızdan sıraya diz, tam ortadaki. Ortalama DEĞİL, çünkü tek uzun vaka ortalamayı yanıltır. YAVAŞ UÇ — en yavaş %10'un başladığı süre (P90). BİRİM — saat · müşteri beklemesi hariç."
          secondaries={[{ k: 'Yavaş uç (P90)', v: hrs(s.p90Hours) }]}
        />
        <SummaryCard
          layer="③ Kalite" label="Yeniden açılma oranı" value={pct(s.reopenRatePct)} hint="kapatılıp tekrar açılan iş"
          secondaries={[
            { k: 'Kalite puanı', v: s.qaScore === null ? '—' : `${s.qaScore}/5` },
            { k: 'Zamanında çözüm', v: pct(s.slaCompliancePct) },
          ]}
        />
        <SummaryCard
          layer="④ İş yükü" label="Elindeki açık iş" value={s.openWip === null ? '—' : `${s.openWip} vaka`} hint="kişi ort. · şu an omuzdaki"
          secondaries={[
            { k: 'En yüklü kişi', v: s.busiest ? `${s.busiest.openWip} vaka` : '—' },
            { k: 'Boşta kapasite', v: `${s.idleCapacity} kişi`, tone: s.idleCapacity > 0 ? 'good' : 'flat' },
          ]}
        />
      </div>
    </div>
  );
}

export function PeoplePerformancePage({ onSelectCase }: { onSelectCase?: (id: string) => void }) {
  const [dateFrom, setDateFrom] = useState(() => isoDate(new Date(Date.now() - 30 * DAY)));
  const [dateTo, setDateTo] = useState(() => isoDate(new Date()));
  const [data, setData] = useState<PeoplePerformanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const [companyId, setCompanyId] = useState<string>(''); // '' = tüm şirketler
  const [teamId, setTeamId] = useState<string>(''); // '' = tüm takımlar

  // Şirketler (dropdown) — tek şirketliyse gizlenir (gürültü olmasın).
  const companyOptions = useMemo(
    () => lookupService.companies().slice().sort((a, b) => a.name.localeCompare(b.name, 'tr')),
    [],
  );
  // Aktif takımlar; şirket seçiliyse o şirketin takımları (cascade).
  const teamOptions = useMemo(
    () => lookupService.teams()
      .filter((t) => !companyId || t.companyId === companyId)
      .slice().sort((a, b) => a.name.localeCompare(b.name, 'tr')),
    [companyId],
  );
  const teamsFilter = useMemo(() => (teamId ? [teamId] : undefined), [teamId]);
  const companiesFilter = useMemo(() => (companyId ? [companyId] : undefined), [companyId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const out = await analyticsService.peoplePerformance({
      from: rangeStartIso(dateFrom), to: rangeEndIso(dateTo),
      ...(companyId ? { companies: [companyId] } : {}),
      ...(teamId ? { teams: [teamId] } : {}),
    });
    setLoading(false);
    if (!out) { setError('Performans verisi yüklenemedi.'); return; }
    setData(out);
  }, [dateFrom, dateTo, companyId, teamId]);

  useEffect(() => { void load(); }, [load]);

  const people = useMemo(() => data?.people ?? [], [data]);

  // Kişi kartına tıklanınca uzmanlık profili (drill-down) açılır.
  if (selected) {
    return (
      <PersonProfileView
        personId={selected.id}
        personName={selected.name}
        from={rangeStartIso(dateFrom)}
        to={rangeEndIso(dateTo)}
        teams={teamsFilter}
        companies={companiesFilter}
        onBack={() => setSelected(null)}
        onSelectCase={onSelectCase}
      />
    );
  }

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
        <div className="flex flex-wrap items-center gap-2">
          {companyOptions.length > 1 && (
            <select
              value={companyId}
              onChange={(e) => { setCompanyId(e.target.value); setTeamId(''); setSelected(null); }}
              aria-label="Şirket filtresi"
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
            >
              <option value="">Tüm şirketler</option>
              {companyOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <select
            value={teamId}
            onChange={(e) => { setTeamId(e.target.value); setSelected(null); }}
            aria-label="Takım filtresi"
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
          >
            <option value="">Tüm takımlar</option>
            {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
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
          Her sayı ekip ortalamasına göre bağlamıyla gösterilir; yetersiz örneklemli
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
              Kişi koçluk kartları — ekip ortalamasına göre
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              {people.map((p) => <PersonCard key={p.id} p={p} bench={data!.teamBenchmark} onOpen={() => setSelected({ id: p.id, name: p.name })} />)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
