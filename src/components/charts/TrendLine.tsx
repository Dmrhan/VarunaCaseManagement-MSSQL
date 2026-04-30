import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface TrendLineProps {
  series: { label: string; color: string; values: number[] }[];
  xLabels?: string[];
  height?: number;
  showLegend?: boolean;
}

/**
 * Recharts-based responsive line chart.
 * Dark mode: CartesianGrid + axis tick'leri `currentColor` ile parent text
 * rengini alır; outer wrapper class'larıyla light/dark tone değiştirilir.
 * Tooltip arka planı `var(--color-background-primary)` üzerinden
 * otomatik tema uyumludur.
 */
export function TrendLine({ series, xLabels, height = 280, showLegend = true }: TrendLineProps) {
  const len = Math.max(0, ...series.map((s) => s.values.length));
  const labels = xLabels ?? Array.from({ length: len }, (_, i) => String(i + 1));

  // Recharts veri yapısı: her satır { label, [series.label]: value, ... }
  const data = labels.map((label, i) => {
    const row: Record<string, string | number> = { label };
    for (const s of series) row[s.label] = s.values[i] ?? 0;
    return row;
  });

  return (
    <div className="text-slate-500 dark:text-ndark-muted">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="currentColor"
            strokeOpacity={0.2}
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'currentColor' }}
            tickLine={false}
            axisLine={{ stroke: 'currentColor', strokeOpacity: 0.3 }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'currentColor' }}
            tickLine={false}
            axisLine={false}
            width={32}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--color-background-primary, #ffffff)',
              border: '1px solid var(--color-border-tertiary, #e2e8f0)',
              borderRadius: 6,
              fontSize: 12,
              color: 'var(--color-text-primary, #1e293b)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            }}
            labelStyle={{ color: 'var(--color-text-secondary, #64748b)' }}
            itemStyle={{ color: 'var(--color-text-primary, #1e293b)' }}
            cursor={{ stroke: 'currentColor', strokeOpacity: 0.2 }}
          />
          {showLegend && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s) => (
            <Line
              key={s.label}
              type="monotone"
              dataKey={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
