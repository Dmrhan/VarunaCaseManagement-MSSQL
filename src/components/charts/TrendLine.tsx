interface TrendLineProps {
  series: { label: string; color: string; values: number[] }[];
  xLabels?: string[];           // her n-inci index için label
  height?: number;
  showLegend?: boolean;
}

export function TrendLine({ series, xLabels, height = 120, showLegend = true }: TrendLineProps) {
  const len = Math.max(1, ...series.map((s) => s.values.length));
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const w = 600;
  const h = height;
  const pad = { l: 28, r: 8, t: 8, b: 18 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  const x = (i: number) => pad.l + (len <= 1 ? innerW / 2 : (i / (len - 1)) * innerW);
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;

  // Y ekseni gridlines (3 yatay çizgi)
  const yTicks = [0, 0.5, 1].map((p) => Math.round(max * p));
  const xTickIndices = [0, Math.floor(len / 2), len - 1];

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none">
        {/* gridlines */}
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={pad.l} x2={w - pad.r} y1={y(tick)} y2={y(tick)} stroke="#e2e8f0" strokeDasharray="2 4" />
            <text x={pad.l - 4} y={y(tick) + 3} textAnchor="end" className="fill-slate-400 text-[9px]">
              {tick}
            </text>
          </g>
        ))}
        {xLabels && xTickIndices.map((idx) => (
          <text
            key={idx}
            x={x(idx)}
            y={h - 4}
            textAnchor="middle"
            className="fill-slate-400 text-[9px]"
          >
            {xLabels[idx] ?? ''}
          </text>
        ))}

        {series.map((s) => {
          const points = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
          return (
            <g key={s.label}>
              <polyline points={points} fill="none" stroke={s.color} strokeWidth={2} />
              {s.values.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r={2} fill={s.color} />
              ))}
            </g>
          );
        })}
      </svg>
      {showLegend && (
        <div className="flex flex-wrap gap-4">
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5 text-xs text-slate-600">
              <span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
