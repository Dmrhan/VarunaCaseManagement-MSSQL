import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextInput } from '@/components/ui/Field';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { PHONE_TYPES, PHONE_TYPE_LABELS } from '@/utils/phone';
import { useAuth } from '@/services/AuthContext';
import {
  accountService,
  CUSTOMER_TYPES,
  CUSTOMER_TYPE_LABELS,
  type AccountCompanyCreateInput,
  type AccountDetail,
  type CustomerType,
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
  // Phase 3 — Account başına 3 telefon slot. State array; visibleSlotCount
  // ile 1/2/3 slot görünür. Slot 1 her zaman görünür; "+ Telefon ekle"
  // ile 2 ve 3 açılır. "Remove" slot 2/3'i temizler ve üst slot'a kaydırır.
  type Slot = { phone: string; type: string; extension: string };
  const emptySlot = (): Slot => ({ phone: '', type: '', extension: '' });
  const [slots, setSlots] = useState<Slot[]>([emptySlot(), emptySlot(), emptySlot()]);
  const [visibleSlotCount, setVisibleSlotCount] = useState<number>(1);
  const [primarySlot, setPrimarySlot] = useState<number>(1); // 1/2/3
  const [email, setEmail] = useState('');
  const [isActive, setIsActive] = useState(true);
  // WR-A1 — Müşteri tipi + (opsiyonel) kurumsal alanlar.
  const [customerType, setCustomerType] = useState<CustomerType>('Corporate');
  const [legalName, setLegalName] = useState('');
  const [registrationNo, setRegistrationNo] = useState('');
  // WR-A2 — TCKN: yalnız submit transient. Sadece state'te tutulur; submit
  // sonrası temizlenir. localStorage / sessionStorage / cache'e YAZILMAZ.
  const [tckn, setTckn] = useState('');
  const [vknValidationMsg, setVknValidationMsg] = useState<string | null>(null);
  const [tcknValidationMsg, setTcknValidationMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<CompanyRow[]>([emptyCompanyRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // open/account değiştiğinde formu reset et
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setVknValidationMsg(null);
    setTcknValidationMsg(null);
    setTckn(''); // WR-A2 — TCKN state'i her modal açılışında temizlenir
    if (mode === 'edit' && account) {
      setName(account.name);
      // vknMasked plaintext değil — edit'te boş başla, kullanıcı değiştirmek istemezse göndermez.
      setVkn('');
      // Phase 3 — 3 slot init.
      const initSlots: Slot[] = [
        { phone: account.phone ?? '', type: account.phoneType ?? '', extension: account.phoneExtension ?? '' },
        { phone: account.phone2 ?? '', type: account.phone2Type ?? '', extension: account.phone2Extension ?? '' },
        { phone: account.phone3 ?? '', type: account.phone3Type ?? '', extension: account.phone3Extension ?? '' },
      ];
      setSlots(initSlots);
      // visibleSlotCount = en yüksek dolu slot'tan max(1)
      let vis = 1;
      if (initSlots[2].phone) vis = 3;
      else if (initSlots[1].phone) vis = 2;
      setVisibleSlotCount(vis);
      // primary: backend null verdiyse first non-empty
      const primary = account.primaryPhoneSlot ?? null;
      if (primary === 1 || primary === 2 || primary === 3) {
        setPrimarySlot(primary);
      } else {
        const first = initSlots.findIndex((s) => s.phone);
        setPrimarySlot(first === -1 ? 1 : first + 1);
      }
      setEmail(account.email ?? '');
      setIsActive(account.isActive);
      setCustomerType(account.customerType ?? 'Corporate');
      setLegalName(account.legalName ?? '');
      setRegistrationNo(account.registrationNo ?? '');
    } else {
      setName('');
      setVkn('');
      setSlots([emptySlot(), emptySlot(), emptySlot()]);
      setVisibleSlotCount(1);
      setPrimarySlot(1);
      setEmail('');
      setIsActive(true);
      setCustomerType('Corporate');
      setLegalName('');
      setRegistrationNo('');
      const defaultCompanyId = companies.length === 1 ? companies[0].id : '';
      setRows([{ ...emptyCompanyRow(), companyId: defaultCompanyId }]);
    }
  }, [open, mode, account, companies]);

  const isIndividual = customerType === 'Individual';

  // WR-A2 — VKN inline validate (debounce 350ms).
  useEffect(() => {
    if (!vkn || vkn.trim().length < 10) {
      setVknValidationMsg(null);
      return;
    }
    const timer = setTimeout(async () => {
      const r = await import('@/services/accountService').then((m) =>
        m.validateVknRemote(vkn.trim()),
      );
      if (r && !r.valid) setVknValidationMsg(r.reason);
      else setVknValidationMsg(null);
    }, 350);
    return () => clearTimeout(timer);
  }, [vkn]);

  // WR-A2 — TCKN inline validate (debounce 350ms). Sadece Individual'da.
  useEffect(() => {
    if (!isIndividual || !tckn || tckn.trim().length < 11) {
      setTcknValidationMsg(null);
      return;
    }
    const timer = setTimeout(async () => {
      const r = await import('@/services/accountService').then((m) =>
        m.validateTcknRemote(tckn.trim()),
      );
      if (r && !r.valid) setTcknValidationMsg(r.reason);
      else setTcknValidationMsg(null);
    }, 350);
    return () => clearTimeout(timer);
  }, [tckn, isIndividual]);

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

    // Phase 3 — slot snapshot (visible olanları gönder; hidden slot'ları null'a düşür).
    const visibleSlots: Slot[] = slots.map((s, i) =>
      i < visibleSlotCount ? s : emptySlot(),
    );
    // Cross-slot duplicate E.164 önlemi: backend de doğrular; UI'da
    // hızlı geri bildirim verelim.
    const e164s = visibleSlots.map((s) => s.phone.trim()).filter(Boolean);
    if (new Set(e164s).size !== e164s.length) {
      setErrors({ phones: 'Aynı telefon numarası birden fazla slotta yer alıyor.' });
      setSubmitting(false);
      return;
    }
    // Effective primary: visible iken UI'da seçili; aksi halde first non-empty.
    let effPrimary = primarySlot;
    if (effPrimary > visibleSlotCount || !visibleSlots[effPrimary - 1].phone) {
      const firstFilled = visibleSlots.findIndex((s) => s.phone);
      effPrimary = firstFilled === -1 ? 1 : firstFilled + 1;
    }

    let saved: AccountDetail | undefined;
    if (mode === 'create') {
      const body = {
        name: name.trim(),
        // WR-A1: Bireysel'de VKN gönderilmez; helper text TCKN A2'ye işaret ediyor.
        vkn: isIndividual ? null : vkn.trim() || null,
        // Phase 3 — slot 1/2/3
        phone: visibleSlots[0].phone.trim() || null,
        phoneType: visibleSlots[0].phone.trim() ? visibleSlots[0].type || null : null,
        phoneExtension: visibleSlots[0].phone.trim() ? visibleSlots[0].extension.trim() || null : null,
        phone2: visibleSlots[1].phone.trim() || null,
        phone2Type: visibleSlots[1].phone.trim() ? visibleSlots[1].type || null : null,
        phone2Extension: visibleSlots[1].phone.trim() ? visibleSlots[1].extension.trim() || null : null,
        phone3: visibleSlots[2].phone.trim() || null,
        phone3Type: visibleSlots[2].phone.trim() ? visibleSlots[2].type || null : null,
        phone3Extension: visibleSlots[2].phone.trim() ? visibleSlots[2].extension.trim() || null : null,
        primaryPhoneSlot: e164s.length > 0 ? effPrimary : null,
        email: email.trim() || null,
        customerType,
        legalName: isIndividual ? null : legalName.trim() || null,
        registrationNo: isIndividual ? null : registrationNo.trim() || null,
        // WR-A2 — Plain TCKN sadece submit transient; backend hash + last4'e çevirir.
        tckn: isIndividual && tckn.trim() ? tckn.trim() : undefined,
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
      // Phase 3 — update body. Her slot ayrı pair olarak gönderilir;
      // slot fields'ı her zaman gönder (backend atomic pair semantik).
      const body = {
        name: name.trim() !== account.name ? name.trim() : undefined,
        phone: visibleSlots[0].phone.trim() || null,
        phoneType: visibleSlots[0].phone.trim() ? visibleSlots[0].type || null : null,
        phoneExtension: visibleSlots[0].phone.trim() ? visibleSlots[0].extension.trim() || null : null,
        phone2: visibleSlots[1].phone.trim() || null,
        phone2Type: visibleSlots[1].phone.trim() ? visibleSlots[1].type || null : null,
        phone2Extension: visibleSlots[1].phone.trim() ? visibleSlots[1].extension.trim() || null : null,
        phone3: visibleSlots[2].phone.trim() || null,
        phone3Type: visibleSlots[2].phone.trim() ? visibleSlots[2].type || null : null,
        phone3Extension: visibleSlots[2].phone.trim() ? visibleSlots[2].extension.trim() || null : null,
        primaryPhoneSlot: e164s.length > 0 ? effPrimary : null,
        email: email.trim() !== (account.email ?? '') ? email.trim() || null : undefined,
        isActive: isActive !== account.isActive ? isActive : undefined,
        // VKN sadece kullanıcı dolu bıraktıysa gönderilir; boşsa mevcut kalır.
        // WR-A1: Bireysel seçiliyse VKN gönderilmez (alan disabled).
        vkn: isIndividual ? undefined : vkn.trim() ? vkn.trim() : undefined,
        customerType: customerType !== account.customerType ? customerType : undefined,
        legalName:
          legalName.trim() !== (account.legalName ?? '')
            ? isIndividual
              ? null
              : legalName.trim() || null
            : undefined,
        registrationNo:
          registrationNo.trim() !== (account.registrationNo ?? '')
            ? isIndividual
              ? null
              : registrationNo.trim() || null
            : undefined,
        // WR-A2 — TCKN edit: yalnızca Individual + dolu input gönderilir.
        // Boş gönderme = "değişme" (clear için ayrıca null gönderme).
        tckn: isIndividual && tckn.trim() ? tckn.trim() : undefined,
      };
      saved = await accountService.update(account.id, body);
      if (saved) notify({ type: 'success', title: 'Müşteri güncellendi', message: saved.name });
    }

    // WR-A2 — Submit sonrası plain TCKN state'ten temizlenir (transient guarantee).
    setTckn('');
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

        {/* WR-A1 — Müşteri tipi segmented control. Bireysel'de VKN disabled olur. */}
        <Field label="Müşteri Tipi" required>
          <div
            role="radiogroup"
            aria-label="Müşteri tipi"
            className="inline-flex flex-wrap rounded-md border border-slate-200 bg-slate-50 p-0.5 text-xs dark:border-ndark-border dark:bg-ndark-surface"
          >
            {CUSTOMER_TYPES.map((opt) => {
              const active = customerType === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setCustomerType(opt)}
                  className={
                    'rounded px-3 py-1.5 transition-colors ' +
                    (active
                      ? 'bg-white font-semibold text-slate-900 shadow-sm dark:bg-ndark-bg dark:text-ndark-text'
                      : 'text-slate-600 hover:text-slate-900 dark:text-ndark-muted dark:hover:text-ndark-text')
                  }
                >
                  {CUSTOMER_TYPE_LABELS[opt]}
                </button>
              );
            })}
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="VKN"
            hint={
              isIndividual
                ? 'TCKN aşağıda — bu alan kurumsal müşteri için.'
                : mode === 'edit'
                  ? 'Boş bırak → değişmez.'
                  : 'Vergi numarası — 10 hane, otomatik doğrulanır'
            }
            error={vknValidationMsg ?? undefined}
          >
            <TextInput
              value={isIndividual ? '' : vkn}
              onChange={(e) => setVkn(e.target.value)}
              placeholder={isIndividual ? '—' : '1234567890'}
              inputMode="numeric"
              autoComplete="off"
              disabled={isIndividual}
              maxLength={10}
            />
          </Field>
        </div>

        {/* Phase 3 — Telefonlar: en fazla 3 slot, dinamik göster/gizle. */}
        <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3 dark:border-ndark-border dark:bg-ndark-card">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-ndark-muted">
              Telefonlar
            </h3>
            {errors.phones && (
              <span className="text-xs text-rose-600 dark:text-rose-400">{errors.phones}</span>
            )}
          </div>
          {slots.slice(0, visibleSlotCount).map((slot, idx) => {
            const slotNo = idx + 1;
            const slotLabel = slotNo === 1 ? 'Ana telefon' : `Telefon ${slotNo}`;
            return (
              <div
                key={idx}
                className="rounded-md border border-slate-100 bg-slate-50 p-2 dark:border-ndark-border/60 dark:bg-ndark-surface/40"
              >
                <div className="mb-1 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="primaryPhone"
                      checked={primarySlot === slotNo}
                      onChange={() => setPrimarySlot(slotNo)}
                      disabled={!slot.phone}
                      title="Birincil telefon olarak işaretle"
                      className="h-3.5 w-3.5 cursor-pointer text-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`${slotLabel} birincil`}
                    />
                    <span className="text-xs font-medium text-slate-700 dark:text-ndark-text">
                      {slotLabel}
                    </span>
                    {primarySlot === slotNo && slot.phone && (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                        Birincil
                      </span>
                    )}
                  </div>
                  {slotNo > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        // Slot'u sil + alt slotları yukarı kaydır.
                        const next = [...slots];
                        for (let i = idx; i < 2; i++) next[i] = next[i + 1];
                        next[2] = emptySlot();
                        setSlots(next);
                        setVisibleSlotCount((v) => Math.max(1, v - 1));
                        // Primary kayma: silinen slot primary idi veya altındakiler kaydıysa
                        if (primarySlot === slotNo) {
                          // ilk dolu slotu birincil yap
                          const first = next.findIndex((s) => s.phone);
                          setPrimarySlot(first === -1 ? 1 : first + 1);
                        } else if (primarySlot > slotNo) {
                          setPrimarySlot(primarySlot - 1);
                        }
                      }}
                      className="flex items-center gap-1 rounded p-1 text-xs text-slate-500 hover:bg-rose-50 hover:text-rose-700 dark:text-ndark-muted dark:hover:bg-rose-900/20 dark:hover:text-rose-300"
                      title={`${slotLabel} sil`}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  <PhoneInput
                    value={slot.phone || null}
                    onChange={(e164) => {
                      const next = [...slots];
                      next[idx] = { ...next[idx], phone: e164 ?? '' };
                      setSlots(next);
                      // Phone temizlendiyse ve birincil bu slot ise → first non-empty
                      if (!e164 && primarySlot === slotNo) {
                        const first = next.findIndex((s) => s.phone);
                        setPrimarySlot(first === -1 ? 1 : first + 1);
                      } else if (e164 && primarySlot !== slotNo) {
                        // Yeni slot ilk dolu slot ise birincil yap
                        const firstFilled = next.findIndex((s) => s.phone);
                        if (firstFilled === idx) setPrimarySlot(slotNo);
                      }
                    }}
                  />
                  {slot.phone && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Select
                        value={slot.type}
                        onChange={(e) => {
                          const next = [...slots];
                          next[idx] = { ...next[idx], type: e.target.value };
                          setSlots(next);
                        }}
                      >
                        <option value="">— tip seç —</option>
                        {PHONE_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {PHONE_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </Select>
                      <TextInput
                        value={slot.extension}
                        onChange={(e) => {
                          const next = [...slots];
                          next[idx] = { ...next[idx], extension: e.target.value };
                          setSlots(next);
                        }}
                        placeholder="Dahili (opsiyonel)"
                        inputMode="numeric"
                        maxLength={10}
                        autoComplete="off"
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {visibleSlotCount < 3 && (
            <button
              type="button"
              onClick={() => setVisibleSlotCount((v) => v + 1)}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-ndark-border dark:text-ndark-muted dark:hover:bg-ndark-surface"
            >
              <Plus size={12} /> Telefon ekle
            </button>
          )}
        </div>

        {/* WR-A1 — Kurumsal/Kamu/Vakıf-STK için opsiyonel ticari unvan + sicil no. */}
        {!isIndividual && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Ticari Unvan" hint="Resmi tam unvan (opsiyonel)">
              <TextInput
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="Örn. Acme Anonim Şirketi"
                autoComplete="off"
              />
            </Field>
            <Field label="Sicil No" hint="Ticaret sicil no veya muadili (opsiyonel)">
              <TextInput
                value={registrationNo}
                onChange={(e) => setRegistrationNo(e.target.value)}
                placeholder="Örn. 123456"
                autoComplete="off"
              />
            </Field>
          </div>
        )}

        {/* WR-A2 — TCKN: yalnızca Individual. Plain TCKN sadece submit transient;
            backend HMAC + last4 olarak saklar; localStorage/cache'e yazılmaz. */}
        {isIndividual && (
          <Field
            label="TCKN"
            hint={
              mode === 'edit' && account?.tcknMasked
                ? `Mevcut: ${account.tcknMasked} — değiştirmek için yeni TCKN yaz; boş bırak → değişmez`
                : 'TCKN güvenli şekilde hashlenir, ham değer saklanmaz.'
            }
            error={tcknValidationMsg ?? undefined}
          >
            <TextInput
              value={tckn}
              onChange={(e) => setTckn(e.target.value)}
              placeholder="11 haneli TCKN"
              inputMode="numeric"
              autoComplete="off"
              maxLength={11}
            />
          </Field>
        )}

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
