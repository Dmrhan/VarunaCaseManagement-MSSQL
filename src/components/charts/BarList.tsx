import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';

export interface BarListItem {
  key: string;
  label: ReactNode;
  value: number;
  color: string; // tailwind background class, e.g. 'bg-blue-500'
}

interface BarListProps {
  items: BarListItem[];
  formatValue?: (n: number) => string;
  total?: number;     // override total — default sum of values
  showPct?: boolean;
}

export function BarList({ items, formatValue, total, showPct = false }: BarListProps) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const sum = total ?? items.reduce((a, b) => a + b.value, 0);
  return (
    <ul className="space-y-2">
      {items.map((it) => {
        const widthPct = (it.value / max) * 100;
        const sharePct = sum > 0 ? (it.value / sum) * 100 : 0;
        return (
          <li key={it.key}>
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-700">{it.label}</span>
              <span className="font-medium text-slate-800">
                {formatValue ? formatValue(it.value) : it.value}
                {showPct && sum > 0 && (
                  <span className="ml-1 text-slate-400">({sharePct.toFixed(0)}%)</span>
                )}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn('h-full rounded-full transition-all', it.color)}
                style={{ width: `${widthPct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
