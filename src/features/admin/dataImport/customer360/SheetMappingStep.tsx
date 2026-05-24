/**
 * Sheet Mapping Wizard step for Customer 360 import.
 *
 * Sits between XLSX upload and field mapping. Lists every sheet of the
 * uploaded workbook, shows the auto-suggested target entities, lets the
 * user adjust per-sheet target selection (multi-select), and validates
 * that at least one sheet feeds Accounts before allowing continue.
 *
 * No business logic lives here — the actual bundle build runs in
 * `buildCustomer360BundleFromMappings` once the user confirms.
 */

import { useMemo, useState } from 'react';
import { ArrowRight, Sparkles, AlertTriangle, RefreshCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { Customer360EntityKey } from '@/services/importService';
import type { AutoSuggestResult, RawSheet, SheetMappingChoice } from './parsers';

const ENTITY_LABELS: Record<Customer360EntityKey, string> = {
  account: 'Müşteriler',
  accountCompany: 'Müşteri-Şirket İlişkileri',
  accountContact: 'İletişim Kişileri',
  accountAddress: 'Adresler',
  accountProject: 'Projeler',
};
const ENTITY_ORDER: Customer360EntityKey[] = [
  'account',
  'accountCompany',
  'accountContact',
  'accountAddress',
  'accountProject',
];

export interface SheetMappingStepProps {
  sheets: RawSheet[];
  suggested: AutoSuggestResult;
  /** Externally-controlled mappings. Parent owns the state. */
  mappings: Record<string, SheetMappingChoice>;
  onChange: (next: Record<string, SheetMappingChoice>) => void;
  onReset: () => void;
  onConfirm: () => void;
}

export function SheetMappingStep({
  sheets,
  suggested,
  mappings,
  onChange,
  onReset,
  onConfirm,
}: SheetMappingStepProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const summary = useMemo(() => {
    const perEntity: Record<Customer360EntityKey, string[]> = {
      account: [], accountCompany: [], accountContact: [], accountAddress: [], accountProject: [],
    };
    const unmapped: string[] = [];
    const skipped: string[] = [];
    for (const s of sheets) {
      const m = mappings[s.sheetName];
      if (!m) { unmapped.push(s.sheetName); continue; }
      if (m.skip) { skipped.push(s.sheetName); continue; }
      if (m.entities.length === 0) { unmapped.push(s.sheetName); continue; }
      for (const e of m.entities) perEntity[e].push(s.sheetName);
    }
    return { perEntity, unmapped, skipped };
  }, [sheets, mappings]);

  const accountsCovered = summary.perEntity.account.length > 0;
  const childWithoutAccounts: Customer360EntityKey[] = !accountsCovered
    ? (['accountCompany', 'accountContact', 'accountAddress', 'accountProject'] as Customer360EntityKey[]).filter(
        (e) => summary.perEntity[e].length > 0,
      )
    : [];

  const canContinue = accountsCovered;
  const hasUnmapped = summary.unmapped.length > 0;

  function updateChoice(sheetName: string, next: SheetMappingChoice) {
    onChange({ ...mappings, [sheetName]: next });
  }

  function toggleEntity(sheetName: string, entity: Customer360EntityKey) {
    const current = mappings[sheetName] ?? { entities: [], skip: false };
    const set = new Set(current.entities);
    if (set.has(entity)) set.delete(entity);
    else set.add(entity);
    updateChoice(sheetName, { entities: [...set], skip: false });
  }

  function setSkip(sheetName: string, skip: boolean) {
    const current = mappings[sheetName] ?? { entities: [], skip: false };
    updateChoice(sheetName, { entities: skip ? [] : current.entities, skip });
  }

  function toggleExpanded(sheetName: string) {
    setExpanded((prev) => ({ ...prev, [sheetName]: !prev[sheetName] }));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-800 dark:text-ndark-text">Sheetleri Eşleştir</div>
          <div className="text-[11px] text-slate-500 dark:text-ndark-muted">
            Yüklenen dosyadaki her sayfayı bir veya birden fazla Customer 360 entity'sine eşleyin.
            Sayfayı kullanmak istemiyorsanız "Atla" seçebilirsiniz.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:border-brand-400 hover:bg-brand-50/40 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
          >
            <RefreshCcw size={12} /> Önerileri Sıfırla
          </button>
          <Button
            variant="primary"
            size="sm"
            onClick={onConfirm}
            disabled={!canContinue}
            title={!canContinue ? 'Devam etmek için en az bir sayfayı Müşteriler\'e eşleyin.' : undefined}
          >
            Devam <ArrowRight size={14} />
          </Button>
        </div>
      </div>

      {suggested.legacyPresetApplied && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-200">
          <div className="flex items-center gap-1.5">
            <Sparkles size={12} />
            <strong>Eski müşteri listesi düzeni algılandı.</strong> Önerilen sheet eşleştirmeleri hazırlandı.
          </div>
          <div className="mt-1 text-[11px] text-emerald-700/90 dark:text-emerald-200/90">
            Genel Tekil → Müşteriler + Müşteri-Şirket; Detaylar → İletişim + Projeler; "Genel" varsa
            mükerrer olarak atlanır.
          </div>
        </div>
      )}

      {!accountsCovered && childWithoutAccounts.length > 0 && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-700/40 dark:bg-rose-900/20 dark:text-rose-200">
          <div className="flex items-center gap-1.5">
            <AlertTriangle size={12} />
            <strong>Müşteriler sayfası eşleşmemiş.</strong>
          </div>
          <div className="mt-1 text-[11px]">
            En az bir sayfayı "Müşteriler" entity'sine eşleyin. Şu an sadece çocuk entity'ler eşli:
            {' '}
            {childWithoutAccounts.map((e) => ENTITY_LABELS[e]).join(', ')}.
          </div>
        </div>
      )}

      {hasUnmapped && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
          <strong>Eşleşmemiş sayfalar:</strong> {summary.unmapped.join(', ')} — hiçbir entity seçilmedi ve
          "Atla" da işaretlenmedi. Devam edebilirsiniz; bu sayfalar bundle'a dahil edilmez.
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-slate-200 dark:border-ndark-border">
        <table className="w-full table-fixed text-xs">
          <thead className="bg-slate-50 text-slate-600 dark:bg-ndark-surface dark:text-ndark-muted">
            <tr>
              <th className="w-[24%] px-2 py-1.5 text-left font-medium">Sayfa</th>
              <th className="w-[10%] px-2 py-1.5 text-right font-medium">Satır</th>
              <th className="px-2 py-1.5 text-left font-medium">Hedef Entity'ler</th>
              <th className="w-[8%] px-2 py-1.5 text-center font-medium">Atla</th>
              <th className="w-[6%] px-2 py-1.5 text-center font-medium">Detay</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-ndark-border">
            {sheets.map((s) => {
              const choice = mappings[s.sheetName] ?? { entities: [], skip: false };
              const isExpanded = expanded[s.sheetName] ?? false;
              const isLegacyHint = suggested.legacyPresetApplied && (
                normalize(s.sheetName) === 'genel tekil' ||
                normalize(s.sheetName) === 'detaylar' ||
                (normalize(s.sheetName) === 'genel' && !!suggested.ignoredFallbackSheet)
              );
              return (
                <>
                  <tr key={s.sheetName} className="align-top">
                    <td className="px-2 py-2">
                      <div className="font-medium text-slate-800 dark:text-ndark-text">{s.sheetName}</div>
                      <div className="text-[10px] text-slate-500 dark:text-ndark-muted">
                        {s.columns.length} kolon
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right text-slate-700 dark:text-ndark-text">
                      {s.rowCount.toLocaleString('tr-TR')}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {ENTITY_ORDER.map((e) => {
                          const on = !choice.skip && choice.entities.includes(e);
                          return (
                            <label
                              key={e}
                              className={`inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] ${
                                on
                                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-ndark-card dark:text-ndark-text dark:border-ndark-accent'
                                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted'
                              } ${choice.skip ? 'opacity-50' : ''}`}
                            >
                              <input
                                type="checkbox"
                                className="hidden"
                                disabled={choice.skip}
                                checked={on}
                                onChange={() => toggleEntity(s.sheetName, e)}
                              />
                              {ENTITY_LABELS[e]}
                            </label>
                          );
                        })}
                      </div>
                      {isLegacyHint && (
                        <div className="mt-1 text-[10px] text-emerald-700/80 dark:text-emerald-200/80">
                          Eski format öneri uygulandı.
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={choice.skip}
                        onChange={(e) => setSkip(s.sheetName, e.target.checked)}
                      />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(s.sheetName)}
                        className="rounded p-0.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-ndark-surface"
                      >
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${s.sheetName}__detail`}>
                      <td colSpan={5} className="bg-slate-50 px-3 py-2 dark:bg-ndark-surface/40">
                        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                          Kolonlar
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {s.columns.length === 0 ? (
                            <span className="text-[11px] text-slate-500">— (boş)</span>
                          ) : (
                            s.columns.map((c) => (
                              <span
                                key={c}
                                className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-600 ring-1 ring-slate-200 dark:bg-ndark-card dark:text-ndark-muted dark:ring-ndark-border"
                              >
                                {c}
                              </span>
                            ))
                          )}
                        </div>
                        {s.sampleRows.length > 0 && (
                          <>
                            <div className="mt-2 mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                              Örnek satırlar (ilk 3)
                            </div>
                            <pre className="max-h-40 overflow-auto rounded bg-white p-2 text-[10px] text-slate-700 ring-1 ring-slate-200 dark:bg-ndark-card dark:text-ndark-muted dark:ring-ndark-border">
                              {s.sampleRows.map((r) => JSON.stringify(r)).join('\n')}
                            </pre>
                          </>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600 dark:border-ndark-border dark:bg-ndark-surface/40 dark:text-ndark-muted">
        <strong className="text-slate-700 dark:text-ndark-text">Plan özeti:</strong>{' '}
        {ENTITY_ORDER.map((e) => `${ENTITY_LABELS[e]}: ${summary.perEntity[e].length}`).join(' · ')}
        {summary.skipped.length > 0 && (
          <span className="ml-1 text-slate-500">· Atlanan: {summary.skipped.length}</span>
        )}
      </div>
    </div>
  );
}

function normalize(s: string): string {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}
