import { useEffect, useRef, useState } from 'react';
import { X, Info, Lightbulb, AlertTriangle, ListTree } from 'lucide-react';

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
  /**
   * 2026-07-02 — Her boyutta sağdan overlay davranışını zorla
   * (lg:static akışını devre dışı bırak). Sayfa root'u flex parent
   * DEĞİLSE bu prop kullanılmalı — aksi halde lg üzeri ekranda drawer
   * sayfanın altında render olur (AdminListLayout dışı ekranlar için).
   * Default: false (backward-compat AdminListLayout için).
   */
  overlayOnly?: boolean;
}

/**
 * Sayfa içine gömülü yardım paneli.
 * - lg ve üzeri: inline 320px sütun (çağıran flex parent'ın içinde durur)
 * - lg altı: sağdan açılan overlay (backdrop tıklanınca kapanır)
 * - overlayOnly=true: her boyutta overlay (sağdan slide + backdrop).
 *
 * State localStorage'a yazılmaz — her ekran girişinde kapalı başlar.
 * Page scroll'unu engellemez.
 */
export function HelpDrawer({ open, title, sections, onClose, overlayOnly = false }: HelpDrawerProps) {
  // Scrollable content container ref — İçindekiler menüsü smooth scroll
  // için ihtiyaç duyuyor (drawer içinde scroll, sayfa değil).
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // overlayOnly=true → lg üzeri de aynı fixed overlay davranışı (parent
  // flex olmayan sayfalarda drawer sayfa altında görünmesin).
  const asideClass = overlayOnly
    ? 'fixed inset-y-0 right-0 z-50 flex w-96 max-w-[90vw] flex-col border-l border-slate-200 bg-white shadow-xl'
    : 'fixed inset-y-0 right-0 z-50 flex w-80 max-w-[90vw] flex-col border-l border-slate-200 bg-white shadow-xl lg:static lg:inset-auto lg:z-auto lg:h-[calc(100vh-3rem)] lg:w-80 lg:shrink-0 lg:self-start lg:rounded-lg lg:border lg:shadow-sm';
  const backdropClass = overlayOnly
    ? 'fixed inset-0 z-40 bg-slate-900/40'
    : 'fixed inset-0 z-40 bg-slate-900/40 lg:hidden';

  return (
    <>
      {/* Backdrop — overlayOnly'de her zaman; default'ta sadece lg altı */}
      <div
        className={backdropClass}
        onClick={onClose}
        aria-hidden
      />

      <aside
        role="complementary"
        aria-label={title}
        className={asideClass}
      >
        {/* Header — 2026-07-02 iyileştirme: sağ tarafa "İçindekiler" toggle
            + kapat butonu. ToC 4+ bölümde otomatik önerilir. */}
        <HelpDrawerHeader
          title={title}
          sections={sections}
          onClose={onClose}
          scrollRef={scrollRef}
        />

        {/* Scrollable content — section'lar arasında hr ayracı ve
            id="help-section-N" ile smooth-scroll hedefleri. */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="divide-y divide-slate-200">
            {sections.map((s, idx) => (
              <SectionCard key={idx} section={s} index={idx} />
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}

function HelpDrawerHeader({
  title,
  sections,
  onClose,
  scrollRef,
}: {
  title: string;
  sections: HelpSection[];
  onClose: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [tocOpen, setTocOpen] = useState(false);
  // 4+ bölümde ToC değerli; azsa aşağı direkt scroll yeterli.
  const showTocToggle = sections.length >= 4;

  function scrollToSection(idx: number) {
    const el = scrollRef.current?.querySelector<HTMLElement>(`#help-section-${idx}`);
    if (el && scrollRef.current) {
      // Sadece drawer scroll container'ı içinde scroll — sayfayı kaydırma.
      const top = el.offsetTop - 12;
      scrollRef.current.scrollTo({ top, behavior: 'smooth' });
    }
    setTocOpen(false);
  }

  return (
    <div className="border-b border-slate-200 bg-slate-50/60">
      <div className="flex items-start justify-between gap-2 px-4 py-3">
        <div className="flex items-start gap-2">
          <Info size={16} className="mt-0.5 shrink-0 text-brand-500" />
          <div>
            <div className="text-sm font-semibold text-slate-800">{title}</div>
            <div className="text-[11px] text-slate-500">Yardım · {sections.length} bölüm</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {showTocToggle && (
            <button
              type="button"
              onClick={() => setTocOpen((v) => !v)}
              className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                tocOpen
                  ? 'bg-brand-100 text-brand-700'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
              }`}
              aria-label="İçindekiler"
              aria-expanded={tocOpen}
            >
              <ListTree size={12} />
              <span>İçindekiler</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Yardımı kapat"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      {/* Table of Contents dropdown — numaralı liste, tıklanınca smooth scroll */}
      {tocOpen && (
        <nav
          aria-label="İçindekiler"
          className="max-h-64 overflow-y-auto border-t border-slate-200 bg-white px-3 py-2"
        >
          <ol className="space-y-0.5">
            {sections.map((s, idx) => (
              <li key={idx}>
                <button
                  type="button"
                  onClick={() => scrollToSection(idx)}
                  className="flex w-full items-start gap-2 rounded px-2 py-1 text-left text-[12px] text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                >
                  <span className="mt-[1px] inline-block min-w-[1.5rem] shrink-0 text-[10px] font-mono text-slate-400">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span className="leading-snug">{s.heading}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      )}
    </div>
  );
}

function SectionCard({ section, index }: { section: HelpSection; index: number }) {
  return (
    <article id={`help-section-${index}`} className="scroll-mt-2 bg-white px-4 py-4">
      <div className="mb-3 flex items-start gap-2">
        <span className="mt-[3px] inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-semibold text-brand-700">
          {index + 1}
        </span>
        <h3 className="text-base font-bold leading-tight text-slate-900">{section.heading}</h3>
      </div>
      <p className="text-[13px] leading-relaxed text-slate-700">{section.content}</p>

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
