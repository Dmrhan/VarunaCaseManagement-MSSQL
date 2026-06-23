import { useEffect, useRef, useState, useLayoutEffect, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';

// Cila-3 fix — portal pozisyonu için trigger rect'i. Eski versiyon
// <span className="contents"> üzerine ref koyuyordu; display: contents
// element box'unu render etmez → getBoundingClientRect() {0,0,0,0} döner
// → menü ekranın sol üst köşesinde açılırdı. Şimdi wrapperRef'i
// (relative inline-flex div) kullanıyoruz; trigger button'un dış
// sarmalayıcısı olarak gerçek rect'i verir.

interface PopoverProps {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (props: { close: () => void }) => ReactNode;
  align?: 'start' | 'end';
  width?: number;
  className?: string;
  /**
   * Cila-3 — opt-in portal pattern. true ise content `document.body`'e
   * render edilir (createPortal); parent `overflow:hidden`'dan KAÇAR,
   * RUNA AI paneli gibi başka panellerle çakışmaz. Trigger'ın
   * getBoundingClientRect'inden fixed pozisyon hesaplanır; aşağı
   * sığmazsa yukarı flip. Scroll/resize'da menü KAPANIR (reposition
   * değil — daha güvenli, fixed trigger'dan kopmaz).
   *
   * Default false — diğer Popover caller'ları (User menu, ⋯ menü,
   * ActiveCallBanner, QuickNotePopover, Smart Ticket banner trigger)
   * eski absolute davranıştadır, görsel olarak ETKİLENMEZ.
   */
  usePortal?: boolean;
  /**
   * Cila-3 — content içinde `whitespace-nowrap` (etiketler asla 2 satıra
   * kırılmaz). Tipik dropdown menü için açılır.
   */
  nowrap?: boolean;
  /**
   * Cila-3 — min genişlik (px). width sabit + minWidth ile daha geniş
   * etiketlerde panel büzülmez.
   */
  minWidth?: number;
}

export function Popover({
  trigger,
  children,
  align = 'start',
  width = 320,
  className,
  usePortal = false,
  nowrap = false,
  minWidth,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const [portalPos, setPortalPos] = useState<{ top: number; left: number } | null>(null);

  // Portal pozisyon hesabı — open + usePortal'da; viewport-aware flip
  // (alt sığmazsa üst). useLayoutEffect → ilk paint'ten önce konumlanır.
  useLayoutEffect(() => {
    if (!open || !usePortal) {
      setPortalPos(null);
      return;
    }
    const compute = () => {
      // Cila-3 fix — trigger rect'i için wrapperRef (relative inline-flex
      // div) kullanılır. Eski span/contents pattern getBoundingClientRect
      // {0,0,0,0} döndürdüğü için menü sol üst köşede açılıyordu.
      const trig = wrapperRef.current;
      if (!trig) return;
      const r = trig.getBoundingClientRect();
      // İlk render'da portalRef daha bağlanmamış olabilir — varsayım 240px.
      const estHeight = portalRef.current?.offsetHeight ?? 240;
      const spaceBelow = window.innerHeight - r.bottom;
      const placeBelow = spaceBelow >= estHeight + 8 || spaceBelow >= r.top;
      const top = placeBelow ? r.bottom + 4 : r.top - estHeight - 4;
      let left = align === 'end' ? r.right - width : r.left;
      // Viewport içine sıkıştır
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      setPortalPos({ top, left });
    };
    compute();
    // İkinci geçiş: gerçek portalRef.offsetHeight ile yeniden hesapla
    const raf = requestAnimationFrame(compute);
    return () => cancelAnimationFrame(raf);
  }, [open, usePortal, width, align]);

  // Outside click / Esc / scroll / resize
  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (portalRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onClickOutside);
    window.addEventListener('keydown', onKey);

    // Cila-3 — usePortal modunda scroll/resize'da KAPAN (reposition değil)
    let onScroll: (() => void) | null = null;
    let onResize: (() => void) | null = null;
    if (usePortal) {
      onScroll = () => setOpen(false);
      onResize = () => setOpen(false);
      window.addEventListener('scroll', onScroll, { capture: true });
      window.addEventListener('resize', onResize);
    }
    return () => {
      window.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('keydown', onKey);
      if (onScroll) window.removeEventListener('scroll', onScroll, { capture: true });
      if (onResize) window.removeEventListener('resize', onResize);
    };
  }, [open, usePortal]);

  const contentStyle: CSSProperties = {
    width,
    maxWidth: 'calc(100vw - 1rem)',
    ...(minWidth ? { minWidth } : {}),
    ...(usePortal && portalPos
      ? { position: 'fixed', top: portalPos.top, left: portalPos.left }
      : {}),
  };

  const content = (
    <div
      ref={portalRef}
      style={contentStyle}
      className={cn(
        usePortal ? 'z-50' : 'absolute top-full z-30 mt-1',
        'rounded-lg border border-slate-200 bg-white p-3 shadow-lg dark:border-ndark-border dark:bg-ndark-surface dark:text-ndark-text',
        !usePortal && (align === 'end' ? 'right-0' : 'left-0'),
        nowrap && 'whitespace-nowrap',
        className,
      )}
    >
      {children({ close: () => setOpen(false) })}
    </div>
  );

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (usePortal ? createPortal(content, document.body) : content)}
    </div>
  );
}
