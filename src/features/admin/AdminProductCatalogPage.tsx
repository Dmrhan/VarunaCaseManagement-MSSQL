import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderTree, Loader2, Package, Pencil, Plus } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/services/AuthContext';
import {
  adminService,
  type Product,
  type ProductGroup,
  type ProductInput,
  type ProductGroupInput,
} from '@/services/adminService';
import { lookupService } from '@/services/caseService';
import { SUPPORT_LEVEL_LABELS, SUPPORT_LEVELS, type SupportLevel } from '@/features/cases/types';

/**
 * WR-A6 / PM-05 — Admin ürün kataloğu master-detail UI.
 *
 * Sol panel: seçili şirketin ProductGroup listesi.
 * Sağ panel: seçili grubun Product listesi.
 *
 * Foundation only — Case form'una bağlanmadı (A7b). Mevcut Case.productGroup
 * serbest string kolonu olduğu gibi kalır.
 */
export function AdminProductCatalogPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const companies = useMemo(() => lookupService.companies(), []);
  const writeAllowed = user?.role === 'Admin' || user?.role === 'SystemAdmin';

  const [companyId, setCompanyId] = useState<string>(() => companies[0]?.id ?? '');
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [groupEditor, setGroupEditor] = useState<
    | { mode: 'add' }
    | { mode: 'edit'; group: ProductGroup }
    | null
  >(null);
  const [productEditor, setProductEditor] = useState<
    | { mode: 'add'; groupId: string }
    | { mode: 'edit'; product: Product }
    | null
  >(null);

  const loadGroups = useCallback(async () => {
    if (!companyId) {
      setGroups([]);
      setProducts([]);
      setSelectedGroupId(null);
      return;
    }
    setLoading(true);
    const list = await adminService.productGroups.list(companyId, { includeInactive: showInactive });
    setLoading(false);
    setGroups(list);
    // Otomatik ilk grubu seç
    if (!selectedGroupId || !list.find((g) => g.id === selectedGroupId)) {
      setSelectedGroupId(list[0]?.id ?? null);
    }
  }, [companyId, showInactive, selectedGroupId]);

  const loadProducts = useCallback(async (gid: string | null) => {
    if (!companyId || !gid) {
      setProducts([]);
      return;
    }
    const list = await adminService.products.list(companyId, { productGroupId: gid, includeInactive: showInactive });
    setProducts(list);
  }, [companyId, showInactive]);

  useEffect(() => { void loadGroups(); }, [loadGroups]);
  useEffect(() => { void loadProducts(selectedGroupId); }, [loadProducts, selectedGroupId]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-ndark-text">
            Ürün Kataloğu
          </h1>
          <p className="text-xs text-slate-500 dark:text-ndark-muted">
            Şirket-özel ürün grupları ve ürünler. SLA/checklist eşleştirmesi ve A7 Paket kataloğu için zemin.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={companyId} onChange={(e) => { setSelectedGroupId(null); setCompanyId(e.target.value); }}>
            {companies.length === 0 && <option value="">Şirket yok</option>}
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-ndark-muted">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-ndark-border dark:bg-ndark-surface"
            />
            Pasifleri de göster
          </label>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
              <FolderTree size={12} />
              Ürün Grupları
            </div>
            {writeAllowed && companyId && (
              <Button size="sm" variant="outline" leftIcon={<Plus size={12} />} onClick={() => setGroupEditor({ mode: 'add' })}>
                Grup
              </Button>
            )}
          </div>
          {loading ? (
            <div className="flex h-32 items-center justify-center text-slate-400 dark:text-ndark-muted">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : groups.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<FolderTree size={16} />}
              title="Grup yok"
              description={writeAllowed ? 'İlk grubu eklemek için yukarıdaki düğmeyi kullan.' : '—'}
            />
          ) : (
            <ul className="space-y-1">
              {groups.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedGroupId(g.id)}
                    className={`flex w-full items-start justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                      g.id === selectedGroupId
                        ? 'bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-200'
                        : 'hover:bg-slate-50 dark:hover:bg-ndark-surface'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-slate-900 dark:text-ndark-text">
                          {g.name}
                        </span>
                        {!g.isActive && <Badge tint="slate">Pasif</Badge>}
                      </div>
                      <span className="font-mono text-[10px] text-slate-500 dark:text-ndark-muted">{g.code}</span>
                    </div>
                    {writeAllowed && (
                      <span
                        role="button"
                        aria-label={`${g.name} grubunu düzenle`}
                        onClick={(e) => { e.stopPropagation(); setGroupEditor({ mode: 'edit', group: g }); }}
                        className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-ndark-muted dark:hover:bg-ndark-surface dark:hover:text-ndark-text"
                      >
                        <Pencil size={12} />
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
              <Package size={12} />
              {selectedGroupId
                ? `Ürünler — ${groups.find((g) => g.id === selectedGroupId)?.name ?? ''}`
                : 'Ürünler'}
            </div>
            {writeAllowed && selectedGroupId && (
              <Button size="sm" variant="outline" leftIcon={<Plus size={12} />} onClick={() => setProductEditor({ mode: 'add', groupId: selectedGroupId })}>
                Ürün
              </Button>
            )}
          </div>
          {!selectedGroupId ? (
            <EmptyState
              size="sm"
              icon={<Package size={16} />}
              title="Önce grup seç"
              description="Sol panelden bir ürün grubu seçerek altındaki ürünleri yönet."
            />
          ) : products.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<Package size={16} />}
              title="Ürün yok"
              description={writeAllowed ? 'İlk ürünü eklemek için yukarıdaki düğmeyi kullan.' : '—'}
            />
          ) : (
            <ul className="space-y-1.5">
              {products.map((p) => (
                <li
                  key={p.id}
                  className="flex items-start justify-between gap-2 rounded-md border border-slate-200 px-3 py-2 dark:border-ndark-border"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900 dark:text-ndark-text">{p.name}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:bg-ndark-surface dark:text-ndark-muted">
                        {p.code}
                      </span>
                      {p.supportLevel && (
                        <span title="Varsayılan destek seviyesi">
                          <Badge tint={p.supportLevel === 'L1' ? 'slate' : p.supportLevel === 'L2' ? 'amber' : 'rose'}>
                            {SUPPORT_LEVEL_LABELS[p.supportLevel as SupportLevel] ?? p.supportLevel}
                          </Badge>
                        </span>
                      )}
                      {!p.isActive && <Badge tint="slate">Pasif</Badge>}
                    </div>
                    {p.description && (
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-ndark-muted">{p.description}</p>
                    )}
                  </div>
                  {writeAllowed && (
                    <button
                      type="button"
                      onClick={() => setProductEditor({ mode: 'edit', product: p })}
                      title="Düzenle"
                      aria-label={`${p.name} ürününü düzenle`}
                      className="shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-ndark-muted dark:hover:bg-ndark-surface dark:hover:text-ndark-text"
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <ProductGroupEditor
        open={groupEditor !== null}
        mode={groupEditor?.mode ?? 'add'}
        companyId={companyId}
        group={groupEditor && groupEditor.mode === 'edit' ? groupEditor.group : null}
        onClose={() => setGroupEditor(null)}
        onSaved={async (saved, action) => {
          setGroupEditor(null);
          if (action === 'created' && saved) setSelectedGroupId(saved.id);
          await loadGroups();
          toast({ type: 'success', message: action === 'created' ? 'Ürün grubu eklendi.' : 'Ürün grubu güncellendi.' });
        }}
      />

      <ProductEditor
        open={productEditor !== null}
        mode={productEditor?.mode ?? 'add'}
        companyId={companyId}
        groups={groups}
        defaultGroupId={
          productEditor && productEditor.mode === 'add'
            ? productEditor.groupId
            : productEditor && productEditor.mode === 'edit'
              ? productEditor.product.productGroupId
              : ''
        }
        product={productEditor && productEditor.mode === 'edit' ? productEditor.product : null}
        onClose={() => setProductEditor(null)}
        onSaved={async (action) => {
          setProductEditor(null);
          await loadProducts(selectedGroupId);
          toast({ type: 'success', message: action === 'created' ? 'Ürün eklendi.' : 'Ürün güncellendi.' });
        }}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * ProductGroup Editor
 * ────────────────────────────────────────────────────────────────────────── */

function ProductGroupEditor({
  open,
  mode,
  companyId,
  group,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: 'add' | 'edit';
  companyId: string;
  group?: ProductGroup | null;
  onClose: () => void;
  onSaved: (saved: ProductGroup | null, action: 'created' | 'updated') => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState<number>(0);
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === 'edit' && group) {
      setCode(group.code);
      setName(group.name);
      setDescription(group.description ?? '');
      setSortOrder(group.sortOrder);
      setIsActive(group.isActive);
    } else {
      setCode('');
      setName('');
      setDescription('');
      setSortOrder(0);
      setIsActive(true);
    }
  }, [open, mode, group]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === 'add' && !code.trim()) { setError('Kod zorunlu.'); return; }
    if (!name.trim()) { setError('Ad zorunlu.'); return; }
    setSubmitting(true);
    if (mode === 'add') {
      const input: ProductGroupInput = {
        companyId,
        code: code.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim() || null,
        sortOrder,
        isActive,
      };
      const r = await adminService.productGroups.create(input);
      setSubmitting(false);
      if (r.ok) onSaved(r.item, 'created');
    } else if (group) {
      // code immutable; don't send it.
      const patch: Partial<ProductGroupInput> = {
        name: name.trim(),
        description: description.trim() || null,
        sortOrder,
        isActive,
      };
      const r = await adminService.productGroups.update(group.id, patch);
      setSubmitting(false);
      if (r.ok) onSaved(r.item, 'updated');
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={mode === 'add' ? 'Yeni Ürün Grubu' : 'Ürün Grubunu Düzenle'}
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-3">
          <Button variant="outline" type="button" onClick={onClose} disabled={submitting}>Vazgeç</Button>
          <Button type="submit" form="admin-product-group-form" disabled={submitting}>
            {submitting ? 'Kaydediliyor…' : mode === 'add' ? 'Grup Ekle' : 'Değişiklikleri Kaydet'}
          </Button>
        </div>
      }
    >
      <form id="admin-product-group-form" onSubmit={handleSubmit} className="space-y-4 p-5">
        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Kod"
            required={mode === 'add'}
            hint={mode === 'edit' ? 'Kod oluşturma sonrası değiştirilemez.' : 'ASCII büyük harf/rakam/_/- (örn. POS, SAHA, BANKA)'}
          >
            <TextInput
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={64}
              autoFocus={mode === 'add'}
              disabled={mode === 'edit'}
              className="font-mono"
            />
          </Field>
          <Field label="Ad" required>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn. POS Çözümleri" />
          </Field>
        </div>
        <Field label="Açıklama">
          <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Sıralama" hint="Liste sırası (küçük öne)">
            <TextInput type="number" value={String(sortOrder)} onChange={(e) => setSortOrder(Number(e.target.value) || 0)} />
          </Field>
          <Field label="Durum">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-ndark-text">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-ndark-border dark:bg-ndark-surface"
              />
              <span>Aktif</span>
            </label>
          </Field>
        </div>
      </form>
    </Modal>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Product Editor
 * ────────────────────────────────────────────────────────────────────────── */

function ProductEditor({
  open,
  mode,
  companyId,
  groups,
  defaultGroupId,
  product,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: 'add' | 'edit';
  companyId: string;
  groups: ProductGroup[];
  defaultGroupId: string;
  product?: Product | null;
  onClose: () => void;
  onSaved: (action: 'created' | 'updated') => void;
}) {
  const [productGroupId, setProductGroupId] = useState(defaultGroupId);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState<number>(0);
  const [isActive, setIsActive] = useState(true);
  const [supportLevel, setSupportLevel] = useState<SupportLevel>('L1');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === 'edit' && product) {
      setProductGroupId(product.productGroupId);
      setCode(product.code);
      setName(product.name);
      setDescription(product.description ?? '');
      setSortOrder(product.sortOrder);
      setIsActive(product.isActive);
      setSupportLevel((product.supportLevel as SupportLevel | undefined) ?? 'L1');
    } else {
      setProductGroupId(defaultGroupId);
      setCode('');
      setName('');
      setDescription('');
      setSortOrder(0);
      setIsActive(true);
      setSupportLevel('L1');
    }
  }, [open, mode, product, defaultGroupId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!productGroupId) { setError('Grup seç.'); return; }
    if (mode === 'add' && !code.trim()) { setError('Kod zorunlu.'); return; }
    if (!name.trim()) { setError('Ad zorunlu.'); return; }
    setSubmitting(true);
    if (mode === 'add') {
      const input: ProductInput = {
        companyId,
        productGroupId,
        code: code.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim() || null,
        sortOrder,
        isActive,
        supportLevel,
      };
      const r = await adminService.products.create(input);
      setSubmitting(false);
      if (r.ok) onSaved('created');
    } else if (product) {
      const patch: Partial<ProductInput> = {
        productGroupId,
        name: name.trim(),
        description: description.trim() || null,
        sortOrder,
        isActive,
        supportLevel,
      };
      const r = await adminService.products.update(product.id, patch);
      setSubmitting(false);
      if (r.ok) onSaved('updated');
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={mode === 'add' ? 'Yeni Ürün' : 'Ürünü Düzenle'}
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-3">
          <Button variant="outline" type="button" onClick={onClose} disabled={submitting}>Vazgeç</Button>
          <Button type="submit" form="admin-product-form" disabled={submitting}>
            {submitting ? 'Kaydediliyor…' : mode === 'add' ? 'Ürün Ekle' : 'Değişiklikleri Kaydet'}
          </Button>
        </div>
      }
    >
      <form id="admin-product-form" onSubmit={handleSubmit} className="space-y-4 p-5">
        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </div>
        )}
        <Field label="Ürün Grubu" required>
          <Select value={productGroupId} onChange={(e) => setProductGroupId(e.target.value)}>
            <option value="">Grup seç…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.code} — {g.name}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Kod"
            required={mode === 'add'}
            hint={mode === 'edit' ? 'Kod oluşturma sonrası değiştirilemez.' : 'ASCII; örn. PARAMPOS, ENROUTE'}
          >
            <TextInput
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={64}
              autoFocus={mode === 'add'}
              disabled={mode === 'edit'}
              className="font-mono"
            />
          </Field>
          <Field label="Ad" required>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn. ParamPOS" />
          </Field>
        </div>
        <Field label="Açıklama">
          <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </Field>
        <Field
          label="Varsayılan Destek Seviyesi"
          hint="Bu ürüne bağlı vaka açılışında default tier (L1/L2/L3/Uzman). A7b sonrası case form'una bağlanacak."
        >
          <Select value={supportLevel} onChange={(e) => setSupportLevel(e.target.value as SupportLevel)}>
            {SUPPORT_LEVELS.map((s) => (
              <option key={s} value={s}>
                {SUPPORT_LEVEL_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Sıralama">
            <TextInput type="number" value={String(sortOrder)} onChange={(e) => setSortOrder(Number(e.target.value) || 0)} />
          </Field>
          <Field label="Durum">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-ndark-text">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-ndark-border dark:bg-ndark-surface"
              />
              <span>Aktif</span>
            </label>
          </Field>
        </div>
      </form>
    </Modal>
  );
}
