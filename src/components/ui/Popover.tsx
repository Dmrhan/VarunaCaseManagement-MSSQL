import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from './cn';

interface PopoverProps {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (props: { close: () => void }) => ReactNode;
  align?: 'start' | 'end';
  width?: number;
  className?: string;
}

export function Popover({ trigger, children, align = 'start', width = 320, className }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onClickOutside);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          style={{
            width,
            // Sadece viewport'tan büyük olamaz — parent'a sınırlama yok ki dar
            // wrapper'larda (ör. ActiveCallBanner butonu) panel kendi width'ini koruyabilsin.
            maxWidth: 'calc(100vw - 1rem)',
          }}
          className={cn(
            'absolute top-full z-30 mt-1 rounded-lg border border-slate-200 bg-white p-3 shadow-lg',
            align === 'end' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children({ close: () => setOpen(false) })}
        </div>
      )}
    </div>
  );
}
