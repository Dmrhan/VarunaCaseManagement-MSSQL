import { useEffect, useMemo, useState } from 'react';
import { Building2, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { notify } from '@/components/ui/Toast';
import { useAuth } from '@/services/AuthContext';
import {
  accountService,
  type AccountCompanyDetail,
  type AccountCompanyMutationInput,
  type AccountDetail,
} from '@/services/accountService';
import { lookupService } from '@/services/caseService';

interface AccountCompanyEditorProps {
  open: boolean;
  mode: 'add' | 'edit';
  accountId: string;
  /** edit modunda mevcut ilişki; add modunda undefined. */
  relation?: AccountCompanyDetail | null;
  /** Bu account'a zaten bağlı companyId'ler — add modunda dropdown'dan çıkar. */
  existingCompanyIds: string[];
  onClose: () => void;
  onSaved: (updated: AccountDetail | undefined) => void;
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'active', label: 'Aktif' },
  { value: 'prospect', label: 'Aday' },
  { value: 'churn', label: 'Churn' },
  { value: 'inactive', label: 'Pasif' },
];

const FIVE_DIGIT_RX = /^\d{5}$/;

function toDateInput(value: string | null | undefined): string {
  if (!value) return '';
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

/**
 * Account şirket ilişkisi ekleme/düzenleme/silme. companyId edit modunda
 * değiştirilemez (cross-tenant audit gerektirir; ayrı endpoint Phase D'de).
 */
export function AccountCompanyEditor({
  open,
  mode,
  accountId,
  relation,
  existingCompanyIds,
  onClose,
  onSaved,
}: AccountCompanyEditorProps) {
  const { user } = useAuth();
  const companies = useMemo(() => lookupService.companies(), []);

  const [companyId, setCompanyId] = useState('');
  const [externalCustomerCode, setExternalCustomerCode] = useState('');
  const [packageName, setPackageName] = useState('');
  const [contractStartAt, setContractStartAt] = useState('');
  const [contractEndAt, setContractEndAt] = useState('');
  const [segment, setSegment] = useState('');
  const [status, setStatus] = useState('active');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (mode === 'edit' && relation) {
      setCompanyId(relation.companyId);
      setExternalCustomerCode(relation.externalCustomerCode ?? '');
      setPackageName(relation.packageName ?? '');
      setContractStartAt(toDateInput(relation.contractStartAt));
      setContractEndAt(toDateInput(relation.contractEndAt));
      setSegment(relation.segment ?? '');
      setStatus(relation.status || 'active');
      setNotes(relation.notes ?? '');
    } else {
      setCompanyId('');
      setExternalCustomerCode('');
      setPackageName('');
      setContractStartAt('');
      setContractEndAt('');
      setSegment('');
      setStatus('active');
      setNotes('');
    }
  }, [open, mode, relation]);

  // Add modunda: zaten bağlı companyId'leri dışla. Edit'te aynı kalır.
  const availableCompanies = useMemo(() => {
    if (mode === 'edit') return companies;
    return companies.filter((c) => !existingCompanyIds.includes(c.id));
  }, [companies, existingCompanyIds, mode]);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (mode === 'add' && !companyId) errs.companyId = 'Şirket seç.';
    if (externalCustomerCode && !FIVE_DIGIT_RX.test(externalCustomerCode.trim())) {
      errs.externalCustomerCode = 'Müşteri dış kodu 5 hane olmalı.';
    }
    if (contractStartAt && contractEndAt && contractStartAt > contractEndAt) {
      errs.contractEndAt = 'Bitiş tarihi başlangıçtan önce olamaz.';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    let result: AccountDetail | undefined;

    if (mode === 'add') {
      const body: AccountCompanyMutationInput = {
        companyId,
        externalCustomerCode: externalCustomerCode.trim() || null,
        packageName: packageName.trim() || null,
        contractStartAt: contractStartAt || null,
        contractEndAt: contractEndAt || null,
        segment: segment.trim() || null,
        status,
        notes: notes.trim() || null,
      };
      result = await accountService.addCompanyRelation(accountId, body);
      if (result) notify({ type: 'success', title: 'Şirket ilişkisi eklendi', message: '' });
    } else if (relation) {
      const body: AccountCompanyMutationInput = {
        externalCustomerCode: externalCustomerCode.trim() || null,
        packageName: packageName.trim() || null,
        contractStartAt: contractStartAt || null,
        contractEndAt: contractEndAt || null,
        segment: segment.trim() || null,
        status,
        notes: notes.trim() || null,
      };
      result = await accountService.updateCompanyRelation(
        accountId,
        relation.accountCompanyId,
        body,
      );
      if (result) notify({ type: 'success', title: 'Şirket ilişkisi güncellendi', message: '' });
    }
    setSubmitting(false);
    if (result) onSaved(result);
  }

  async function handleDelete() {
    if (!relation || mode !== 'edit') return;
    if (!window.confirm('Bu şirket ilişkisini kaldırmak istediğine emin misin?')) return;
    setDeleting(true);
    const result = await accountService.removeCompanyRelation(
      accountId,
      relation.accountCompanyId,
    );
    setDeleting(false);
    if (result) {
      notify({ type: 'success', title: 'Şirket ilişkisi kaldırıldı', message: '' });
      onSaved(result);
    }
  }

  const title =
    mode === 'add' ? (
      <span className="inline-flex items-center gap-1.5">
        <Building2 size={14} /> Yeni Şirket İlişkisi
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5">
        <Building2 size={14} /> Şirket İlişkisini Düzenle
      </span>
    );

  // SystemAdmin değilse sadece allowed company'lerden seç (lookup zaten filter'lı).
  void user;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={title}
      footer={
        <div className="flex items-center justify-between px-5 py-3">
          <div>
            {mode === 'edit' && (
              <Button
                variant="outline"
                type="button"
                leftIcon={<Trash2 size={12} />}
                disabled={submitting || deleting}
                onClick={handleDelete}
                className="border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-900/30"
              >
                {deleting ? 'Kaldırılıyor…' : 'İlişkiyi Kaldır'}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" type="button" onClick={onClose} disabled={submitting}>
              Vazgeç
            </Button>
            <Button
              type="submit"
              form="account-company-form"
              disabled={submitting || deleting}
            >
              {submitting
                ? 'Kaydediliyor…'
                : mode === 'add'
                  ? 'İlişki Ekle'
                  : 'Değişiklikleri Kaydet'}
            </Button>
          </div>
        </div>
      }
    >
      <form id="account-company-form" onSubmit={handleSubmit} className="space-y-4 p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Şirket" required error={errors.companyId}>
            {mode === 'edit' ? (
              <TextInput
                value={
                  companies.find((c) => c.id === companyId)?.name ?? companyId
                }
                disabled
                readOnly
              />
            ) : (
              <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                <option value="">Şirket seç…</option>
                {availableCompanies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Durum">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Müşteri Dış Kodu"
            hint="Opsiyonel dış sistem kodu (ERP/CRM/3. parti)"
            error={errors.externalCustomerCode}
          >
            <TextInput
              value={externalCustomerCode}
              onChange={(e) => setExternalCustomerCode(e.target.value)}
              placeholder="00000"
              inputMode="numeric"
              maxLength={5}
            />
          </Field>
          <Field label="Paket">
            <TextInput
              value={packageName}
              onChange={(e) => setPackageName(e.target.value)}
              placeholder="Örn. Standart"
            />
          </Field>

          <Field label="Sözleşme Başlangıç">
            <TextInput
              type="date"
              value={contractStartAt}
              onChange={(e) => setContractStartAt(e.target.value)}
            />
          </Field>
          <Field label="Sözleşme Bitiş" error={errors.contractEndAt}>
            <TextInput
              type="date"
              value={contractEndAt}
              onChange={(e) => setContractEndAt(e.target.value)}
            />
          </Field>

          <Field label="Segment" className="sm:col-span-2">
            <TextInput
              value={segment}
              onChange={(e) => setSegment(e.target.value)}
              placeholder="KOBİ / Enterprise / Demo …"
            />
          </Field>
        </div>

        <Field label="Notlar">
          <TextArea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Bu şirket bağlamına özel not (opsiyonel)"
          />
        </Field>
      </form>
    </Modal>
  );
}
