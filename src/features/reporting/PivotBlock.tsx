// Excel-tarzı tek pivot bloğu: [boyut] × [ay sütunları] | Toplam | [ekstra kolonlar] + Toplam satırı.
import type { PivotResponse, PivotRow } from './types';

export interface ExtraCol {
  label: string;
  value: (row: PivotRow) => string;
  totalValue?: string;
}

interface PivotBlockProps {
  title: string;
  dimLabel: string;
  data: PivotResponse | null;
  monthLabels: string[];        // data.periods ile hizalı ay adları
  totalLabel?: string;
  extraCols?: ExtraCol[];
  loading?: boolean;
}

const nf = (n: number) => n.toLocaleString('tr-TR');

export function PivotBlock({ title, dimLabel, data, monthLabels, totalLabel = 'Toplam', extraCols = [], loading }: PivotBlockProps) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-ndark-border">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-center text-sm font-semibold text-slate-800 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text">
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-100/60 text-slate-600 dark:bg-ndark-card/60 dark:text-ndark-dim">
              <th className="border border-slate-200 px-2 py-1 text-left font-semibold dark:border-ndark-border">{dimLabel}</th>
              {monthLabels.map((m) => (
                <th key={m} className="border border-slate-200 px-2 py-1 text-right font-semibold dark:border-ndark-border">{m}</th>
              ))}
              <th className="border border-slate-200 px-2 py-1 text-right font-semibold dark:border-ndark-border">{totalLabel}</th>
              {extraCols.map((c) => (
                <th key={c.label} className="border border-slate-200 px-2 py-1 text-right font-semibold dark:border-ndark-border">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(!data || data.rows.length === 0) && (
              <tr><td colSpan={monthLabels.length + 2 + extraCols.length} className="border border-slate-200 px-2 py-6 text-center text-slate-400 dark:border-ndark-border">{loading ? 'Yükleniyor…' : 'Veri yok'}</td></tr>
            )}
            {data?.rows.map((r) => (
              <tr key={r.key} className="hover:bg-slate-50 dark:hover:bg-ndark-card/50">
                <td className="border border-slate-200 px-2 py-1 text-slate-700 dark:border-ndark-border dark:text-ndark-text">{r.key}</td>
                {r.values.map((v, i) => (
                  <td key={i} className="border border-slate-200 px-2 py-1 text-right tabular-nums text-slate-600 dark:border-ndark-border dark:text-ndark-dim">{v ? nf(v) : ''}</td>
                ))}
                <td className="border border-slate-200 px-2 py-1 text-right font-medium tabular-nums text-slate-800 dark:border-ndark-border dark:text-ndark-text">{nf(r.total)}</td>
                {extraCols.map((c) => (
                  <td key={c.label} className="border border-slate-200 px-2 py-1 text-right tabular-nums text-slate-500 dark:border-ndark-border dark:text-ndark-dim">{c.value(r)}</td>
                ))}
              </tr>
            ))}
            {data && data.rows.length > 0 && (
              <tr className="bg-slate-100 font-semibold text-slate-800 dark:bg-ndark-card dark:text-ndark-text">
                <td className="border border-slate-200 px-2 py-1 dark:border-ndark-border">Toplam</td>
                {data.totalRow.values.map((v, i) => (
                  <td key={i} className="border border-slate-200 px-2 py-1 text-right tabular-nums dark:border-ndark-border">{v ? nf(v) : ''}</td>
                ))}
                <td className="border border-slate-200 px-2 py-1 text-right tabular-nums dark:border-ndark-border">{nf(data.totalRow.total)}</td>
                {extraCols.map((c) => (
                  <td key={c.label} className="border border-slate-200 px-2 py-1 text-right tabular-nums dark:border-ndark-border">{c.totalValue ?? ''}</td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
