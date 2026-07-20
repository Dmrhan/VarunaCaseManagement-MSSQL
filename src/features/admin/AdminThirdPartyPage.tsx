import { useEffect, useMemo, useState } from 'react';
import { Network, Pencil, Power, PowerOff, Trash2 } from 'lucide-react';
import { CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, TextArea, TextInput } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { adminService, type ThirdPartyInput } from '@/services/adminService';
import type { CaseThirdParty } from '@/features/cases/types';
import { AdminListLayout } from './AdminListLayout';
import { THIRD_PARTY_HELP } from './helpContents';
import { CompanySelector } from '@/components/ui/CompanySelector';
import { lookupService } from '@/services/caseService';

export function AdminThirdPartyPage() {
  const [items, setItems] = useState<CaseThirdParty[]>([]);
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const companies = useMemo(() => lookupService.companies(), []);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const list = selectedCompanyId
        ? await adminService.thirdParties.listByCompany(selectedCompanyId)
        : await adminService.thirdParties.list();
      setItems(list);
    } catch (e) {
      setError((e as Error).message ?? 'Bilinmeyen hata');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void refresh(); }, [selectedCompanyId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        (it.description ?? '').toLowerCase().includes(q),
    );
  }, [items, search]);

  async function handleToggleActive(item: CaseThirdParty) {
    const r = await adminService.thirdParties.setActive(item.id, !item.isActive);
    if (r.ok) {
      await refresh();
      toast({
        type: 'success',
        message: r.item.isActive ? `"${r.item.name}" aktif edildi.` : `"${r.item.name}" pasif edildi.`,
        duration: 2000,
      });
    } else {
      toast({ type: 'error', message: r.error });
    }
  }

  async function handleDelete(item: CaseThirdParty) {
    const usage = adminService.thirdParties.usage(item.id).count;
    const msg =
      usage > 0
        ? `"${item.name}" toplam ${usage} vakada kullanılıyor. Silinince yeni vaka geçişlerinde görünmez (mevcut vakalardaki ad korunur). Devam edilsin mi?`
        : `"${item.name}" silinsin mi?`;
    if (!window.confirm(msg)) return;
    const r = await adminService.thirdParties.remove(item.id);
    if (r.ok) {
      await refresh();
      toast({ type: 'warn', message: `"${item.name}" silindi.`, duration: 2500 });
    } else {
      toast({ type: 'error', message: r.error });
    }
  }

  return (
    <>
      <AdminListLayout
        title="3. Parti Tanımları"
        description="3rdPartyBekleniyor statüsünde seçilebilen 3. parti listesi (Hukuk, Jira, Operasyon...)."
        count={items.length}
        searchPlaceholder="İsim veya açıklamaya göre ara…"
        searchValue={search}
        onSearchChange={setSearch}
        onAdd={() => setEditor({ mode: 'create' })}
        addLabel="Yeni 3. Parti"
        helpTitle={THIRD_PARTY_HELP.title}
        helpSections={THIRD_PARTY_HELP.sections}
        loading={loading}
        error={error}
        onRetry={() => void refresh()}
        filters={
          <div className="w-56">
            <CompanySelector
              label="Şirket Filtresi"
              value={selectedCompanyId}
              onChange={(v) => setSelectedCompanyId(v ?? '')}
              allowAll
            />
          </div>
        }
      >
        {filtered.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<Network size={22} />}
              title={search ? 'Aramaya uyan kayıt yok' : 'Henüz tanım yok'}
              description={
                search
                  ? 'Farklı bir terim deneyin.'
                  : 'İlk 3. parti tanımını oluşturarak başlayın.'
              }
              action={
                !search ? (
                  <Button size="sm" onClick={() => setEditor({ mode: 'create' })}>
                    Yeni 3. Parti
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
                  <Th>Şirket</Th>
                  <Th align="right">Kullanım</Th>
                  <Th align="right">Aksiyon</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((it) => {
                  const usage = adminService.thirdParties.usage(it.id).count;
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
                      <Td>
                        {it.companyId
                          ? (companies.find((c) => c.id === it.companyId)?.name ?? it.companyId)
                          : <span className="text-slate-400 text-xs">Sistem geneli</span>}
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

      <ThirdPartyEditModal
        open={editor !== null}
        mode={editor?.mode ?? 'create'}
        editingId={editor?.mode === 'edit' ? editor.id : null}
        defaultCompanyId={selectedCompanyId || undefined}
        companies={companies}
        onClose={() => setEditor(null)}
        onSaved={refresh}
      />
    </>
  );
}

// ----------------------------------------------------------------
// Edit Modal
// ----------------------------------------------------------------

function ThirdPartyEditModal({
  open,
  mode,
  editingId,
  defaultCompanyId,
  companies,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  editingId: string | null;
  defaultCompanyId?: string;
  companies: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ThirdPartyInput>({ name: '', description: '', isActive: true, companyId: defaultCompanyId, pausesSla: true, triggersExtendedSla: false, extendedSlaRequiresDevopsLink: true, requiresNote: false });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === 'edit' && editingId) {
      void (async () => {
        const item = await adminService.thirdParties.get(editingId);
        if (item) {
          setForm({ name: item.name, description: item.description ?? '', isActive: item.isActive, companyId: item.companyId, pausesSla: item.pausesSla !== false, triggersExtendedSla: item.triggersExtendedSla === true, extendedSlaRequiresDevopsLink: item.extendedSlaRequiresDevopsLink !== false, requiresNote: item.requiresNote === true });
        }
      })();
    } else {
      setForm({ name: '', description: '', isActive: true, companyId: defaultCompanyId || undefined, pausesSla: true, triggersExtendedSla: false, extendedSlaRequiresDevopsLink: true, requiresNote: false });
    }
  }, [open, mode, editingId, defaultCompanyId]);

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    const trimmed: ThirdPartyInput = {
      name: form.name.trim(),
      description: form.description?.trim() || undefined,
      isActive: form.isActive,
      companyId: form.companyId || undefined,
      pausesSla: form.pausesSla !== false,
      triggersExtendedSla: form.triggersExtendedSla === true,
      extendedSlaRequiresDevopsLink: form.extendedSlaRequiresDevopsLink !== false,
      requiresNote: form.requiresNote === true,
    };

    const r =
      mode === 'create'
        ? await adminService.thirdParties.create(trimmed)
        : editingId
          ? await adminService.thirdParties.update(editingId, trimmed)
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
      title={mode === 'create' ? 'Yeni 3. Parti' : '3. Partiyi Düzenle'}
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
        <Field label="İsim" required>
          <TextInput
            autoFocus
            placeholder="ör. Hukuk Departmanı"
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

        <Field label="Açıklama" hint="Opsiyonel — kısa not">
          <TextArea
            placeholder="Bu 3. partinin işlevini açıklayın…"
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
          Aktif — yeni vaka geçişlerinde dropdown'da görünür
        </label>

        {mode === 'edit' ? (
          <Field label="Şirket" hint="Düzenleme modunda şirket değiştirilemez">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-600">
              {form.companyId
                ? (companies.find((c) => c.id === form.companyId)?.name ?? form.companyId)
                : 'Sistem geneli'}
            </div>
          </Field>
        ) : (
          <Field label="Şirket" hint="Boş bırakılırsa sistem geneli olur">
            <select
              value={form.companyId ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value || undefined }))}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Sistem geneli</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
        )}

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.pausesSla !== false}
            onChange={(e) => setForm((f) => ({ ...f, pausesSla: e.target.checked }))}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          Beklenirken SLA dursun
        </label>

        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.requiresNote === true}
            onChange={(e) => setForm((f) => ({ ...f, requiresNote: e.target.checked }))}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          <span>
            Seçildiğinde açıklama zorunlu
            <span className="block text-xs text-slate-500">
              Bu 3. parti seçildiğinde operatör bekleme nedenini yazmadan statü geçişini
              uygulayamaz. Girilen açıklama vaka raporlarında görüntülenebilir.
            </span>
          </span>
        </label>

        {/* Uzatılmış SLA v1 (U-B) — iki parçalı tetik. İkinci anahtar
            birinciye bağlı: kapalıyken soluk + devre dışı. */}
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.triggersExtendedSla === true}
            onChange={(e) => setForm((f) => ({ ...f, triggersExtendedSla: e.target.checked }))}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          <span>
            Uzatılmış çözüm süresi uygular
            <span className="block text-xs text-slate-500">
              Vaka bu tanıma devredildiğinde, SLA kuralındaki "Uzatılmış Çözüm" süresi devreye girer.
              Kural satırında uzatılmış süre boşsa hiçbir şey değişmez.
            </span>
          </span>
        </label>
        <label className={`ml-6 flex items-start gap-2 border-l-2 border-slate-200 pl-3 text-sm text-slate-700 ${form.triggersExtendedSla ? '' : 'opacity-50'}`}>
          <input
            type="checkbox"
            disabled={!form.triggersExtendedSla}
            checked={form.extendedSlaRequiresDevopsLink !== false}
            onChange={(e) => setForm((f) => ({ ...f, extendedSlaRequiresDevopsLink: e.target.checked }))}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          <span>
            Ek şart: vakada DevOps kaydı bulunmalı
            <span className="block text-xs text-slate-500">
              Açıksa uzatma yalnız DevOps iş kaydı bağlı vakalarda uygulanır; kapalıysa devir tek başına yeterlidir.
            </span>
          </span>
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
