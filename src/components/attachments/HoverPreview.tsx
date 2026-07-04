/**
 * HoverPreview — Ortak hover-önizleme kartı (PR-1 UX FIX PAKETİ).
 *
 * Generic ve bağımsız. PR-2 (İletişim) tarafından da tüketilecek.
 *
 * Özellikler:
 *  - ~400ms hover delay → küçük kart (max 350px)
 *  - Görsel: token'lı önizleme URL; kart üzerinde küçük thumbnail
 *  - Non-image: 5 satır meta kart (ad + tip + boyut + yükleyen + tarih)
 *  - Mouseleave kapatır; kart üstüne geçiş kapatmaz
 *  - LAZY: hover trigger olmadan HİÇ istek yok
 *  - Oturum cache: aynı item için 2. hover'da cached URL kullan
 *  - Dokunmatik/klavye: pointer/@media (hover: hover) — touch cihaz devre dışı
 *  - Silinen dosya (404) → kart sessiz kapanır
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { FileText, Image as ImageIcon, Loader2, User } from 'lucide-react';

export interface HoverPreviewItem {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType?: string | null;
  uploadedBy?: string | null;
  uploadedAt?: string | null;
}

interface Props<T extends HoverPreviewItem> {
  item: T;
  /** Görsel ise resolved URL, non-image ise null döndür. */
  getPreviewUrl: (item: T) => Promise<{ url: string } | null>;
  /** İçindeki trigger element (satır adı, chip vb.). */
  children: ReactNode;
  /** MIME image mi diye kontrol (caller'dan gelir; helper reuse kolaylığı). */
  isImage?: (item: T) => boolean;
}

// Modül-scope oturum cache (sayfa reload'a kadar yaşar).
const urlCache = new Map<string, string | null>();

function formatBytes(n: number): string {
  if (!n || n < 0) return '';
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatShortDate(iso?: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '';
  }
}

function detectImageDefault(item: HoverPreviewItem): boolean {
  const m = (item.mimeType ?? '').toLowerCase();
  if (m.startsWith('image/')) return true;
  const name = item.fileName.toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name);
}

const HOVER_DELAY_MS = 400;
const CARD_MAX_WIDTH = 350;

export function HoverPreview<T extends HoverPreviewItem>({
  item,
  getPreviewUrl,
  children,
  isImage,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);
  const openTimer = useRef<number | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const imgCheck = isImage ?? detectImageDefault;
  const shouldFetch = imgCheck(item);

  const scheduleClose = useCallback(() => {
    if (openTimer.current) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    setOpen(false);
  }, []);

  const scheduleOpen = useCallback((clientX: number, clientY: number) => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(async () => {
      openTimer.current = null;
      // Konum: cursor + küçük offset (viewport clamp)
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const left = Math.min(clientX + 16, vw - CARD_MAX_WIDTH - 8);
      const top = Math.min(clientY + 16, vh - 260);
      setPos({ left, top });
      setOpen(true);

      if (!shouldFetch) return;
      const cached = urlCache.get(item.id);
      if (cached !== undefined) {
        if (cached === null) setErrored(true);
        else setUrl(cached);
        return;
      }
      setLoading(true);
      setErrored(false);
      try {
        const r = await getPreviewUrl(item);
        if (r?.url) {
          urlCache.set(item.id, r.url);
          setUrl(r.url);
        } else {
          urlCache.set(item.id, null);
          setErrored(true);
        }
      } catch {
        urlCache.set(item.id, null);
        setErrored(true);
      } finally {
        setLoading(false);
      }
    }, HOVER_DELAY_MS);
  }, [item, shouldFetch, getPreviewUrl]);

  useEffect(() => {
    return () => {
      if (openTimer.current) window.clearTimeout(openTimer.current);
    };
  }, []);

  return (
    <span
      ref={wrapperRef}
      className="hover-preview-wrap"
      onMouseEnter={(e) => scheduleOpen(e.clientX, e.clientY)}
      onMouseMove={(e) => {
        if (open || openTimer.current) return; // Yalnız ilk enter'da zamanla
        scheduleOpen(e.clientX, e.clientY);
      }}
      onMouseLeave={scheduleClose}
    >
      {children}
      {open && pos && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[70] hidden max-w-[350px] rounded-md border border-slate-200 bg-white p-2 shadow-xl [@media(hover:hover)]:block dark:border-ndark-border dark:bg-ndark-card"
          style={{ left: pos.left, top: pos.top, width: CARD_MAX_WIDTH }}
        >
          <div className="flex items-start gap-2">
            <div className="mt-0.5 shrink-0 rounded bg-slate-100 p-1.5 text-slate-500 dark:bg-ndark-bg dark:text-ndark-muted">
              {shouldFetch ? <ImageIcon size={14} /> : <FileText size={14} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-slate-900 dark:text-ndark-text">
                {item.fileName}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-ndark-muted">
                {(item.mimeType ?? '').split('/')[1]?.toUpperCase() || 'Dosya'}
                {' · '}
                {formatBytes(item.fileSize)}
              </div>
              {(item.uploadedBy || item.uploadedAt) && (
                <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-500 dark:text-ndark-muted">
                  <User size={10} />
                  <span className="truncate">{item.uploadedBy ?? '—'}</span>
                  {item.uploadedAt && (
                    <>
                      <span>·</span>
                      <span>{formatShortDate(item.uploadedAt)}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          {shouldFetch && (
            <div className="mt-2 flex items-center justify-center rounded bg-slate-50 dark:bg-ndark-bg" style={{ minHeight: 100 }}>
              {loading && <Loader2 className="animate-spin text-slate-400" size={20} />}
              {errored && !loading && (
                <div className="p-2 text-[10px] text-slate-400">Önizleme yok</div>
              )}
              {url && !loading && !errored && (
                <img
                  src={url}
                  alt=""
                  className="max-h-[160px] max-w-full rounded object-contain"
                  onError={() => setErrored(true)}
                />
              )}
            </div>
          )}
        </div>
      )}
    </span>
  );
}
