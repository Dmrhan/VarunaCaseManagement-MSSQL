import { useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  FolderTree,
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
import { Field, TextArea, TextInput } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import {
  adminService,
  type CategoryInput,
  type SubCategoryInput,
} from '@/services/adminService';
import type { CaseCategoryDef } from '@/features/cases/types';
import { AdminListLayout } from './AdminListLayout';
import { CATEGORIES_HELP } from './helpContents';

export function AdminCategoriesPage() {
  const [items, setItems] = useState<CaseCategoryDef[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [catEditor, setCatEditor] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null);
  const [subEditor, setSubEditor] = useState<
    | { mode: 'create'; categoryId: string }
    | { mode: 'edit'; categoryId: string; subId: string }
    | null
  >(null);
  const { toast } = useToast();

  function refresh() {
    setItems(adminService.categories.list());
  }
  useEffect(refresh, []);

  // İlk yüklemede ilk kategoriyi seç
  useEffect(() => {
    if (selectedId == null && items.length > 0) {
      setSelectedId(items[0].id);
    }
    if (selectedId != null && !items.find((c) => c.id === selectedId)) {
      setSelectedId(items[0]?.id ?? null);
    }
  }, [items, selectedId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.description ?? '').toLowerCase().includes(q) ||
        c.subCategories.some((s) => s.name.toLowerCase().includes(q)),
    );
  }, [items, search]);

  const selected = useMemo(
    () => items.find((c) => c.id === selectedId) ?? null,
    [items, selectedId],
  );

  function handleToggleCatActive(cat: CaseCategoryDef) {
    if (cat.isActive) {
      const u = adminService.categories.usage(cat.id);
      if (u.totalCases > 0) {
        const ok = window.confirm(
          `"${cat.name}" toplam ${u.totalCases} vakada referans veriliyor. Pasifleştirilirse yeni vaka oluşturmada dropdown'da görünmez (mevcut vakalar etkilenmez). Devam edilsin mi?`,
        );
        if (!ok) return;
      }
    }
    const r = adminService.categories.setActive(cat.id, !cat.isActive);
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

  function handleDeleteCategory(cat: CaseCategoryDef) {
    if (cat.subCategories.length > 0) {
      window.alert(
        `"${cat.name}" altında ${cat.subCategories.length} alt kategori var. Önce alt kategorileri silin.`,
      );
      return;
    }
    const u = adminService.categories.usage(cat.id);
    const msg =
      u.totalCases > 0
        ? `"${cat.name}" toplam ${u.totalCases} vakada referans veriliyor. Silinince vakalardaki ad korunur, sadece dropdown'dan kalkar. Devam edilsin mi?`
        : `"${cat.name}" silinsin mi?`;
    if (!window.confirm(msg)) return;
    const r = adminService.categories.remove(cat.id);
    if (r.ok) {
      refresh();
      toast({ type: 'warn', message: `"${cat.name}" silindi.`, duration: 2500 });
    } else {
      toast({ type: 'error', message: r.error });
    }
  }

  function handleToggleSubActive(categoryId: string, subId: string, isActive: boolean) {
    const r = adminService.categories.setSubCategoryActive(categoryId, subId, !isActive);
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

  function handleDeleteSub(categoryId: string, subId: string, subName: string) {
    const u = adminService.categories.subCategoryUsage(categoryId, subId).count;
    const msg =
      u > 0
        ? `"${subName}" toplam ${u} vakada kullanılıyor. Silinince vakalardaki ad korunur. Devam edilsin mi?`
        : `"${subName}" silinsin mi?`;
    if (!window.confirm(msg)) return;
    const r = adminService.categories.removeSubCategory(categoryId, subId);
    if (r.ok) {
      refresh();
      toast({ type: 'warn', message: `"${subName}" silindi.`, duration: 2500 });
    } else {
      toast({ type: 'error', message: r.error });
    }
  }

  return (
    <>
      <AdminListLayout
        title="Kategori & Alt Kategori"
        description="Vaka oluşturmada ve atamada kullanılan iki seviyeli kategori yapısı. Pasif kategoriler/alt kategoriler yeni vakalarda görünmez (mevcut vakalardaki ad korunur)."
        count={items.length}
        searchPlaceholder="Kategori veya alt kategori ara…"
        searchValue={search}
        onSearchChange={setSearch}
        onAdd={() => setCatEditor({ mode: 'create' })}
        addLabel="Yeni Kategori"
        helpTitle={CATEGORIES_HELP.title}
        helpSections={CATEGORIES_HELP.sections}
      >
        {filtered.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<FolderTree size={22} />}
              title={search ? 'Aramaya uyan kategori yok' : 'Henüz kategori yok'}
              description={
                search
                  ? 'Farklı bir terim deneyin.'
                  : 'İlk kategoriyi oluşturarak başlayın.'
              }
              action={
                !search ? (
                  <Button size="sm" onClick={() => setCatEditor({ mode: 'create' })}>
                    Yeni Kategori
                  </Button>
                ) : undefined
              }
            />
          </CardBody>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr]">
            {/* SOL: Kategori listesi */}
            <div className="border-r border-slate-200">
              <ul className="divide-y divide-slate-100">
                {filtered.map((c) => {
                  const isSelected = c.id === selectedId;
                  return (
                    <li
                      key={c.id}
                      className={`cursor-pointer px-4 py-3 hover:bg-slate-50 ${
                        isSelected ? 'bg-brand-50/60' : ''
                      }`}
                      onClick={() => setSelectedId(c.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`font-medium ${c.isActive ? 'text-slate-800' : 'text-slate-400'}`}>
                              {c.name}
                            </span>
                            {!c.isActive && <Badge tint="slate">Pasif</Badge>}
                          </div>
                          {c.description && (
                            <div className="mt-0.5 truncate text-xs text-slate-500">{c.description}</div>
                          )}
                          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
                            <span>{c.subCategories.length} alt kategori</span>
                            <span>·</span>
                            <span>{c.subCategories.filter((s) => s.isActive).length} aktif</span>
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

            {/* SAĞ: Seçili kategorinin alt kategori detayı */}
            <div>
              {selected ? (
                <CategoryDetail
                  category={selected}
                  onEditCategory={() => setCatEditor({ mode: 'edit', id: selected.id })}
                  onToggleCategoryActive={() => handleToggleCatActive(selected)}
                  onDeleteCategory={() => handleDeleteCategory(selected)}
                  onAddSub={() => setSubEditor({ mode: 'create', categoryId: selected.id })}
                  onEditSub={(subId) =>
                    setSubEditor({ mode: 'edit', categoryId: selected.id, subId })
                  }
                  onToggleSubActive={(subId, isActive) =>
                    handleToggleSubActive(selected.id, subId, isActive)
                  }
                  onDeleteSub={(subId, subName) => handleDeleteSub(selected.id, subId, subName)}
                />
              ) : (
                <CardBody>
                  <EmptyState
                    icon={<FolderTree size={22} />}
                    title="Soldan bir kategori seçin"
                    description="Detayları ve alt kategorileri burada görüntülenecek."
                  />
                </CardBody>
              )}
            </div>
          </div>
        )}
      </AdminListLayout>

      <CategoryEditModal
        open={catEditor !== null}
        mode={catEditor?.mode ?? 'create'}
        editingId={catEditor?.mode === 'edit' ? catEditor.id : null}
        onClose={() => setCatEditor(null)}
        onSaved={(newId) => {
          refresh();
          if (newId) setSelectedId(newId);
        }}
      />

      <SubCategoryEditModal
        editor={subEditor}
        onClose={() => setSubEditor(null)}
        onSaved={refresh}
      />
    </>
  );
}

// ----------------------------------------------------------------
// Category Detail (sağ panel)
// ----------------------------------------------------------------

function CategoryDetail({
  category,
  onEditCategory,
  onToggleCategoryActive,
  onDeleteCategory,
  onAddSub,
  onEditSub,
  onToggleSubActive,
  onDeleteSub,
}: {
  category: CaseCategoryDef;
  onEditCategory: () => void;
  onToggleCategoryActive: () => void;
  onDeleteCategory: () => void;
  onAddSub: () => void;
  onEditSub: (subId: string) => void;
  onToggleSubActive: (subId: string, isActive: boolean) => void;
  onDeleteSub: (subId: string, subName: string) => void;
}) {
  const usage = adminService.categories.usage(category.id);

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-slate-800">{category.name}</h3>
            {category.isActive ? (
              <Badge tint="emerald">Aktif</Badge>
            ) : (
              <Badge tint="slate">Pasif</Badge>
            )}
          </div>
          {category.description && (
            <p className="mt-1 text-sm text-slate-600">{category.description}</p>
          )}
          <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
            <span className="font-mono text-slate-400">{category.id}</span>
            <span>·</span>
            <span>{usage.totalCases} vaka</span>
            <span>·</span>
            <span>{category.subCategories.length} alt kategori</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onEditCategory}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            title="Düzenle"
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={onToggleCategoryActive}
            className={`rounded p-1.5 hover:bg-slate-100 ${
              category.isActive
                ? 'text-amber-600 hover:text-amber-700'
                : 'text-emerald-600 hover:text-emerald-700'
            }`}
            title={category.isActive ? 'Pasifleştir' : 'Aktifleştir'}
          >
            {category.isActive ? <PowerOff size={14} /> : <Power size={14} />}
          </button>
          <button
            type="button"
            onClick={onDeleteCategory}
            className="rounded p-1.5 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
            title="Sil"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Sub-category table */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-5 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Alt Kategoriler
        </span>
        <Button size="sm" variant="outline" onClick={onAddSub}>
          <Plus size={12} className="mr-1" />
          Yeni Alt Kategori
        </Button>
      </div>

      {category.subCategories.length === 0 ? (
        <div className="px-5 py-8">
          <EmptyState
            icon={<FolderTree size={20} />}
            title="Alt kategori yok"
            description="Bu kategori için ilk alt kategoriyi ekleyin."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50/40 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <Th>İsim</Th>
                <Th>Durum</Th>
                <Th align="right">Kullanım</Th>
                <Th align="right">Aksiyon</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {category.subCategories.map((s) => {
                const u = adminService.categories.subCategoryUsage(category.id, s.id).count;
                return (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <Td>
                      <div className={`font-medium ${s.isActive ? 'text-slate-800' : 'text-slate-400'}`}>
                        {s.name}
                      </div>
                      <div className="font-mono text-[10px] text-slate-400">{s.id}</div>
                    </Td>
                    <Td>
                      {s.isActive ? (
                        <Badge tint="emerald">Aktif</Badge>
                      ) : (
                        <Badge tint="slate">Pasif</Badge>
                      )}
                    </Td>
                    <Td align="right">
                      {u > 0 ? (
                        <Badge tint="blue">{u}</Badge>
                      ) : (
                        <span className="text-xs text-slate-400">0</span>
                      )}
                    </Td>
                    <Td align="right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => onEditSub(s.id)}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                          title="Düzenle"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleSubActive(s.id, s.isActive)}
                          className={`rounded p-1.5 hover:bg-slate-100 ${
                            s.isActive
                              ? 'text-amber-600 hover:text-amber-700'
                              : 'text-emerald-600 hover:text-emerald-700'
                          }`}
                          title={s.isActive ? 'Pasifleştir' : 'Aktifleştir'}
                        >
                          {s.isActive ? <PowerOff size={14} /> : <Power size={14} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteSub(s.id, s.name)}
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
// Category Edit Modal
// ----------------------------------------------------------------

function CategoryEditModal({
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
  const [form, setForm] = useState<CategoryInput>({ name: '', description: '', isActive: true });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === 'edit' && editingId) {
      const item = adminService.categories.get(editingId);
      if (item) {
        setForm({ name: item.name, description: item.description ?? '', isActive: item.isActive });
      }
    } else {
      setForm({ name: '', description: '', isActive: true });
    }
  }, [open, mode, editingId]);

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    const trimmed: CategoryInput = {
      name: form.name.trim(),
      description: form.description?.trim() || undefined,
      isActive: form.isActive,
    };
    const r =
      mode === 'create'
        ? adminService.categories.create(trimmed)
        : editingId
          ? adminService.categories.update(editingId, trimmed)
          : null;
    setSubmitting(false);
    if (!r) {
      setError('Kategori bulunamadı.');
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

  const canSubmit = form.name.trim().length > 0 && !submitting;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={mode === 'create' ? 'Yeni Kategori' : 'Kategoriyi Düzenle'}
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
        <Field label="Kategori Adı" required>
          <TextInput
            autoFocus
            placeholder="ör. Yazılım"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSubmit) {
                e.preventDefault();
                void handleSave();
              }
            }}
          />
        </Field>

        <Field label="Açıklama" hint="Opsiyonel — kategorinin kapsamı">
          <TextArea
            placeholder="Bu kategorinin hangi vakaları kapsadığını açıklayın…"
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
          Aktif — yeni vakalarda dropdown'da görünür
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
// SubCategory Edit Modal
// ----------------------------------------------------------------

function SubCategoryEditModal({
  editor,
  onClose,
  onSaved,
}: {
  editor:
    | { mode: 'create'; categoryId: string }
    | { mode: 'edit'; categoryId: string; subId: string }
    | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const open = editor !== null;
  const [form, setForm] = useState<SubCategoryInput>({ name: '', isActive: true });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open || !editor) return;
    setError(null);
    if (editor.mode === 'edit') {
      const cat = adminService.categories.get(editor.categoryId);
      const sub = cat?.subCategories.find((s) => s.id === editor.subId);
      if (sub) {
        setForm({ name: sub.name, isActive: sub.isActive });
      }
    } else {
      setForm({ name: '', isActive: true });
    }
  }, [open, editor]);

  async function handleSave() {
    if (!editor) return;
    setSubmitting(true);
    setError(null);
    const trimmed: SubCategoryInput = {
      name: form.name.trim(),
      isActive: form.isActive,
    };
    const r =
      editor.mode === 'create'
        ? adminService.categories.addSubCategory(editor.categoryId, trimmed)
        : adminService.categories.updateSubCategory(editor.categoryId, editor.subId, trimmed);
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onSaved();
    onClose();
    toast({
      type: 'success',
      message: editor.mode === 'create'
        ? `"${r.item.name}" eklendi.`
        : `"${r.item.name}" güncellendi.`,
      duration: 2200,
    });
  }

  const canSubmit = form.name.trim().length > 0 && !submitting;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={editor?.mode === 'create' ? 'Yeni Alt Kategori' : 'Alt Kategoriyi Düzenle'}
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
        <Field label="Alt Kategori Adı" required>
          <TextInput
            autoFocus
            placeholder="ör. Raporlama"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSubmit) {
                e.preventDefault();
                void handleSave();
              }
            }}
          />
        </Field>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          Aktif — yeni vakalarda dropdown'da görünür
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
