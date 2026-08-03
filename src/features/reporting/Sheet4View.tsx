// Sheet 4 (Süre) — mesai-duyarlı süre analizi. İKİ zaman tabanı (Ham/Mesai) ×
// ÜÇ blok (Tüm / TFS-var / TFS-yok); her tablo Tipi × ay (Sayı/Saat/Ort) + Toplam
// grubu (Sayı/Saat/Ort Saat/Ort Gün). Kaynak: /api/monitoring/report/s4.
import { Fragment } from 'react';
import type { S4Response, S4Row } from './types';

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const monthLabel = (p: string, multiYear: boolean) =>
  multiYear ? `${AYLAR[+p.slice(5) - 1]?.slice(0, 3)}'${p.slice(2, 4)}` : AYLAR[+p.slice(5) - 1] ?? p;

const nf = (n: number) => n.toLocaleString('tr-TR');
const h1 = (dk: number) => (dk / 60).toFixed(1).replace('.', ','); // saat
const gun = (dk: number, netDayMin: number) => (dk / netDayMin).toFixed(1).replace('.', ','); // gün

function S4Table({ title, rows, periods, monthLabels, netDayMin }: {
  title: string; rows: S4Row[]; periods: string[]; monthLabels: string[]; netDayMin: number;
}) {
  const totCells = periods.map((_, i) => rows.reduce((a, r) => ({ s: a.s + (r.cells[i]?.s ?? 0), d: a.d + (r.cells[i]?.d ?? 0) }), { s: 0, d: 0 }));
  const grand = rows.reduce((a, r) => ({ s: a.s + r.tot.s, d: a.d + r.tot.d }), { s: 0, d: 0 });
  const th = 'border border-slate-200 px-2 py-1 font-semibold dark:border-ndark-border';
  const td = 'border border-slate-200 px-2 py-1 text-right tabular-nums dark:border-ndark-border';
  return (
    <div className="rounded-lg border border-slate-200 dark:border-ndark-border">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-slate-100/60 text-slate-600 dark:bg-ndark-card/60 dark:text-ndark-dim">
            <tr>
              <th className={`${th} text-left`} rowSpan={2}>Tipi</th>
              {monthLabels.map((m) => <th key={m} className={`${th} text-center`} colSpan={3}>{m}</th>)}
              <th className={`${th} text-center`} colSpan={4}>Toplam</th>
            </tr>
            <tr>
              {monthLabels.map((m) => (
                <Fragment key={m}>
                  <th className={`${th} text-right`}>Sayı</th><th className={`${th} text-right`}>Saat</th><th className={`${th} text-right`}>Ort</th>
                </Fragment>
              ))}
              <th className={`${th} text-right`}>Sayı</th><th className={`${th} text-right`}>Saat</th><th className={`${th} text-right`}>Ort S</th><th className={`${th} text-right`}>Ort G</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={periods.length * 3 + 5} className="border border-slate-200 px-2 py-6 text-center text-slate-400 dark:border-ndark-border">Veri yok</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.tipi} className="hover:bg-slate-50 dark:hover:bg-ndark-card/50">
                <td className="border border-slate-200 px-2 py-1 text-slate-700 dark:border-ndark-border dark:text-ndark-text">{r.tipi}</td>
                {r.cells.map((c, i) => (
                  <Fragment key={i}>
                    <td className={`${td} text-slate-600 dark:text-ndark-dim`}>{c.s ? nf(c.s) : ''}</td>
                    <td className={`${td} text-slate-600 dark:text-ndark-dim`}>{c.s ? h1(c.d) : ''}</td>
                    <td className={`${td} text-slate-500 dark:text-ndark-dim`}>{c.s ? h1(c.d / c.s) : ''}</td>
                  </Fragment>
                ))}
                <td className={`${td} font-medium text-slate-800 dark:text-ndark-text`}>{nf(r.tot.s)}</td>
                <td className={`${td} font-medium text-slate-800 dark:text-ndark-text`}>{h1(r.tot.d)}</td>
                <td className={`${td} text-slate-600 dark:text-ndark-dim`}>{r.tot.s ? h1(r.tot.d / r.tot.s) : ''}</td>
                <td className={`${td} text-brand-700 dark:text-ndark-link`}>{r.tot.s ? gun(r.tot.d / r.tot.s, netDayMin) : ''}</td>
              </tr>
            ))}
            {rows.length > 0 && (
              <tr className="bg-slate-100 font-semibold text-slate-800 dark:bg-ndark-card dark:text-ndark-text">
                <td className="border border-slate-200 px-2 py-1 dark:border-ndark-border">Toplam</td>
                {totCells.map((c, i) => (
                  <Fragment key={i}>
                    <td className={td}>{c.s ? nf(c.s) : ''}</td><td className={td}>{c.s ? h1(c.d) : ''}</td><td className={td}>{c.s ? h1(c.d / c.s) : ''}</td>
                  </Fragment>
                ))}
                <td className={td}>{nf(grand.s)}</td><td className={td}>{h1(grand.d)}</td><td className={td}>{grand.s ? h1(grand.d / grand.s) : ''}</td><td className={td}>{grand.s ? gun(grand.d / grand.s, netDayMin) : ''}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Sheet4View({ data, loading }: { data: S4Response | null; loading?: boolean }) {
  if (!data) {
    return <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400 dark:border-ndark-border">{loading ? 'Yükleniyor…' : 'Veri yok'}</div>;
  }
  const multiYear = new Set(data.periods.map((p) => p.slice(0, 4))).size > 1;
  const monthLabels = data.periods.map((p) => monthLabel(p, multiYear));
  const bases = [
    { key: 'wall' as const, label: 'A) Ham Takvim Saati (kesintisiz, 7/24)' },
    { key: 'biz' as const, label: 'B) Mesai Saati (Pzt–Cum 08:30–18:00, hafta sonu + tatil + öğle molası hariç)' },
  ];
  const blocks = [
    { key: 'all' as const, label: 'Tüm Bildirimler' },
    { key: 'tfsVar' as const, label: "Yazılım / BI'a Madde Açılmış (TFS var)" },
    { key: 'tfsYok' as const, label: 'Maddesi Olmayanlar (TFS yok)' },
  ];
  return (
    <div className="space-y-6">
      <p className="text-xs text-slate-500 dark:text-ndark-dim">Açılış→Kapanış süresi · Tipi × ay · Ort Gün = net mesai günü ({(data.netDayMin / 60).toFixed(1).replace('.', ',')}s/gün)</p>
      {bases.map((base) => (
        <div key={base.key} className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-ndark-text">{base.label}</h2>
          {blocks.map((blk) => (
            <S4Table key={blk.key} title={blk.label} rows={data.blocks[blk.key][base.key]} periods={data.periods} monthLabels={monthLabels} netDayMin={data.netDayMin} />
          ))}
        </div>
      ))}
    </div>
  );
}
