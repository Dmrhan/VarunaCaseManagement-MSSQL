import { useMemo } from 'react';
import { Field, Select } from './Field';
import { useAuth } from '@/services/AuthContext';
import { lookupService } from '@/services/caseService';

/**
 * CompanySelector — Admin tanım ekranlarında (Takımlar, SLA, Checklist,
 * Kategori) ortak şirket seçici.
 *
 * Veri kaynağı: lookupService.companies() (bootstrap zaten user'ın
 * allowedCompanyIds'iyle filtrelenmiş).
 *
 * allowSystemWide (varsayılan: false): true verilince ek "Sistem Geneli"
 * (companyId=null) seçeneği görünür — yalnızca SystemAdmin için aktif.
 *
 * value type: string | null
 *   - null = sistem geneli (companyId = null DB'de)
 *   - "" boş string ise "Şirket seç…" placeholder
 *
 * Kullanım örnekleri:
 *   <CompanySelector value={companyId} onChange={setCompanyId} required />
 *   <CompanySelector value={companyId} onChange={setCompanyId}
 *                    allowSystemWide label="Şirket" />
 */

interface CompanySelectorProps {
  value: string | null;
  onChange: (companyId: string | null) => void;
  allowSystemWide?: boolean;
  required?: boolean;
  disabled?: boolean;
  label?: string;
  hint?: string;
  /** "Tümü" seçeneği — filter kullanımı için (create form'da false bırak). */
  allowAll?: boolean;
}

const SYSTEM_WIDE_VALUE = '__system__';
const ALL_VALUE = '__all__';

export function CompanySelector({
  value,
  onChange,
  allowSystemWide = false,
  required = false,
  disabled = false,
  label = 'Şirket',
  hint,
  allowAll = false,
}: CompanySelectorProps) {
  const { user } = useAuth();
  const isSystemAdmin = user?.role === 'SystemAdmin';
  const companies = useMemo(() => lookupService.companies(), []);

  // value → select string
  // null → SYSTEM_WIDE_VALUE (allowSystemWide true ise)
  // "" → ALL_VALUE (allowAll true ise) ya da "" placeholder
  const selectValue =
    value === null
      ? allowSystemWide
        ? SYSTEM_WIDE_VALUE
        : allowAll
          ? ALL_VALUE
          : ''
      : value;

  function handleChange(raw: string) {
    if (raw === SYSTEM_WIDE_VALUE) onChange(null);
    else if (raw === ALL_VALUE) onChange(null); // "Tümü" filtresi de null ile temsil edilir
    else if (raw === '') onChange(null);
    else onChange(raw);
  }

  return (
    <Field label={label} required={required} hint={hint}>
      <Select
        value={selectValue}
        onChange={(e) => handleChange(e.target.value)}
        disabled={disabled}
      >
        {allowAll && <option value={ALL_VALUE}>Tümü</option>}
        {!allowAll && !value && <option value="">Şirket seç…</option>}
        {/*
          "Sistem Geneli" — yalnız allowSystemWide=true VE kullanıcı SystemAdmin.
          Admin SystemAdmin değilse bu seçenek dropdown'da gözükmez (form yaratamaz).
          Mevcut bir sistem-geneli kayıt edit ediliyorsa parent component disabled
          yaparak değişikliği engellemeli.
        */}
        {allowSystemWide && isSystemAdmin && (
          <option value={SYSTEM_WIDE_VALUE}>Sistem Geneli (tüm şirketler)</option>
        )}
        {companies.length === 0 && !allowSystemWide && !allowAll && (
          <option value="" disabled>
            — atanmış şirket yok —
          </option>
        )}
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}
