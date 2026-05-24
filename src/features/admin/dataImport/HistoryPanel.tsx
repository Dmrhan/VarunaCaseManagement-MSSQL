import { useEffect, useState } from 'react';
import { History, Clock } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { importService, type ImportJob } from '@/services/importService';

interface Props {
  companyId: string;
  onOpenJob: (j: ImportJob) => void;
  /** Sayım değişince yenile (commit/rollback sonrası) */
  refreshKey: number;
  /**
   * Tenant + targetType filtreli geçmiş. Phase 1 wizard `account` geçer,
   * Customer 360 wizard `customer360` geçer; ikisi karışmaz.
   */
  targetType?: 'account' | 'customer360';
}

const STATUS_TONE: Record<ImportJob['status'], string> = {
  draft: 'bg-slate-100 text-slate-600',
  validated: 'bg-sky-100 text-sky-700',
  running: 'bg-violet-100 text-violet-700',
  partial: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-rose-100 text-rose-700',
  rolled_back: 'bg-slate-200 text-slate-700',
  rollback_partial: 'bg-amber-100 text-amber-700',
};

const STATUS_LABEL: Record<ImportJob['status'], string> = {
  draft: 'Taslak',
  validated: 'Doğrulandı',
  running: 'Çalışıyor',
  partial: 'Kısmi',
  completed: 'Tamamlandı',
  failed: 'Başarısız',
  rolled_back: 'Geri alındı',
  rollback_partial: 'Geri alma kısmi',
};

export function HistoryPanel({ companyId, onOpenJob, refreshKey, targetType }: Props) {
  const [items, setItems] = useState<ImportJob[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    setLoading(true);
    void importService.listJobs(companyId, targetType ? { targetType } : undefined).then((r) => {
      if (!alive) return;
      setItems(r?.value ?? []);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [companyId, refreshKey, targetType]);

  return (
    <Card>
      <CardBody className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-ndark-text">
            <History size={14} /> Geçmiş
          </h3>
          <span className="text-[10px] text-slate-500 dark:text-ndark-muted">
            {items.length} kayıt
          </span>
        </div>
        {loading && <Skeleton className="h-12 w-full" />}
        {!loading && items.length === 0 && (
          <div className="rounded-md border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-xs text-slate-500 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted">
            Bu şirket için henüz aktarım yok.
          </div>
        )}
        {!loading && items.length > 0 && (
          <ul className="space-y-1.5">
            {items.map((j) => (
              <li
                key={j.id}
                onClick={() => onOpenJob(j)}
                className="cursor-pointer rounded-md border border-slate-200 bg-white p-2 text-xs transition-colors hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-card dark:hover:bg-ndark-surface"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium text-slate-800 dark:text-ndark-text">
                        {j.fileName ?? j.sourceName ?? 'aktarım'}
                      </span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${STATUS_TONE[j.status]}`}>
                        {STATUS_LABEL[j.status]}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-500 dark:text-ndark-muted">
                      <Clock size={9} />
                      <span>{new Date(j.createdAt).toLocaleString('tr-TR')}</span>
                      <span>·</span>
                      <span>{j.sourceType === 'file' ? 'Dosya' : 'API'}</span>
                    </div>
                    <div className="mt-1 text-[10px] text-slate-600 dark:text-ndark-muted">
                      {j.createCount}+ · {j.updateCount}↺ · {j.skippedCount}⊘
                      {j.errorCount > 0 ? ` · ${j.errorCount}✗` : ''}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
