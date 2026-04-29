import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { caseService, lookupService, type NewCaseInput } from '@/services/caseService';
import {
  CASE_ORIGINS,
  CASE_PRIORITIES,
  CASE_TYPES,
  CASE_TYPE_LABELS,
  type Case,
  type CaseOrigin,
  type CasePriority,
  type CaseType,
} from './types';

interface NewCaseFormProps {
  open: boolean;
  onClose: () => void;
  onCreated: (c: Case) => void;
}

const emptyForm = {
  title: '',
  description: '',
  caseType: 'GeneralSupport' as CaseType,
  priority: 'Orta' as CasePriority,
  origin: 'Telefon' as CaseOrigin,
  originDescription: '',
  accountId: '',
  category: '',
  subCategory: '',
  requestType: '',
  productGroup: '',
  assignedTeamId: '',
  assignedPersonId: '',
};

export function NewCaseForm({ open, onClose, onCreated }: NewCaseFormProps) {
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicateWarning, setDuplicateWarning] = useState(false);

  const accounts = useMemo(() => lookupService.accounts(), []);
  const categories = useMemo(() => lookupService.categories(), []);
  const teams = useMemo(() => lookupService.teams(), []);
  const requestTypes = useMemo(() => lookupService.requestTypes(), []);

  const subCategories = useMemo(
    () => categories.find((c) => c.category === form.category)?.subCategories ?? [],
    [categories, form.category],
  );
  const personsForTeam = useMemo(
    () => (form.assignedTeamId ? lookupService.personsByTeam(form.assignedTeamId) : []),
    [form.assignedTeamId],
  );

  useEffect(() => {
    if (!open) {
      setForm(emptyForm);
      setErrors({});
      setDuplicateWarning(false);
    }
  }, [open]);

  // Reset subCategory if category changes invalidates it
  useEffect(() => {
    if (form.subCategory && !subCategories.includes(form.subCategory)) {
      setForm((f) => ({ ...f, subCategory: '' }));
    }
  }, [subCategories, form.subCategory]);

  // Reset person if team changes
  useEffect(() => {
    if (form.assignedPersonId && !personsForTeam.find((p) => p.id === form.assignedPersonId)) {
      setForm((f) => ({ ...f, assignedPersonId: '' }));
    }
  }, [personsForTeam, form.assignedPersonId]);

  // Duplicate check (debounced via simple effect)
  useEffect(() => {
    let alive = true;
    if (!form.accountId || !form.caseType) {
      setDuplicateWarning(false);
      return;
    }
    void caseService.hasOpenCaseFor(form.accountId, form.caseType).then((exists) => {
      if (alive) setDuplicateWarning(exists);
    });
    return () => {
      alive = false;
    };
  }, [form.accountId, form.caseType]);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.title.trim()) e.title = 'Başlık zorunlu';
    if (!form.description.trim()) e.description = 'Açıklama zorunlu';
    if (!form.accountId) e.accountId = 'Müşteri seçilmeli';
    if (!form.category) e.category = 'Kategori seçilmeli';
    if (!form.subCategory) e.subCategory = 'Alt kategori seçilmeli';
    if (!form.requestType) e.requestType = 'Talep türü seçilmeli';
    if (form.origin === 'Diğer' && !form.originDescription.trim())
      e.originDescription = 'Origin "Diğer" seçildiğinde açıklama zorunlu';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    setSubmitting(true);
    const account = accounts.find((a) => a.id === form.accountId)!;
    const team = teams.find((t) => t.id === form.assignedTeamId);
    const person = personsForTeam.find((p) => p.id === form.assignedPersonId);

    const input: NewCaseInput = {
      title: form.title.trim(),
      description: form.description.trim(),
      caseType: form.caseType,
      priority: form.priority,
      origin: form.origin,
      originDescription: form.origin === 'Diğer' ? form.originDescription.trim() : undefined,
      accountId: account.id,
      accountName: account.name,
      category: form.category,
      subCategory: form.subCategory,
      requestType: form.requestType,
      productGroup: form.productGroup || undefined,
      assignedTeamId: team?.id,
      assignedTeamName: team?.name,
      assignedPersonId: person?.id,
      assignedPersonName: person?.name,
    };
    const created = await caseService.create(input);
    setSubmitting(false);
    onCreated(created);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={
        <div className="flex items-center gap-2">
          <span>Yeni Vaka</span>
          <Badge tint="slate">FAZ 0 — Mock</Badge>
        </div>
      }
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">
            Vaka oluşturulduğunda statü <strong>Açık</strong> olarak başlar.
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Vazgeç
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Oluşturuluyor…' : 'Vakayı Oluştur'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {duplicateWarning && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <span>
              Seçili müşteri için aynı tipte <strong>açık bir vaka</strong> bulunuyor. Yeni vaka açmadan önce
              mevcut vakayı kontrol etmeniz önerilir.
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Vaka Başlığı" required error={errors.title}>
            <TextInput
              placeholder="Kısa, özetleyici bir başlık"
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
            />
          </Field>
          <Field label="Vaka Tipi" required>
            <Select value={form.caseType} onChange={(e) => update('caseType', e.target.value as CaseType)}>
              {CASE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CASE_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Müşteri" required error={errors.accountId}>
            <Select value={form.accountId} onChange={(e) => update('accountId', e.target.value)}>
              <option value="">Müşteri seçin…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Öncelik" required>
            <Select value={form.priority} onChange={(e) => update('priority', e.target.value as CasePriority)}>
              {CASE_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Origin (Kanal)" required>
            <Select value={form.origin} onChange={(e) => update('origin', e.target.value as CaseOrigin)}>
              {CASE_ORIGINS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Origin Açıklama"
            required={form.origin === 'Diğer'}
            error={errors.originDescription}
            hint={form.origin === 'Diğer' ? 'Origin "Diğer" seçildiğinde zorunludur.' : undefined}
          >
            <TextInput
              placeholder={form.origin === 'Diğer' ? 'Kanalı kısaca açıklayın' : 'Opsiyonel'}
              value={form.originDescription}
              onChange={(e) => update('originDescription', e.target.value)}
              disabled={form.origin !== 'Diğer'}
            />
          </Field>

          <Field label="Kategori" required error={errors.category}>
            <Select value={form.category} onChange={(e) => update('category', e.target.value)}>
              <option value="">Seçin…</option>
              {categories.map((c) => (
                <option key={c.category} value={c.category}>
                  {c.category}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Alt Kategori" required error={errors.subCategory}>
            <Select
              value={form.subCategory}
              onChange={(e) => update('subCategory', e.target.value)}
              disabled={!form.category}
            >
              <option value="">Seçin…</option>
              {subCategories.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Talep Türü" required error={errors.requestType}>
            <Select value={form.requestType} onChange={(e) => update('requestType', e.target.value)}>
              <option value="">Seçin…</option>
              {requestTypes.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Ürün Grubu" hint="SLA hesaplamasında kullanılır (opsiyonel — FAZ 0)">
            <TextInput
              placeholder="ör. ERP - Kasa"
              value={form.productGroup}
              onChange={(e) => update('productGroup', e.target.value)}
            />
          </Field>

          <Field label="Atanan Takım">
            <Select value={form.assignedTeamId} onChange={(e) => update('assignedTeamId', e.target.value)}>
              <option value="">Atanmadı</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Atanan Kişi"
            hint={form.assignedTeamId ? 'Sadece seçili takımın üyeleri listelenir.' : 'Önce takım seçin.'}
          >
            <Select
              value={form.assignedPersonId}
              onChange={(e) => update('assignedPersonId', e.target.value)}
              disabled={!form.assignedTeamId}
            >
              <option value="">Atanmadı</option>
              {personsForTeam.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Açıklama" required error={errors.description}>
          <TextArea
            placeholder="Sorun veya talebin detayını yazın…"
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            rows={5}
          />
        </Field>
      </div>
    </Modal>
  );
}
