import { useEffect, useMemo, useState } from 'react';
import { Pencil, Power, PowerOff, Tag } from 'lucide-react';
import { CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, Select, TextInput } from '@/components/ui/Field';
import { CompanySelector } from '@/components/ui/CompanySelector';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { lookupService } from '@/services/caseService';
import {
  adminService,
  SMART_TICKET_TAXONOMY_TYPES,
  SMART_TICKET_TAXONOMY_TYPE_LABELS,
  type SmartTicketTaxonomyType,
  type TaxonomyDef,
  type TaxonomyDefInput,
} from '@/services/adminService';
import { AdminListLayout } from './AdminListLayout';
import { TAXONOMY_DEFS_HELP } from './helpContents';

/**
 * WR-Smart-Ticket Phase 1b — TaxonomyDef admin maintenance page.
 *
 * Sade bir liste/edit ekranı. companyId + taxonomyType seçimi zorunlu;
 * SmartTicket intake UI, KB adapter ve CaseSolutionStep KAPSAM DIŞI.
 *
 * Soft delete: Sil yok, "Pasifleştir" (isActive=false). UI bu durumu
 * "Aktif/Pasif" badge'i ile gösterir.
 *
 * Hiyerarşi:
 *   - rootCauseDetail: parent (rootCauseGroup) zorunlu
 *   - rootCauseGroup: parent yasak
 *   - Diğer 7 tip flat (parent alanı UI'da gizli)
 */
export function AdminTaxonomyDefsPage() {
  const companies = useMemo(() => lookupService.companies(), []);
  const defaultCompanyId = companies[0]?.id ?? '';
  const [companyId, setCompanyId] = useState<string>(defaultCompanyId);
  const [taxonomyType, setTaxonomyType] = useState<SmartTicketTaxonomyType>('businessProcess');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [items, setItems] = useState<TaxonomyDef[]>([]);
  const [parents, setParents] = useState<TaxonomyDef[]>([]);
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  async function refresh() {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const list = await adminService.taxonomyDefs.list({
        companyId,
        taxonomyType,
        isActive: includeInactive ? undefined : true,
      });
      setItems(list);
      if (taxonomyType === 'rootCauseDetail') {
        // Parent dropdown için rootCauseGroup listesi (aktif olanlar).
        const groups = await adminService.taxonomyDefs.list({
          companyId,
          taxonomyType: 'rootCauseGroup',
          isActive: true,
        });
        setParents(groups);
      } else {
        setParents([]);
      }
    } catch (e) {
      setError((e as Error).message ?? 'Bilinmeyen hata');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, taxonomyType, includeInactive]);

  const parentLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of parents) m.set(p.id, p.label);
    return m;
  }, [parents]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (t) => t.label.toLowerCase().includes(q) || t.code.toLowerCase().includes(q),
    );
  }, [items, search]);

  async function handleToggleActive(row: TaxonomyDef) {
    const r = await adminService.taxonomyDefs.setActive(row.id, !row.isActive);
    if (r.ok) {
      await refresh();
      toast({
        type: 'success',
        message: r.item.isActive ? `"${r.item.label}" aktif edildi.` : `"${r.item.label}" pasifleştirildi.`,
        duration: 2000,
      });
    } else {
      toast({ type: 'error', message: r.error });
    }
  }

  if (!companyId) {
    return (
      <AdminListLayout
        title="Akıllı Ticket Tanımları"
        description="Smart Ticket dropdown'ları için per-tenant taxonomy tanımları."
        helpTitle={TAXONOMY_DEFS_HELP.title}
        helpSections={TAXONOMY_DEFS_HELP.sections}
      >
        <CardBody>
          <EmptyState
            icon={<Tag size={22} />}
            title="Şirket seçilmedi"
            description="Yönetim için bir şirket seçin."
          />
        </CardBody>
      </AdminListLayout>
    );
  }

  return (
    <>
      <AdminListLayout
        title="Akıllı Ticket Tanımları"
        description="Smart Ticket intake/closure dropdown'ları için taxonomy tanımları (platform, iş süreci, kök neden vs.)."
        count={filtered.length}
        searchPlaceholder="Etiket veya koda göre ara…"
        searchValue={search}
        onSearchChange={setSearch}
        onAdd={() => setEditor({ mode: 'create' })}
        addLabel="Yeni Tanım"
        helpTitle={TAXONOMY_DEFS_HELP.title}
        helpSections={TAXONOMY_DEFS_HELP.sections}
        loading={loading}
        error={error}
        onRetry={() => void refresh()}
        filters={
          <div className="flex items-end gap-3">
            <div className="w-52">
              <CompanySelector
                label="Şirket"
                value={companyId}
                onChange={(id) => setCompanyId(id ?? '')}
                required
              />
            </div>
            <div className="w-52">
              <Field label="Taxonomy Tipi">
                <Select
                  value={taxonomyType}
                  onChange={(e) => setTaxonomyType(e.target.value as SmartTicketTaxonomyType)}
                >
                  {SMART_TICKET_TAXONOMY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {SMART_TICKET_TAXONOMY_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <label className="flex items-center gap-2 pb-1.5 text-sm text-slate-700 dark:text-ndark-muted">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              Pasifleri göster
            </label>
          </div>
        }
      >
        {filtered.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<Tag size={22} />}
              title={search ? 'Aramaya uyan kayıt yok' : 'Henüz tanım yok'}
              description={
                search
                  ? 'Farklı bir terim deneyin.'
                  : `${SMART_TICKET_TAXONOMY_TYPE_LABELS[taxonomyType]} altında ilk tanımı oluşturarak başlayın.`
              }
              action={
                !search ? (
                  <Button size="sm" onClick={() => setEditor({ mode: 'create' })}>
                    Yeni Tanım
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
                  <Th>Etiket</Th>
                  <Th>Kod</Th>
                  {taxonomyType === 'rootCauseDetail' && <Th>Üst Kök Neden</Th>}
                  <Th align="right">Sıra</Th>
                  <Th>Durum</Th>
                  <Th align="right">Aksiyon</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <Td>
                      <div className="font-medium text-slate-800">{row.label}</div>
                      <div className="font-mono text-[10px] text-slate-400">{row.id}</div>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs text-slate-600">{row.code}</span>
                    </Td>
                    {taxonomyType === 'rootCauseDetail' && (
                      <Td className="text-slate-600">
                        {row.parentId ? (
                          parentLabelById.get(row.parentId) ?? (
                            <span className="font-mono text-xs text-slate-400">{row.parentId}</span>
                          )
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </Td>
                    )}
                    <Td align="right" className="text-slate-600">{row.sortOrder}</Td>
                    <Td>
                      {row.isActive ? (
                        <Badge tint="emerald">Aktif</Badge>
                      ) : (
                        <Badge tint="slate">Pasif</Badge>
                      )}
                    </Td>
                    <Td align="right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setEditor({ mode: 'edit', id: row.id })}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                          title="Düzenle"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggleActive(row)}
                          className={`rounded p-1.5 hover:bg-slate-100 ${
                            row.isActive
                              ? 'text-amber-600 hover:text-amber-700'
                              : 'text-emerald-600 hover:text-emerald-700'
                          }`}
                          title={row.isActive ? 'Pasifleştir' : 'Aktifleştir'}
                        >
                          {row.isActive ? <PowerOff size={14} /> : <Power size={14} />}
                        </button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminListLayout>

      <TaxonomyEditModal
        open={editor !== null}
        mode={editor?.mode ?? 'create'}
        editingId={editor?.mode === 'edit' ? editor.id : null}
        companyId={companyId}
        taxonomyType={taxonomyType}
        parents={parents}
        onClose={() => setEditor(null)}
        onSaved={() => {
          void refresh();
        }}
      />
    </>
  );
}

// ───────────────────────────────────────────────────────────────────
// Edit modal
// ───────────────────────────────────────────────────────────────────

function TaxonomyEditModal({
  open,
  mode,
  editingId,
  companyId,
  taxonomyType,
  parents,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  editingId: string | null;
  companyId: string;
  taxonomyType: SmartTicketTaxonomyType;
  parents: TaxonomyDef[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<TaxonomyDefInput>({
    companyId,
    taxonomyType,
    code: '',
    label: '',
    parentId: null,
    isActive: true,
    sortOrder: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === 'edit' && editingId) {
      let cancelled = false;
      void (async () => {
        const list = await adminService.taxonomyDefs.list({ companyId, taxonomyType });
        if (cancelled) return;
        const item = list.find((x) => x.id === editingId);
        if (item) {
          setForm({
            companyId: item.companyId,
            taxonomyType: item.taxonomyType,
            code: item.code,
            label: item.label,
            parentId: item.parentId,
            isActive: item.isActive,
            sortOrder: item.sortOrder,
          });
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    setForm({
      companyId,
      taxonomyType,
      code: '',
      label: '',
      parentId: null,
      isActive: true,
      sortOrder: 0,
    });
  }, [open, mode, editingId, companyId, taxonomyType]);

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    const trimmed: TaxonomyDefInput = {
      companyId: form.companyId,
      taxonomyType: form.taxonomyType,
      code: form.code.trim(),
      label: form.label.trim(),
      parentId: form.taxonomyType === 'rootCauseDetail' ? (form.parentId || null) : null,
      isActive: form.isActive ?? true,
      sortOrder: Number.isFinite(form.sortOrder) ? Number(form.sortOrder) : 0,
    };

    const r =
      mode === 'create'
        ? await adminService.taxonomyDefs.create(trimmed)
        : editingId
          ? await adminService.taxonomyDefs.update(editingId, trimmed)
          : null;

    setSubmitting(false);

    if (!r) {
      setError('Kayıt bulunamadı.');
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
      message:
        mode === 'create'
          ? `"${r.item.label}" oluşturuldu.`
          : `"${r.item.label}" güncellendi.`,
      duration: 2500,
    });
  }

  const isRcDetail = form.taxonomyType === 'rootCauseDetail';
  const canSubmit =
    form.code.trim().length > 0 &&
    form.label.trim().length > 0 &&
    (!isRcDetail || !!form.parentId) &&
    !submitting;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={mode === 'create' ? 'Yeni Taxonomy Tanımı' : 'Taxonomy Tanımını Düzenle'}
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
        <Field label="Şirket">
          <TextInput value={form.companyId} disabled />
        </Field>

        <Field label="Taxonomy Tipi" hint="Oluşturulduktan sonra değiştirilemez.">
          <TextInput value={SMART_TICKET_TAXONOMY_TYPE_LABELS[form.taxonomyType]} disabled />
        </Field>

        <Field label="Etiket (label)" required>
          <TextInput
            autoFocus
            placeholder="ör. CRM İşlemleri"
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          />
        </Field>

        <Field
          label="Kod (code)"
          required
          hint="ASCII slug — şirket + taxonomy tipi içinde benzersiz olmalı."
        >
          <TextInput
            placeholder="ör. bp.crm_islemleri"
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
          />
        </Field>

        {isRcDetail && (
          <Field
            label="Üst Kök Neden Grubu"
            required
            hint="Kök neden detayları bir gruba bağlanmak zorundadır."
          >
            <Select
              value={form.parentId ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, parentId: e.target.value || null }))}
            >
              <option value="">— Seçin —</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Sıralama" hint="Küçük değer önce gelir.">
          <TextInput
            type="number"
            value={String(form.sortOrder ?? 0)}
            onChange={(e) =>
              setForm((f) => ({ ...f, sortOrder: Number(e.target.value) || 0 }))
            }
          />
        </Field>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.isActive ?? true}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          Aktif — dropdown'larda görünür
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

// ───────────────────────────────────────────────────────────────────
// Table primitives
// ───────────────────────────────────────────────────────────────────

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}>{children}</th>
  );
}
function Td({
  children,
  align = 'left',
  className = '',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <td className={`px-3 py-2 ${align === 'right' ? 'text-right' : ''} ${className}`}>{children}</td>
  );
}
