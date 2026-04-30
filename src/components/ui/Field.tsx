import { forwardRef } from 'react';
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from './cn';

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
  /** Label satırının sağına yerleştirilen aksiyon (örn. VoiceNoteButton) */
  actions?: ReactNode;
}

export function Field({ label, hint, error, required, children, className, actions }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-slate-700 dark:text-ndark-text">
          {label}
          {required && <span className="ml-0.5 text-rose-500">*</span>}
        </label>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {children}
      {hint && !error && <span className="text-[11px] text-slate-500 dark:text-ndark-muted">{hint}</span>}
      {error && <span className="text-[11px] font-medium text-rose-600 dark:text-red-400">{error}</span>}
    </div>
  );
}

const baseControl =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 ' +
  'placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 ' +
  'focus:ring-brand-500/20 disabled:bg-slate-50 disabled:text-slate-500 ' +
  'dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text ' +
  'dark:placeholder:text-ndark-dim dark:focus:border-ndark-accent dark:focus:ring-ndark-accent/30 ' +
  'dark:disabled:bg-ndark-surface dark:disabled:text-ndark-muted';

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput(props, ref) {
    return <input ref={ref} {...props} className={cn(baseControl, props.className)} />;
  },
);

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea(props, ref) {
    return (
      <textarea
        ref={ref}
        {...props}
        className={cn(baseControl, 'min-h-[88px] resize-y', props.className)}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select(props, ref) {
    return <select ref={ref} {...props} className={cn(baseControl, 'pr-8', props.className)} />;
  },
);
