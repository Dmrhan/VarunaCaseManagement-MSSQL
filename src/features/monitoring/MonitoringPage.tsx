// İZOLE monitoring/İzleme panosu — yönetici tier. Ticket yaşam döngüsü funnel'ı
// (açılan → L2 devir → yazılıma → kodlandı/döndü) + drill-down (KeyAccount →
// Proje → Dist) + zaman serisi. Veri: dbo.vw_TicketLifecycle_All (canlı+geçmiş).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Inbox, ArrowUpRight, Code2, Check, Undo2, Clock, X, Filter } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { MetricTile } from '@/components/charts/MetricTile';
import { BarList } from '@/components/charts/BarList';
import { TrendLine } from '@/components/charts/TrendLine';
import { monitoringService } from './monitoringService';
import type {
  Summary, TimeseriesPoint, BreakdownRow, FiltersResponse,
  MonitoringFilters, Grain, Dimension,
} from './types';

const BAR_COLORS = [
  'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-violet-500', 'bg-rose-500',
  'bg-cyan-500', 'bg-indigo-500', 'bg-teal-500', 'bg-orange-500', 'bg-pink-500',
];
const DIMS: { key: Dimension; label: string; filterKey?: keyof MonitoringFilters }[] = [
  { key: 'Proje', label: 'Proje', filterKey: 'proje' },
  { key: 'Dist', label: 'Dist', filterKey: 'dist' },
  { key: 'KokNeden', label: 'Kök Neden' },
  { key: 'Tipi', label: 'Tipi', filterKey: 'tipi' },
  { key: 'Takim', label: 'Takım' },
  { key: 'Kaynak', label: 'Kaynak', filterKey: 'kaynak' },
];
const GRAINS: { key: Grain; label: string }[] = [
  { key: 'day', label: 'Gün' }, { key: 'week', label: 'Hafta' },
  { key: 'month', label: 'Ay' }, { key: 'year', label: 'Yıl' },
];
const CHIP_LABEL: Partial<Record<keyof MonitoringFilters, string>> = {
  proje: 'Proje', dist: 'Dist', tipi: 'Tipi', kaynak: 'Kaynak',
};
const nf = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('tr-TR'));

type Preset = 'day' | 'week' | 'month' | 'year';
const PRESETS: { key: Preset; label: string }[] = [
  { key: 'day', label: 'Bugün' }, { key: 'week', label: 'Bu Hafta' },
  { key: 'month', label: 'Bu Ay' }, { key: 'year', label: 'Bu Yıl' },
];
const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// Preset → tarih aralığı (bulunduğumuz dönem) + trend granülü.
// anchorIso = "bugün" referansı: verinin SON günü (snapshot bugünü). Yoksa takvim bugünü.
// Snapshot Tem-31'de bitip takvim Ağustos'ta olunca "Bugün/Bu Ay" boş kalmasın diye.
function presetRange(p: Preset, anchorIso?: string): { from: string; to: string; grain: Grain } {
  const now = anchorIso ? new Date(`${anchorIso}T12:00:00`) : new Date();
  const today = isoLocal(now);
  if (p === 'day') return { from: today, to: today, grain: 'day' };
  if (p === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // haftanın Pazartesi'si
    return { from: isoLocal(d), to: today, grain: 'day' };
  }
  if (p === 'month') return { from: isoLocal(new Date(now.getFullYear(), now.getMonth(), 1)), to: today, grain: 'day' };
  return { from: isoLocal(new Date(now.getFullYear(), 0, 1)), to: today, grain: 'month' }; // Bu Yıl
}
// Özel tarih aralığında trend granülünü aralığın uzunluğuna göre seç
function autoGrain(from?: string, to?: string): Grain {
  if (!from) return 'month';
  const days = ((to ? new Date(to) : new Date()).getTime() - new Date(from).getTime()) / 86400000;
  if (days <= 45) return 'day';
  if (days <= 120) return 'week';
  if (days <= 1100) return 'month';
  return 'year';
}

export function MonitoringPage() {
  const [filters, setFilters] = useState<MonitoringFilters>(() => { const r = presetRange('year'); return { from: r.from, to: r.to }; });
  const [grain, setGrain] = useState<Grain>('month');
  const [preset, setPreset] = useState<Preset | null>('year');
  const [dim, setDim] = useState<Dimension>('Proje');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [series, setSeries] = useState<TimeseriesPoint[]>([]);
  const [breakdown, setBreakdown] = useState<BreakdownRow[]>([]);
  const [bdTotal, setBdTotal] = useState(0);
  const [bdPage, setBdPage] = useState(1);
  const [bdPageSize, setBdPageSize] = useState(20);
  const [bdLoading, setBdLoading] = useState(true);
  const [projeBar, setProjeBar] = useState<BreakdownRow[]>([]);
  const [kokBar, setKokBar] = useState<BreakdownRow[]>([]);
  const [opts, setOpts] = useState<FiltersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const mainReqRef = useRef(0);
  const bdReqRef = useRef(0);

  useEffect(() => {
    void monitoringService.getFilters().then((r) => {
      if (!r) return;
      setOpts(r);
      // Preset'leri VERİNİN SON GÜNÜNE sabitle (ilk preset 'year'): snapshot Tem-31'de
      // biter, takvim Ağustos'ta → "Bu Yıl/Bu Ay/Bugün" dolu gelsin.
      if (r.bounds?.sonTarih) {
        const rng = presetRange('year', r.bounds.sonTarih);
        setFilters((f) => ({ ...f, from: rng.from, to: rng.to }));
        setGrain(rng.grain);
      }
    });
  }, []);

  // Özet + zaman serisi + iki bar — sayfalamadan bağımsız
  const loadMain = useCallback(async () => {
    const id = ++mainReqRef.current;
    setLoading(true);
    const [s, ts, pb, kb] = await Promise.all([
      monitoringService.getSummary(filters),
      monitoringService.getTimeseries(filters, grain),
      monitoringService.getBreakdown({ ...filters, tipi: 'Hata', onlyL2: '1' }, 'Proje', 1, 10),
      monitoringService.getBreakdown({ ...filters, onlyYazilim: '1' }, 'KokNeden', 1, 10),
    ]);
    if (id !== mainReqRef.current) return; // last-write-wins
    setSummary(s ?? null);
    setSeries(ts ?? []);
    setProjeBar(pb?.rows ?? []);
    setKokBar(kb?.rows ?? []);
    setLoading(false);
  }, [filters, grain]);

  // Kırılım tablosu — SAYFALI (dim / filtre / sayfa değişince yeniden çeker)
  const loadBreakdown = useCallback(async () => {
    const id = ++bdReqRef.current;
    setBdLoading(true);
    const r = await monitoringService.getBreakdown(filters, dim, bdPage, bdPageSize);
    if (id !== bdReqRef.current) return;
    setBreakdown(r?.rows ?? []);
    setBdTotal(r?.total ?? 0);
    setBdLoading(false);
  }, [filters, dim, bdPage, bdPageSize]);

  useEffect(() => { void loadMain(); }, [loadMain]);
  useEffect(() => { void loadBreakdown(); }, [loadBreakdown]);

  // Filtre/boyut değişince kırılım sayfasını başa al
  const patch = (p: Partial<MonitoringFilters>) => { setFilters((f) => ({ ...f, ...p })); setBdPage(1); };
  const clearKey = (k: keyof MonitoringFilters) => {
    setFilters((f) => { const n = { ...f }; delete n[k]; return n; });
    setBdPage(1);
  };
  const changeDim = (k: Dimension) => { setDim(k); setBdPage(1); };

  // Dönem preset'i: bulunduğumuz gün/hafta/ay/yıl → TÜM ekranlar o aralığı alır
  const applyPreset = (p: Preset) => {
    const r = presetRange(p, opts?.bounds?.sonTarih ?? undefined); // "bugün" = verinin son günü
    setFilters((f) => ({ ...f, from: r.from, to: r.to, all: undefined }));
    setGrain(r.grain);
    setPreset(p);
    setBdPage(1);
  };
  // Elle tarih girilince preset iptal; trend granülü aralığa göre otomatik
  const setDate = (p: Partial<MonitoringFilters>) => {
    const nf = { ...filters, ...p };
    // başlangıç > bitiş olmasın (boş aralık → veri gelmez): değişeni referans al, diğerini çek
    if (nf.from && nf.to && nf.from > nf.to) {
      if ('from' in p) nf.to = nf.from; else nf.from = nf.to;
    }
    setFilters(nf);
    setGrain(autoGrain(nf.from, nf.to));
    setPreset(null);
    setBdPage(1);
  };
  const toggleAll = (checked: boolean) => {
    if (checked) { setFilters((f) => ({ ...f, all: '1', from: undefined, to: undefined })); setGrain('month'); }
    else setFilters((f) => { const n = { ...f }; delete n.all; return n; });
    setPreset(null);
    setBdPage(1);
  };

  // Bir kırılım satırına tıklanınca: o boyut filtrelenebilirse sayfayı ona daralt (drill)
  const drill = (row: BreakdownRow) => {
    const d = DIMS.find((x) => x.key === dim);
    if (!d?.filterKey || row.key === '(boş)') return;
    patch({ [d.filterKey]: row.key } as Partial<MonitoringFilters>);
    if (dim === 'Proje') changeDim('Dist'); // Proje seçildi → dağıtıcılara in
  };

  const totalPages = Math.max(1, Math.ceil(bdTotal / bdPageSize));

  // Yazılıma açılan → 4 sonuç kovası (toplamı = yazılıma açılan; funnel reconcile)
  const codeSegs = summary ? [
    { label: 'Kodlandı', val: summary.kodlandi, color: 'bg-emerald-500' },
    { label: 'Kodlanmadan döndü', val: summary.geriDondu, color: 'bg-rose-500' },
    { label: 'Devam eden', val: summary.devamEden, color: 'bg-amber-500' },
    { label: 'Kodlanmadan düzeltildi', val: summary.digerKok, color: 'bg-violet-500' },
  ] : [];

  const chips = (Object.keys(CHIP_LABEL) as (keyof MonitoringFilters)[]).filter((k) => filters[k]);
  const funnelPct = (n: number) => (summary && summary.acilan > 0 ? Math.round((n / summary.acilan) * 100) : 0);

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4">
      {/* Başlık */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-ndark-text">Monitoring — Ticket Yaşam Döngüsü</h1>
          <p className="text-xs text-slate-500 dark:text-ndark-dim">
            Açılan → L1&rarr;L2 devir → Yazılıma açılan → Kodlandı / Kodlanmadan döndü · KeyAccount → Proje → Dist · Canlı + Geçmiş (2025+)
          </p>
        </div>
        {opts?.meta?.refreshedAt && (
          <div className="text-right text-[11px] text-slate-400 dark:text-ndark-dim">
            <div>Son güncelleme: {opts.meta.refreshedAt}</div>
            {opts.meta.satirSayisi != null && <div>{opts.meta.satirSayisi.toLocaleString('tr-TR')} kayıt</div>}
          </div>
        )}
      </div>

      {/* Filtre çubuğu */}
      <Card>
        <CardBody className="flex flex-wrap items-center gap-3 py-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-ndark-text">
            Başlangıç
            <input type="date" value={filters.from ?? ''} onChange={(e) => setDate({ from: e.target.value || undefined })}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-ndark-border dark:bg-ndark-card" />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-ndark-text">
            Bitiş
            <input type="date" value={filters.to ?? ''} onChange={(e) => setDate({ to: e.target.value || undefined })}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-ndark-border dark:bg-ndark-card" />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-ndark-text">
            <input type="checkbox" checked={filters.all === '1'} onChange={(e) => toggleAll(e.target.checked)} />
            Tüm zaman (2025+)
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-ndark-text">
            <input type="checkbox" checked={filters.keyAccount === '1'} onChange={(e) => patch({ keyAccount: e.target.checked ? '1' : undefined })} />
            Sadece Key Account
          </label>
          <select
            value={filters.proje ?? ''}
            onChange={(e) => patch({ proje: e.target.value || undefined })}
            className="max-w-[180px] rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
            title="Proje"
          >
            <option value="">Tüm projeler</option>
            {opts?.projeler.map((p) => (
              <option key={p.key} value={p.key}>{p.key} ({p.c})</option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-1 text-xs">
            <span className="text-slate-400">Dönem:</span>
            {PRESETS.map((p) => (
              <button key={p.key} onClick={() => applyPreset(p.key)} type="button"
                className={`rounded px-2 py-1 ${preset === p.key ? 'bg-brand-50 font-medium text-brand-700 dark:bg-ndark-card dark:text-ndark-link' : 'text-slate-600 hover:bg-slate-100 dark:text-ndark-text dark:hover:bg-ndark-card'}`}>
                {p.label}
              </button>
            ))}
          </div>
          {chips.length > 0 && (
            <div className="flex w-full flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2 dark:border-ndark-border">
              <Filter size={13} className="text-slate-400" />
              {chips.map((k) => (
                <span key={k} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] text-brand-700 dark:bg-ndark-card dark:text-ndark-link">
                  {CHIP_LABEL[k]}: {String(filters[k])}
                  <button type="button" onClick={() => clearKey(k)} className="hover:text-brand-900"><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Funnel KPI'ları */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricTile label="Açılan" value={nf(summary?.acilan)} icon={<Inbox size={13} />} tone="info" />
        <MetricTile label="L2'ye Devir" value={nf(summary?.l2ye)} icon={<ArrowUpRight size={13} />} tone="neutral"
          hint={summary ? `%${funnelPct(summary.l2ye)}` : undefined} />
        <MetricTile label="Yazılıma Açılan" value={nf(summary?.yazilima)} icon={<Code2 size={13} />} tone="warn"
          hint={summary ? `%${funnelPct(summary.yazilima)}` : undefined} />
        <MetricTile label="Kodlandı" value={nf(summary?.kodlandi)} icon={<Check size={13} />} tone="good" />
        <MetricTile label="Kodlanmadan Döndü" value={nf(summary?.geriDondu)} icon={<Undo2 size={13} />} tone="danger" />
        <MetricTile label="Ort. Çözüm (saat)" value={summary?.ortCozumSaat != null ? summary.ortCozumSaat.toFixed(1) : '—'}
          icon={<Clock size={13} />} tone="neutral" hint={`Hata(L2): ${nf(summary?.hataL2)}`} />
      </div>

      {/* Yazılıma Açılan Sonucu — 4 kova (toplamı = Yazılıma Açılan; funnel reconcile) */}
      {summary && summary.yazilima > 0 && (
        <Card>
          <CardHeader>Yazılıma Açılan Sonucu — toplam {nf(summary.yazilima)}</CardHeader>
          <CardBody>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-ndark-card">
              {codeSegs.map((s) => (s.val > 0 ? (
                <div key={s.label} className={s.color} style={{ width: `${(s.val / summary.yazilima) * 100}%` }} title={`${s.label}: ${nf(s.val)}`} />
              ) : null))}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {codeSegs.map((s) => (
                <span key={s.label} className="inline-flex items-center gap-1.5 text-slate-600 dark:text-ndark-text">
                  <span className={`inline-block h-2.5 w-2.5 rounded-sm ${s.color}`} />
                  {s.label}: <b className="mx-0.5 text-slate-800 dark:text-ndark-text">{nf(s.val)}</b>
                  <span className="text-slate-400">%{Math.round((s.val / summary.yazilima) * 100)}</span>
                </span>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Zaman serisi */}
      <Card>
        <CardHeader>Zaman Serisi ({GRAINS.find((g) => g.key === grain)?.label})</CardHeader>
        <CardBody>
          {series.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">{loading ? 'Yükleniyor…' : 'Veri yok'}</p>
          ) : (
            <TrendLine
              height={260}
              xLabels={series.map((p) => p.period)}
              series={[
                { label: 'Açılan', color: '#3b82f6', values: series.map((p) => p.acilan) },
                { label: 'Hata (L2)', color: '#ef4444', values: series.map((p) => p.hataL2) },
                { label: 'Yazılıma', color: '#8b5cf6', values: series.map((p) => p.yazilima) },
                { label: 'Kodlandı', color: '#10b981', values: series.map((p) => p.kodlandi) },
              ]}
            />
          )}
        </CardBody>
      </Card>

      {/* İki breakdown kartı */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>Key Account Hata (L2'ye ulaşan) — Proje</CardHeader>
          <CardBody>
            {projeBar.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">Veri yok</p> : (
              <BarList showPct items={projeBar.map((r, i) => ({ key: r.key, label: r.key, value: r.hataL2, color: BAR_COLORS[i % BAR_COLORS.length] }))} />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>Yazılıma İletilen — Kök Neden</CardHeader>
          <CardBody>
            {kokBar.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">Veri yok</p> : (
              <BarList showPct items={kokBar.map((r, i) => ({ key: r.key, label: r.key, value: r.yazilima, color: BAR_COLORS[i % BAR_COLORS.length] }))} />
            )}
          </CardBody>
        </Card>
      </div>

      {/* Drill-down tablosu */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-2">Kırılım</span>
            {DIMS.map((d) => (
              <button key={d.key} type="button" onClick={() => changeDim(d.key)}
                className={`rounded px-2 py-1 text-xs ${dim === d.key ? 'bg-brand-50 font-medium text-brand-700 dark:bg-ndark-card dark:text-ndark-link' : 'text-slate-600 hover:bg-slate-100 dark:text-ndark-text dark:hover:bg-ndark-card'}`}>
                {d.label}
              </button>
            ))}
            {DIMS.find((x) => x.key === dim)?.filterKey && (
              <span className="ml-1 text-[11px] text-slate-400">satıra tıkla → daralt</span>
            )}
          </div>
        </CardHeader>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400 dark:border-ndark-border">
                <th className="px-3 py-2 font-medium">{DIMS.find((x) => x.key === dim)?.label}</th>
                <th className="px-3 py-2 text-right font-medium">Açılan</th>
                <th className="px-3 py-2 text-right font-medium">L2 Devir</th>
                <th className="px-3 py-2 text-right font-medium">Yazılıma</th>
                <th className="px-3 py-2 text-right font-medium">Kodlandı</th>
                <th className="px-3 py-2 text-right font-medium">Döndü</th>
                <th className="px-3 py-2 text-right font-medium">Hata(L2)</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">{bdLoading ? 'Yükleniyor…' : 'Veri yok'}</td></tr>
              )}
              {breakdown.map((r) => {
                const clickable = !!DIMS.find((x) => x.key === dim)?.filterKey && r.key !== '(boş)';
                return (
                  <tr key={r.key} onClick={() => clickable && drill(r)}
                    className={`border-b border-slate-50 dark:border-ndark-border/50 ${clickable ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-ndark-card' : ''}`}>
                    <td className="px-3 py-1.5 text-slate-700 dark:text-ndark-text">{r.key}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600 dark:text-ndark-dim">{nf(r.acilan)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600 dark:text-ndark-dim">{nf(r.l2ye)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-amber-700">{nf(r.yazilima)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{nf(r.kodlandi)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-rose-700">{nf(r.geriDondu)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium text-slate-800 dark:text-ndark-text">{nf(r.hataL2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          {/* Sayfalama — tüm proje/dist'leri gez */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-ndark-border dark:text-ndark-dim">
            <span>
              Toplam <b className="text-slate-700 dark:text-ndark-text">{nf(bdTotal)}</b>{' '}
              {DIMS.find((x) => x.key === dim)?.label.toLowerCase()} · Sayfa {bdPage}/{totalPages}
            </span>
            <div className="flex items-center gap-1.5">
              <select
                value={bdPageSize}
                onChange={(e) => { setBdPageSize(Number(e.target.value)); setBdPage(1); }}
                className="rounded border border-slate-300 px-1.5 py-1 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
              >
                {[20, 50, 100, 200].map((n) => <option key={n} value={n}>{n}/sayfa</option>)}
              </select>
              <button type="button" disabled={bdPage <= 1} onClick={() => setBdPage((p) => Math.max(1, p - 1))}
                className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100 disabled:opacity-40 dark:border-ndark-border dark:hover:bg-ndark-card">‹ Önceki</button>
              <button type="button" disabled={bdPage >= totalPages} onClick={() => setBdPage((p) => Math.min(totalPages, p + 1))}
                className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100 disabled:opacity-40 dark:border-ndark-border dark:hover:bg-ndark-card">Sonraki ›</button>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
