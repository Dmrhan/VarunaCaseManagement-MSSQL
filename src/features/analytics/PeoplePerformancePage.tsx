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
  type PeopleTeamSummary,
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

// Süre gösterimi — L1 (dakikalar) ile L2 (saat/gün) aynı ekranda olduğundan
// birimi büyüklüğe göre seç: <1sa → dakika, <48sa → saat, sonrası → gün.
// Kullanıcı direktifi 2026-07-08: 1 saatin altı "saat" ile değil dakika ile.
export function formatDur(hours: number | null): string {
  if (hours == null) return '—';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} dk`;
  if (hours < 48) return `${Math.round(hours * 10) / 10} sa`;
  return `${Math.round(hours / 24)} gün`;
}

function formatMetric(m: PersonMetric): string {
  if (m.value === null) return '—';
  if (m.unit === 'saat') return formatDur(m.value); // dk/sa/gün
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
  const hrs = (v: number | null) => formatDur(v);
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
          tip="TIPIK = MEDYAN — vakaları hızdan sıraya diz, tam ortadaki. Ortalama DEĞİL, çünkü tek uzun vaka ortalamayı yanıltır. YAVAŞ UÇ — en yavaş %10'un başladığı süre (P90). BİRİM — büyüklüğe göre dakika / saat / gün · müşteri beklemesi hariç."
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

// ─────────────────────────────────────────────────────────────────
// Regenerasyon Faz A — anlatı bileşenleri (nabız · dikkat · uzman · dengeli)
// ─────────────────────────────────────────────────────────────────

// Soru-başlığı (R1) — sayfa yukarıdan aşağı sorulara cevap akar.
function SectionQ({ q, badge }: { q: string; badge?: string }) {
  return (
    <div className="mb-4 flex items-baseline gap-3">
      <h2 className="text-[19px] font-bold tracking-tight text-slate-900 dark:text-ndark-text">{q}</h2>
      {badge && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:bg-ndark-bg dark:text-ndark-muted">{badge}</span>}
    </div>
  );
}

// R6 — Nabız cümlesi: tek bakışta ekip okuması.
function PulseSentence({ s, attention, strong }: { s: PeopleTeamSummary; attention: number; strong: number }) {
  const melt = s.netMelted;
  return (
    <div className="rounded-2xl bg-gradient-to-br from-[#2c1c49] to-[#3f2668] px-6 py-5 text-violet-50 shadow-sm">
      <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-violet-300">Ekip nabzı</div>
      <p className="mt-2 text-[15px] leading-relaxed sm:text-base">
        <b className="font-bold text-white">Ekip {attention <= strong ? 'dengeli' : 'yoğun'} çalışıyor.</b>{' '}
        {melt >= 0 ? <>backlog <b className="text-white">{melt} vaka eridi</b></> : <>backlog <b className="text-white">{Math.abs(melt)} vaka büyüdü</b></>},{' '}
        tipik çözüm <b className="text-white">{formatDur(s.medianHours)}</b>, yeniden açılma <b className="text-white">%{s.reopenRatePct ?? '—'}</b>.{' '}
        Bu dönem <span className="font-semibold text-amber-200">{attention} kişi</span> yakından bakmaya değer, <span className="font-semibold text-emerald-200">{strong} kişi</span> belirgin güçlü.
      </p>
    </div>
  );
}

function SupNum({ label, value, tone }: { label: string; value: string; tone?: 'crit' | 'warn' }) {
  const c = tone === 'crit' ? 'text-rose-600 dark:text-rose-400' : tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-ndark-text';
  return (
    <span className="text-[12px] text-slate-500 dark:text-ndark-muted">
      <b className={`block text-[16px] font-bold tabular-nums leading-tight ${c}`}>{value}</b>{label}
    </span>
  );
}

const ATT_UI = {
  watch: { av: 'from-amber-500 to-amber-600', pill: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300', dot: 'bg-amber-500', act: 'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200' },
  info: { av: 'from-sky-500 to-sky-600', pill: 'bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300', dot: 'bg-sky-500', act: 'border-sky-200 bg-sky-50/70 text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-200' },
};
// Kısa pill etiketi — koçluk metninin desenine göre.
function attLabel(tone: 'watch' | 'info', text: string | null | undefined): string {
  if (tone === 'watch') {
    if (text?.includes('açık iş var')) return 'Aşırı yük';
    if (text?.includes('devrediyor')) return 'Sahiplenme';
    return 'Kalite koçluğu';
  }
  return text?.includes('zor iş payı') ? 'Kolay işe kaçış' : 'Sessiz üretken';
}

// R3 + R5 — İçgörü-önce dikkat kartı: koçluk cümlesi başlık, sayılar destekler, aksiyon köprüsü.
function AttentionCard({ p, onOpen }: { p: PersonPerformance; onOpen: () => void }) {
  const c = p.coaching!;
  const tone: 'watch' | 'info' = c.tone === 'watch' ? 'watch' : 'info';
  const ui = ATT_UI[tone];
  const m = p.metrics;
  const reopenHigh = (m.reopenRatePct.value ?? 0) >= 12;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-ndark-border dark:bg-ndark-card">
      <button type="button" onClick={onOpen} className="flex w-full gap-3.5 px-5 py-4 text-left transition-colors hover:bg-slate-50/70 dark:hover:bg-ndark-bg/40">
        <span className={`grid h-11 w-11 flex-none place-items-center rounded-xl bg-gradient-to-br ${ui.av} text-[15px] font-bold text-white`}>{initials(p.name)}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-ndark-text">
            {p.name}
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${ui.pill}`}><span className={`h-1.5 w-1.5 rounded-full ${ui.dot}`} />{attLabel(tone, c.text)}</span>
          </span>
          <span className="mt-1.5 block text-[13.5px] leading-relaxed text-slate-600 dark:text-ndark-muted">{c.text}</span>
        </span>
      </button>
      <div className="flex flex-wrap gap-x-6 gap-y-2 px-5 pb-3.5 pl-[76px]">
        <SupNum label="çözülen" value={`${m.resolved.value}`} />
        <SupNum label="elindeki açık iş" value={`${m.openWip.value}`} tone={tone === 'watch' && (m.openWip.value ?? 0) >= 8 ? 'warn' : undefined} />
        <SupNum label="tipik süre" value={formatDur(m.medianHours.value)} />
        <SupNum label="yeniden açılma" value={m.reopenRatePct.value == null ? '—' : `%${m.reopenRatePct.value}`} tone={reopenHigh ? 'crit' : undefined} />
        {m.qaScore.value != null && <SupNum label="kalite" value={`${m.qaScore.value}/5`} />}
      </div>
      {c.action && (
        <div className={`flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 ${ui.act}`}>
          <span className="text-[12.5px] font-semibold">Öneri: {c.action}</span>
          <button type="button" onClick={onOpen} className="flex-none rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-bold text-brand-700 shadow-sm dark:border-ndark-border dark:bg-ndark-card dark:text-brand-300">Profili aç →</button>
        </div>
      )}
    </div>
  );
}

// "Kim neyde güçlü?" — uzman/referans kartı (KB iş süreçleri).
function ExpertCard({ p, onOpen }: { p: PersonPerformance; onOpen: () => void }) {
  const topics = (p.topExpertise ?? []).slice(0, 2);
  const fast = topics.find((t) => (t.fasterPct ?? 0) >= 20);
  const qa = p.metrics.qaScore.value;
  return (
    <button type="button" onClick={onOpen} className="rounded-xl border border-emerald-200 bg-white p-4 text-left shadow-sm transition-colors hover:bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-ndark-card dark:hover:bg-emerald-950/20">
      <div className="mb-2 flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 text-[13px] font-bold text-white">{initials(p.name)}</span>
        <span className="truncate text-sm font-semibold text-slate-900 dark:text-ndark-text">{p.name}</span>
        <span className="ml-auto flex-none rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Uzman</span>
      </div>
      <p className="text-[12.5px] leading-relaxed text-slate-600 dark:text-ndark-muted">
        {topics.length > 0
          ? <><b className="text-slate-800 dark:text-ndark-text">{topics.map((t) => t.topic).join(' ve ')}</b>’nde güçlü.</>
          : <>Dengeli, sağlam performans.</>}
        {qa != null && <> Kalite {qa}/5.</>}
      </p>
      {fast && <div className="mt-2 text-[11.5px] font-medium text-emerald-600 dark:text-emerald-400">▼ {fast.topic}’nde ekipten %{fast.fasterPct} hızlı</div>}
      <div className="mt-2 text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-400">→ Bilgi paylaşımı için referans</div>
    </button>
  );
}

// R2 — dengeli çoğunluk katlanır; yönetici önemliyle karşılaşır, kalabalık avlanma yok.
function BalancedCollapsed({ people, bench, onOpen }: { people: PersonPerformance[]; bench: PeoplePerformanceResponse['teamBenchmark']; onOpen: (p: PersonPerformance) => void }) {
  const [open, setOpen] = useState(false);
  if (people.length === 0) return null;
  return (
    <section>
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-4 shadow-sm dark:border-ndark-border dark:bg-ndark-card">
        <div className="flex">
          {people.slice(0, 5).map((p, i) => (
            <span key={p.id} className={`grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-brand-500 text-[10.5px] font-bold text-white dark:border-ndark-card ${i ? '-ml-2.5' : ''}`}>{initials(p.name)}</span>
          ))}
        </div>
        <div className="flex-1 text-[13px] text-slate-600 dark:text-ndark-muted"><b className="text-slate-900 dark:text-ndark-text">{people.length} kişi dengeli çalışıyor</b> — sinyaller ekip normalinde, ayrı bir aksiyon gerektirmiyor.</div>
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex-none text-[12.5px] font-bold text-brand-700 dark:text-brand-400">{open ? 'Gizle' : 'Tümünü göster →'}</button>
      </div>
      {open && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {people.map((p) => <PersonCard key={p.id} p={p} bench={bench} onOpen={() => onOpen(p)} />)}
        </div>
      )}
    </section>
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
  // R2 — exception-first bucketing (koçluk sinyali tonuna göre).
  const attention = useMemo(
    () => people.filter((p) => p.coaching?.tone === 'watch' || p.coaching?.tone === 'info')
      .sort((a, b) => (a.coaching?.tone === 'watch' ? 0 : 1) - (b.coaching?.tone === 'watch' ? 0 : 1)),
    [people],
  );
  // "Güçlü" tonundakileri güç skoruyla sırala; sadece belirgin öne çıkanları (top ~8)
  // "Kim güçlü?" bölümüne al — gerisi dengeli çoğunluğa katılır (aksi halde herkes
  // "uzman" olur, ayrım kaybolur). Skor: konu-içi hız > kalite > hacim.
  const EXPERT_CAP = 8;
  const rankedGood = useMemo(() => {
    const strength = (p: PersonPerformance) => {
      const fast = (p.topExpertise ?? []).some((t) => (t.fasterPct ?? 0) >= 20) ? 1000 : 0;
      return fast + (p.metrics.qaScore.value ?? 0) * 100 + (p.metrics.resolved.value ?? 0);
    };
    return people.filter((p) => p.coaching?.tone === 'good').sort((a, b) => strength(b) - strength(a));
  }, [people]);
  const experts = useMemo(() => rankedGood.slice(0, EXPERT_CAP), [rankedGood]);
  const balanced = useMemo(
    () => [...people.filter((p) => !p.coaching?.tone), ...rankedGood.slice(EXPERT_CAP)]
      .sort((a, b) => (b.metrics.resolved.value ?? 0) - (a.metrics.resolved.value ?? 0)),
    [people, rankedGood],
  );
  const openPerson = (p: PersonPerformance) => setSelected({ id: p.id, name: p.name });

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
        <div className="space-y-8">
          {/* R6 — nabız cümlesi */}
          <PulseSentence s={data!.teamSummary} attention={attention.length} strong={experts.length} />

          {/* Ekip bu dönem nasıl? */}
          <section>
            <SectionQ q="Ekip bu dönem nasıl?" />
            <TeamSummary data={data!} />
          </section>

          {/* Kime bakmalıyım? — exception-first */}
          {attention.length > 0 && (
            <section>
              <SectionQ q="Kime bakmalıyım?" badge={`${attention.length} kişi · dikkat`} />
              <div className="grid gap-3">
                {attention.map((p) => <AttentionCard key={p.id} p={p} onOpen={() => openPerson(p)} />)}
              </div>
            </section>
          )}

          {/* Kim neyde güçlü? */}
          {experts.length > 0 && (
            <section>
              <SectionQ q="Kim neyde güçlü?" badge={`${experts.length} uzman · referans`} />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {experts.map((p) => <ExpertCard key={p.id} p={p} onOpen={() => openPerson(p)} />)}
              </div>
            </section>
          )}

          {/* Dengeli çoğunluk — katlanmış */}
          <BalancedCollapsed people={balanced} bench={data!.teamBenchmark} onOpen={openPerson} />
        </div>
      )}
    </div>
  );
}
