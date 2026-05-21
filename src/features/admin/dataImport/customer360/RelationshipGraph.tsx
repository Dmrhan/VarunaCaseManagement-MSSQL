import { AlertTriangle, CheckCircle2, Circle } from 'lucide-react';
import type { Customer360Bundle } from './parsers';
import type {
  Customer360DryRunResponse,
  Customer360EntityKey,
  Customer360SchemaResponse,
} from '@/services/importService';

interface Props {
  schema: Customer360SchemaResponse;
  bundle: Customer360Bundle;
  dryRun?: Customer360DryRunResponse | null;
  onSelect?: (entity: Customer360EntityKey) => void;
  selected?: Customer360EntityKey | null;
}

const TREE: Array<{ entity: Customer360EntityKey; indent: number }> = [
  { entity: 'account', indent: 0 },
  { entity: 'accountCompany', indent: 1 },
  { entity: 'accountProject', indent: 2 },
  { entity: 'accountContact', indent: 1 },
  { entity: 'accountAddress', indent: 1 },
];

export function RelationshipGraph({ schema, bundle, dryRun, onSelect, selected }: Props) {
  const labelByEntity = new Map(schema.entities.map((e) => [e.entity, e.label]));
  return (
    <div className="space-y-1">
      <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-ndark-muted">
        <span>İlişki Ağacı</span>
        {dryRun?.summary && (
          <span className="text-[10px]">
            Tamamlanma:{' '}
            {dryRun.summary.completenessScore?.accountsWithCompany?.pct ?? 0}% şirket ·{' '}
            {dryRun.summary.completenessScore?.accountsWithContact?.pct ?? 0}% iletişim ·{' '}
            {dryRun.summary.completenessScore?.accountsWithAddress?.pct ?? 0}% adres
          </span>
        )}
      </div>
      <ul className="space-y-1">
        {TREE.map(({ entity, indent }) => {
          const block = bundle[entity];
          const summary = dryRun?.summary?.byEntity?.[entity];
          const orphans = dryRun?.summary?.orphansByEntity?.[entity]?.length ?? 0;
          const isSelected = selected === entity;
          const isEmpty = (block?.totalRows ?? 0) === 0;
          const hasErrors = (summary?.error ?? 0) > 0;
          const hasWarnings = (summary?.warning ?? 0) > 0;
          const tone = hasErrors
            ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-700/40 dark:bg-rose-900/20 dark:text-rose-200'
            : hasWarnings
              ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200'
              : isEmpty
                ? 'border-slate-200 bg-slate-50 text-slate-500 dark:border-ndark-border dark:bg-ndark-surface dark:text-ndark-muted'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-200';
          const ringClass = isSelected ? 'ring-2 ring-brand-500' : '';
          const icon = hasErrors ? (
            <AlertTriangle size={12} />
          ) : isEmpty ? (
            <Circle size={12} />
          ) : (
            <CheckCircle2 size={12} />
          );
          return (
            <li key={entity} style={{ marginLeft: indent * 18 }}>
              <button
                type="button"
                onClick={() => onSelect?.(entity)}
                className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs ${tone} ${ringClass}`}
              >
                {icon}
                <span className="flex-1 truncate font-medium">{labelByEntity.get(entity) ?? entity}</span>
                <span className="shrink-0 text-[10px] opacity-80">
                  {(block?.totalRows ?? 0)} satır
                  {summary
                    ? ` · ${summary.create}+ ${summary.update}↺ ${summary.error}✗`
                    : ''}
                  {orphans > 0 ? ` · ${orphans} orphan` : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
