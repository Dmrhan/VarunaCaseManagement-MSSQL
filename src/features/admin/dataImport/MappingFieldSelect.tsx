/**
 * WR-A8 — Data Import Studio mapping field dropdown.
 *
 * Native <select> sometimes collapses during parent re-renders (e.g. when
 * the mapping list re-renders after `setMapping`, or when source/target
 * cards animate). This component is a controlled popover/listbox that
 * stays open until:
 *   - the user picks an option,
 *   - the user clicks outside, or
 *   - the user presses Escape.
 *
 * It does NOT close when:
 *   - parent re-renders,
 *   - the user scrolls inside the popover,
 *   - the user moves the pointer over options.
 *
 * Used only inside Data Integration Studio mapping flows; unrelated
 * dropdowns (company/method/auth) keep native <select> behavior.
 */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '@/components/ui/cn';

export interface MappingFieldOption {
  /** Value sent to onChange. Use empty string for "unmapped". */
  value: string;
  label: string;
  required?: boolean;
  pii?: boolean;
  description?: string;
}

interface Props {
  value: string;
  options: MappingFieldOption[];
  /** First-option placeholder text. Defaults to "— eşleşmedi —". */
  placeholder?: string;
  onChange: (value: string | null) => void;
  className?: string;
  disabled?: boolean;
}

const UNMAPPED_PLACEHOLDER = '— eşleşmedi —';

export function MappingFieldSelect({
  value,
  options,
  placeholder = UNMAPPED_PLACEHOLDER,
  onChange,
  className,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  );

  // Outside-click via document pointerdown. Using pointerdown (not click)
  // so option mousedown can preempt the close — option clicks set value
  // and close inside the option handler.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const root = containerRef.current;
      if (!root) return;
      if (e.target instanceof Node && root.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Escape closes
  useEffect(() => {
    if (!open) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function handleSelect(v: string) {
    // Empty string → unmapped → onChange(null) to match existing payload shape.
    onChange(v === '' ? null : v);
    setOpen(false);
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange(null);
    setOpen(false);
  }

  function handleButtonKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen((v) => !v);
    } else if (e.key === 'ArrowDown' && !open) {
      e.preventDefault();
      setOpen(true);
    }
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={handleButtonKey}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md border bg-white px-3 py-2 text-left text-xs transition-colors',
          'border-slate-300 hover:border-brand-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20',
          'dark:border-ndark-border dark:bg-ndark-card dark:hover:border-ndark-accent dark:focus:border-ndark-accent dark:focus:ring-ndark-accent/30',
          disabled && 'cursor-not-allowed opacity-60',
          open && 'border-brand-500 ring-2 ring-brand-500/20',
        )}
      >
        <span className={cn('flex-1 truncate', selected ? 'text-slate-800 dark:text-ndark-text' : 'text-slate-400 dark:text-ndark-muted')}>
          {selected ? selected.label : placeholder}
        </span>
        {selected && selected.required && (
          <span className="shrink-0 rounded bg-rose-100 px-1 py-0.5 text-[9px] font-semibold text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
            zorunlu
          </span>
        )}
        {selected && selected.pii && (
          <span className="shrink-0 rounded bg-violet-100 px-1 py-0.5 text-[9px] font-semibold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
            PII
          </span>
        )}
        {selected && !disabled && (
          <span
            role="button"
            aria-label="Eşleşmeyi kaldır"
            tabIndex={-1}
            onClick={handleClear}
            className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-ndark-surface"
          >
            <X size={11} />
          </span>
        )}
        <ChevronDown size={12} className={cn('shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && !disabled && (
        <div
          role="listbox"
          id={listId}
          className={cn(
            'absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg',
            'dark:border-ndark-border dark:bg-ndark-card',
          )}
        >
          <ul className="max-h-72 overflow-y-auto py-1">
            {/* Unmapped option always first */}
            <li>
              <button
                type="button"
                onClick={() => handleSelect('')}
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors',
                  'hover:bg-slate-50 dark:hover:bg-ndark-surface',
                  value === '' && 'bg-slate-100 dark:bg-ndark-surface',
                )}
              >
                <span className="italic text-slate-500 dark:text-ndark-muted">{placeholder}</span>
              </button>
            </li>
            {options.map((opt) => {
              const isActive = opt.value === value;
              return (
                <li key={opt.value}>
                  <button
                    type="button"
                    onClick={() => handleSelect(opt.value)}
                    className={cn(
                      'flex w-full flex-col gap-0.5 px-3 py-1.5 text-left text-xs transition-colors',
                      'hover:bg-slate-50 dark:hover:bg-ndark-surface',
                      isActive && 'bg-brand-50 text-brand-700 dark:bg-ndark-surface dark:text-ndark-text',
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="flex-1 truncate font-medium">{opt.label}</span>
                      {opt.required && (
                        <span className="rounded bg-rose-100 px-1 py-0.5 text-[9px] font-semibold text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                          zorunlu
                        </span>
                      )}
                      {opt.pii && (
                        <span className="rounded bg-violet-100 px-1 py-0.5 text-[9px] font-semibold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                          PII
                        </span>
                      )}
                    </span>
                    {opt.description && (
                      <span className="line-clamp-1 text-[10px] text-slate-500 dark:text-ndark-muted">
                        {opt.description}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
