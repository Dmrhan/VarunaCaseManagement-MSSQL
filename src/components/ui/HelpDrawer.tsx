import { useEffect } from 'react';
import { X, Info, Lightbulb, AlertTriangle } from 'lucide-react';

export interface HelpSection {
  heading: string;
  content: string;
  /** Code-style green box — preformatted text, monospace */
  example?: string;
  /** Blue info box */
  tip?: string;
  /** Amber warning box */
  warning?: string;
}

interface HelpDrawerProps {
  open: boolean;
  title: string;
  sections: HelpSection[];
  onClose: () => void;
}

/**
 * Sayfa içine gömülü yardım paneli.
 * - lg ve üzeri: inline 320px sütun (çağıran flex parent'ın içinde durur)
 * - lg altı: sağdan açılan overlay (backdrop tıklanınca kapanır)
 *
 * State localStorage'a yazılmaz — her ekran girişinde kapalı başlar.
 * Page scroll'unu engellemez.
 */
export function HelpDrawer({ open, title, sections, onClose }: HelpDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Mobile backdrop — sadece lg altında görünür */}
      <div
        className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
        onClick={onClose}
        aria-hidden
      />

      <aside
        role="complementary"
        aria-label={title}
        className="fixed inset-y-0 right-0 z-50 flex w-80 max-w-[90vw] flex-col border-l border-slate-200 bg-white shadow-xl lg:static lg:inset-auto lg:z-auto lg:h-[calc(100vh-3rem)] lg:w-80 lg:shrink-0 lg:self-start lg:rounded-lg lg:border lg:shadow-sm"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 border-b border-slate-200 bg-slate-50/60 px-4 py-3">
          <div className="flex items-start gap-2">
            <Info size={16} className="mt-0.5 shrink-0 text-brand-500" />
            <div>
              <div className="text-sm font-semibold text-slate-800">{title}</div>
              <div className="text-[11px] text-slate-500">Yardım</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Yardımı kapat"
          >
            <X size={14} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-4">
            {sections.map((s, idx) => (
              <SectionCard key={idx} section={s} />
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}

function SectionCard({ section }: { section: HelpSection }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3.5">
      <h4 className="mb-1.5 text-sm font-semibold text-slate-800">{section.heading}</h4>
      <p className="text-[13px] leading-relaxed text-slate-600">{section.content}</p>

      {section.example && (
        <pre className="mt-3 whitespace-pre-wrap rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-emerald-900">
          {section.example}
        </pre>
      )}

      {section.tip && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-[12px] text-blue-900">
          <Lightbulb size={14} className="mt-0.5 shrink-0 text-blue-500" />
          <span className="leading-relaxed">
            <span className="font-semibold">İpucu: </span>
            {section.tip}
          </span>
        </div>
      )}

      {section.warning && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
          <span className="leading-relaxed">
            <span className="font-semibold">Uyarı: </span>
            {section.warning}
          </span>
        </div>
      )}
    </article>
  );
}

/**
 * Help button — sayfa header'ında [? Yardım] butonu olarak kullanılır.
 * AdminListLayout bunu otomatik render eder; manuel kullanım için export edildi.
 */
export function HelpButton({ onClick, active }: { onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'border-brand-300 bg-brand-50 text-brand-700'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800'
      }`}
      title={active ? 'Yardımı kapat' : 'Yardım'}
    >
      <Info size={13} />
      <span>Yardım</span>
    </button>
  );
}

interface HelpContent {
  title: string;
  sections: HelpSection[];
}

export type { HelpContent };
