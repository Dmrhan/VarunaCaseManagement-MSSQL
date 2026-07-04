/**
 * Lightbox — Ortak görsel önizleme bileşeni (PR-1 UX FIX PAKETİ).
 *
 * Generic ve bağımsız. PR-2 (İletişim) tarafından da tüketilecek —
 * MailMessageCard/CaseFiles/CaseListDrawer aynı bileşeni kullanır.
 *
 * Özellikler:
 *  - ~%90 viewport koyu overlay
 *  - Görsel fit-to-width; tık → %100 native (natural size)
 *  - Zoom in/out butonu (+ / -)
 *  - Klavye + button ile ← → gezinme (aynı vakanın önizlenebilir ekleri)
 *  - İndir + Yeni Sekmede Aç
 *  - Başlıkta ad + boyut
 *  - ESC / backdrop tıklaması kapatır
 *  - Focus trap (sırada tuş butonu)
 *  - PDF ve diğerleri Lightbox'a GİRMEZ (caller filter eder)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export interface LightboxItem {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType?: string | null;
}

interface Props<T extends LightboxItem> {
  open: boolean;
  onClose: () => void;
  items: T[];
  activeId: string;
  onNavigate: (id: string) => void;
  getPreviewUrl: (item: T) => Promise<{ url: string; fileName: string } | null>;
  /** İndir tıklaması — default: window.open(url) attachment (browser prompt). */
  onDownload?: (item: T) => void;
}

function formatBytes(n: number): string {
  if (!n || n < 0) return '';
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function Lightbox<T extends LightboxItem>({
  open,
  onClose,
  items,
  activeId,
  onNavigate,
  getPreviewUrl,
  onDownload,
}: Props<T>) {
  const active = useMemo(() => items.find((i) => i.id === activeId) ?? null, [items, activeId]);
  const activeIdx = useMemo(() => items.findIndex((i) => i.id === activeId), [items, activeId]);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);
  const [zoom100, setZoom100] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const canPrev = activeIdx > 0;
  const canNext = activeIdx >= 0 && activeIdx < items.length - 1;

  const goPrev = useCallback(() => {
    if (canPrev) onNavigate(items[activeIdx - 1].id);
  }, [canPrev, items, activeIdx, onNavigate]);

  const goNext = useCallback(() => {
    if (canNext) onNavigate(items[activeIdx + 1].id);
  }, [canNext, items, activeIdx, onNavigate]);

  // Fetch preview URL when active changes
  useEffect(() => {
    if (!open || !active) return;
    let alive = true;
    setUrl(null);
    setLoading(true);
    setErrored(false);
    setZoom100(false);
    void getPreviewUrl(active).then((r) => {
      if (!alive) return;
      if (r?.url) setUrl(r.url);
      else setErrored(true);
      setLoading(false);
    }).catch(() => {
      if (!alive) return;
      setErrored(true);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [open, active, getPreviewUrl]);

  // Keyboard: Esc/←/→
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowLeft') { goPrev(); return; }
      if (e.key === 'ArrowRight') { goNext(); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, goPrev, goNext]);

  // Focus trap — açılınca kapat butonuna odak
  useEffect(() => {
    if (!open) return;
    closeBtnRef.current?.focus();
  }, [open]);

  if (!open || !active) return null;

  const backdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={active.fileName}
      className="fixed inset-0 z-[60] flex flex-col bg-black/85 backdrop-blur-sm"
      onClick={backdropClick}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-2 text-white">
        <div className="min-w-0 flex-1 truncate">
          <div className="truncate text-sm font-medium">{active.fileName}</div>
          <div className="text-[11px] text-white/70">
            {formatBytes(active.fileSize)}
            {items.length > 1 && ` · ${activeIdx + 1} / ${items.length}`}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoom100((v) => !v)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-white/90 hover:bg-white/10"
            aria-label={zoom100 ? 'Sığdır' : 'Gerçek boyut'}
            title={zoom100 ? 'Sığdır (fit)' : 'Gerçek boyut (%100)'}
          >
            {zoom100 ? <ZoomOut size={20} /> : <ZoomIn size={20} />}
          </button>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 w-10 items-center justify-center rounded-md text-white/90 hover:bg-white/10"
              aria-label="Yeni sekmede aç"
              title="Yeni sekmede aç"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink size={20} />
            </a>
          )}
          <button
            type="button"
            onClick={() => onDownload?.(active)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-white/90 hover:bg-white/10"
            aria-label="İndir"
            title="İndir"
          >
            <Download size={20} />
          </button>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-white/90 hover:bg-white/10"
            aria-label="Kapat"
            title="Kapat (Esc)"
          >
            <X size={22} />
          </button>
        </div>
      </div>

      {/* Content — %90 viewport */}
      <div
        className="flex flex-1 items-center justify-center overflow-auto px-4 pb-4"
        onClick={backdropClick}
      >
        {loading && <Loader2 className="animate-spin text-white" size={32} />}
        {errored && !loading && (
          <div className="rounded-md bg-white/10 px-4 py-3 text-sm text-white/90">
            Önizleme yüklenemedi.
          </div>
        )}
        {url && !loading && !errored && (
          <img
            src={url}
            alt={active.fileName}
            onClick={(e) => { e.stopPropagation(); setZoom100((v) => !v); }}
            className={
              zoom100
                ? 'max-w-none cursor-zoom-out'
                : 'max-h-[85vh] max-w-[90vw] cursor-zoom-in object-contain'
            }
          />
        )}
      </div>

      {/* Nav arrows — sadece 1'den fazla item varsa */}
      {items.length > 1 && (
        <>
          <button
            type="button"
            onClick={goPrev}
            disabled={!canPrev}
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white transition hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Önceki görsel"
            title="Önceki (←)"
          >
            <ChevronLeft size={28} />
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={!canNext}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white transition hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Sonraki görsel"
            title="Sonraki (→)"
          >
            <ChevronRight size={28} />
          </button>
        </>
      )}
    </div>
  );
}
