/**
 * Mail M6.3b Faz 3 — Admin Email Template CRUD UI.
 *
 * Plan referansı: M6.3b plan §Faz 3.
 * n4b parite (Zendesk macros, Freshdesk canned responses, Freshservice
 * canned responses): admin tablo list + inline form CRUD + preview.
 *
 * GUARD: admin route'lar assertCompanyAdmin (M5-ext desen birebir kopya).
 * Bu UI sadece SystemAdmin/Admin rolündeki kullanıcıların erişebileceği
 * admin layout altında render.
 *
 * REUSE: AdminExternalMailPage company picker + form deseni.
 */
import { useEffect, useMemo, useState } from 'react';
import { FileText, Plus, Trash2, Eye, Pencil, Save, X } from 'lucide-react';
import { sanitizeMailHtml } from '@/lib/sanitizeMailHtml';
import { Button } from '@/components/ui/Button';
import { Field, TextArea, TextInput } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { lookupService } from '@/services/caseService';
import { adminService, type CaseEmailTemplateRow, type CaseEmailTemplateDraft } from '@/services/adminService';

const SYSTEM_PLACEHOLDERS = [
  'case.number',
  'case.title',
  'account.name',
  'requester.name',
  'requester.email',
  'agent.fullName',
];

interface PreviewState {
  templateId: string;
  subject: string | null;
  bodyHtml: string;
  missing: string[];
}

export function AdminEmailTemplatesPage() {
  const { toast } = useToast();
  // Şirket seçici — AdminExternalMail deseni (lookupService.companies()).
  const companyOptions = useMemo(() => lookupService.companies(), []);
  const [companyId, setCompanyId] = useState<string>(companyOptions[0]?.id ?? '');
  useEffect(() => {
    if (!companyId && companyOptions[0]) setCompanyId(companyOptions[0].id);
  }, [companyOptions, companyId]);

  const [rows, setRows] = useState<CaseEmailTemplateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<null | (CaseEmailTemplateDraft & { id?: string })>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  async function refresh() {
    if (!companyId) return;
    setLoading(true);
    try {
      const items = await adminService.caseEmailTemplates.list(companyId);
      setRows(items);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void refresh(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (!editing || !companyId) return;
    const draft: CaseEmailTemplateDraft = {
      name: editing.name,
      category: editing.category,
      subject: editing.subject,
      bodyHtml: editing.bodyHtml,
      variables: editing.variables ?? JSON.stringify(SYSTEM_PLACEHOLDERS),
      isActive: editing.isActive ?? true,
    };
    const result = editing.id
      ? await adminService.caseEmailTemplates.update(companyId, editing.id, draft)
      : await adminService.caseEmailTemplates.create(companyId, draft);
    if (result) {
      toast({ type: 'success', title: 'Şablon kaydedildi', message: result.name });
      setEditing(null);
      await refresh();
    }
  }

  async function handleDelete(id: string) {
    if (!companyId) return;
    if (!confirm('Bu şablonu silmek istediğine emin misin?')) return;
    const ok = await adminService.caseEmailTemplates.remove(companyId, id);
    if (ok) {
      toast({ type: 'success', title: 'Şablon silindi', message: '' });
      await refresh();
    }
  }

  async function handlePreview(id: string) {
    if (!companyId) return;
    const out = await adminService.caseEmailTemplates.preview(companyId, id);
    if (out) {
      setPreview({ templateId: id, subject: out.subject, bodyHtml: out.bodyHtml, missing: out.missing });
    }
  }

  if (companyOptions.length === 0) {
    return (
      <div className="p-6 text-sm text-slate-500">
        Bu sayfayı görüntülemek için en az bir şirkette Admin/SystemAdmin rolüne sahip olmalısın.
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-800 dark:text-ndark-text">
          <FileText size={18} />
          Mail Şablonları
        </h1>
        <div className="flex items-center gap-2">
          <Field label="Şirket" className="w-56">
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-text"
            >
              {companyOptions.map((c: { id: string; name: string }) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Button
            type="button"
            variant="primary"
            leftIcon={<Plus size={13} />}
            onClick={() => setEditing({ name: '', bodyHtml: '', isActive: true })}
          >
            Yeni Şablon
          </Button>
        </div>
      </header>

      {editing && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-ndark-border dark:bg-ndark-card">
          <h2 className="mb-2 text-sm font-medium">
            {editing.id ? 'Şablonu Düzenle' : 'Yeni Şablon'}
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Ad *">
              <TextInput
                value={editing.name ?? ''}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="Örn: İade Onay Bildirimi"
              />
            </Field>
            <Field label="Kategori">
              <TextInput
                value={editing.category ?? ''}
                onChange={(e) => setEditing({ ...editing, category: e.target.value || null })}
                placeholder="Örn: İade, Bilgi Talebi"
              />
            </Field>
          </div>
          <Field label="Konu (opsiyonel)" className="mt-2">
            <TextInput
              value={editing.subject ?? ''}
              onChange={(e) => setEditing({ ...editing, subject: e.target.value || null })}
              placeholder="Örn: RE: {{case.number}} {{case.title}}"
            />
          </Field>
          <Field label="Gövde * (HTML)" className="mt-2">
            <TextArea
              rows={6}
              value={editing.bodyHtml ?? ''}
              onChange={(e) => setEditing({ ...editing, bodyHtml: e.target.value })}
              placeholder='Örn: <p>Sayın {{requester.name}},</p><p>...</p>'
              className="font-mono text-xs"
            />
          </Field>
          <p className="mt-1 text-[10px] text-slate-500">
            Desteklenen placeholder'lar: {SYSTEM_PLACEHOLDERS.map((p) => `{{${p}}}`).join(', ')}
          </p>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={editing.isActive !== false}
              onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
            />
            Aktif (composer dropdown'da görünür)
          </label>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              Vazgeç
            </Button>
            <Button
              type="button"
              variant="primary"
              leftIcon={<Save size={13} />}
              onClick={() => void handleSave()}
            >
              Kaydet
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-ndark-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-ndark-card dark:text-ndark-muted">
            <tr>
              <th className="px-2 py-2">Ad</th>
              <th className="px-2 py-2">Kategori</th>
              <th className="px-2 py-2">Konu</th>
              <th className="px-2 py-2">Aktif</th>
              <th className="px-2 py-2 text-right">İşlem</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-ndark-card">
            {loading ? (
              <tr><td colSpan={5} className="px-2 py-6 text-center text-slate-400">Yükleniyor…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-2 py-6 text-center text-slate-400">Henüz şablon yok.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 dark:border-ndark-border">
                  <td className="px-2 py-2 font-medium">{r.name}</td>
                  <td className="px-2 py-2 text-slate-500">{r.category ?? '—'}</td>
                  <td className="px-2 py-2 text-slate-500">
                    <span className="block max-w-[300px] truncate" title={r.subject ?? ''}>
                      {r.subject ?? '—'}
                    </span>
                  </td>
                  <td className="px-2 py-2">{r.isActive ? '✓' : '—'}</td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void handlePreview(r.id)}
                      className="rounded p-1 text-slate-500 hover:bg-slate-100"
                      title="Önizleme"
                    >
                      <Eye size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing({ ...r })}
                      className="rounded p-1 text-slate-500 hover:bg-slate-100"
                      title="Düzenle"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(r.id)}
                      className="rounded p-1 text-rose-500 hover:bg-rose-50"
                      title="Sil"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPreview(null)}>
          <div
            className="w-full max-w-2xl rounded-lg bg-white p-4 shadow-xl dark:bg-ndark-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Şablon Önizleme</h3>
              <button onClick={() => setPreview(null)} aria-label="Kapat">
                <X size={14} />
              </button>
            </div>
            {preview.missing.length > 0 && (
              <div className="mb-2 rounded border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-800">
                Bilinmeyen placeholder: {preview.missing.map((m) => `{{${m}}}`).join(', ')}
              </div>
            )}
            {preview.subject && (
              <div className="mb-2">
                <label className="text-[10px] font-medium text-slate-500">Konu</label>
                <p className="font-mono text-xs">{preview.subject}</p>
              </div>
            )}
            <label className="text-[10px] font-medium text-slate-500">Gövde</label>
            <div
              className="prose prose-sm max-w-none rounded border border-slate-200 bg-slate-50 p-2 text-xs dark:prose-invert"
              // Compose-Signature F4 — Defense-in-depth: paylaşılan
              // sanitizeMailHtml (backend allowlist'iyle birebir hizalı).
              // Codex P2 fix: tablo attrs (border, cellpadding, ...) preserve.
              dangerouslySetInnerHTML={{ __html: sanitizeMailHtml(preview.bodyHtml) }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminEmailTemplatesPage;
