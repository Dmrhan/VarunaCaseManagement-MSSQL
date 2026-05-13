import { Briefcase, Eye, LineChart, User } from 'lucide-react';
import type { LensConfig, LensKey } from './operationsLensConfig';

interface LensSelectorProps {
  current: LensKey;
  options: LensConfig[];
  onChange: (next: LensKey) => void;
}

const LENS_ICON: Record<LensKey, React.ReactNode> = {
  operations: <Briefcase size={12} />,
  customer:   <Eye size={12} />,
  executive:  <LineChart size={12} />,
  personal:   <User size={12} />,
};

/**
 * Operations Dashboard — kompakt segmented control.
 * Mobile'da yatay scroll yerine wrap; uzun cumlelere izin yok.
 */
export function LensSelector({ current, options, onChange }: LensSelectorProps) {
  if (options.length <= 1) return null;
  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-md border border-slate-200 bg-white p-0.5 dark:border-ndark-border dark:bg-ndark-card">
      {options.map((opt) => {
        const active = current === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            title={opt.description}
            aria-pressed={active}
            className={`inline-flex items-center gap-1 rounded-[5px] px-2.5 py-1 text-xs font-medium transition ${
              active
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50 dark:text-ndark-muted dark:hover:bg-ndark-bg'
            }`}
          >
            {LENS_ICON[opt.key]}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
