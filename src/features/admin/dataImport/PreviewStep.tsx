import { useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Drawer } from '@/components/ui/Drawer';
import type {
  DryRunResponse,
  DryRunRowPreview,
} from '@/services/importService';
import { cn } from '@/components/ui/cn';

type Filter = 'all' | 'create' | 'update' | 'error' | 'warning' | 'skip';

interface Props {
  dryRun: DryRunResponse;
  /** Run dry-run again with current mapping (used after fixes). */
  onRerun?: () => void;
  busy?: boolean;
}

export function PreviewStep({ dryRun, onRerun, busy }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [openRow, setOpenRow] = useState<DryRunRowPreview | null>(null);

  const summary = dryRun.summary ?? {
    totalRows: 0,
    createCount: 0,
    updateCount: 0,
    skippedCount: 0,
    errorCount: 0,
    warningCount: 0,
    qualityScore: 0,
  };

  const preview = dryRun.preview ?? [];

  const filtered = useMemo(() => {
    return preview.filter((r) => {
      if (filter === 'all') return true;
      if (filter === 'warning') return r.warnings.length > 0;
      return r.action === filter;
    });
  }, [preview, filter]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-7">
        <MetricTile label="Toplam" value={summary.totalRows} tone="slate" />
        <MetricTile label="Oluşturulacak" value={summary.createCount} tone="emerald" />
        <MetricTile label="Güncellenecek" value={summary.updateCount} tone="sky" />
        <MetricTile label="Atlanacak" value={summary.skippedCount} tone="slate" />
        <MetricTile label="Hatalı" value={summary.errorCount} tone="rose" />
        <MetricTile label="Uyarılı" value={summary.warningCount} tone="amber" />
        <MetricTile label="Kalite" value={`%${summary.qualityScore}`} tone="violet" />
      </div>

      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FilterTabs current={filter} onChange={setFilter} />
            {onRerun && (
              <button
                type="button"
                onClick={onRerun}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
              >
                <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
                Yeniden Doğrula
              </button>
            )}
          </div>

          <div className="overflow-auto rounded-md border border-slate-200 dark:border-ndark-border">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="bg-slate-50 dark:bg-ndark-surface">
                <tr className="text-left text-slate-600 dark:text-ndark-muted">
                  <th className="px-2 py-1.5">#</th>
                  <th className="px-2 py-1.5">Eylem</th>
                  <th className="px-2 py-1.5">Durum</th>
                  <th className="px-2 py-1.5">Müşteri</th>
                  <th className="px-2 py-1.5">VKN</th>
                  <th className="px-2 py-1.5">Sorun</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500 dark:text-ndark-muted">
                      Bu filtreye uyan satır yok.
                    </td>
                  </tr>
                )}
                {filtered.map((r) => (
                  <tr
                    key={r.rowNumber}
                    onClick={() => setOpenRow(r)}
                    className="cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-ndark-border dark:hover:bg-ndark-surface"
                  >
                    <td className="px-2 py-1.5 text-slate-500">{r.rowNumber}</td>
                    <td className="px-2 py-1.5">
                      <ActionPill action={r.action} />
                    </td>
                    <td className="px-2 py-1.5">
                      <StatusPill r={r} />
                    </td>
                    <td className="px-2 py-1.5 text-slate-800 dark:text-ndark-text">
                      {(r.normalized.name as string) || r.matchedAccountName || '—'}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-[11px] text-slate-600">
                      {(r.normalized.vkn as string) || r.matchedAccountVknMasked || '—'}
                    </td>
                    <td className="px-2 py-1.5 text-slate-600">
                      {r.errors[0]?.message ?? r.warnings[0]?.message ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Drawer
        open={!!openRow}
        onClose={() => setOpenRow(null)}
        title={openRow ? `Satır #${openRow.rowNumber}` : ''}
        width="lg"
      >
        {openRow && <RowDetail row={openRow} />}
      </Drawer>
    </div>
  );
}

function MetricTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: 'slate' | 'emerald' | 'sky' | 'rose' | 'amber' | 'violet';
}) {
  const toneMap: Record<typeof tone, string> = {
    slate: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-200',
    sky: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-700/40 dark:bg-sky-900/20 dark:text-sky-200',
    rose: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-700/40 dark:bg-rose-900/20 dark:text-rose-200',
    amber: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200',
    violet: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-700/40 dark:bg-violet-900/20 dark:text-violet-200',
  };
  return (
    <div className={`flex flex-col gap-0.5 rounded-md border px-2.5 py-2 ${toneMap[tone]}`}>
      <span className="text-[10px] font-medium uppercase tracking-wider opacity-70">{label}</span>
      <span className="text-lg font-bold leading-tight">{value}</span>
    </div>
  );
}

function FilterTabs({ current, onChange }: { current: Filter; onChange: (f: Filter) => void }) {
  const tabs: Array<{ key: Filter; label: string }> = [
    { key: 'all', label: 'Tümü' },
    { key: 'create', label: 'Oluşturulacak' },
    { key: 'update', label: 'Güncellenecek' },
    { key: 'error', label: 'Hatalı' },
    { key: 'warning', label: 'Uyarılı' },
    { key: 'skip', label: 'Atlanacak' },
  ];
  return (
    <div className="flex flex-wrap gap-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={cn(
            'rounded-full border px-2.5 py-1 text-[11px] font-medium',
            current === t.key
              ? 'border-brand-500 bg-brand-500 text-white'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function ActionPill({ action }: { action: DryRunRowPreview['action'] }) {
  const tone: Record<DryRunRowPreview['action'], string> = {
    create:
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    update: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
    skip: 'bg-slate-100 text-slate-600 dark:bg-ndark-surface dark:text-ndark-muted',
    error: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  };
  const label: Record<DryRunRowPreview['action'], string> = {
    create: 'oluşturulacak',
    update: 'güncellenecek',
    skip: 'atlanacak',
    error: 'hata',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tone[action]}`}>
      {label[action]}
    </span>
  );
}

function StatusPill({ r }: { r: DryRunRowPreview }) {
  if (r.errors.length > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-300">
        <AlertCircle size={10} />
        hatalı
      </span>
    );
  }
  if (r.warnings.length > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
        <AlertTriangle size={10} />
        uyarılı
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
      <CheckCircle2 size={10} />
      geçerli
    </span>
  );
}

function RowDetail({ row }: { row: DryRunRowPreview }) {
  return (
    <div className="space-y-3 px-4 py-3 text-xs">
      <Section title="Eylem">
        <div className="flex items-center gap-2">
          <ActionPill action={row.action} />
          {row.matchedAccountName && (
            <span className="text-slate-500">
              eşleşen müşteri: <strong>{row.matchedAccountName}</strong>
              {row.matchedAccountVknMasked ? ` · ${row.matchedAccountVknMasked}` : ''}
            </span>
          )}
        </div>
      </Section>

      {row.errors.length > 0 && (
        <Section title="Hatalar">
          <ul className="ml-4 list-disc text-rose-700 dark:text-rose-300">
            {row.errors.map((e, i) => (
              <li key={i}>
                {e.label ? <strong>{e.label}: </strong> : null}
                {e.message}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {row.warnings.length > 0 && (
        <Section title="Uyarılar">
          <ul className="ml-4 list-disc text-amber-700 dark:text-amber-300">
            {row.warnings.map((w, i) => (
              <li key={i}>
                <strong>{w.label}: </strong>
                {w.message}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Normalize edilmiş değerler">
        <pre className="max-h-48 overflow-auto rounded-md bg-slate-50 p-2 text-[10px] text-slate-700 dark:bg-ndark-surface dark:text-ndark-text">
          {JSON.stringify(row.normalized, null, 2)}
        </pre>
      </Section>

      {row.action === 'update' && row.fieldDiff && (
        <Section title="Değişen alanlar">
          <FieldDiffTable diff={row.fieldDiff} />
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-ndark-muted">
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function FieldDiffTable({
  diff,
}: {
  diff: { account: Record<string, { from: unknown; to: unknown }>; accountCompany: Record<string, { from: unknown; to: unknown }> };
}) {
  const accountKeys = Object.keys(diff.account);
  const acKeys = Object.keys(diff.accountCompany);
  if (accountKeys.length === 0 && acKeys.length === 0) {
    return <div className="text-slate-500 dark:text-ndark-muted">Değişiklik yok.</div>;
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-slate-500 dark:text-ndark-muted">
          <th className="py-1">Alan</th>
          <th className="py-1">Eski</th>
          <th className="py-1">Yeni</th>
        </tr>
      </thead>
      <tbody>
        {accountKeys.map((k) => (
          <tr key={`a-${k}`} className="border-t border-slate-100 dark:border-ndark-border">
            <td className="py-1 font-medium">{k}</td>
            <td className="py-1 text-slate-500">{String(diff.account[k].from ?? '—')}</td>
            <td className="py-1 text-slate-800 dark:text-ndark-text">{String(diff.account[k].to ?? '—')}</td>
          </tr>
        ))}
        {acKeys.map((k) => (
          <tr key={`ac-${k}`} className="border-t border-slate-100 dark:border-ndark-border">
            <td className="py-1 font-medium">{k} <span className="text-[9px] text-slate-400">(Şirket)</span></td>
            <td className="py-1 text-slate-500">{String(diff.accountCompany[k].from ?? '—')}</td>
            <td className="py-1 text-slate-800 dark:text-ndark-text">{String(diff.accountCompany[k].to ?? '—')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
