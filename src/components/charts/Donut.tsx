interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string; // CSS color (e.g. '#3b62f5')
}

interface DonutProps {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}

export function Donut({ slices, size = 140, thickness = 22, centerLabel, centerValue }: DonutProps) {
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;
  const total = slices.reduce((a, b) => a + b.value, 0) || 1;
  let acc = 0;

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="currentColor"
          className="text-slate-100 dark:text-ndark-card"
          strokeWidth={thickness}
        />
        {slices.map((s) => {
          const dash = (s.value / total) * C;
          const offset = (-acc / total) * C;
          acc += s.value;
          return (
            <circle
              key={s.key}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${C}`}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${cx} ${cy})`}
              strokeLinecap="butt"
            />
          );
        })}
        {centerValue && (
          <text
            x={cx}
            y={cy - 2}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-slate-800 text-lg font-semibold dark:fill-ndark-text"
          >
            {centerValue}
          </text>
        )}
        {centerLabel && (
          <text
            x={cx}
            y={cy + 14}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-slate-500 text-[10px] dark:fill-ndark-muted"
          >
            {centerLabel}
          </text>
        )}
      </svg>
      <ul className="space-y-1.5 text-sm">
        {slices.map((s) => {
          const pct = total > 0 ? (s.value / total) * 100 : 0;
          return (
            <li key={s.key} className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
              <span className="text-xs text-slate-700">{s.label}</span>
              <span className="ml-auto pl-3 font-medium text-slate-800">{s.value}</span>
              <span className="text-xs text-slate-400">({pct.toFixed(0)}%)</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
