import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { cn } from './cn';

export type ToastType = 'success' | 'error' | 'info' | 'warn';

export interface ToastEntry {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
  role?: 'status' | 'alert';
}

interface ToastApi {
  toast: (t: Omit<ToastEntry, 'id'>) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi>({ toast: () => '', dismiss: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

// ─────────────────────────────────────────────────────────────────
// Module-level singleton — React Context dışından (örn. caseService
// fetch wrapper'ları) toast tetiklemek için. ToastProvider ilk
// mount'ta kendini buraya register eder.
// ─────────────────────────────────────────────────────────────────
let _toastSingleton: ToastApi | null = null;

/** caseService gibi React dışı modüllerden toast göster. */
export function notify(t: Omit<ToastEntry, 'id'>): void {
  if (_toastSingleton) {
    _toastSingleton.toast(t);
  } else {
    // ToastProvider henüz mount olmadıysa console'a düş — kullanıcı bunu
    // göremez ama sessiz fail değil; geliştirici init sırasını fark eder.
    console.warn('[notify] ToastProvider mount edilmeden toast tetiklendi:', t);
  }
}

const TYPE_STYLE: Record<ToastType, { bg: string; ring: string; icon: ReactNode; iconColor: string }> = {
  success: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    ring: 'ring-emerald-200 dark:ring-emerald-800',
    icon: <CheckCircle2 size={18} />,
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  error: {
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    ring: 'ring-rose-200 dark:ring-rose-800',
    icon: <AlertCircle size={18} />,
    iconColor: 'text-rose-600 dark:text-rose-400',
  },
  info: {
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    ring: 'ring-blue-200 dark:ring-blue-800',
    icon: <Info size={18} />,
    iconColor: 'text-blue-600 dark:text-blue-400',
  },
  warn: {
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    ring: 'ring-amber-200 dark:ring-amber-800',
    icon: <TriangleAlert size={18} />,
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastEntry[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const STACK_CAP = 3;

  const toast = useCallback(
    (t: Omit<ToastEntry, 'id'>) => {
      const id = Math.random().toString(36).slice(2, 10);
      const entry: ToastEntry = { duration: 4000, ...t, id };
      setItems((prev) => {
        const next = [...prev, entry];
        return next.length > STACK_CAP ? next.slice(next.length - STACK_CAP) : next;
      });
      if (entry.duration && entry.duration > 0) {
        setTimeout(() => dismiss(id), entry.duration);
      }
      return id;
    },
    [dismiss],
  );

  // Module singleton'ı bu provider'a bağla — React dışı modüller (caseService
  // gibi) `notify(...)` ile toast tetikleyebilsin.
  useEffect(() => {
    _toastSingleton = { toast, dismiss };
    return () => {
      _toastSingleton = null;
    };
  }, [toast, dismiss]);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
        {items.map((t) => (
          <ToastCard key={t.id} entry={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ entry, onClose }: { entry: ToastEntry; onClose: () => void }) {
  const style = TYPE_STYLE[entry.type];
  const [enter, setEnter] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setEnter(true), 10);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div
      role={entry.role ?? 'status'}
      className={cn(
        'pointer-events-auto flex items-start gap-2 rounded-lg p-3 shadow-md ring-1 ring-inset transition-all duration-200',
        style.bg,
        style.ring,
        enter ? 'translate-x-0 opacity-100' : 'translate-x-2 opacity-0',
      )}
    >
      <span className={cn('mt-0.5 flex-shrink-0', style.iconColor)}>{style.icon}</span>
      <div className="flex-1 min-w-0">
        {entry.title && <div className="text-sm font-semibold text-slate-900 dark:text-ndark-text">{entry.title}</div>}
        <div className="text-sm text-slate-700 dark:text-ndark-text">{entry.message}</div>
        {entry.action && (
          <button
            type="button"
            onClick={() => {
              entry.action!.onClick();
              onClose();
            }}
            className="mt-1 text-xs font-medium text-brand-700 underline hover:text-brand-800 dark:text-ndark-link dark:hover:text-blue-300"
          >
            {entry.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="flex-shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200/50 hover:text-slate-600 dark:text-ndark-muted dark:hover:bg-ndark-card dark:hover:text-ndark-text"
        aria-label="Kapat"
      >
        <X size={14} />
      </button>
    </div>
  );
}
