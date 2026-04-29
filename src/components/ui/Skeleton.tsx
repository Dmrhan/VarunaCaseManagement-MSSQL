import { cn } from './cn';

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  rounded?: 'sm' | 'md' | 'lg' | 'full';
}

export function Skeleton({ className, width, height, rounded = 'md' }: SkeletonProps) {
  const round =
    rounded === 'full' ? 'rounded-full' :
    rounded === 'lg'   ? 'rounded-lg' :
    rounded === 'sm'   ? 'rounded-sm' :
                          'rounded-md';
  return (
    <div
      className={cn('animate-pulse bg-slate-200/70', round, className)}
      style={{ width, height }}
    />
  );
}

export function SkeletonText({ lines = 1, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={10} className={i === lines - 1 ? 'w-2/3' : 'w-full'} />
      ))}
    </div>
  );
}

export function TableRowSkeleton({ cols = 9 }: { cols?: number }) {
  return (
    <tr className="border-b border-slate-100">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton height={12} className={i === 1 ? 'w-3/4' : 'w-1/2'} />
        </td>
      ))}
    </tr>
  );
}

export function MetricTileSkeleton() {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-inset ring-slate-200">
      <Skeleton width={80} height={10} />
      <Skeleton width={60} height={24} className="mt-2" />
      <Skeleton width={120} height={10} className="mt-2" />
    </div>
  );
}
