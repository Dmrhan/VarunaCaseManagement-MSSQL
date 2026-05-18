import { useEffect, useState } from 'react';
import { Trash2, UserRound } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextInput } from '@/components/ui/Field';
import { notify } from '@/components/ui/Toast';
import {
  accountService,
  type AccountContact,
  type AccountContactMutationInput,
  type AccountDetail,
} from '@/services/accountService';

interface AccountContactEditorProps {
  open: boolean;
  mode: 'add' | 'edit';
  accountId: string;
  contact?: AccountContact | null;
  onClose: () => void;
  onSaved: (updated: AccountDetail | undefined) => void;
}

const CHANNEL_OPTIONS = [
  { value: '', label: 'Belirtilmemiş' },
  { value: 'email', label: 'E-posta' },
  { value: 'phone', label: 'Telefon' },
  { value: 'whatsapp', label: 'WhatsApp' },
];

/**
 * Müşteri kontak ekleme / düzenleme / pasifleştirme.
 *
 * - `isPrimary` aynı account'ta tekil — bu kayda primary verilirse backend
 *   diğer primary'leri otomatik düşürür.
 * - DELETE soft delete; backend `isActive=false` + `isPrimary=false` yapar.
 */
export function AccountContactEditor({
  open,
  mode,
  accountId,
  contact,
  onClose,
  onSaved,
}: AccountContactEditorProps) {
  const [fullName, setFullName] = useState('');
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [preferredChannel, setPreferredChannel] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (mode === 'edit' && contact) {
      setFullName(contact.fullName);
      setTitle(contact.title ?? '');
      setEmail(contact.email ?? '');
      setPhone(contact.phone ?? '');
      setPreferredChannel(contact.preferredChannel ?? '');
      setIsPrimary(contact.isPrimary);
      setIsActive(contact.isActive);
    } else {
      setFullName('');
      setTitle('');
      setEmail('');
      setPhone('');
      setPreferredChannel('');
      setIsPrimary(false);
      setIsActive(true);
    }
  }, [open, mode, contact]);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!fullName.trim()) errs.fullName = 'Ad Soyad zorunlu.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    let result: AccountDetail | undefined;

    const body: AccountContactMutationInput = {
      fullName: fullName.trim(),
      title: title.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      preferredChannel: preferredChannel || null,
      isPrimary,
      isActive,
    };

    if (mode === 'add') {
      result = await accountService.addContact(accountId, body);
      if (result) notify({ type: 'success', title: 'Kontak eklendi', message: '' });
    } else if (contact) {
      result = await accountService.updateContact(accountId, contact.id, body);
      if (result) notify({ type: 'success', title: 'Kontak güncellendi', message: '' });
    }
    setSubmitting(false);
    if (result) onSaved(result);
  }

  async function handleDeactivate() {
    if (!contact || mode !== 'edit') return;
    if (!window.confirm('Bu kontağı pasifleştirmek istediğine emin misin?')) return;
    setDeleting(true);
    const result = await accountService.removeContact(accountId, contact.id);
    setDeleting(false);
    if (result) {
      notify({ type: 'success', title: 'Kontak pasifleştirildi', message: '' });
      onSaved(result);
    }
  }

  const title_ = (
    <span className="inline-flex items-center gap-1.5">
      <UserRound size={14} />
      {mode === 'add' ? 'Yeni Kontak' : 'Kontağı Düzenle'}
    </span>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={title_}
      footer={
        <div className="flex items-center justify-between px-5 py-3">
          <div>
            {mode === 'edit' && contact?.isActive && (
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
            <Button type="submit" form="account-contact-form" disabled={submitting || deleting}>
              {submitting
                ? 'Kaydediliyor…'
                : mode === 'add'
                  ? 'Kontak Ekle'
                  : 'Değişiklikleri Kaydet'}
            </Button>
          </div>
        </div>
      }
    >
      <form id="account-contact-form" onSubmit={handleSubmit} className="space-y-4 p-5">
        <Field label="Ad Soyad" required error={errors.fullName}>
          <TextInput
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Örn. Ayşe Yılmaz"
            autoFocus
          />
        </Field>
        <Field label="Unvan">
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Karar Verici / Teknik Lider / vs."
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="E-posta">
            <TextInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="iletisim@firma.com"
            />
          </Field>
          <Field label="Telefon">
            <TextInput
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+90 212 555 00 00"
            />
          </Field>
        </div>

        <Field label="Tercih Edilen Kanal">
          <Select value={preferredChannel} onChange={(e) => setPreferredChannel(e.target.value)}>
            {CHANNEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex flex-col gap-2 rounded-md bg-slate-50 px-3 py-2 dark:bg-ndark-surface sm:flex-row sm:gap-6">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-ndark-text">
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-ndark-border dark:bg-ndark-surface"
            />
            <span>Birincil kontak</span>
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

        {mode === 'edit' && isPrimary && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            Bu kayda birincil verirsen aynı müşterideki diğer birincil kontaklar otomatik
            kaldırılacak.
          </p>
        )}
      </form>
    </Modal>
  );
}
