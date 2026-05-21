import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Sparkles, RotateCcw, CheckCircle2, AlertCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Select } from '@/components/ui/Field';
import {
  importService,
  type MappingItem,
  type MappingValidation,
  type TargetFieldDescriptor,
  type TargetSchemaResponse,
} from '@/services/importService';
import type { ParsedSource } from './types';
import { cn } from '@/components/ui/cn';

interface Props {
  companyId: string;
  schema: TargetSchemaResponse;
  source: ParsedSource;
  mapping: MappingItem[];
  onChange: (next: MappingItem[]) => void;
  onValidationChange: (v: MappingValidation | null) => void;
}

const GROUP_ORDER = ['Zorunlu', 'Kimlik', 'Yasal', 'İletişim', 'Durum'];

function detectType(samples: unknown[]): 'text' | 'number' | 'boolean' | 'email' | 'phone' | 'vkn' {
  const s = samples.filter((v) => v !== null && v !== undefined && v !== '').map((v) => String(v));
  if (s.length === 0) return 'text';
  if (s.every((v) => /^[+]?\d[\d\s\-()/.]{6,}$/.test(v))) return 'phone';
  if (s.every((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) return 'email';
  if (s.every((v) => /^\d{10}$/.test(v.replace(/\s/g, '')))) return 'vkn';
  if (s.every((v) => /^-?\d+(\.\d+)?$/.test(v))) return 'number';
  if (s.every((v) => /^(true|false|evet|hayır|hayir|0|1|aktif|pasif)$/i.test(v))) return 'boolean';
  return 'text';
}

export function MappingStep({ companyId, schema, source, mapping, onChange, onValidationChange }: Props) {
  const [validation, setValidation] = useState<MappingValidation | null>(null);
  const [busy, setBusy] = useState(false);

  // Validation tetikle
  useEffect(() => {
    let alive = true;
    void importService.validateMapping({ companyId, mapping }).then((r) => {
      if (!alive) return;
      setValidation(r ?? null);
      onValidationChange(r ?? null);
    });
    return () => {
      alive = false;
    };
  }, [companyId, mapping, onValidationChange]);

  // Sütun başına ilk 3 örnek değer + detect type
  const sourceCards = useMemo(() => {
    return source.columns.map((col) => {
      const samples = source.sample.slice(0, 3).map((r) => r[col]);
      const detected = detectType(samples);
      const mapped = mapping.find((m) => m.source === col)?.targetKey ?? null;
      return { col, samples, detected, mapped };
    });
  }, [source, mapping]);

  // Target fields by group
  const targetGroups = useMemo(() => {
    const byGroup: Record<string, TargetFieldDescriptor[]> = {};
    for (const f of schema.fields) {
      if (!byGroup[f.group]) byGroup[f.group] = [];
      byGroup[f.group].push(f);
    }
    const ordered = GROUP_ORDER.filter((g) => byGroup[g]).map((g) => [g, byGroup[g]!] as const);
    const remaining = Object.entries(byGroup).filter(([g]) => !GROUP_ORDER.includes(g));
    return [...ordered, ...remaining];
  }, [schema]);

  function setMapping(source: string, targetKey: string | null) {
    const next: MappingItem[] = [];
    let touched = false;
    for (const m of mapping) {
      if (m.source === source) {
        if (targetKey !== null) {
          next.push({ source, targetKey });
        }
        touched = true;
      } else {
        next.push(m);
      }
    }
    if (!touched && targetKey !== null) {
      next.push({ source, targetKey });
    }
    onChange(next);
  }

  async function autoMap() {
    setBusy(true);
    const r = await importService.autoMap({ companyId, columns: source.columns });
    setBusy(false);
    if (!r) return;
    onChange(r.suggestions.filter((s) => s.targetKey !== null));
  }

  function clearAll() {
    onChange([]);
  }

  // Status badges per target
  const targetMappingByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of mapping) if (m.targetKey) map.set(m.targetKey, m.source);
    return map;
  }, [mapping]);

  return (
    <div className="space-y-3">
      <Card>
        <CardBody className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-ndark-text">
              Alanları Eşleştir
            </h3>
            <p className="text-xs text-slate-500 dark:text-ndark-muted">
              Kaynak sütununu doğru Varuna alanına bağlayın. Otomatik eşleştirme önerileri kabul edilebilir.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={clearAll} disabled={busy || mapping.length === 0}>
              <RotateCcw size={12} />
              Tümünü Temizle
            </Button>
            <Button onClick={autoMap} disabled={busy}>
              <Sparkles size={12} />
              {busy ? 'Eşleştiriliyor…' : 'Otomatik Eşleştir'}
            </Button>
          </div>
        </CardBody>
      </Card>

      <MappingValidationBanner v={validation} schema={schema} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto_1.2fr]">
        {/* LEFT: kaynak sütunlar */}
        <Card>
          <CardBody className="space-y-2">
            <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-ndark-muted">
              <span>Kaynak Alanlar ({sourceCards.length})</span>
              <span className="text-[10px] font-normal">{source.totalRows} satır</span>
            </div>
            {sourceCards.length === 0 && (
              <div className="text-xs text-slate-500">Sütun bulunamadı.</div>
            )}
            <ul className="space-y-2">
              {sourceCards.map((c) => {
                const mappedField = c.mapped ? schema.fields.find((f) => f.key === c.mapped) : null;
                return (
                  <li
                    key={c.col}
                    className={cn(
                      'rounded-md border p-2 text-xs',
                      mappedField
                        ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-700/40 dark:bg-emerald-900/10'
                        : 'border-slate-200 bg-white dark:border-ndark-border dark:bg-ndark-card',
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-800 dark:text-ndark-text">
                          {c.col}
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-ndark-muted">
                          tip: {c.detected}
                        </div>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                          mappedField
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                            : 'bg-slate-100 text-slate-500 dark:bg-ndark-surface dark:text-ndark-muted',
                        )}
                      >
                        {mappedField ? 'eşlendi' : 'boşta'}
                      </span>
                    </div>
                    <div className="mb-2 line-clamp-2 text-[10px] text-slate-500 dark:text-ndark-muted">
                      {c.samples
                        .filter((v) => v !== null && v !== undefined && v !== '')
                        .map((v) => String(v))
                        .join(' · ') || '—'}
                    </div>
                    <div className="flex items-center gap-2">
                      <ArrowRight size={12} className="shrink-0 text-slate-400" />
                      <Select
                        className="text-xs"
                        value={c.mapped ?? ''}
                        onChange={(e) => setMapping(c.col, e.target.value || null)}
                      >
                        <option value="">— eşleşmedi —</option>
                        {schema.fields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label} {f.required ? '·zorunlu' : ''}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>

        {/* CENTER: visual hint divider on lg */}
        <div className="hidden flex-col items-center justify-center text-xs text-slate-400 lg:flex">
          <ArrowRight size={20} />
          <div className="mt-2 -rotate-90 text-[10px] uppercase tracking-wider">eşleşme</div>
        </div>

        {/* RIGHT: target fields */}
        <Card>
          <CardBody className="space-y-3">
            <div className="text-xs font-semibold text-slate-600 dark:text-ndark-muted">
              Varuna Hedef Alanları
            </div>
            <div className="text-[10px] text-slate-500 dark:text-ndark-muted">
              Hedef şema: {schema.target} · {schema.version}
            </div>
            <div className="space-y-3">
              {targetGroups.map(([group, fields]) => (
                <div key={group}>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-ndark-muted">
                    {group}
                  </div>
                  <ul className="space-y-1.5">
                    {fields.map((f) => {
                      const mappedSource = targetMappingByKey.get(f.key);
                      const state = mappedSource ? 'mapped' : f.required ? 'required' : 'optional';
                      return (
                        <li
                          key={f.key}
                          className={cn(
                            'rounded-md border px-2.5 py-1.5 text-xs',
                            state === 'mapped'
                              ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-700/40 dark:bg-emerald-900/10'
                              : state === 'required'
                                ? 'border-rose-200 bg-rose-50/40 dark:border-rose-700/40 dark:bg-rose-900/10'
                                : 'border-slate-200 bg-white dark:border-ndark-border dark:bg-ndark-card',
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-slate-800 dark:text-ndark-text">
                                  {f.label}
                                </span>
                                {f.required && (
                                  <span className="rounded bg-rose-100 px-1 py-0.5 text-[9px] font-semibold text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                                    zorunlu
                                  </span>
                                )}
                                <span className="text-[10px] text-slate-400 dark:text-ndark-muted">
                                  .{f.key}
                                </span>
                              </div>
                              <div className="truncate text-[10px] text-slate-500 dark:text-ndark-muted">
                                {f.description}
                              </div>
                            </div>
                            <span className="shrink-0 text-[10px] text-slate-500">
                              {mappedSource ? (
                                <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                                  ← {mappedSource}
                                </span>
                              ) : (
                                <span className="text-slate-400">eşleşmedi</span>
                              )}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function MappingValidationBanner({
  v,
  schema,
}: {
  v: MappingValidation | null;
  schema: TargetSchemaResponse;
}) {
  if (!v) return null;
  if (v.ok && v.warnings.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-200">
        <CheckCircle2 size={14} />
        Eşleştirme geçerli. Doğrulamaya geçebilirsiniz.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {v.errors.length > 0 && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs dark:border-rose-700/40 dark:bg-rose-900/20">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-rose-800 dark:text-rose-200">
            <AlertCircle size={12} /> Eşleştirme hataları
          </div>
          <ul className="ml-4 list-disc text-rose-700 dark:text-rose-300">
            {v.errors.map((e, i) => (
              <li key={i}>
                {e.message ??
                  (e.code === 'required_unmapped'
                    ? `${
                        schema.fields.find((f) => f.key === e.targetKey)?.label ?? e.targetKey
                      } eşleştirilmeli.`
                    : e.code)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {v.warnings.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs dark:border-amber-700/40 dark:bg-amber-900/20">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-200">
            <AlertTriangle size={12} /> Uyarılar
          </div>
          <ul className="ml-4 list-disc text-amber-700 dark:text-amber-300">
            {v.warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
