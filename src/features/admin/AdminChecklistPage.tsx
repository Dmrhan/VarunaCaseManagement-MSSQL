import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ClipboardCheck,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Trash2,
} from 'lucide-react';
import { CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import {
  adminService,
  type ChecklistItemInput,
  type ChecklistTemplateInput,
} from '@/services/adminService';
import { lookupService } from '@/services/caseService';
import type {
  CaseCategoryDef,
  CaseChecklistItem,
  CaseChecklistTemplate,
  CaseCompany,
} from '@/features/cases/types';
import { AdminListLayout } from './AdminListLayout';
import { CHECKLIST_HELP } from './helpContents';

export function AdminChecklistPage() {
  const [items, setItems] = useState<CaseChecklistTemplate[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tplEditor, setTplEditor] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null);
  const [itemEditor, setItemEditor] = useState<
    | { mode: 'create'; templateId: string }
    | { mode: 'edit'; templateId: string; itemId: string }
    | null
  >(null);
  const { toast } = useToast();

  function refresh() {
    setItems(adminService.checklists.list());
  }
  useEffect(refresh, []);

  // İlk yüklemede ilk template'i seç
  useEffect(() => {
    if (selectedId == null && items.length > 0) {
      setSelectedId(items[0].id);
    }
    if (selectedId != null && !items.find((t) => t.id === selectedId)) {
      setSelectedId(items[0]?.id ?? null);
    }
  }, [items, selectedId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((t) =>
      [t.name, t.companyName, t.productGroup, t.categoryName, t.description ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [items, search]);

  const selected = useMemo(
    () => items.find((t) => t.id === selectedId) ?? null,
    [items, selectedId],
  );

  function handleToggleTplActive(t: CaseChecklistTemplate) {
    const r = adminService.checklists.setActive(t.id, !t.isActive);
    if (r.ok) {
      refresh();
      toast({
        type: 'success',
        message: r.item.isActive ? `"${r.item.name}" aktif edildi.` : `"${r.item.name}" pasif edildi.`,
        duration: 2000,
      });
    } else {
      toast({ type: 'error', message: r.error });
    }
  }

  function handleDeleteTemplate(t: CaseChecklistTemplate) {
    const usage = adminService.checklists.usage(t.id);
    const tuple = `${t.companyName} / ${t.productGroup} / ${t.categoryName}`;
    const msg =
      usage.totalCases > 0
        ? `"${t.name}" şablonu (${tuple}) ${usage.totalCases} vakaya eşleşiyor. Silinince yeni vakalarda checklist yüklenmez. Devam edilsin mi?`
        : `"${t.name}" şablonu silinsin mi?`;
    if (!window.confirm(msg)) return;
    const r = adminService.checklists.remove(t.id);
    if (r.ok) {
      refresh();
      toast({ type: 'warn', message: `"${t.name}" silindi.`, duration: 2500 });
    } else {
      toast({ type: 'error', message: r.error });
    }
  }

  function handleToggleItemActive(templateId: string, item: CaseChecklistItem) {
    const r = adminService.checklists.setItemActive(templateId, item.id, !item.isActive);
    if (r.ok) {
      refresh();
      toast({
        type: 'success',
        message: r.item.isActive ? 'Madde aktif edildi.' : 'Madde pasif edildi.',
        duration: 1800,
      });
    } else {
      toast({ type: 'error', message: r.error });
    }
  }

  function handleDeleteItem(templateId: string, item: CaseChecklistItem) {
    if (!window.confirm(`"${item.label}" silinsin mi?`)) return;
    const r = adminService.checklists.removeItem(templateId, item.id);
    if (r.ok) {
      refresh();
      toast({ type: 'warn', message: 'Madde silindi.', duration: 1800 });
    } else {
      toast({ type: 'error', message: r.error });
    }
  }

  function handleMoveItem(templateId: string, itemId: string, direction: -1 | 1) {
    const r = adminService.checklists.moveItem(templateId, itemId, direction);
    if (r.ok) {
      refresh();
    } else {
      toast({ type: 'error', message: r.error });
    }
  }

  return (
    <>
      <AdminListLayout
        title="Kontrol Listesi"
        description="Şirket + Ürün Grubu + Kategori (3-tuple) eşleşmesinde vaka detayında otomatik yüklenen kontrol listeleri."
        count={items.length}
        searchPlaceholder="Şablon adı / şirket / ürün grubu / kategoriye göre ara…"
        searchValue={search}
        onSearchChange={setSearch}
        onAdd={() => setTplEditor({ mode: 'create' })}
        addLabel="Yeni Şablon"
        helpTitle={CHECKLIST_HELP.title}
        helpSections={CHECKLIST_HELP.sections}
      >
        {filtered.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<ClipboardCheck size={22} />}
              title={search ? 'Aramaya uyan şablon yok' : 'Henüz şablon yok'}
              description={
                search
                  ? 'Farklı bir terim deneyin.'
                  : 'İlk kontrol listesi şablonunu oluşturarak başlayın.'
              }
              action={
                !search ? (
                  <Button size="sm" onClick={() => setTplEditor({ mode: 'create' })}>
                    Yeni Şablon
                  </Button>
                ) : undefined
              }
            />
          </CardBody>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr]">
            {/* SOL: Şablon listesi */}
            <div className="border-r border-slate-200">
              <ul className="divide-y divide-slate-100">
                {filtered.map((t) => {
                  const isSelected = t.id === selectedId;
                  return (
                    <li
                      key={t.id}
                      className={`cursor-pointer px-4 py-3 hover:bg-slate-50 ${
                        isSelected ? 'bg-brand-50/60' : ''
                      }`}
                      onClick={() => setSelectedId(t.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`font-medium ${t.isActive ? 'text-slate-800' : 'text-slate-400'}`}>
                              {t.name}
                            </span>
                            {!t.isActive && <Badge tint="slate">Pasif</Badge>}
                          </div>
                          <div className="mt-0.5 truncate text-xs text-slate-500">
                            {t.companyName} · {t.productGroup} · {t.categoryName}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-400">
                            {t.items.length} madde · {t.items.filter((i) => i.isActive).length} aktif
                          </div>
                        </div>
                        <ChevronRight
                          size={14}
                          className={`shrink-0 ${isSelected ? 'text-brand-500' : 'text-slate-300'}`}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* SAĞ: Seçili şablonun detayı + maddeler */}
            <div>
              {selected ? (
                <ChecklistDetail
                  template={selected}
                  onEditTemplate={() => setTplEditor({ mode: 'edit', id: selected.id })}
                  onToggleTemplateActive={() => handleToggleTplActive(selected)}
                  onDeleteTemplate={() => handleDeleteTemplate(selected)}
                  onAddItem={() => setItemEditor({ mode: 'create', templateId: selected.id })}
                  onEditItem={(itemId) =>
                    setItemEditor({ mode: 'edit', templateId: selected.id, itemId })
                  }
                  onToggleItemActive={(item) => handleToggleItemActive(selected.id, item)}
                  onDeleteItem={(item) => handleDeleteItem(selected.id, item)}
                  onMoveItem={(itemId, dir) => handleMoveItem(selected.id, itemId, dir)}
                />
              ) : (
                <CardBody>
                  <EmptyState
                    icon={<ClipboardCheck size={22} />}
                    title="Soldan bir şablon seçin"
                    description="Detayları ve kontrol maddeleri burada görüntülenecek."
                  />
                </CardBody>
              )}
            </div>
          </div>
        )}
      </AdminListLayout>

      <ChecklistTemplateEditModal
        open={tplEditor !== null}
        mode={tplEditor?.mode ?? 'create'}
        editingId={tplEditor?.mode === 'edit' ? tplEditor.id : null}
        onClose={() => setTplEditor(null)}
        onSaved={(newId) => {
          refresh();
          if (newId) setSelectedId(newId);
        }}
      />

      <ChecklistItemEditModal
        editor={itemEditor}
        onClose={() => setItemEditor(null)}
        onSaved={refresh}
      />
    </>
  );
}

// ----------------------------------------------------------------
// Checklist Detail (sağ panel)
// ----------------------------------------------------------------

function ChecklistDetail({
  template,
  onEditTemplate,
  onToggleTemplateActive,
  onDeleteTemplate,
  onAddItem,
  onEditItem,
  onToggleItemActive,
  onDeleteItem,
  onMoveItem,
}: {
  template: CaseChecklistTemplate;
  onEditTemplate: () => void;
  onToggleTemplateActive: () => void;
  onDeleteTemplate: () => void;
  onAddItem: () => void;
  onEditItem: (itemId: string) => void;
  onToggleItemActive: (item: CaseChecklistItem) => void;
  onDeleteItem: (item: CaseChecklistItem) => void;
  onMoveItem: (itemId: string, direction: -1 | 1) => void;
}) {
  const usage = adminService.checklists.usage(template.id);

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-slate-800">{template.name}</h3>
            {template.isActive ? (
              <Badge tint="emerald">Aktif</Badge>
            ) : (
              <Badge tint="slate">Pasif</Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <Badge tint="blue">{template.companyName}</Badge>
            <Badge tint="slate">{template.productGroup}</Badge>
            <Badge tint="amber">{template.categoryName}</Badge>
          </div>
          {template.description && (
            <p className="mt-2 text-sm text-slate-600">{template.description}</p>
          )}
          <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
            <span className="font-mono text-slate-400">{template.id}</span>
            <span>·</span>
            <span>{usage.totalCases} eşleşen vaka</span>
            <span>·</span>
            <span>{usage.itemCount} madde</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onEditTemplate}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            title="Şablonu düzenle"
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={onToggleTemplateActive}
            className={`rounded p-1.5 hover:bg-slate-100 ${
              template.isActive
                ? 'text-amber-600 hover:text-amber-700'
                : 'text-emerald-600 hover:text-emerald-700'
            }`}
            title={template.isActive ? 'Pasifleştir' : 'Aktifleştir'}
          >
            {template.isActive ? <PowerOff size={14} /> : <Power size={14} />}
          </button>
          <button
            type="button"
            onClick={onDeleteTemplate}
            className="rounded p-1.5 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
            title="Sil"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Item table header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-5 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Kontrol Maddeleri
        </span>
        <Button size="sm" variant="outline" onClick={onAddItem}>
          <Plus size={12} className="mr-1" />
          Yeni Madde
        </Button>
      </div>

      {template.items.length === 0 ? (
        <div className="px-5 py-8">
          <EmptyState
            icon={<ClipboardCheck size={20} />}
            title="Madde yok"
            description="Bu şablon için ilk kontrol maddesini ekleyin."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50/40 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <Th align="right">Sıra</Th>
                <Th>Metin</Th>
                <Th>Zorunlu</Th>
                <Th>Durum</Th>
                <Th align="right">Aksiyon</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {template.items.map((item, idx) => {
                const isFirst = idx === 0;
                const isLast = idx === template.items.length - 1;
                return (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <Td align="right" className="font-mono text-xs text-slate-500">
                      {idx + 1}
                    </Td>
                    <Td>
                      <div className={`font-medium ${item.isActive ? 'text-slate-800' : 'text-slate-400'}`}>
                        {item.label}
                      </div>
                      <div className="font-mono text-[10px] text-slate-400">{item.id}</div>
                    </Td>
                    <Td>
                      {item.required ? (
                        <Badge tint="rose">Zorunlu</Badge>
                      ) : (
                        <span className="text-xs text-slate-400">Opsiyonel</span>
                      )}
                    </Td>
                    <Td>
                      {item.isActive ? (
                        <Badge tint="emerald">Aktif</Badge>
                      ) : (
                        <Badge tint="slate">Pasif</Badge>
                      )}
                    </Td>
                    <Td align="right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => onMoveItem(item.id, -1)}
                          disabled={isFirst}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                          title="Yukarı taşı"
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onMoveItem(item.id, 1)}
                          disabled={isLast}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                          title="Aşağı taşı"
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onEditItem(item.id)}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                          title="Düzenle"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleItemActive(item)}
                          className={`rounded p-1.5 hover:bg-slate-100 ${
                            item.isActive
                              ? 'text-amber-600 hover:text-amber-700'
                              : 'text-emerald-600 hover:text-emerald-700'
                          }`}
                          title={item.isActive ? 'Pasifleştir' : 'Aktifleştir'}
                        >
                          {item.isActive ? <PowerOff size={14} /> : <Power size={14} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteItem(item)}
                          className="rounded p-1.5 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                          title="Sil"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Template Edit Modal
// ----------------------------------------------------------------

const EMPTY_TPL_FORM: ChecklistTemplateInput = {
  name: '',
  companyId: '',
  companyName: '',
  productGroup: '',
  categoryName: '',
  description: '',
  isActive: true,
};

function ChecklistTemplateEditModal({
  open,
  mode,
  editingId,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  editingId: string | null;
  onClose: () => void;
  onSaved: (newId: string | null) => void;
}) {
  const [form, setForm] = useState<ChecklistTemplateInput>(EMPTY_TPL_FORM);
  const [companies, setCompanies] = useState<CaseCompany[]>([]);
  const [productGroups, setProductGroups] = useState<string[]>([]);
  const [categories, setCategories] = useState<CaseCategoryDef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setError(null);
    setCompanies(lookupService.companies());
    setProductGroups(lookupService.productGroups());
    setCategories(adminService.categories.list());

    if (mode === 'edit' && editingId) {
      const t = adminService.checklists.get(editingId);
      if (t) {
        setForm({
          name: t.name,
          companyId: t.companyId,
          companyName: t.companyName,
          productGroup: t.productGroup,
          categoryName: t.categoryName,
          description: t.description ?? '',
          isActive: t.isActive,
        });
      }
    } else {
      setForm(EMPTY_TPL_FORM);
    }
  }, [open, mode, editingId]);

  function handleCompanyChange(companyId: string) {
    const c = companies.find((x) => x.id === companyId);
    setForm((f) => ({ ...f, companyId, companyName: c?.name ?? '' }));
  }

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    const trimmed: ChecklistTemplateInput = {
      ...form,
      name: form.name.trim(),
      productGroup: form.productGroup.trim(),
      categoryName: form.categoryName.trim(),
      description: form.description?.trim() || undefined,
    };
    const r =
      mode === 'create'
        ? adminService.checklists.create(trimmed)
        : editingId
          ? adminService.checklists.update(editingId, trimmed)
          : null;
    setSubmitting(false);

    if (!r) {
      setError('Şablon bulunamadı.');
      return;
    }
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onSaved(mode === 'create' ? r.item.id : null);
    onClose();
    toast({
      type: 'success',
      message: mode === 'create' ? `"${r.item.name}" oluşturuldu.` : `"${r.item.name}" güncellendi.`,
      duration: 2200,
    });
  }

  const canSubmit =
    form.name.trim().length > 0 &&
    !!form.companyId &&
    !!form.productGroup.trim() &&
    !!form.categoryName.trim() &&
    !submitting;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={mode === 'create' ? 'Yeni Kontrol Listesi Şablonu' : 'Şablonu Düzenle'}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Vazgeç
          </Button>
          <Button onClick={handleSave} disabled={!canSubmit}>
            {submitting ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-600">
          3-tuple eşleşmesi: bu üç alanın tümü vaka ile uyuşunca şablon vaka detayında otomatik
          yüklenir. Aynı kombinasyon için yalnızca bir şablon olabilir.
        </div>

        <Field label="Şablon Adı" required>
          <TextInput
            autoFocus
            placeholder="ör. Sanal POS Yazılım Vakaları"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Şirket" required>
            <Select
              value={form.companyId}
              onChange={(e) => handleCompanyChange(e.target.value)}
            >
              <option value="">Şirket seçin…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Ürün Grubu" required>
            <Select
              value={form.productGroup}
              onChange={(e) => setForm((f) => ({ ...f, productGroup: e.target.value }))}
            >
              <option value="">Ürün grubu seçin…</option>
              {productGroups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Kategori" required>
            <Select
              value={form.categoryName}
              onChange={(e) => setForm((f) => ({ ...f, categoryName: e.target.value }))}
            >
              <option value="">Kategori seçin…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                  {!c.isActive ? ' (pasif)' : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Açıklama" hint="Opsiyonel — şablonun amacı / hangi durumda kullanılır">
          <TextArea
            placeholder="Bu şablonun ne için kullanıldığını açıklayın…"
            value={form.description ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={2}
          />
        </Field>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          Aktif — eşleşen vakalarda otomatik yüklenir
        </label>

        {error && (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

// ----------------------------------------------------------------
// Item Edit Modal
// ----------------------------------------------------------------

function ChecklistItemEditModal({
  editor,
  onClose,
  onSaved,
}: {
  editor:
    | { mode: 'create'; templateId: string }
    | { mode: 'edit'; templateId: string; itemId: string }
    | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const open = editor !== null;
  const [form, setForm] = useState<ChecklistItemInput>({
    label: '',
    required: false,
    isActive: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open || !editor) return;
    setError(null);
    if (editor.mode === 'edit') {
      const t = adminService.checklists.get(editor.templateId);
      const item = t?.items.find((i) => i.id === editor.itemId);
      if (item) {
        setForm({ label: item.label, required: item.required, isActive: item.isActive });
      }
    } else {
      setForm({ label: '', required: false, isActive: true });
    }
  }, [open, editor]);

  async function handleSave() {
    if (!editor) return;
    setSubmitting(true);
    setError(null);
    const trimmed: ChecklistItemInput = {
      label: form.label.trim(),
      required: form.required,
      isActive: form.isActive,
    };
    const r =
      editor.mode === 'create'
        ? adminService.checklists.addItem(editor.templateId, trimmed)
        : adminService.checklists.updateItem(editor.templateId, editor.itemId, trimmed);
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onSaved();
    onClose();
    toast({
      type: 'success',
      message: editor.mode === 'create' ? 'Madde eklendi.' : 'Madde güncellendi.',
      duration: 1800,
    });
  }

  const canSubmit = form.label.trim().length > 0 && !submitting;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={editor?.mode === 'create' ? 'Yeni Madde' : 'Maddeyi Düzenle'}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Vazgeç
          </Button>
          <Button onClick={handleSave} disabled={!canSubmit}>
            {submitting ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Madde Metni" required>
          <TextArea
            autoFocus
            placeholder="ör. Hata kodu / log loglandı mı?"
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            rows={2}
          />
        </Field>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.required}
            onChange={(e) => setForm((f) => ({ ...f, required: e.target.checked }))}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          Zorunlu — vaka kapatılmadan önce işaretlenmeli
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          Aktif — yeni vakalarda gösterilir
        </label>

        {error && (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

// ----------------------------------------------------------------
// Tablo helpers
// ----------------------------------------------------------------

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`whitespace-nowrap px-4 py-2.5 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  className,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <td
      className={`whitespace-nowrap px-4 py-2.5 ${align === 'right' ? 'text-right' : 'text-left'} ${className ?? ''}`}
    >
      {children}
    </td>
  );
}
