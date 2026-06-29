import { useEffect, useMemo, useState } from 'react';
import { Pencil, Power, PowerOff, Timer, Trash2 } from 'lucide-react';
import { CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { CompanySelector } from '@/components/ui/CompanySelector';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import {
  adminService,
  type SlaPolicyInput,
} from '@/services/adminService';
import { lookupService } from '@/services/caseService';
import {
  CASE_PRIORITIES,
  CASE_PRIORITY_LABELS,
  CASE_REQUEST_TYPES,
  type CaseCategoryDef,
  type CaseCompany,
  type CasePriority,
  type CaseRequestType,
  type SlaPolicy,
} from '@/features/cases/types';
import { AdminListLayout } from './AdminListLayout';
import { SLA_HELP } from './helpContents';

export function AdminSlaPage() {
  const [items, setItems] = useState<SlaPolicy[]>([]);
  const [search, setSearch] = useState('');
  // Phase 5C — sayfa şirket filtresi (null = tümü).
  const [filterCompanyId, setFilterCompanyId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setItems(await adminService.sla.list());
    } catch (e) {
      setError((e as Error).message ?? 'Bilinmeyen hata');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = items;
    if (filterCompanyId) arr = arr.filter((p) => p.companyId === filterCompanyId);
    if (!q) return arr;
    return arr.filter((p) =>
      [
        p.companyName,
        p.productGroup ?? '',
        p.categoryName ?? '',
        p.subCategoryName ?? '',
        p.requestType ?? '',
        p.priority ?? '',
        p.description ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [items, search, filterCompanyId]);

  async function handleToggleActive(p: SlaPolicy) {
    const r = await adminService.sla.setActive(p.id, !p.isActive);
    if (r.ok) {
      await refresh();
      toast({
        type: 'success',
        message: r.item.isActive ? 'Kural aktif edildi.' : 'Kural pasif edildi.',
        duration: 2000,
      });
    } else {
      toast({ type: 'error', message: r.error });
    }
  }

  async function handleDelete(p: SlaPolicy) {
    const usage = adminService.sla.usage(p.id).count;
    const tuple = [p.companyName, p.productGroup, p.categoryName, p.subCategoryName, p.requestType, p.priority].filter(Boolean).join(' / ');
    const msg =
      usage > 0
        ? `Bu kural ${usage} vakaya eşleşiyor (${tuple}). Silinince yeni vakalarda fallback uygulanır. Devam edilsin mi?`
        : `"${tuple}" kuralı silinsin mi?`;
    if (!window.confirm(msg)) return;
    const r = await adminService.sla.remove(p.id);
    if (r.ok) {
      await refresh();
      toast({ type: 'warn', message: 'Kural silindi.', duration: 2000 });
    } else {
      toast({ type: 'error', message: r.error });
    }
  }

  return (
    <>
      <AdminListLayout
        title="SLA Kuralları"
        description="5-tuple eşleşme: Şirket + Ürün Grubu + Kategori + Alt Kategori + Talep Türü → Yanıt/Çözüm saatleri (PRODUCT_SPEC §6)."
        count={filtered.length}
        searchPlaceholder="Şirket / ürün grubu / kategori / talep türüne göre ara…"
        searchValue={search}
        onSearchChange={setSearch}
        onAdd={() => setEditor({ mode: 'create' })}
        addLabel="Yeni Kural"
        helpTitle={SLA_HELP.title}
        helpSections={SLA_HELP.sections}
        loading={loading}
        error={error}
        onRetry={() => void refresh()}
        filters={
          <div className="w-56">
            <CompanySelector
              label="Şirket Filtresi"
              value={filterCompanyId}
              onChange={setFilterCompanyId}
              allowAll
            />
          </div>
        }
      >
        {filtered.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<Timer size={22} />}
              title={search ? 'Aramaya uyan kural yok' : 'Henüz SLA kuralı yok'}
              description={
                search
                  ? 'Farklı bir terim deneyin.'
                  : 'İlk SLA kuralını oluşturarak başlayın. Eşleşmeyen vakalar fallback’e düşer.'
              }
              action={
                !search ? (
                  <Button size="sm" onClick={() => setEditor({ mode: 'create' })}>
                    Yeni Kural
                  </Button>
                ) : undefined
              }
            />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <Th>Şirket</Th>
                  <Th>Ürün Grubu</Th>
                  <Th>Kategori</Th>
                  <Th>Alt Kategori</Th>
                  <Th>Talep Türü</Th>
                  <Th>Öncelik</Th>
                  <Th align="right">Yanıt</Th>
                  <Th align="right">Çözüm</Th>
                  <Th align="right">Eşleşen</Th>
                  <Th>Durum</Th>
                  <Th align="right">Aksiyon</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((p) => {
                  const usage = adminService.sla.usage(p.id).count;
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <Td>
                        <div className="font-medium text-slate-800">{p.companyName}</div>
                        <div className="font-mono text-[10px] text-slate-400">{p.id}</div>
                      </Td>
                      <Td className="text-slate-700">{p.productGroup ?? <span className="text-slate-400 text-xs italic">Tümü</span>}</Td>
                      <Td className="text-slate-700">{p.categoryName ?? <span className="text-slate-400 text-xs italic">Tümü</span>}</Td>
                      <Td className="text-slate-700">{p.subCategoryName ?? <span className="text-slate-400 text-xs italic">Tümü</span>}</Td>
                      <Td>
                        {p.requestType
                          ? <Badge tint="slate">{p.requestType}</Badge>
                          : <span className="text-slate-400 text-xs italic">Tümü</span>}
                      </Td>
                      <Td>
                        {p.priority
                          ? <Badge tint="slate">{CASE_PRIORITY_LABELS[p.priority as CasePriority]}</Badge>
                          : <span className="text-slate-400 text-xs italic">Tümü</span>}
                      </Td>
                      <Td align="right" className="font-mono text-slate-700">
                        {p.responseHours}h
                      </Td>
                      <Td align="right" className="font-mono text-slate-700">
                        {p.resolutionHours}h
                      </Td>
                      <Td align="right">
                        {usage > 0 ? (
                          <Badge tint="blue">{usage}</Badge>
                        ) : (
                          <span className="text-xs text-slate-400">0</span>
                        )}
                      </Td>
                      <Td>
                        {p.isActive ? (
                          <Badge tint="emerald">Aktif</Badge>
                        ) : (
                          <Badge tint="slate">Pasif</Badge>
                        )}
                      </Td>
                      <Td align="right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setEditor({ mode: 'edit', id: p.id })}
                            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                            title="Düzenle"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleActive(p)}
                            className={`rounded p-1.5 hover:bg-slate-100 ${
                              p.isActive
                                ? 'text-amber-600 hover:text-amber-700'
                                : 'text-emerald-600 hover:text-emerald-700'
                            }`}
                            title={p.isActive ? 'Pasifleştir' : 'Aktifleştir'}
                          >
                            {p.isActive ? <PowerOff size={14} /> : <Power size={14} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(p)}
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
      </AdminListLayout>

      <SlaEditModal
        open={editor !== null}
        mode={editor?.mode ?? 'create'}
        editingId={editor?.mode === 'edit' ? editor.id : null}
        onClose={() => setEditor(null)}
        onSaved={() => {
          void refresh();
        }}
      />
    </>
  );
}

// ----------------------------------------------------------------
// Edit Modal — 5 dropdown + 2 saat input
// ----------------------------------------------------------------

const EMPTY_FORM: SlaPolicyInput = {
  companyId: '',
  companyName: '',
  productGroup: null,
  categoryName: null,
  subCategoryName: null,
  requestType: null,
  priority: null,
  responseHours: 4,
  resolutionHours: 24,
  description: '',
  isActive: true,
};

function SlaEditModal({
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
  onSaved: () => void;
}) {
  const [form, setForm] = useState<SlaPolicyInput>(EMPTY_FORM);
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

    let cancelled = false;
    void (async () => {
      const cats = await adminService.categories.list();
      if (cancelled) return;
      setCategories(cats);

      if (mode === 'edit' && editingId) {
        const p = await adminService.sla.get(editingId);
        if (cancelled) return;
        if (p) {
          setForm({
            companyId: p.companyId,
            companyName: p.companyName,
            productGroup: (p.productGroup as string | null) ?? '',
            categoryName: (p.categoryName as string | null) ?? '',
            subCategoryName: (p.subCategoryName as string | null) ?? '',
            requestType: p.requestType ?? 'Talep',
            responseHours: p.responseHours,
            resolutionHours: p.resolutionHours,
            description: p.description ?? '',
            isActive: p.isActive,
            priority: p.priority ?? null,
          });
        }
      } else {
        setForm(EMPTY_FORM);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, mode, editingId]);

  // Kategori değişince alt kategoriyi sıfırla (cascade)
  const subCategories = useMemo(() => {
    if (!form.categoryName) return [];
    const cat = categories.find((c) => c.name === form.categoryName);
    return cat?.subCategories ?? [];
  }, [categories, form.categoryName]);

  function handleCompanyChange(companyId: string) {
    const c = companies.find((x) => x.id === companyId);
    setForm((f) => ({ ...f, companyId, companyName: c?.name ?? '' }));
  }

  function handleCategoryChange(categoryName: string | null) {
    setForm((f) => ({
      ...f,
      categoryName,
      subCategoryName: null,
    }));
  }

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    const trimmed: SlaPolicyInput = {
      ...form,
      productGroup: (form.productGroup ?? '').trim() || null,
      categoryName: (form.categoryName ?? '').trim() || null,
      subCategoryName: (form.subCategoryName ?? '').trim() || null,
      description: form.description?.trim() || undefined,
    };

    const r =
      mode === 'create'
        ? await adminService.sla.create(trimmed)
        : editingId
          ? await adminService.sla.update(editingId, trimmed)
          : null;

    setSubmitting(false);

    if (!r) {
      setError('Kural bulunamadı.');
      return;
    }
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onSaved();
    onClose();
    toast({
      type: 'success',
      message: mode === 'create' ? 'Kural oluşturuldu.' : 'Kural güncellendi.',
      duration: 2200,
    });
  }

  const canSubmit =
    !!form.companyId &&
    form.responseHours > 0 &&
    form.resolutionHours > 0 &&
    !submitting;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={mode === 'create' ? 'Yeni SLA Kuralı' : 'SLA Kuralını Düzenle'}
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
          Esnek eşleşme: boş bırakılan alanlar wildcard olarak davranır (her değerle eşleşir). Daha spesifik kurallar öncelik kazanır.
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <CompanySelector
            value={form.companyId || null}
            onChange={(id) => handleCompanyChange(id ?? '')}
            required
            disabled={mode === 'edit'}
            hint={
              mode === 'edit'
                ? 'Var olan kuralın şirketi değiştirilemez.'
                : undefined
            }
          />
          {/* productGroup ve sonraki alanlar Field'ları aşağıda */}

          <Field label="Ürün Grubu" hint="Boş = tüm ürün grupları">
            <Select
              value={form.productGroup ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, productGroup: e.target.value || null }))}
            >
              <option value="">— Tümü (wildcard) —</option>
              {productGroups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Kategori" hint="Boş = tüm kategoriler">
            <Select
              value={form.categoryName ?? ''}
              onChange={(e) => handleCategoryChange(e.target.value || null)}
            >
              <option value="">— Tümü (wildcard) —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                  {!c.isActive ? ' (pasif)' : ''}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Alt Kategori" hint="Boş = tüm alt kategoriler">
            <Select
              value={form.subCategoryName ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, subCategoryName: e.target.value || null }))}
              disabled={!form.categoryName}
            >
              <option value="">— Tümü (wildcard) —</option>
              {subCategories.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                  {!s.isActive ? ' (pasif)' : ''}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Talep Türü" hint="Boş = tüm talep türleri">
            <Select
              value={form.requestType ?? ''}
              onChange={(e) =>
                setForm((f) => ({ ...f, requestType: (e.target.value as CaseRequestType) || null }))
              }
            >
              <option value="">— Tümü (wildcard) —</option>
              {CASE_REQUEST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Öncelik" hint="Boş = tüm öncelikler">
            <Select
              value={form.priority ?? ''}
              onChange={(e) =>
                setForm((f) => ({ ...f, priority: (e.target.value as CasePriority) || null }))
              }
            >
              <option value="">— Tümü (wildcard) —</option>
              {CASE_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {CASE_PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Yanıt Süresi (saat)" required hint="İlk yanıt için hedef süre">
            <TextInput
              type="number"
              min={1}
              step={1}
              value={form.responseHours}
              onChange={(e) =>
                setForm((f) => ({ ...f, responseHours: Number(e.target.value) || 0 }))
              }
            />
          </Field>

          <Field label="Çözüm Süresi (saat)" required hint="Vakanın çözülmesi için hedef süre">
            <TextInput
              type="number"
              min={1}
              step={1}
              value={form.resolutionHours}
              onChange={(e) =>
                setForm((f) => ({ ...f, resolutionHours: Number(e.target.value) || 0 }))
              }
            />
          </Field>
        </div>

        <Field label="Açıklama" hint="Opsiyonel — kuralın iş gerekçesi">
          <TextArea
            placeholder="Bu kural neden var, ne zaman uygulanır…"
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
          Aktif — yeni vakalarda eşleştirilir
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
