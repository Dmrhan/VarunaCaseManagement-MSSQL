// İZOLE Raporlama — manuel "Bildirim Sayıları" Excel'ini birebir üretir.
// Sheet 2 (Key Account) + Sheet 3 (Tüm Projeler): 4 blok (Hata / →Yazılıma(Dev) /
// →Kodlanan / →BI), Proje × ay pivotları. Kaynak: dbo.rpt_TicketLifecycle.
import { useCallback, useEffect, useRef, useState } from 'react';
import { reportingService } from './reportingService';
import { PivotBlock, type ExtraCol } from './PivotBlock';
import type { PivotResponse, ReportFilters } from './types';

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const pct = (a: number, b: number | undefined) => (b && b > 0 ? `${((a / b) * 100).toFixed(2).replace('.', ',')}%` : '—');

const SHEETS = [
  { key: 'sheet3', label: 'Tüm Projeler (S3)', ka: false, ready: true },
  { key: 'sheet2', label: 'Key Account (S2)', ka: true, ready: true },
  { key: 'sheet1', label: 'Kök Neden (S1)', ka: false, ready: false },
  { key: 'sheet4', label: 'Süre (S4)', ka: false, ready: false },
] as const;
type SheetKey = typeof SHEETS[number]['key'];

/** Bir bloğu base'in (b1) proje sırası + dönemlerine hizala (aynı satır düzeni). */
function alignToBase(base: PivotResponse, block: PivotResponse | null): PivotResponse {
  const bm = new Map((block?.rows ?? []).map((r) => [r.key, r]));
  const bIdx = Object.fromEntries((block?.periods ?? []).map((p, i) => [p, i]));
  const rows = base.rows.map((br) => {
    const r = bm.get(br.key);
    return { key: br.key, values: base.periods.map((p) => (r && bIdx[p] != null ? r.values[bIdx[p]] : 0)), total: r?.total ?? 0 };
  });
  const totalValues = base.periods.map((p) => (bIdx[p] != null ? block?.totalRow.values[bIdx[p]] ?? 0 : 0));
  return { periods: base.periods, rows, totalRow: { values: totalValues, total: block?.totalRow.total ?? 0 } };
}

export function ReportsPage() {
  const [sheet, setSheet] = useState<SheetKey>('sheet3');
  const [from, setFrom] = useState('2026-01-01');
  const [to, setTo] = useState('2026-06-30');
  const [kaynak, setKaynak] = useState('Geçmiş (next4biz)');
  const [blocks, setBlocks] = useState<(PivotResponse | null)[]>([null, null, null, null]);
  const [loading, setLoading] = useState(true);
  const reqRef = useRef(0);

  const cfg = SHEETS.find((s) => s.key === sheet)!;

  const load = useCallback(async () => {
    if (!cfg.ready) { setBlocks([null, null, null, null]); return; }
    const id = ++reqRef.current;
    setLoading(true);
    const base: ReportFilters = { from, to, kaynak, tipi: 'Hata', onlyL2: '1', ...(cfg.ka ? { keyAccount: '1' as const } : {}) };
    const [b1, b2, b3, b4] = await Promise.all([
      reportingService.getPivot(base, 'Proje'),
      reportingService.getPivot({ ...base, hedef: 'dev' }, 'Proje'),
      reportingService.getPivot({ ...base, hedef: 'dev', onlyKodlandi: '1' }, 'Proje'),
      reportingService.getPivot({ ...base, hedef: 'bi' }, 'Proje'),
    ]);
    if (id !== reqRef.current) return;
    setBlocks([b1 ?? null, b2 ?? null, b3 ?? null, b4 ?? null]);
    setLoading(false);
  }, [from, to, kaynak, cfg.ready, cfg.ka]);

  useEffect(() => { void load(); }, [load]);

  const [b1, b2, b3, b4] = blocks;
  const multiYear = !!b1 && new Set(b1.periods.map((p) => p.slice(0, 4))).size > 1;
  const monthLabels = b1 ? b1.periods.map((p) => (multiYear ? `${AYLAR[+p.slice(5) - 1]?.slice(0, 3)}'${p.slice(2, 4)}` : AYLAR[+p.slice(5) - 1] ?? p)) : [];
  const nMonths = b1?.periods.length || 1;
  const b1Map = new Map((b1?.rows ?? []).map((r) => [r.key, r.total]));
  const b2Aligned = b1 ? alignToBase(b1, b2) : null;
  const b3Aligned = b1 ? alignToBase(b1, b3) : null;
  const b4Aligned = b1 ? alignToBase(b1, b4) : null;
  const b2Map = new Map((b2Aligned?.rows ?? []).map((r) => [r.key, r.total]));

  const grand = b1?.totalRow.total || 1;
  const b1Extra: ExtraCol[] = [
    { label: '%', value: (r) => pct(r.total, grand), totalValue: '100,00%' },
    { label: 'Aylık Ort', value: (r) => (r.total / nMonths).toFixed(2).replace('.', ','), totalValue: (grand / nMonths).toFixed(2).replace('.', ',') },
  ];

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-ndark-text">Raporlar — Bildirim Sayıları</h1>
        <p className="text-xs text-slate-500 dark:text-ndark-dim">Manuel Excel raporunun birebir otomasyonu · Proje × ay · Hata (L2'ye ulaşan) → Yazılıma(Dev) → Kodlanan → BI</p>
      </div>

      {/* Kontroller */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-3 dark:border-ndark-border">
        <div className="flex items-center gap-1">
          {SHEETS.map((s) => (
            <button key={s.key} type="button" disabled={!s.ready} onClick={() => setSheet(s.key)}
              className={`rounded px-2.5 py-1 text-xs ${sheet === s.key ? 'bg-brand-50 font-medium text-brand-700 dark:bg-ndark-card dark:text-ndark-link' : s.ready ? 'text-slate-600 hover:bg-slate-100 dark:text-ndark-text dark:hover:bg-ndark-card' : 'cursor-not-allowed text-slate-300 dark:text-ndark-dim'}`}
              title={s.ready ? '' : 'Yakında'}>
              {s.label}{!s.ready && ' ·'}
            </button>
          ))}
        </div>
        <span className="mx-1 h-4 w-px bg-slate-200 dark:bg-ndark-border" />
        <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-ndark-text">Başlangıç
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-ndark-border dark:bg-ndark-card" /></label>
        <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-ndark-text">Bitiş
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-ndark-border dark:bg-ndark-card" /></label>
        <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-ndark-text">Kaynak
          <select value={kaynak} onChange={(e) => setKaynak(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text">
            <option value="Geçmiş (next4biz)">Geçmiş (next4biz)</option>
            <option value="Canlı (Varuna)">Canlı (Varuna)</option>
            <option value="">Tümü</option>
          </select></label>
        {loading && <span className="text-xs text-slate-400">Yükleniyor…</span>}
      </div>

      {!cfg.ready ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400 dark:border-ndark-border">Bu sayfa yakında ({cfg.label}).</div>
      ) : (
        <div className="space-y-4">
          <PivotBlock title={`${cfg.ka ? 'Key Account' : 'Tüm Projeler'}'lardan Gelen Hata Bildirimleri`} dimLabel="Proje" data={b1} monthLabels={monthLabels} extraCols={b1Extra} loading={loading} />
          <PivotBlock title="Yazılıma (Dev) İletilenler" dimLabel="Proje" data={b2Aligned} monthLabels={monthLabels} loading={loading}
            extraCols={[{ label: 'Bildirim>Dev Dönüşüm', value: (r) => pct(r.total, b1Map.get(r.key)), totalValue: pct(b2?.totalRow.total ?? 0, grand) }]} />
          <PivotBlock title="Yazılımda Kodlama Yapılanlar" dimLabel="Proje" data={b3Aligned} monthLabels={monthLabels} loading={loading}
            extraCols={[{ label: 'Kodlama Oran', value: (r) => pct(r.total, b2Map.get(r.key)), totalValue: pct(b3?.totalRow.total ?? 0, b2?.totalRow.total ?? 0) }]} />
          <PivotBlock title="BI Ekibine Gönderilenler" dimLabel="Proje" data={b4Aligned} monthLabels={monthLabels} totalLabel="BI Toplam" loading={loading}
            extraCols={[{ label: 'Bildirim>BI Dönüşüm', value: (r) => pct(r.total, b1Map.get(r.key)), totalValue: pct(b4?.totalRow.total ?? 0, grand) }]} />
        </div>
      )}
    </div>
  );
}
