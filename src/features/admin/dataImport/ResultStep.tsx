import { useEffect, useState } from 'react';
import { Check, Undo2, Copy, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { importService, type ImportJob } from '@/services/importService';
import { lookupService } from '@/services/caseService';

interface Props {
  job: ImportJob;
  runStats?: { createdCount: number; updatedCount: number; skippedCount: number; errorCount: number };
  onNew: () => void;
  onJobUpdated: (j: ImportJob) => void;
}

const STATUS_LABEL: Record<ImportJob['status'], { label: string; tone: string }> = {
  draft: { label: 'Taslak', tone: 'bg-slate-100 text-slate-600' },
  validated: { label: 'Doğrulandı', tone: 'bg-sky-100 text-sky-700' },
  running: { label: 'Çalışıyor', tone: 'bg-violet-100 text-violet-700' },
  partial: { label: 'Kısmen tamamlandı', tone: 'bg-amber-100 text-amber-700' },
  completed: { label: 'Tamamlandı', tone: 'bg-emerald-100 text-emerald-700' },
  failed: { label: 'Başarısız', tone: 'bg-rose-100 text-rose-700' },
  rolled_back: { label: 'Geri alındı', tone: 'bg-slate-200 text-slate-700' },
  rollback_partial: { label: 'Geri alma kısmi', tone: 'bg-amber-100 text-amber-700' },
};

export function ResultStep({ job, runStats, onNew, onJobUpdated }: Props) {
  const [busy, setBusy] = useState(false);
  const [confirmRollback, setConfirmRollback] = useState(false);
  /** WR-A8 review fix (no-swallow) — son rollback raporu (kısmi başarı detayı). */
  const [rollbackReport, setRollbackReport] = useState<
    | {
        errorCount?: number;
        failedRows?: Array<{
          rowNumber: number;
          errors: Array<{ code: string; targetKey: string | null; label: string | null; message: string }>;
        }>;
      }
    | null
  >(null);

  // WR-A8 review fix (UI state) — Operator history panel'den başka bir
  // ImportJob açtığında ResultStep aynı instance ile mount kalıyor; rollback
  // paneli önceki job'dan kalıyordu. Job id değişince rollback-spesifik
  // state'i sıfırla. `busy` ve `confirmRollback` da güvenle reset edilir
  // çünkü bunlar da yalnız aktif rollback akışına aittir.
  useEffect(() => {
    setRollbackReport(null);
    setConfirmRollback(false);
    setBusy(false);
  }, [job?.id]);

  const { toast } = useToast();
  const company = lookupService.companies().find((c) => c.id === job.companyId);
  const statusInfo = STATUS_LABEL[job.status];

  const title =
    job.status === 'completed'
      ? 'İçe aktarım tamamlandı'
      : job.status === 'partial'
        ? 'İçe aktarım kısmen tamamlandı'
        : job.status === 'failed'
          ? 'İçe aktarım tamamlanamadı'
          : job.status === 'rolled_back' || job.status === 'rollback_partial'
            ? 'İçe aktarım geri alındı'
            : 'Sonuç';

  function copySummary() {
    const text = [
      `Job: ${job.id}`,
      `Şirket: ${company?.name ?? job.companyId}`,
      `Durum: ${statusInfo.label}`,
      `Toplam: ${job.totalRows}`,
      `Oluşturulan: ${job.createCount}`,
      `Güncellenen: ${job.updateCount}`,
      `Atlanan: ${job.skippedCount}`,
      `Hatalı: ${job.errorCount}`,
      `Uyarılı: ${job.warningCount}`,
      job.startedAt ? `Başlangıç: ${new Date(job.startedAt).toLocaleString('tr-TR')}` : null,
      job.completedAt ? `Bitiş: ${new Date(job.completedAt).toLocaleString('tr-TR')}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    void navigator.clipboard?.writeText(text);
    toast({ type: 'success', message: 'Özet panoya kopyalandı.', duration: 1500 });
  }

  async function rollback() {
    setBusy(true);
    const r = await importService.rollback(job.id);
    setBusy(false);
    if (!r) return;
    const acCount = r.report.rolledBackAccountCompanyCount ?? 0;
    const errCount = r.report.errorCount ?? r.report.failedCount ?? 0;
    const ok = errCount === 0;
    const acFragment = acCount > 0 ? `, ${acCount} müşteri kodu geri yüklendi` : '';
    const message = ok
      ? `Geri alındı · ${r.report.rolledBackCreatedCount} pasife alındı, ${r.report.rolledBackUpdatedCount} eski hale döndürüldü${acFragment}`
      : `Geri alma kısmi · ${r.report.rolledBackCreatedCount} pasife alındı, ${r.report.rolledBackUpdatedCount} eski hale döndürüldü${acFragment} · ${errCount} satır geri alınamadı`;
    toast({
      type: ok ? 'success' : 'warn',
      message,
      duration: ok ? 4500 : 7000,
    });
    setRollbackReport({ errorCount: errCount, failedRows: r.report.failedRows });
    onJobUpdated(r.job);
    setConfirmRollback(false);
  }

  const canRollback = job.status === 'completed' || job.status === 'partial';

  return (
    <div className="space-y-3">
      <Card>
        <CardBody className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-ndark-text">
                {title}
              </h3>
              <p className="text-xs text-slate-500 dark:text-ndark-muted">
                Job <code className="font-mono">{job.id}</code> · Şirket:{' '}
                <strong>{company?.name ?? job.companyId}</strong>
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusInfo.tone}`}>
              {statusInfo.label}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            <Stat label="Toplam" value={job.totalRows} />
            <Stat label="Oluşturulan" value={job.createCount} accent="emerald" />
            <Stat label="Güncellenen" value={job.updateCount} accent="sky" />
            <Stat label="Atlanan" value={job.skippedCount} />
            <Stat label="Hatalı" value={job.errorCount} accent="rose" />
            <Stat label="Uyarılı" value={job.warningCount} accent="amber" />
          </div>

          {runStats && (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-ndark-border dark:bg-ndark-surface dark:text-ndark-muted">
              Bu çalıştırmada: {runStats.createdCount} yeni · {runStats.updatedCount} güncelleme ·{' '}
              {runStats.skippedCount} atlandı · {runStats.errorCount} hata.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button variant="ghost" onClick={copySummary}>
              <Copy size={12} />
              Sonuç özetini kopyala
            </Button>
            <Button variant="ghost" onClick={onNew}>
              Yeni aktarım başlat
            </Button>
            {canRollback && (
              <Button variant="danger" onClick={() => setConfirmRollback(true)} disabled={busy}>
                <Undo2 size={12} />
                İçe Aktarımı Geri Al
              </Button>
            )}
            {(job.status === 'rolled_back' || job.status === 'rollback_partial') && (
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-ndark-muted">
                <Check size={12} />
                Geri alındı: {job.rolledBackAt ? new Date(job.rolledBackAt).toLocaleString('tr-TR') : ''}
              </span>
            )}
          </div>
        </CardBody>
      </Card>

      {confirmRollback && (
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-start gap-2 text-xs text-slate-700 dark:text-ndark-muted">
              <AlertCircle size={16} className="mt-0.5 text-amber-500" />
              <div>
                Bu işlem import ile oluşturulan kayıtları pasife alır ve güncellenen alanları eski değerlerine döndürür. Devam etmek istiyor musunuz?
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmRollback(false)} disabled={busy}>
                Vazgeç
              </Button>
              <Button variant="danger" onClick={rollback} disabled={busy}>
                {busy ? 'Geri alınıyor…' : 'Evet, Geri Al'}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {rollbackReport && (rollbackReport.errorCount ?? 0) > 0 && (
        <Card>
          <CardBody className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-200">
              <AlertCircle size={14} className="text-amber-500" />
              Geri alma kısmi tamamlandı — {rollbackReport.errorCount} satır geri alınamadı
            </div>
            <p className="text-[11px] text-slate-600 dark:text-ndark-muted">
              Aşağıdaki satırların Account veya AccountCompany kaydı rollback sırasında başarısız oldu. Müdahale gerekebilir.
            </p>
            <ul className="space-y-1 text-xs">
              {(rollbackReport.failedRows ?? []).slice(0, 20).map((fr) => (
                <li
                  key={fr.rowNumber}
                  className="rounded-md border border-amber-200 bg-amber-50 p-2 dark:border-amber-700/40 dark:bg-amber-900/20"
                >
                  <div className="font-medium text-amber-900 dark:text-amber-200">Satır #{fr.rowNumber}</div>
                  <ul className="ml-3 list-disc text-amber-800 dark:text-amber-300">
                    {fr.errors.map((e, i) => (
                      <li key={i}>
                        {e.label ? <strong>{e.label}: </strong> : null}
                        {e.message}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
              {(rollbackReport.failedRows?.length ?? 0) > 20 && (
                <li className="text-[10px] text-amber-700">… ve {rollbackReport.failedRows!.length - 20} satır daha</li>
              )}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'emerald' | 'sky' | 'rose' | 'amber';
}) {
  const accentMap: Record<NonNullable<typeof accent>, string> = {
    emerald: 'text-emerald-700 dark:text-emerald-300',
    sky: 'text-sky-700 dark:text-sky-300',
    rose: 'text-rose-700 dark:text-rose-300',
    amber: 'text-amber-700 dark:text-amber-300',
  };
  return (
    <div className="rounded-md border border-slate-200 bg-white p-2 text-center dark:border-ndark-border dark:bg-ndark-card">
      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-ndark-muted">
        {label}
      </div>
      <div className={`mt-0.5 text-lg font-bold ${accent ? accentMap[accent] : 'text-slate-800 dark:text-ndark-text'}`}>
        {value}
      </div>
    </div>
  );
}
