import { useEffect, useMemo, useState } from 'react';
import { MapPin, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextInput } from '@/components/ui/Field';
import { notify } from '@/components/ui/Toast';
import {
  accountService,
  ADDRESS_TYPE_LABELS,
  ADDRESS_TYPES,
  type AccountAddressMutationInput,
  type AccountAddressSummary,
  type AccountCompanyDetail,
  type AccountDetail,
  type AddressType,
} from '@/services/accountService';

interface AccountAddressEditorProps {
  open: boolean;
  mode: 'add' | 'edit';
  accountId: string;
  /** Kullanıcının görebildiği AccountCompany'ler — Adres hangi şirkete bağlanacak. */
  visibleCompanies: AccountCompanyDetail[];
  address?: AccountAddressSummary | null;
  onClose: () => void;
  onSaved: (account: AccountDetail | undefined) => void;
}

const ISO2_RX = /^[A-Z]{2}$/;

/**
 * WR-A3 / PM-02 — Country-agnostic adres ekleme/düzenleme/pasifleştirme.
 *
 * - Add: kullanıcı şirket + tip + line1 + country seçer (diğer alanlar opsiyonel).
 * - Edit: companyId değiştirilemez (taşıma desteklenmiyor — yeni adres yarat).
 */
export function AccountAddressEditor({
  open,
  mode,
  accountId,
  visibleCompanies,
  address,
  onClose,
  onSaved,
}: AccountAddressEditorProps) {
  const [companyId, setCompanyId] = useState('');
  const [type, setType] = useState<AddressType>('Billing');
  const [label, setLabel] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [district, setDistrict] = useState('');
  const [city, setCity] = useState('');
  const [stateRegion, setStateRegion] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('TR');
  const [isDefault, setIsDefault] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (mode === 'edit' && address) {
      setCompanyId(address.companyId);
      setType(address.type);
      setLabel(address.label ?? '');
      setLine1(address.line1);
      setLine2(address.line2 ?? '');
      setDistrict(address.district ?? '');
      setCity(address.city ?? '');
      setStateRegion(address.state ?? '');
      setPostalCode(address.postalCode ?? '');
      setCountry(address.country);
      setIsDefault(address.isDefault);
      setIsActive(address.isActive);
    } else {
      const defaultCid = visibleCompanies.length === 1 ? visibleCompanies[0].companyId : '';
      setCompanyId(defaultCid);
      setType('Billing');
      setLabel('');
      setLine1('');
      setLine2('');
      setDistrict('');
      setCity('');
      setStateRegion('');
      setPostalCode('');
      setCountry('TR');
      setIsDefault(false);
      setIsActive(true);
    }
  }, [open, mode, address, visibleCompanies]);

  const selectedCompany = useMemo(
    () => visibleCompanies.find((c) => c.companyId === companyId) ?? null,
    [visibleCompanies, companyId],
  );

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (mode === 'add' && !companyId) errs.companyId = 'Şirket seç.';
    if (!line1.trim()) errs.line1 = 'Adres satırı zorunlu.';
    const normalizedCountry = country.trim().toUpperCase();
    if (!ISO2_RX.test(normalizedCountry)) {
      errs.country = 'Ülke kodu 2 harfli ISO formatında olmalı (örn. TR, DE).';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);

    const body: AccountAddressMutationInput = {
      type,
      label: label.trim() || null,
      line1: line1.trim(),
      line2: line2.trim() || null,
      district: district.trim() || null,
      city: city.trim() || null,
      state: stateRegion.trim() || null,
      postalCode: postalCode.trim() || null,
      country: country.trim().toUpperCase(),
      isDefault,
      isActive,
    };

    let updated: AccountDetail | undefined;
    if (mode === 'add') {
      body.companyId = companyId;
      const result = await accountService.addAddress(accountId, body);
      updated = result?.account;
      if (updated) notify({ type: 'success', title: 'Adres eklendi', message: '' });
    } else if (address) {
      const result = await accountService.updateAddress(accountId, address.id, body);
      updated = result?.account;
      if (updated) notify({ type: 'success', title: 'Adres güncellendi', message: '' });
    }
    setSubmitting(false);
    if (updated) onSaved(updated);
  }

  async function handleDeactivate() {
    if (!address || mode !== 'edit') return;
    if (!window.confirm('Bu adresi pasifleştirmek istediğine emin misin?')) return;
    setDeleting(true);
    const result = await accountService.removeAddress(accountId, address.id);
    setDeleting(false);
    if (result?.account) {
      notify({ type: 'success', title: 'Adres pasifleştirildi', message: '' });
      onSaved(result.account);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={
        <span className="inline-flex items-center gap-1.5">
          <MapPin size={14} />
          {mode === 'add' ? 'Yeni Adres' : 'Adresi Düzenle'}
        </span>
      }
      footer={
        <div className="flex items-center justify-between px-5 py-3">
          <div>
            {mode === 'edit' && address?.isActive && (
              <Button
                variant="outline"
                type="button"
                leftIcon={<Trash2 size={12} />}
                disabled={submitting || deleting}
                onClick={handleDeactivate}
                className="border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-900/30"
              >
                {deleting ? 'Pasifleştiriliyor…' : 'Pasifleştir'}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" type="button" onClick={onClose} disabled={submitting}>
              Vazgeç
            </Button>
            <Button type="submit" form="account-address-form" disabled={submitting || deleting}>
              {submitting
                ? 'Kaydediliyor…'
                : mode === 'add'
                  ? 'Adres Ekle'
                  : 'Değişiklikleri Kaydet'}
            </Button>
          </div>
        </div>
      }
    >
      <form id="account-address-form" onSubmit={handleSubmit} className="space-y-4 p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Şirket"
            required
            error={errors.companyId}
            hint={mode === 'edit' ? 'Şirket değişimi desteklenmiyor.' : undefined}
          >
            {mode === 'edit' ? (
              <TextInput
                value={selectedCompany?.companyName ?? companyId}
                disabled
                readOnly
              />
            ) : (
              <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                <option value="">Şirket seç…</option>
                {visibleCompanies.map((c) => (
                  <option key={c.companyId} value={c.companyId}>
                    {c.companyName ?? c.companyId}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Adres Tipi" required>
            <Select value={type} onChange={(e) => setType(e.target.value as AddressType)}>
              {ADDRESS_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ADDRESS_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Etiket" hint="Opsiyonel — örn. 'İstanbul merkez ofis', 'Adana şube'">
          <TextInput
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Örn. İstanbul merkez ofis"
            maxLength={120}
          />
        </Field>

        <Field label="Adres Satırı" required error={errors.line1}>
          <TextInput
            value={line1}
            onChange={(e) => setLine1(e.target.value)}
            placeholder="Cadde, sokak, bina no"
            autoFocus
          />
        </Field>
        <Field label="Ek Adres Satırı" hint="Opsiyonel — kat, daire, blok">
          <TextInput
            value={line2}
            onChange={(e) => setLine2(e.target.value)}
            placeholder="Kat 5, Daire 42"
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="İlçe / Semt">
            <TextInput value={district} onChange={(e) => setDistrict(e.target.value)} />
          </Field>
          <Field label="Şehir" hint="Opsiyonel">
            <TextInput value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
          <Field label="Eyalet / Bölge">
            <TextInput
              value={stateRegion}
              onChange={(e) => setStateRegion(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Posta Kodu">
            <TextInput value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
          </Field>
          <Field
            label="Ülke (ISO-2)"
            required
            error={errors.country}
            hint="Örn. TR, DE, US"
          >
            <TextInput
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
              maxLength={2}
              className="uppercase"
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-ndark-text">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-ndark-border dark:bg-ndark-surface"
            />
            <span>Bu tip için varsayılan adres</span>
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-ndark-text">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-ndark-border dark:bg-ndark-surface"
            />
            <span>Aktif</span>
          </label>
        </div>
      </form>
    </Modal>
  );
}
