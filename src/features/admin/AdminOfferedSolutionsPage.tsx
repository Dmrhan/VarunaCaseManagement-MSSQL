import { useEffect, useMemo, useState } from 'react';
import { Pencil, Power, PowerOff, Tag, Trash2 } from 'lucide-react';
import { CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, TextArea, TextInput } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { adminService, type OfferedSolutionInput } from '@/services/adminService';
import type { OfferedSolutionDef } from '@/features/cases/types';
import { AdminListLayout } from './AdminListLayout';
import { OFFERED_SOLUTIONS_HELP } from './helpContents';

export function AdminOfferedSolutionsPage() {
  const [items, setItems] = useState<OfferedSolutionDef[]>([]);
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null);
  const { toast } = useToast();

  function refresh() {
    setItems(adminService.offeredSolutions.list());
  }
  useEffect(refresh, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        (it.description ?? '').toLowerCase().includes(q),
    );
  }, [items, search]);

  function handleToggleActive(item: OfferedSolutionDef) {
    const r = adminService.offeredSolutions.setActive(item.id, !item.isActive);
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

  function handleDelete(item: OfferedSolutionDef) {
    const usage = adminService.offeredSolutions.usage(item.id).count;
    const msg =
      usage > 0
        ? `"${item.name}" toplam ${usage} vakada sunulmuş. Silinince eski vakalardaki referans "Bilinmeyen teklif" olarak görünür. Silmek yerine pasifleştirme önerilir. Yine de silinsin mi?`
        : `"${item.name}" silinsin mi?`;
    if (!window.confirm(msg)) return;
    const r = adminService.offeredSolutions.remove(item.id);
    if (r.ok) {
      refresh();
      toast({ type: 'warn', message: `"${item.name}" silindi.`, duration: 2500 });
    } else {
      toast({ type: 'error', message: r.error });
    }
  }

  return (
    <>
      <AdminListLayout
        title="Teklif Tanımları"
        description="Churn yönetiminde sunulabilen retention teklifleri (indirim, ücretsiz ay, paket yükseltme...). Pasif teklifler yeni Churn vakalarında dropdown'da görünmez."
        count={items.length}
        searchPlaceholder="Teklif adı veya açıklamaya göre ara…"
        searchValue={search}
        onSearchChange={setSearch}
        onAdd={() => setEditor({ mode: 'create' })}
        addLabel="Yeni Teklif"
        helpTitle={OFFERED_SOLUTIONS_HELP.title}
        helpSections={OFFERED_SOLUTIONS_HELP.sections}
      >
        {filtered.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<Tag size={22} />}
              title={search ? 'Aramaya uyan teklif yok' : 'Henüz teklif yok'}
              description={
                search
                  ? 'Farklı bir terim deneyin.'
                  : 'İlk retention teklifini oluşturarak başlayın.'
              }
              action={
                !search ? (
                  <Button size="sm" onClick={() => setEditor({ mode: 'create' })}>
                    Yeni Teklif
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
                  <Th>İsim</Th>
                  <Th>Açıklama</Th>
                  <Th>Durum</Th>
                  <Th align="right">Sunulduğu Vaka</Th>
                  <Th align="right">Aksiyon</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((it) => {
                  const usage = adminService.offeredSolutions.usage(it.id).count;
                  return (
                    <tr key={it.id} className="hover:bg-slate-50">
                      <Td>
                        <div className="font-medium text-slate-800">{it.name}</div>
                        <div className="font-mono text-[10px] text-slate-400">{it.id}</div>
                      </Td>
                      <Td className="text-slate-600">{it.description ?? <span className="text-slate-400">—</span>}</Td>
                      <Td>
                        {it.isActive ? (
                          <Badge tint="emerald">Aktif</Badge>
                        ) : (
                          <Badge tint="slate">Pasif</Badge>
                        )}
                      </Td>
                      <Td align="right">
                        {usage > 0 ? (
                          <Badge tint="blue">{usage}</Badge>
                        ) : (
                          <span className="text-xs text-slate-400">0</span>
                        )}
                      </Td>
                      <Td align="right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setEditor({ mode: 'edit', id: it.id })}
                            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                            title="Düzenle"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleActive(it)}
                            className={`rounded p-1.5 hover:bg-slate-100 ${
                              it.isActive
                                ? 'text-amber-600 hover:text-amber-700'
                                : 'text-emerald-600 hover:text-emerald-700'
                            }`}
                            title={it.isActive ? 'Pasifleştir' : 'Aktifleştir'}
                          >
                            {it.isActive ? <PowerOff size={14} /> : <Power size={14} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(it)}
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

      <OfferedSolutionEditModal
        open={editor !== null}
        mode={editor?.mode ?? 'create'}
        editingId={editor?.mode === 'edit' ? editor.id : null}
        onClose={() => setEditor(null)}
        onSaved={refresh}
      />
    </>
  );
}

// ----------------------------------------------------------------
// Edit Modal
// ----------------------------------------------------------------

function OfferedSolutionEditModal({
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
  const [form, setForm] = useState<OfferedSolutionInput>({ name: '', description: '', isActive: true });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === 'edit' && editingId) {
      const item = adminService.offeredSolutions.get(editingId);
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
    const trimmed: OfferedSolutionInput = {
      name: form.name.trim(),
      description: form.description?.trim() || undefined,
      isActive: form.isActive,
    };

    const r =
      mode === 'create'
        ? adminService.offeredSolutions.create(trimmed)
        : editingId
          ? adminService.offeredSolutions.update(editingId, trimmed)
          : null;

    setSubmitting(false);

    if (!r) {
      setError('Teklif bulunamadı.');
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
      message: mode === 'create'
        ? `"${r.item.name}" oluşturuldu.`
        : `"${r.item.name}" güncellendi.`,
      duration: 2500,
    });
  }

  const canSubmit = form.name.trim().length > 0 && !submitting;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={mode === 'create' ? 'Yeni Teklif' : 'Teklifi Düzenle'}
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
        <Field label="Teklif Adı" required>
          <TextInput
            autoFocus
            placeholder="ör. %10 İndirim"
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

        <Field label="Açıklama" hint="Opsiyonel — teklifin koşulları/süresi">
          <TextArea
            placeholder="Teklifin geçerlilik süresi, koşulları, kime sunulabileceği…"
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
          Aktif — yeni Churn vakalarında dropdown'da görünür
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
