import { useEffect, useMemo, useState } from 'react';
import { Package, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextInput } from '@/components/ui/Field';
import { notify } from '@/components/ui/Toast';
import {
  accountService,
  type AccountCompanyDetail,
  type AccountDetail,
  type AccountProductSummary,
  type AccountProductMutationInput,
} from '@/services/accountService';

interface AccountProductEditorProps {
  open: boolean;
  mode: 'add' | 'edit';
  accountId: string;
  /** Kullanıcının görebildiği AccountCompany'ler — Ürün hangi şirkete eklenecek. */
  visibleCompanies: AccountCompanyDetail[];
  product?: AccountProductSummary | null;
  /** Edit modunda ürünün ait olduğu accountCompanyId. */
  accountCompanyId?: string | null;
  onClose: () => void;
  onSaved: (account: AccountDetail | undefined) => void;
}

function toDateInput(value: string | null | undefined): string {
  if (!value) return '';
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

/**
 * Ürün ekleme / düzenleme / pasifleştirme.
 * - Add: kullanıcı önce şirketi seçer (AccountCompany), sonra ürün bilgisi
 * - Edit: accountCompanyId değişmez; sadece productName / productCode / tarihler
 */
export function AccountProductEditor({
  open,
  mode,
  accountId,
  visibleCompanies,
  product,
  accountCompanyId: editAccountCompanyId,
  onClose,
  onSaved,
}: AccountProductEditorProps) {
  const [accountCompanyId, setAccountCompanyId] = useState('');
  const [productName, setProductName] = useState('');
  const [productCode, setProductCode] = useState('');
  const [startedAt, setStartedAt] = useState('');
  const [endedAt, setEndedAt] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (mode === 'edit' && product) {
      setAccountCompanyId(editAccountCompanyId ?? '');
      setProductName(product.productName);
      setProductCode(product.productCode ?? '');
      setStartedAt(toDateInput(product.startedAt));
      setEndedAt(toDateInput(product.endedAt));
      setIsActive(product.isActive);
    } else {
      // Single company → otomatik seç.
      const defaultAcId =
        visibleCompanies.length === 1 ? visibleCompanies[0].accountCompanyId : '';
      setAccountCompanyId(defaultAcId);
      setProductName('');
      setProductCode('');
      setStartedAt('');
      setEndedAt('');
      setIsActive(true);
    }
  }, [open, mode, product, editAccountCompanyId, visibleCompanies]);

  const selectedCompany = useMemo(
    () => visibleCompanies.find((c) => c.accountCompanyId === accountCompanyId) ?? null,
    [visibleCompanies, accountCompanyId],
  );

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (mode === 'add' && !accountCompanyId) errs.accountCompanyId = 'Şirket seç.';
    if (!productName.trim()) errs.productName = 'Ürün adı zorunlu.';
    if (startedAt && endedAt && startedAt > endedAt) {
      errs.endedAt = 'Bitiş tarihi başlangıçtan önce olamaz.';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);

    let updated: AccountDetail | undefined;
    if (mode === 'add') {
      const body: AccountProductMutationInput = {
        accountCompanyId,
        productName: productName.trim(),
        productCode: productCode.trim() || null,
        isActive,
        startedAt: startedAt || null,
        endedAt: endedAt || null,
      };
      const result = await accountService.addProduct(accountId, body);
      updated = result?.account;
      if (updated) notify({ type: 'success', title: 'Ürün eklendi', message: '' });
    } else if (product) {
      const body: AccountProductMutationInput = {
        productName: productName.trim(),
        productCode: productCode.trim() || null,
        isActive,
        startedAt: startedAt || null,
        endedAt: endedAt || null,
      };
      const result = await accountService.updateProduct(accountId, product.id, body);
      updated = result?.account;
      if (updated) notify({ type: 'success', title: 'Ürün güncellendi', message: '' });
    }
    setSubmitting(false);
    if (updated) onSaved(updated);
  }

  async function handleDeactivate() {
    if (!product || mode !== 'edit') return;
    if (!window.confirm('Bu ürünü pasifleştirmek istediğine emin misin?')) return;
    setDeleting(true);
    const result = await accountService.removeProduct(accountId, product.id);
    setDeleting(false);
    if (result?.account) {
      notify({ type: 'success', title: 'Ürün pasifleştirildi', message: '' });
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
          <Package size={14} />
          {mode === 'add' ? 'Yeni Ürün' : 'Ürünü Düzenle'}
        </span>
      }
      footer={
        <div className="flex items-center justify-between px-5 py-3">
          <div>
            {mode === 'edit' && product?.isActive && (
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
            <Button type="submit" form="account-product-form" disabled={submitting || deleting}>
              {submitting
                ? 'Kaydediliyor…'
                : mode === 'add'
                  ? 'Ürün Ekle'
                  : 'Değişiklikleri Kaydet'}
            </Button>
          </div>
        </div>
      }
    >
      <form id="account-product-form" onSubmit={handleSubmit} className="space-y-4 p-5">
        <Field
          label="Şirket"
          required
          error={errors.accountCompanyId}
          hint={mode === 'edit' ? 'Şirket değişimi için ürün taşıma desteklenmiyor.' : undefined}
        >
          {mode === 'edit' ? (
            <TextInput
              value={selectedCompany?.companyName ?? accountCompanyId}
              disabled
              readOnly
            />
          ) : (
            <Select
              value={accountCompanyId}
              onChange={(e) => setAccountCompanyId(e.target.value)}
            >
              <option value="">Şirket seç…</option>
              {visibleCompanies.map((c) => (
                <option key={c.accountCompanyId} value={c.accountCompanyId}>
                  {c.companyName ?? c.companyId}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Ürün Adı" required error={errors.productName}>
          <TextInput
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            placeholder="Örn. ERP — Finans Modülü"
            autoFocus
          />
        </Field>
        <Field label="Ürün Kodu" hint="Opsiyonel — şirket içinde benzersiz">
          <TextInput
            value={productCode}
            onChange={(e) => setProductCode(e.target.value)}
            placeholder="Örn. ERP-FIN-01"
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Başlangıç">
            <TextInput
              type="date"
              value={startedAt}
              onChange={(e) => setStartedAt(e.target.value)}
            />
          </Field>
          <Field label="Bitiş" error={errors.endedAt}>
            <TextInput
              type="date"
              value={endedAt}
              onChange={(e) => setEndedAt(e.target.value)}
            />
          </Field>
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-ndark-text">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-ndark-border dark:bg-ndark-surface"
          />
          <span>Aktif</span>
        </label>
      </form>
    </Modal>
  );
}
