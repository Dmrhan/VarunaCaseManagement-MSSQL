/**
 * CsSlaDashboardPage — CS Yönetim Panosu (SLA İzleme). 2026-07-13
 *
 * n4b dönemindeki Power BI panosunun Varuna içi birebiri (kullanıcı onaylı
 * mockup: 8 filtre üstte · 15 kolonlu SLA tablosu · 5 KPI kartı altta).
 * Yetki: TÜM roller (bilinçli — daraltma ileride nav + route listesinden).
 * Veri: GET /api/analytics/sla-dashboard (sunucu tarafı filtre+sayfalama).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, SearchX } from 'lucide-react';
import {
  analyticsService,
  type SlaDashboardFilters,
  type SlaDashboardResponse,
  type SlaDashboardRow,
} from '../../services/analyticsService';

const PRIORITY_TR: Record<string, string> = {
  Low: 'Düşük',
  Medium: 'Orta',
  High: 'Yüksek',
  Critical: 'Kritik',
};
const OPEN_AGE_OPTIONS = ['0-1', '1-3', '3-7', '7+'];
const SUPPORT_LEVELS = ['L1', 'L2', 'L3'];
const YEARS = [2026, 2025];
const MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

const nf = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('tr-TR');

/** Kalan-süre hücresi: değer + orta çizgili mini veri çubuğu (mockup'taki). */
function BarCell({ value, span, unit }: { value: number | null; span: number; unit: string }) {
  if (value == null) return <span className="text-slate-400 dark:text-ndark-dim">—</span>;
  const pct = Math.min((Math.abs(value) / span) * 50, 50);
  const tone = value < 0 ? 'crit' : value < span * 0.15 ? 'warn' : 'ok';
  const textCls =
    tone === 'crit'
      ? 'text-red-600 dark:text-red-400'
      : tone === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-emerald-600 dark:text-emerald-400';
  const fillCls = tone === 'crit' ? 'bg-red-600' : tone === 'warn' ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex min-w-[130px] items-center justify-end gap-2" title={`${nf.format(value)} ${unit}`}>
      <span className={`min-w-[56px] text-right font-semibold tabular-nums ${textCls}`}>
        {nf.format(value)}
      </span>
      <span className="relative h-2 w-16 shrink-0 overflow-hidden rounded-full bg-slate-200 dark:bg-ndark-bg">
        <span className="absolute inset-y-0 left-1/2 w-px bg-slate-400/60" />
        <span
          className={`absolute inset-y-0 rounded-full ${fillCls}`}
          style={value < 0 ? { right: '50%', width: `${pct}%` } : { left: '50%', width: `${pct}%` }}
        />
      </span>
    </div>
  );
}

function UyumPill({ value }: { value: boolean | null }) {
  if (value == null) return <span className="text-slate-400 dark:text-ndark-dim">—</span>;
  return value ? (
    <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
      Evet
    </span>
  ) : (
    <span className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700 dark:bg-red-900/30 dark:text-red-300">
      Hayır
    </span>
  );
}

function DeptChip({ label }: { label: string | null }) {
  if (!label) return <span className="text-slate-400 dark:text-ndark-dim">—</span>;
  return (
    <span className="inline-block rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-muted">
      {label}
    </span>
  );
}

interface Props {
  onSelectCase?: (caseId: string) => void;
}

export function CsSlaDashboardPage({ onSelectCase }: Props) {
  const [filters, setFilters] = useState<SlaDashboardFilters>({ page: 1 });
  const [data, setData] = useState<SlaDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (f: SlaDashboardFilters) => {
    setLoading(true);
    const res = await analyticsService.getSlaDashboard(f);
    if (res) setData(res);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(filters);
  }, [filters, load]);

  const set = (patch: Partial<SlaDashboardFilters>) =>
    setFilters((f) => ({ ...f, ...patch, page: 1 }));

  const kpis = data?.kpis;
  const pct = (n: number, d: number) => (d > 0 ? `%${nf.format((n / d) * 100).replace(',00', ',0')}` : '—');

  const filterDefs = useMemo(
    () => [
      {
        key: 'year',
        label: 'Yıl',
        value: filters.year ?? '',
        options: YEARS.map((y) => ({ v: String(y), l: String(y) })),
        onChange: (v: string) => set({ year: v ? Number(v) : null, month: v ? filters.month : null }),
      },
      {
        key: 'month',
        label: 'Ay',
        value: filters.month ?? '',
        options: MONTHS.map((m, i) => ({ v: String(i + 1), l: m })),
        onChange: (v: string) => set({ month: v ? Number(v) : null }),
      },
      {
        key: 'waitingDept',
        label: 'Bekleyen Bölüm',
        value: filters.waitingDept ?? '',
        options: (data?.options.waitingDepts ?? []).map((d) => ({ v: d, l: d })),
        onChange: (v: string) => set({ waitingDept: v || null }),
      },
      {
        key: 'supportLevel',
        label: 'Support L1-L2',
        value: filters.supportLevel ?? '',
        options: SUPPORT_LEVELS.map((l) => ({ v: l, l })),
        onChange: (v: string) => set({ supportLevel: v || null }),
      },
      {
        key: 'status',
        label: 'Vaka Durumu',
        value: filters.status ?? '',
        options: (data?.options.statuses ?? []).map((s) => ({ v: s, l: s })),
        onChange: (v: string) => set({ status: v || null }),
      },
      {
        key: 'accountId',
        label: 'Müşteri (Proje)',
        value: filters.accountId ?? '',
        options: (data?.options.accounts ?? []).map((a) => ({ v: a.id, l: a.name })),
        onChange: (v: string) => set({ accountId: v || null }),
      },
      {
        key: 'openAge',
        label: 'Açık Kalma Aralığı',
        value: filters.openAge ?? '',
        options: OPEN_AGE_OPTIONS.map((b) => ({ v: b, l: `${b} gün` })),
        onChange: (v: string) => set({ openAge: v || null }),
      },
      {
        key: 'requestType',
        label: 'Bildirim Tipi',
        value: filters.requestType ?? '',
        options: (data?.options.requestTypes ?? []).map((t) => ({ v: t, l: t })),
        onChange: (v: string) => set({ requestType: v || null }),
      },
    ],
    [filters, data],
  );

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5">
      {/* Başlık + amaç (öz-açıklayıcı ekran kuralı) */}
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-xl font-bold text-slate-800 dark:text-ndark-text">
          CS Yönetim Panosu — SLA İzleme
        </h1>
        <button
          type="button"
          onClick={() => void load(filters)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-brand-400 hover:text-brand-600 dark:border-ndark-border dark:text-ndark-muted"
          title="Yenile"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Yenile
        </button>
      </div>
      <p className="mt-1 max-w-4xl text-xs leading-relaxed text-slate-500 dark:text-ndark-muted">
        Tüm vakaların <b>çözüm ve müdahale SLA</b> durumu tek tabloda: hedef, geçen ve kalan
        süreler; gecikenler kırmızı çubukla öne çıkar ve liste gecikeni öne alarak sıralanır.
      </p>

      {/* 8 filtre — kaynaktaki sıra */}
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        {filterDefs.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
              {f.label}
            </span>
            <select
              value={String(f.value)}
              onChange={(e) => f.onChange(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-brand-500 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
            >
              <option value="">Tümü</option>
              {f.options.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.l}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {/* Ana tablo */}
      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-ndark-border dark:bg-ndark-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-ndark-border">
          <div className="text-sm font-bold text-slate-800 dark:text-ndark-text">
            Vaka SLA Dökümü{' '}
            <span className="text-[11px] font-normal text-slate-400 dark:text-ndark-dim">
              · geciken önce
            </span>
          </div>
          <div className="text-[11px] text-slate-400 dark:text-ndark-dim">
            {kpis ? `${nf0.format(kpis.totalCount)} kayıt` : '…'}
            {data ? ` · ${new Date(data.generatedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1560px] border-collapse whitespace-nowrap text-xs">
            <thead>
              <tr className="bg-slate-50 text-left text-[10.5px] font-bold tracking-wide text-slate-500 dark:bg-ndark-bg dark:text-ndark-muted">
                <th className="px-2.5 py-2">Müşteri (Proje)</th>
                <th className="px-2.5 py-2">Öncelik</th>
                <th className="px-2.5 py-2">Bölüm</th>
                <th className="px-2.5 py-2">Vaka No</th>
                <th className="px-2.5 py-2">DevOps No</th>
                <th className="px-2.5 py-2">Sahibi</th>
                <th className="px-2.5 py-2">Bekleyen Bölüm</th>
                <th className="px-2.5 py-2">Çözüm Uyum</th>
                <th className="px-2.5 py-2 text-right">Hedef Çözüm (gün)</th>
                <th className="px-2.5 py-2 text-right">Geçen (gün)</th>
                <th className="px-2.5 py-2 text-right">Kalan (gün)</th>
                <th className="px-2.5 py-2">Müdahale Uyum</th>
                <th className="px-2.5 py-2 text-right">Hedef Müd. (dk)</th>
                <th className="px-2.5 py-2 text-right">Müd. Kalan (dk)</th>
                <th className="px-2.5 py-2 text-right">Müd. Geçen (dk)</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((r: SlaDashboardRow) => (
                <tr
                  key={r.id}
                  className="border-t border-slate-100 hover:bg-brand-50/40 dark:border-ndark-border/50 dark:hover:bg-ndark-bg/40"
                >
                  <td className="px-2.5 py-1.5">
                    {r.accountName ? (
                      <span className="font-semibold text-slate-800 dark:text-ndark-text">{r.accountName}</span>
                    ) : (
                      <span className="italic text-slate-400 dark:text-ndark-dim">— müşteri eşleşmedi</span>
                    )}
                  </td>
                  <td className="px-2.5 py-1.5 text-slate-600 dark:text-ndark-muted">
                    {PRIORITY_TR[r.priority ?? ''] ?? r.priority ?? '—'}
                  </td>
                  <td className="px-2.5 py-1.5"><DeptChip label={r.teamName} /></td>
                  <td className="px-2.5 py-1.5">
                    <button
                      type="button"
                      onClick={() => onSelectCase?.(r.id)}
                      className="font-semibold text-brand-600 hover:underline dark:text-ndark-link"
                      title="Vakayı aç"
                    >
                      {r.caseNumber}
                    </button>
                  </td>
                  <td className="px-2.5 py-1.5 tabular-nums text-slate-500 dark:text-ndark-muted">
                    {r.devopsIds.length ? r.devopsIds.join(', ') : '—'}
                  </td>
                  <td className="px-2.5 py-1.5 text-slate-700 dark:text-ndark-text">{r.ownerName ?? '—'}</td>
                  <td className="px-2.5 py-1.5"><DeptChip label={r.waitingDept} /></td>
                  <td className="px-2.5 py-1.5"><UyumPill value={r.resolutionOnTarget} /></td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-slate-600 dark:text-ndark-muted">
                    {r.resolutionTargetDays != null ? nf.format(r.resolutionTargetDays) : '—'}
                  </td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-slate-600 dark:text-ndark-muted">
                    {nf.format(r.resolutionElapsedDays)}
                  </td>
                  <td className="px-2.5 py-1.5">
                    <BarCell value={r.resolutionRemainingDays} span={3} unit="gün" />
                  </td>
                  <td className="px-2.5 py-1.5"><UyumPill value={r.responseOnTarget} /></td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-slate-600 dark:text-ndark-muted">
                    {r.responseTargetMin != null ? nf0.format(r.responseTargetMin) : '—'}
                  </td>
                  <td className="px-2.5 py-1.5">
                    <BarCell value={r.responseRemainingMin} span={480} unit="dk" />
                  </td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-slate-600 dark:text-ndark-muted">
                    {nf0.format(r.responseElapsedMin)}
                  </td>
                </tr>
              ))}
              {!loading && (data?.rows.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={15} className="px-4 py-10 text-center text-slate-400 dark:text-ndark-dim">
                    <SearchX size={20} className="mx-auto mb-2" />
                    Filtreye uyan vaka yok — filtreleri gevşetmeyi deneyin.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-4 border-t border-slate-200 px-4 py-2 text-[10.5px] text-slate-400 dark:border-ndark-border dark:text-ndark-dim">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-3.5 rounded-full bg-red-600" /> gecikmiş (kalan &lt; 0)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-3.5 rounded-full bg-amber-500" /> sınırda
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-3.5 rounded-full bg-emerald-500" /> hedef içinde
          </span>
          <span>· Bekleyen Bölüm = 3rd-party adı / havuz / atanmış takım / müşteri türetimi</span>
          <span>· DevOps No yalnız yazılıma eskale vakalarda dolu</span>
        </div>
      </div>

      {/* Sayfalama */}
      <div className="mt-3 flex items-center justify-center gap-3 text-xs text-slate-500 dark:text-ndark-muted">
        <button
          type="button"
          disabled={(data?.page ?? 1) <= 1 || loading}
          onClick={() => setFilters((f) => ({ ...f, page: Math.max((data?.page ?? 1) - 1, 1) }))}
          className="rounded-md border border-slate-200 bg-white px-3 py-1 hover:border-brand-400 hover:text-brand-600 disabled:opacity-40 dark:border-ndark-border dark:bg-ndark-card"
        >
          ‹ Önceki
        </button>
        <span>
          Sayfa {data?.page ?? 1} / {data?.totalPages ?? 1}
        </span>
        <button
          type="button"
          disabled={(data?.page ?? 1) >= (data?.totalPages ?? 1) || loading}
          onClick={() =>
            setFilters((f) => ({ ...f, page: Math.min((data?.page ?? 1) + 1, data?.totalPages ?? 1) }))
          }
          className="rounded-md border border-slate-200 bg-white px-3 py-1 hover:border-brand-400 hover:text-brand-600 disabled:opacity-40 dark:border-ndark-border dark:bg-ndark-card"
        >
          Sonraki ›
        </button>
      </div>

      {/* 5 KPI kartı — kaynaktaki gibi en altta */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-ndark-border dark:bg-ndark-card">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
            Toplam Vaka
          </div>
          <div className="mt-1.5 text-3xl font-extrabold tabular-nums text-brand-600 dark:text-ndark-link">
            {kpis ? nf0.format(kpis.totalCount) : '…'}
          </div>
        </div>
        {(
          [
            { lbl: 'Çözüm SLA Uyum (adet)', k: kpis?.resolution, isPct: false },
            { lbl: 'Çözüm SLA Uyum %', k: kpis?.resolution, isPct: true },
            { lbl: 'Müdahale SLA Uyum (adet)', k: kpis?.response, isPct: false },
            { lbl: 'Müdahale SLA Uyum %', k: kpis?.response, isPct: true },
          ] as const
        ).map((c) => (
          <div
            key={c.lbl}
            className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-ndark-border dark:bg-ndark-card"
          >
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
              {c.lbl}
            </div>
            <div className="mt-1.5 flex gap-4">
              <div className="flex-1">
                <div className="text-[10px] font-bold text-slate-400 dark:text-ndark-dim">EVET</div>
                <div className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {c.k ? (c.isPct ? pct(c.k.evet, c.k.withDue) : nf0.format(c.k.evet)) : '…'}
                </div>
              </div>
              <div className="flex-1">
                <div className="text-[10px] font-bold text-slate-400 dark:text-ndark-dim">HAYIR</div>
                <div className="text-lg font-bold tabular-nums text-red-600 dark:text-red-400">
                  {c.k ? (c.isPct ? pct(c.k.hayir, c.k.withDue) : nf0.format(c.k.hayir)) : '…'}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
