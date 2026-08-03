// İZOLE Raporlama — manuel "Bildirim Sayıları" Excel'ini birebir üretir.
// Sheet 3/2 (Proje): 4 blok Hata / →Yazılıma(Dev) / →Kodlanan / →BI.
// Sheet 1 (Kök Neden): 4 blok Yazılıma İletilen / Kodlanan / Kodlanmayan(açıklamalı) /
//   Kodlanmayan(açıklamasız). Popülasyon = YazilimaAcildi=1 (L3'e/yazılıma iletilen).
// Kaynak: dbo.rpt_TicketLifecycle (KokNeden = Konunun_Kok_Nedeni).
import { useCallback, useEffect, useRef, useState } from 'react';
import { reportingService } from './reportingService';
import { PivotBlock, type ExtraCol } from './PivotBlock';
import { Sheet4View } from './Sheet4View';
import type { PivotResponse, ReportFilters, ReportDimension, S4Response } from './types';

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const pct = (a: number, b: number | undefined) => (b && b > 0 ? `${((a / b) * 100).toFixed(2).replace('.', ',')}%` : '—');

const SHEETS = [
  { key: 'sheet1', label: 'Kök Neden (S1)', ready: true },
  { key: 'sheet2', label: 'Key Account (S2)', ready: true },
  { key: 'sheet3', label: 'Tüm Projeler (S3)', ready: true },
  { key: 'sheet4', label: 'Süre (S4)', ready: true },
] as const;
type SheetKey = typeof SHEETS[number]['key'];

interface SheetPlan {
  dim: ReportDimension;
  dimLabel: string;
  base: ReportFilters;                 // sheet geneli filtre (from/to/kaynak üstüne)
  titles: [string, string, string, string];
  totalLabels: [string?, string?, string?, string?];
  filters: [ReportFilters, ReportFilters, ReportFilters, ReportFilters]; // blok-özel
  subtitle: string;
}

/** Sheet'e göre boyut + 4 blok filtresi/başlığı. S2/S3 = Proje, S1 = Kök Neden. */
function buildPlan(sheet: SheetKey): SheetPlan {
  if (sheet === 'sheet1') {
    return {
      dim: 'KokNeden', dimLabel: 'Kök Neden',
      base: { onlyYazilim: '1' },       // yazılıma/L3'e iletilen (TFS var) — Tipi kısıtı YOK
      titles: [
        'Destek Ekiplerinin Yazılıma İlettiği Maddeler',
        'Yazılımda Kodlama Yapılanlar',
        'Kodlama Yapılmayan — açıklama İLE dönenler',
        'Kodlama Yapılmayan — açıklama olmayanlar',
      ],
      totalLabels: [undefined, undefined, undefined, 'Toplam'],
      filters: [{}, { onlyKodlandi: '1' }, { onlyKodlanmadan: '1', bugGrubu: 'var' }, { onlyKodlanmadan: '1', bugGrubu: 'yok' }],
      subtitle: 'Yazılıma iletilen maddeler (Kök Neden × ay) → Kodlanan → Kodlanmayan (açıklamalı / açıklamasız)',
    };
  }
  if (sheet === 'sheet4') {
    // S4 ayrı bileşenle (Sheet4View) render edilir; plan yalnız başlık/altyazı için.
    return { dim: 'Tipi', dimLabel: 'Tipi', base: {}, titles: ['', '', '', ''], totalLabels: [undefined, undefined, undefined, undefined], filters: [{}, {}, {}, {}], subtitle: 'Bildirim açılış–kapanış süresi · ham takvim + mesai saati (2 taban × 3 blok)' };
  }
  const ka = sheet === 'sheet2';
  return {
    dim: 'Proje', dimLabel: 'Proje',
    base: { tipi: 'Hata', onlyL2: '1', ...(ka ? { keyAccount: '1' as const } : {}) },
    titles: [
      `${ka ? 'Key Account' : 'Tüm Projeler'}'lardan Gelen Hata Bildirimleri`,
      'Yazılıma (Dev) İletilenler',
      'Yazılımda Kodlama Yapılanlar',
      'BI Ekibine Gönderilenler',
    ],
    totalLabels: [undefined, undefined, undefined, 'BI Toplam'],
    filters: [{}, { hedef: 'dev' }, { hedef: 'dev', onlyKodlandi: '1' }, { hedef: 'bi' }],
    subtitle: "Hata (L2'ye ulaşan) → Yazılıma(Dev) → Kodlanan → BI",
  };
}

/** Bir bloğu base'in (b1) satır sırası + dönemlerine hizala (aynı satır düzeni). */
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
  const [sheet, setSheet] = useState<SheetKey>('sheet1');
  const [from, setFrom] = useState('2026-01-01');
  const [to, setTo] = useState('2026-06-30');
  const [kaynak, setKaynak] = useState(''); // '' = Tümü (canlı + geçmiş) — varsayılan
  const [blocks, setBlocks] = useState<(PivotResponse | null)[]>([null, null, null, null]);
  const [s4, setS4] = useState<S4Response | null>(null);
  const [loading, setLoading] = useState(true);
  const reqRef = useRef(0);

  const cfg = SHEETS.find((s) => s.key === sheet)!;
  const plan = buildPlan(sheet);

  const load = useCallback(async () => {
    if (!cfg.ready) { setBlocks([null, null, null, null]); return; }
    const id = ++reqRef.current;
    setLoading(true);
    if (sheet === 'sheet4') {
      // S4 = mesai-duyarlı süre; farklı şekil (Tipi × ay, 2 taban × 3 blok).
      const d = await reportingService.getS4(from, to, kaynak);
      if (id !== reqRef.current) return;
      setS4(d ?? null);
      setLoading(false);
      return;
    }
    let res: (PivotResponse | undefined)[];
    if (sheet === 'sheet1') {
      // S1 = MADDE-seviyesi özel endpoint (distinct TFS madde, madde tarihi, ¬DinRap);
      // generic bildirim-seviyesi pivot'tan farklı. Yalnız geçmiş (next4biz).
      res = await Promise.all((['b1', 'b2', 'b3', 'b4'] as const).map((b) => reportingService.getS1(from, to, b)));
    } else {
      const p = buildPlan(sheet);
      const base: ReportFilters = { from, to, kaynak, ...p.base };
      res = await Promise.all(p.filters.map((f) => reportingService.getPivot({ ...base, ...f }, p.dim)));
    }
    if (id !== reqRef.current) return;
    setBlocks([res[0] ?? null, res[1] ?? null, res[2] ?? null, res[3] ?? null]);
    setLoading(false);
  }, [from, to, kaynak, sheet, cfg.ready]);

  useEffect(() => { void load(); }, [load]);

  const [b1, b2, b3, b4] = blocks;
  const isKN = plan.dim === 'KokNeden';
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
  const b2Extra: ExtraCol[] = [
    { label: isKN ? 'Kodlama Oranı' : 'Bildirim>Dev Dönüşüm', value: (r) => pct(r.total, b1Map.get(r.key)), totalValue: pct(b2?.totalRow.total ?? 0, grand) },
  ];
  const b3Extra: ExtraCol[] = isKN
    ? [{ label: 'İletilene %', value: (r) => pct(r.total, b1Map.get(r.key)), totalValue: pct(b3?.totalRow.total ?? 0, grand) }]
    : [{ label: 'Kodlama Oran', value: (r) => pct(r.total, b2Map.get(r.key)), totalValue: pct(b3?.totalRow.total ?? 0, b2?.totalRow.total ?? 0) }];
  const b4Extra: ExtraCol[] = [
    { label: isKN ? 'İletilene %' : 'Bildirim>BI Dönüşüm', value: (r) => pct(r.total, b1Map.get(r.key)), totalValue: pct(b4?.totalRow.total ?? 0, grand) },
  ];

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-ndark-text">Raporlar — Bildirim Sayıları</h1>
        <p className="text-xs text-slate-500 dark:text-ndark-dim">Manuel Excel raporunun birebir otomasyonu · {plan.subtitle}</p>
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
          <input type="date" value={from} onChange={(e) => { const v = e.target.value; setFrom(v); if (v && to && v > to) setTo(v); }} className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-ndark-border dark:bg-ndark-card" /></label>
        <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-ndark-text">Bitiş
          <input type="date" value={to} onChange={(e) => { const v = e.target.value; setTo(v); if (v && from && v < from) setFrom(v); }} className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-ndark-border dark:bg-ndark-card" /></label>
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
      ) : sheet === 'sheet4' ? (
        <Sheet4View data={s4} loading={loading} />
      ) : (
        <div className="space-y-4">
          <PivotBlock title={plan.titles[0]} dimLabel={plan.dimLabel} data={b1} monthLabels={monthLabels} extraCols={b1Extra} loading={loading} />
          <PivotBlock title={plan.titles[1]} dimLabel={plan.dimLabel} data={b2Aligned} monthLabels={monthLabels} totalLabel={plan.totalLabels[1]} extraCols={b2Extra} loading={loading} />
          <PivotBlock title={plan.titles[2]} dimLabel={plan.dimLabel} data={b3Aligned} monthLabels={monthLabels} totalLabel={plan.totalLabels[2]} extraCols={b3Extra} loading={loading} />
          <PivotBlock title={plan.titles[3]} dimLabel={plan.dimLabel} data={b4Aligned} monthLabels={monthLabels} totalLabel={plan.totalLabels[3]} extraCols={b4Extra} loading={loading} />
        </div>
      )}
    </div>
  );
}
