import { useState } from 'react';
import { CheckCircle2, AlertTriangle, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { importService, type DryRunResponse, type ImportJob } from '@/services/importService';
import { lookupService } from '@/services/caseService';

interface Props {
  companyId: string;
  dryRun: DryRunResponse;
  onCompleted: (job: ImportJob, runStats: { createdCount: number; updatedCount: number; skippedCount: number; errorCount: number }) => void;
}

export function CommitStep({ companyId, dryRun, onCompleted }: Props) {
  const [busy, setBusy] = useState(false);
  const [skipErrors, setSkipErrors] = useState(true);
  const { toast } = useToast();
  const summary = dryRun.summary;
  const company = lookupService.companies().find((c) => c.id === companyId);

  if (!dryRun.jobId || !summary) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-rose-600">Dry-run sonucu bulunamadı.</p>
        </CardBody>
      </Card>
    );
  }

  const hasErrors = summary.errorCount > 0;

  async function commit() {
    setBusy(true);
    const r = await importService.commit({
      companyId,
      jobId: dryRun.jobId!,
      options: { skipErrors },
    });
    setBusy(false);
    if (!r) return;
    toast({
      type: 'success',
      message: `İçe aktarım tamamlandı · ${r.runStats.createdCount} oluşturuldu, ${r.runStats.updatedCount} güncellendi`,
      duration: 4000,
    });
    onCompleted(r.job, r.runStats);
  }

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-start gap-3">
          <Rocket size={20} className="mt-0.5 text-brand-500" />
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-ndark-text">
              İçe aktarımı başlatmaya hazır
            </h3>
            <p className="text-xs text-slate-600 dark:text-ndark-muted">
              <strong>{summary.createCount}</strong> müşteri oluşturulacak,{' '}
              <strong>{summary.updateCount}</strong> müşteri güncellenecek.{' '}
              {summary.skippedCount > 0 && (
                <span>
                  <strong>{summary.skippedCount}</strong> satır atlanacak.{' '}
                </span>
              )}
              {hasErrors && (
                <span className="text-rose-600">
                  <strong>{summary.errorCount}</strong> hatalı satır içe aktarılmayacak.{' '}
                </span>
              )}
              Şirket: <strong>{company?.name ?? companyId}</strong>.
            </p>
          </div>
        </div>

        {hasErrors && (
          <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
            <input
              type="checkbox"
              checked={skipErrors}
              onChange={(e) => setSkipErrors(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <strong>Hatalı satırları atla ve geçerli satırları aktar.</strong> Hatalı satırlar içe aktarılmayacak.
            </span>
          </label>
        )}

        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-ndark-border dark:bg-ndark-surface dark:text-ndark-muted">
          <div className="mb-1 flex items-center gap-1.5 font-semibold">
            <AlertTriangle size={12} /> Güvenlik
          </div>
          <ul className="ml-4 list-disc">
            <li>Hiçbir kayıt silinmez. Mevcut müşteriler yalnızca eşleşen alanlarda güncellenir.</li>
            <li>Sonradan "Geri Al" tuşu ile oluşturulan kayıtlar pasife alınabilir, güncellenenler eski değerlerine döner.</li>
            <li>Şirket kapsamı: seçili şirket (<strong>{company?.name ?? companyId}</strong>). Kaynak verideki şirket alanı yok sayılır.</li>
          </ul>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button onClick={commit} disabled={busy}>
            <CheckCircle2 size={14} />
            {busy ? 'İçe aktarılıyor…' : 'İçe Aktarımı Başlat'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
