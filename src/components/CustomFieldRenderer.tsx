import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import type { FieldDefinition } from '@/services/adminService';

/**
 * Tek bir custom field tanımı için input render eder.
 * Tip bazlı: Text/Textarea/Number/Date/Select/Boolean.
 *
 * value/onChange controlled — parent customFields[fieldKey] state'ini yönetir.
 * Değer şeması:
 *   - Text/Textarea/Select → string
 *   - Number → number | ''  (boş = girilmemiş)
 *   - Date → ISO date string 'YYYY-MM-DD' veya ''
 *   - Boolean → boolean
 */
export function CustomFieldRenderer({
  definition,
  value,
  onChange,
  disabled,
}: {
  definition: FieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}) {
  const { fieldType, label, isRequired, options } = definition;

  return (
    <Field
      label={label}
      required={isRequired}
      hint={fieldType === 'Number' ? 'Sayı' : undefined}
    >
      {renderInput(fieldType, value, onChange, options, disabled)}
    </Field>
  );
}

function renderInput(
  fieldType: FieldDefinition['fieldType'],
  value: unknown,
  onChange: (value: unknown) => void,
  options: FieldDefinition['options'],
  disabled?: boolean,
) {
  switch (fieldType) {
    case 'Text':
      return (
        <TextInput
          value={(value as string | undefined) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
    case 'Textarea':
      return (
        <TextArea
          rows={3}
          value={(value as string | undefined) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
    case 'Number':
      return (
        <TextInput
          type="number"
          value={value == null ? '' : String(value)}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === '' ? null : Number(v));
          }}
          disabled={disabled}
        />
      );
    case 'Date':
      return (
        <TextInput
          type="date"
          value={(value as string | undefined) ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={disabled}
        />
      );
    case 'Boolean':
      return (
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-ndark-text">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          Evet
        </label>
      );
    case 'Select':
      return (
        <Select
          value={(value as string | undefined) ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={disabled}
        >
          <option value="">Seçin…</option>
          {(options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    default:
      return <span className="text-xs text-slate-400">Bilinmeyen tip: {fieldType}</span>;
  }
}

/**
 * Custom field grubunu render eder. Boş ise null döner — section gizlenir.
 *
 * Filtreleme: caseType null (her tip için) ya da seçili caseType ile eşleşir.
 * isActive=true zorunlu.
 */
export function CustomFieldsSection({
  definitions,
  caseType,
  values,
  onChange,
  disabled,
}: {
  definitions: FieldDefinition[];
  caseType: string;
  values: Record<string, unknown>;
  onChange: (fieldKey: string, value: unknown) => void;
  disabled?: boolean;
}) {
  const applicable = definitions
    .filter((d) => d.isActive)
    .filter((d) => !d.caseType || d.caseType === caseType)
    .sort((a, b) => a.displayOrder - b.displayOrder);

  if (applicable.length === 0) return null;

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/50 p-3 dark:border-ndark-border dark:bg-ndark-card/40">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-ndark-muted">
        Dinamik Alanlar
      </div>
      {applicable.map((def) => (
        <CustomFieldRenderer
          key={def.id}
          definition={def}
          value={values[def.fieldKey]}
          onChange={(v) => onChange(def.fieldKey, v)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

/** Validate — required dolu mu? Eksik field'ların etiketlerini döner. */
export function validateCustomFields(
  definitions: FieldDefinition[],
  caseType: string,
  values: Record<string, unknown>,
): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  for (const d of definitions) {
    if (!d.isActive) continue;
    if (d.caseType && d.caseType !== caseType) continue;
    if (!d.isRequired) continue;
    const v = values[d.fieldKey];
    const empty =
      v === undefined ||
      v === null ||
      v === '' ||
      (d.fieldType === 'Boolean' && v === false);
    if (empty) missing.push(d.label);
  }
  return missing.length > 0 ? { ok: false, missing } : { ok: true };
}
