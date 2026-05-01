import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Power, PowerOff, Sliders, Trash2 } from 'lucide-react';
import { CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { adminService, type FieldDefinition, type FieldDefinitionInput, type FieldType } from '@/services/adminService';
import { lookupService } from '@/services/caseService';
import { AdminListLayout } from './AdminListLayout';
import { FIELDS_HELP } from './helpContents';

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'Text',     label: 'Metin (kısa)' },
  { value: 'Textarea', label: 'Metin (uzun)' },
  { value: 'Number',   label: 'Sayı' },
  { value: 'Date',     label: 'Tarih' },
  { value: 'Select',   label: 'Seçim listesi' },
  { value: 'Boolean',  label: 'Evet/Hayır' },
];

const CASE_TYPES: { value: string; label: string }[] = [
  { value: '',                  label: 'Tüm vaka tipleri' },
  { value: 'GeneralSupport',    label: 'Genel Destek' },
  { value: 'ProactiveTracking', label: 'Proaktif Takip' },
  { value: 'Churn',             label: 'Churn' },
];

export function AdminFieldsPage() {
  const [items, setItems] = useState<FieldDefinition[]>([]);
  const [filterCompany, setFilterCompany] = useState<string>('');
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null);
  const { toast } = useToast();
  const companies = useMemo(() => lookupService.companies(), []);

  async function refresh() {
    setItems(await adminService.fieldDefinitions.list(filterCompany || undefined));
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterCompany]);

  async function handleToggleActive(item: FieldDefinition) {
    const r = await adminService.fieldDefinitions.setActive(item.id, !item.isActive);
    if (r.ok) {
      await refresh();
      toast({
        type: 'success',
        message: r.item.isActive ? `"${r.item.label}" aktif edildi.` : `"${r.item.label}" pasif edildi.`,
        duration: 2000,
      });
    } else toast({ type: 'error', message: r.error });
  }

  async function handleDelete(item: FieldDefinition) {
    if (!window.confirm(`"${item.label}" dinamik alan pasifleştirilsin mi? (Kullanılmış kayıtlardaki veri korunur.)`)) return;
    const r = await adminService.fieldDefinitions.remove(item.id);
    if (r.ok) {
      await refresh();
      toast({ type: 'warn', message: `"${item.label}" pasifleştirildi.`, duration: 2500 });
    } else toast({ type: 'error', message: r.error });
  }

  return (
    <>
      <AdminListLayout
        title="Dinamik Alanlar"
        description="Şirket bazında vakalara eklenecek özel alanları tanımla. Vaka açma formunda ve detayında otomatik görünür."
        count={items.length}
        searchPlaceholder=""
        searchValue=""
        onSearchChange={() => {}}
        onAdd={() => setEditor({ mode: 'create' })}
        addLabel="Yeni Alan"
        helpTitle={FIELDS_HELP.title}
        helpSections={FIELDS_HELP.sections}
      >
        <div className="border-b border-slate-200 px-4 py-2 dark:border-ndark-border">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500">Şirket:</span>
            <select
              value={filterCompany}
              onChange={(e) => setFilterCompany(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-ndark-border dark:bg-ndark-bg"
            >
              <option value="">Tümü</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {items.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<Sliders size={22} />}
              title="Henüz alan tanımı yok"
              description="Şirkete özel custom alan ekleyerek başla."
              action={
                <Button size="sm" leftIcon={<Plus size={12} />} onClick={() => setEditor({ mode: 'create' })}>
                  Yeni Alan
                </Button>
              }
            />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Etiket</th>
                  <th className="px-4 py-2.5">Field Key</th>
                  <th className="px-4 py-2.5">Tip</th>
                  <th className="px-4 py-2.5">Vaka Tipi</th>
                  <th className="px-4 py-2.5">Şirket</th>
                  <th className="px-4 py-2.5">Zorunlu</th>
                  <th className="px-4 py-2.5">Sıra</th>
                  <th className="px-4 py-2.5">Durum</th>
                  <th className="px-4 py-2.5 text-right">Aksiyon</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {items.map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{it.label}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{it.fieldKey}</td>
                    <td className="px-4 py-2.5"><Badge tint="slate">{it.fieldType}</Badge></td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">{it.caseType ?? 'Tümü'}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {companies.find((c) => c.id === it.companyId)?.name ?? it.companyId}
                    </td>
                    <td className="px-4 py-2.5">
                      {it.isRequired ? <Badge tint="rose">Evet</Badge> : <span className="text-xs text-slate-400">Hayır</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{it.displayOrder}</td>
                    <td className="px-4 py-2.5">
                      {it.isActive ? <Badge tint="emerald">Aktif</Badge> : <Badge tint="slate">Pasif</Badge>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setEditor({ mode: 'edit', id: it.id })}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                          title="Düzenle"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggleActive(it)}
                          className={`rounded p-1.5 hover:bg-slate-100 ${
                            it.isActive ? 'text-amber-600' : 'text-emerald-600'
                          }`}
                          title={it.isActive ? 'Pasifleştir' : 'Aktifleştir'}
                        >
                          {it.isActive ? <PowerOff size={14} /> : <Power size={14} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(it)}
                          className="rounded p-1.5 text-rose-500 hover:bg-rose-50"
                          title="Sil"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminListLayout>

      <FieldEditModal
        open={editor !== null}
        mode={editor?.mode ?? 'create'}
        editingId={editor?.mode === 'edit' ? editor.id : null}
        defaultCompanyId={filterCompany || companies[0]?.id || ''}
        onClose={() => setEditor(null)}
        onSaved={() => void refresh()}
      />
    </>
  );
}

function FieldEditModal({
  open,
  mode,
  editingId,
  defaultCompanyId,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  editingId: string | null;
  defaultCompanyId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const companies = useMemo(() => lookupService.companies(), []);
  const [form, setForm] = useState<FieldDefinitionInput>({
    companyId: defaultCompanyId,
    label: '',
    fieldKey: '',
    fieldType: 'Text',
    caseType: null,
    isRequired: false,
    displayOrder: 0,
    options: null,
    isActive: true,
  });
  const [optionsText, setOptionsText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === 'edit' && editingId) {
      void (async () => {
        const list = await adminService.fieldDefinitions.list();
        const item = list.find((f) => f.id === editingId);
        if (item) {
          setForm({
            companyId: item.companyId,
            label: item.label,
            fieldKey: item.fieldKey,
            fieldType: item.fieldType,
            caseType: item.caseType,
            isRequired: item.isRequired,
            displayOrder: item.displayOrder,
            options: item.options,
            isActive: item.isActive,
          });
          if (item.options) {
            setOptionsText(item.options.map((o) => `${o.value}|${o.label}`).join('\n'));
          }
        }
      })();
    } else {
      setForm({
        companyId: defaultCompanyId,
        label: '',
        fieldKey: '',
        fieldType: 'Text',
        caseType: null,
        isRequired: false,
        displayOrder: 0,
        options: null,
        isActive: true,
      });
      setOptionsText('');
    }
  }, [open, mode, editingId, defaultCompanyId]);

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    let options: { value: string; label: string }[] | null = null;
    if (form.fieldType === 'Select') {
      options = optionsText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [value, label] = line.split('|').map((s) => s.trim());
          return { value, label: label ?? value };
        });
      if (options.length === 0) {
        setSubmitting(false);
        setError('Seçim listesi için en az bir seçenek gerekli (her satır: değer|etiket).');
        return;
      }
    }
    const payload: FieldDefinitionInput = { ...form, options };
    const r = mode === 'create'
      ? await adminService.fieldDefinitions.create(payload)
      : editingId
        ? await adminService.fieldDefinitions.update(editingId, payload)
        : null;
    setSubmitting(false);
    if (!r) return;
    if (!r.ok) { setError(r.error); return; }
    onSaved();
    onClose();
    toast({ type: 'success', message: mode === 'create' ? 'Alan oluşturuldu.' : 'Alan güncellendi.' });
  }

  const canSubmit = form.label.trim() && form.fieldKey.trim() && form.companyId && !submitting;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={mode === 'create' ? 'Yeni Dinamik Alan' : 'Dinamik Alanı Düzenle'}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>Vazgeç</Button>
          <Button onClick={handleSave} disabled={!canSubmit}>{submitting ? 'Kaydediliyor…' : 'Kaydet'}</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Şirket" required>
          <Select
            value={form.companyId}
            onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}
            disabled={mode === 'edit'}
          >
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Etiket" required hint="Forma yansıyan görünür ad (örn. 'Müşteri Segmenti')">
          <TextInput
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          />
        </Field>
        <Field label="Field Key" required hint="DB'ye yazılır, değiştirilirse mevcut kayıtlar görünmez. Örn. 'customer_segment'">
          <TextInput
            value={form.fieldKey}
            onChange={(e) => setForm((f) => ({ ...f, fieldKey: e.target.value.toLowerCase().replace(/\s+/g, '_') }))}
          />
        </Field>
        <Field label="Tip" required>
          <Select
            value={form.fieldType}
            onChange={(e) => setForm((f) => ({ ...f, fieldType: e.target.value as FieldType }))}
          >
            {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        {form.fieldType === 'Select' && (
          <Field label="Seçenekler" hint="Her satıra: değer|etiket (örn. 'kobi|KOBİ')">
            <TextArea
              rows={4}
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              placeholder={'kobi|KOBİ\nkurumsal|Kurumsal\nbireysel|Bireysel'}
            />
          </Field>
        )}
        <Field label="Vaka Tipi">
          <Select
            value={form.caseType ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, caseType: e.target.value || null }))}
          >
            {CASE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sıra" hint="Küçükten büyüğe">
            <TextInput
              type="number"
              value={String(form.displayOrder ?? 0)}
              onChange={(e) => setForm((f) => ({ ...f, displayOrder: Number(e.target.value) }))}
            />
          </Field>
          <Field label="Zorunlu mu?">
            <Select
              value={form.isRequired ? '1' : '0'}
              onChange={(e) => setForm((f) => ({ ...f, isRequired: e.target.value === '1' }))}
            >
              <option value="0">Hayır</option>
              <option value="1">Evet</option>
            </Select>
          </Field>
        </div>
        {error && (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>
        )}
      </div>
    </Modal>
  );
}
