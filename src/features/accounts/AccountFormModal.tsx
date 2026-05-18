import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextInput } from '@/components/ui/Field';
import { useAuth } from '@/services/AuthContext';
import {
  accountService,
  type AccountCompanyCreateInput,
  type AccountDetail,
} from '@/services/accountService';
import { lookupService } from '@/services/caseService';
import { notify } from '@/components/ui/Toast';

interface AccountFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  account?: AccountDetail | null;
  onClose: () => void;
  /** kayıt sonrası — created/updated account. iptal/kapatma'da çağrılmaz. */
  onSaved: (account: AccountDetail | undefined) => void;
}

interface CompanyRow {
  companyId: string;
  externalCustomerCode: string;
  packageName: string;
  contractStartAt: string;
}

const FIVE_DIGIT_RX = /^\d{5}$/;

function emptyCompanyRow(): CompanyRow {
  return { companyId: '', externalCustomerCode: '', packageName: '', contractStartAt: '' };
}

/**
 * Yeni müşteri ekleme / mevcut müşteri düzenleme modal'ı.
 *
 * - mode='create': name + vkn + iletişim + en az 1 şirket ilişkisi
 * - mode='edit': sadece Account fieldları (Phase A endpoint kısıtı).
 *   Şirket ilişkilerinin düzenlenmesi Phase C kapsamı.
 */
export function AccountFormModal({
  open,
  mode,
  account,
  onClose,
  onSaved,
}: AccountFormModalProps) {
  const { user } = useAuth();
  const companies = useMemo(() => lookupService.companies(), []);

  const [name, setName] = useState('');
  const [vkn, setVkn] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [rows, setRows] = useState<CompanyRow[]>([emptyCompanyRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // open/account değiştiğinde formu reset et
  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (mode === 'edit' && account) {
      setName(account.name);
      // vknMasked plaintext değil — edit'te boş başla, kullanıcı değiştirmek istemezse göndermez.
      setVkn('');
      setPhone(account.phone ?? '');
      setEmail(account.email ?? '');
      setIsActive(account.isActive);
    } else {
      setName('');
      setVkn('');
      setPhone('');
      setEmail('');
      setIsActive(true);
      const defaultCompanyId = companies.length === 1 ? companies[0].id : '';
      setRows([{ ...emptyCompanyRow(), companyId: defaultCompanyId }]);
    }
  }, [open, mode, account, companies]);

  function updateRow(index: number, patch: Partial<CompanyRow>) {
    setRows((current) => current.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((current) => [...current, emptyCompanyRow()]);
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, i) => i !== index));
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Müşteri adı zorunlu.';

    if (mode === 'create') {
      if (rows.length === 0) {
        errs.companies = 'En az bir şirket ilişkisi zorunlu.';
      }
      rows.forEach((r, i) => {
        if (!r.companyId) errs[`row.${i}.companyId`] = 'Şirket seç.';
        if (r.externalCustomerCode && !FIVE_DIGIT_RX.test(r.externalCustomerCode.trim())) {
          errs[`row.${i}.externalCustomerCode`] = 'Müşteri dış kodu 5 hane olmalı.';
        }
      });
      // Aynı şirket iki kez seçilmiş mi
      const seen = new Set<string>();
      rows.forEach((r, i) => {
        if (!r.companyId) return;
        if (seen.has(r.companyId)) {
          errs[`row.${i}.companyId`] = 'Aynı şirket tekrar seçilmiş.';
        }
        seen.add(r.companyId);
      });
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);

    let saved: AccountDetail | undefined;
    if (mode === 'create') {
      const body = {
        name: name.trim(),
        vkn: vkn.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        companies: rows.map<AccountCompanyCreateInput>((r) => ({
          companyId: r.companyId,
          externalCustomerCode: r.externalCustomerCode.trim() || null,
          packageName: r.packageName.trim() || null,
          contractStartAt: r.contractStartAt || null,
        })),
      };
      saved = await accountService.create(body);
      if (saved) notify({ type: 'success', title: 'Müşteri eklendi', message: saved.name });
    } else if (account) {
      const body = {
        name: name.trim() !== account.name ? name.trim() : undefined,
        phone: phone.trim() !== (account.phone ?? '') ? phone.trim() || null : undefined,
        email: email.trim() !== (account.email ?? '') ? email.trim() || null : undefined,
        isActive: isActive !== account.isActive ? isActive : undefined,
        // VKN sadece kullanıcı dolu bıraktıysa gönderilir; boşsa mevcut kalır.
        vkn: vkn.trim() ? vkn.trim() : undefined,
      };
      saved = await accountService.update(account.id, body);
      if (saved) notify({ type: 'success', title: 'Müşteri güncellendi', message: saved.name });
    }

    setSubmitting(false);
    if (saved) onSaved(saved);
  }

  // SystemAdmin değilse sadece kendi şirketleri seçilebilir; lookupService zaten
  // user.allowedCompanyIds'iyle filtrelenmiş geliyor.
  const allowedCompanies = useMemo(
    () => (user?.role === 'SystemAdmin' ? companies : companies),
    [companies, user?.role],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={mode === 'create' ? 'Yeni Müşteri' : 'Müşteriyi Düzenle'}
      footer={
        <div className="flex justify-end gap-2 px-5 py-3">
          <Button variant="outline" type="button" onClick={onClose} disabled={submitting}>
            Vazgeç
          </Button>
          <Button
            type="submit"
            form="account-form"
            disabled={submitting}
            leftIcon={submitting ? undefined : <Plus size={14} />}
          >
            {submitting ? 'Kaydediliyor…' : mode === 'create' ? 'Müşteri Oluştur' : 'Değişiklikleri Kaydet'}
          </Button>
        </div>
      }
    >
      <form id="account-form" onSubmit={handleSubmit} className="space-y-4 p-5">
        <Field label="Müşteri Adı" required error={errors.name}>
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Örn. Acme A.Ş."
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="VKN"
            hint={mode === 'edit' ? 'Boş bırak → değişmez.' : 'Vergi numarası (opsiyonel)'}
          >
            <TextInput
              value={vkn}
              onChange={(e) => setVkn(e.target.value)}
              placeholder="1234567890"
              inputMode="numeric"
              autoComplete="off"
            />
          </Field>
          <Field label="Telefon">
            <TextInput
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+90 212 555 00 00"
              autoComplete="off"
            />
          </Field>
        </div>

        <Field label="E-posta">
          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="iletisim@firma.com"
            autoComplete="off"
          />
        </Field>

        {mode === 'edit' && (
          <Field label="Durum">
            <Select value={isActive ? 'active' : 'inactive'} onChange={(e) => setIsActive(e.target.value === 'active')}>
              <option value="active">Aktif</option>
              <option value="inactive">Pasif</option>
            </Select>
          </Field>
        )}

        {mode === 'create' && (
          <section className="rounded-lg border border-slate-200 p-3 dark:border-ndark-border">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-ndark-text">
                Şirket İlişkileri
              </h3>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                leftIcon={<Plus size={12} />}
                onClick={addRow}
              >
                Şirket Ekle
              </Button>
            </div>
            {errors.companies && (
              <p className="mb-2 text-[11px] text-rose-600 dark:text-rose-300">{errors.companies}</p>
            )}
            <ul className="space-y-3">
              {rows.map((row, i) => (
                <li
                  key={i}
                  className="rounded-md bg-slate-50 p-3 dark:bg-ndark-surface"
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field
                      label="Şirket"
                      required
                      error={errors[`row.${i}.companyId`]}
                    >
                      <Select
                        value={row.companyId}
                        onChange={(e) => updateRow(i, { companyId: e.target.value })}
                      >
                        <option value="">Şirket seç…</option>
                        {allowedCompanies.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field
                      label="Müşteri Dış Kodu"
                      hint="Opsiyonel dış sistem kodu (ERP/CRM/3. parti)"
                      error={errors[`row.${i}.externalCustomerCode`]}
                    >
                      <TextInput
                        value={row.externalCustomerCode}
                        onChange={(e) =>
                          updateRow(i, { externalCustomerCode: e.target.value })
                        }
                        placeholder="00000"
                        inputMode="numeric"
                        maxLength={5}
                      />
                    </Field>
                    <Field label="Paket">
                      <TextInput
                        value={row.packageName}
                        onChange={(e) => updateRow(i, { packageName: e.target.value })}
                        placeholder="Örn. Standart"
                      />
                    </Field>
                    <Field label="Sözleşme Başlangıç">
                      <TextInput
                        type="date"
                        value={row.contractStartAt}
                        onChange={(e) => updateRow(i, { contractStartAt: e.target.value })}
                      />
                    </Field>
                  </div>
                  {rows.length > 1 && (
                    <div className="mt-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        className="inline-flex items-center gap-1 text-[11px] text-rose-600 hover:text-rose-700 dark:text-rose-300 dark:hover:text-rose-200"
                      >
                        <Trash2 size={11} /> Bu şirketi kaldır
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {mode === 'edit' && (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-[11px] text-slate-700 dark:bg-ndark-surface dark:text-ndark-muted">
            Şirket ilişkileri, kontaklar ve ürünler müşteri detay sayfasındaki
            ilgili bölümlerden düzenlenir.
          </p>
        )}
      </form>
    </Modal>
  );
}
