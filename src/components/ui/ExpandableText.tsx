import { useEffect, useRef, useState } from 'react';

/**
 * Uzun metinlerde "Devamını oku" göster; kısa metinlerde (kırpılmamışsa)
 * buton hiç render edilmez — scrollHeight > clientHeight ise kırpılmış
 * demektir (CaseSolutionStepsPanel'deki overflow-ölçüm pattern'iyle aynı).
 * Eskiden CaseDetailPage.tsx içinde yalnız açıklama alanı için lokal
 * tanımlıydı (ExpandableDescription); CaseListDrawer'daki uzun başlıklar
 * için de aynı ihtiyaç çıkınca paylaşılan bileşene taşındı.
 */
export function ExpandableText({
  text,
  maxLines = 6,
  className = 'whitespace-pre-wrap text-sm text-slate-700 dark:text-ndark-text',
}: {
  text: string;
  /** Tailwind line-clamp JIT için sabit sınıf seçimi — yeni değer eklenirse
   *  aşağıdaki clampClass haritasına da eklenmeli. */
  maxLines?: 2 | 6;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      setIsOverflowing(false);
      return;
    }
    const measure = () => {
      if (!expanded) {
        setIsOverflowing(el.scrollHeight > el.clientHeight + 1);
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, expanded]);

  useEffect(() => {
    setExpanded(false);
  }, [text]);

  const clampClass = maxLines === 2 ? 'line-clamp-2' : 'line-clamp-6';

  return (
    <div>
      <p ref={ref} className={`${className} ${!expanded ? clampClass : ''}`}>
        {text}
      </p>
      {isOverflowing && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setExpanded((current) => !current);
          }}
          aria-expanded={expanded}
          className="mt-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          {expanded ? 'Daralt' : 'Devamını oku'}
        </button>
      )}
    </div>
  );
}
