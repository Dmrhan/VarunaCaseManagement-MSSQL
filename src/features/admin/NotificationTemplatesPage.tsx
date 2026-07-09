import { useEffect, useMemo, useState } from 'react';
import { Eye, MessageSquare, Pencil, Power, PowerOff } from 'lucide-react';
import { CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { CompanySelector } from '@/components/ui/CompanySelector';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import {
  notificationService,
  type NotificationTemplate,
  type TemplateCreateInput,
} from '@/services/notificationService';
import { lookupService } from '@/services/caseService';
import { sanitizeMailHtml } from '@/lib/sanitizeMailHtml';
import { AdminListLayout } from './AdminListLayout';
import { NOTIFICATION_TEMPLATES_HELP } from './helpContents';

const VARIABLE_OPTIONS = [
  'case.number',
  'case.title',
  'case.description',
  'case.priority',
  'case.status',
  'case.category',
  'case.subCategory',
  'account.name',
  'company.name',
  'assignee.name',
  'team.name',
  'resolution.summary',
  'resolution.customerMessage',
  'approval.rejectionReason',
  'approval.approverName',
  // Müşteri-yüzü + HTML şablon değişkenleri (BE ALLOWED_VARIABLE_PATHS ile hizalı)
  'requester.name',
  'requester.email',
  'case.url',
  'company.logoUrl',
  'app.logoUrl',
  'case.lastCustomerMessage',
];

interface EditorState {
  mode: 'create' | 'edit';
  template?: NotificationTemplate;
}

export function NotificationTemplatesPage() {
  const [items, setItems] = useState<NotificationTemplate[]>([]);
  const [search, setSearch] = useState('');
  const [filterCompanyId, setFilterCompanyId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  async function refresh() {
    setLoading(true);
    setError(null);
    const r = await notificationService.listTemplates();
    if (r) setItems(r.value);
    else setError('Şablonlar yüklenemedi.');
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const companies = useMemo(() => lookupService.companies(), []);
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? id;

  const filtered = useMemo(() => {
    let arr = items;
    if (filterCompanyId) arr = arr.filter((p) => p.companyId === filterCompanyId);
    const q = search.trim().toLowerCase();
    if (!q) return arr;
    return arr.filter((p) =>
      [p.name, p.key, p.description ?? '', companyName(p.companyId)]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [items, search, filterCompanyId, companies]);

  async function handleToggleActive(t: NotificationTemplate) {
    const r = await notificationService.updateTemplate(t.id, { isActive: !t.isActive });
    if (r) {
      await refresh();
      toast({
        type: 'success',
        message: r.isActive ? 'Şablon aktif edildi.' : 'Şablon pasif edildi.',
        duration: 1800,
      });
    }
  }

  return (
    <>
      <AdminListLayout
        title="Bildirim Şablonları"
        description="{{Değişken}} içeren Konu + Gövde mesajları. Şablon güncellense bile geçmiş bildirim kayıtları snapshot içeriklerini korur."
        count={filtered.length}
        searchPlaceholder="Anahtar, ad, açıklama veya şirkete göre ara…"
        searchValue={search}
        onSearchChange={setSearch}
        onAdd={() => setEditor({ mode: 'create' })}
        addLabel="Yeni Şablon"
        helpTitle={NOTIFICATION_TEMPLATES_HELP.title}
        helpSections={NOTIFICATION_TEMPLATES_HELP.sections}
        loading={loading}
        error={error}
        onRetry={() => void refresh()}
        filters={
          <div className="w-56">
            <CompanySelector value={filterCompanyId} onChange={setFilterCompanyId} allowAll label="Şirket filtresi" />
          </div>
        }
      >
        {filtered.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<MessageSquare size={28} />}
              title="Henüz şablon yok"
              description='"Yeni Şablon" ile başlayın. Kural oluşturmadan önce en az 1 şablon olmalı.'
            />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-ndark-border dark:bg-ndark-bg/40 dark:text-ndark-dim">
                <tr>
                  <th className="px-3 py-2">Anahtar / Ad</th>
                  <th className="px-3 py-2">Şirket</th>
                  <th className="px-3 py-2">Format</th>
                  <th className="px-3 py-2">Tür</th>
                  <th className="px-3 py-2">Versiyon</th>
                  <th className="px-3 py-2 text-center">Aktif</th>
                  <th className="px-3 py-2 text-right">Eylem</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100 dark:border-ndark-border/60">
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs text-slate-500">{t.key}</div>
                      <div className="font-medium text-slate-800 dark:text-ndark-text">{t.name}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-ndark-muted">
                      {companyName(t.companyId)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tint="slate">{t.format}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      {t.isCustomerFacing ? <Badge tint="amber">Müşteriye Gider</Badge> : <Badge tint="slate">Dahili</Badge>}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">v{t.version}</td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => void handleToggleActive(t)}
                        className="rounded-md p-1 hover:bg-slate-100 dark:hover:bg-ndark-bg"
                        title={t.isActive ? 'Pasifleştir' : 'Aktifleştir'}
                      >
                        {t.isActive ? <Power size={14} className="text-emerald-600" /> : <PowerOff size={14} className="text-slate-400" />}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="ghost" leftIcon={<Pencil size={12} />} onClick={() => setEditor({ mode: 'edit', template: t })}>
                        Düzenle
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminListLayout>

      {editor && (
        <TemplateEditor
          mode={editor.mode}
          initial={editor.template}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await refresh();
          }}
        />
      )}
    </>
  );
}

function TemplateEditor({
  mode,
  initial,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: NotificationTemplate;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [companyId, setCompanyId] = useState<string | null>(initial?.companyId ?? null);
  const [key, setKey] = useState(initial?.key ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [subjectTemplate, setSubjectTemplate] = useState(initial?.subjectTemplate ?? '');
  const [bodyTemplate, setBodyTemplate] = useState(initial?.bodyTemplate ?? '');
  const [format, setFormat] = useState<'plain' | 'html'>(initial?.format ?? 'plain');
  const [isCustomerFacing, setIsCustomerFacing] = useState(initial?.isCustomerFacing ?? false);
  const [requiredVariables, setRequiredVariables] = useState<string[]>(initial?.requiredVariables ?? []);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; body: string; missing: string[]; format: 'plain' | 'html' } | null>(null);

  // Local preview render (mirrors BE renderTemplate). For Phase 2 we render
  // with placeholder sample vars; admin can also call BE preview for case-
  // backed render but that's gated to saved templates only.
  function localPreview() {
    const sampleVars: Record<string, string> = {
      'case.number': 'VK-PREVIEW',
      'case.title': 'Örnek talep başlığı',
      'case.description': 'Örnek açıklama metni.',
      'case.priority': 'Yüksek',
      'case.status': 'İş Ortağında Bekliyor',
      'case.category': 'Örnek Kategori',
      'case.subCategory': 'Örnek Alt Kategori',
      'account.name': 'Örnek Müşteri A.Ş.',
      'company.name': 'Univera',
      'assignee.name': 'Örnek Uzman',
      'team.name': 'Destek Ekibi',
      'resolution.summary': 'Örnek çözüm özeti.',
      'resolution.customerMessage': 'Talebiniz çözülmüştür; ayrıntılar için örnek çözüm açıklaması metni burada yer alır.',
      'approval.rejectionReason': 'Örnek ret gerekçesi.',
      'approval.approverName': 'Örnek Onaylayan',
      // Müşteri-yüzü + HTML şablon değişkenleri. Logo'lar public/ altından
      // (dev sunucusu + build dist) kök yoldan servis edilir → önizlemede yüklenir.
      'requester.name': 'Ayşe Demir',
      'requester.email': 'ayse.demir@ornekmusteri.com',
      'case.url': '#',
      'company.logoUrl': '/univera-logo.png',
      'app.logoUrl': '/varuna-logo.png',
      'case.lastCustomerMessage': 'Merhaba, konuyla ilgili son durumu öğrenebilir miyim?',
    };
    const VAR_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
    const missing: string[] = [];
    const render = (text: string) =>
      text.replace(VAR_RE, (_, k) => {
        const v = sampleVars[k];
        if (v == null || v === '') {
          if (!missing.includes(k)) missing.push(k);
          return `[${k} eksik]`;
        }
        return v;
      });
    setPreview({
      subject: render(subjectTemplate),
      body: render(bodyTemplate),
      missing: Array.from(new Set(missing)),
      format,
    });
  }

  function toggleVar(v: string) {
    setRequiredVariables((arr) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]));
  }

  async function handleSave() {
    if (!companyId || !name.trim() || !key.trim() || !subjectTemplate.trim() || !bodyTemplate.trim()) return;
    setSaving(true);
    const payload: TemplateCreateInput = {
      companyId,
      key: key.trim(),
      name: name.trim(),
      description: description.trim() || null,
      subjectTemplate,
      bodyTemplate,
      format,
      isCustomerFacing,
      requiredVariables,
      isActive,
    };
    const r =
      mode === 'create'
        ? await notificationService.createTemplate(payload)
        : await notificationService.updateTemplate(initial!.id, payload);
    setSaving(false);
    if (r) await onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'Yeni Bildirim Şablonu' : 'Şablonu Düzenle'}
      size="2xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
          <Button variant="outline" leftIcon={<Eye size={12} />} onClick={localPreview}>
            Önizle
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || !companyId || !name.trim() || !key.trim() || !subjectTemplate.trim() || !bodyTemplate.trim()}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <CompanySelector value={companyId} onChange={setCompanyId} required disabled={mode === 'edit'} />
            <Field label="Anahtar" required hint="küçük_harf_alt_çizgi">
              <TextInput value={key} onChange={(e) => setKey(e.target.value)} disabled={mode === 'edit'} />
            </Field>
          </div>
          <Field label="Ad" required>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Açıklama">
            <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </Field>
          <Field label="Konu (Subject)" required hint='{{case.number}} gibi değişkenler kullanılabilir.'>
            <TextInput value={subjectTemplate} onChange={(e) => setSubjectTemplate(e.target.value)} />
          </Field>
          <Field label="Gövde (Body)" required>
            <TextArea value={bodyTemplate} onChange={(e) => setBodyTemplate(e.target.value)} rows={8} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Format">
              <Select value={format} onChange={(e) => setFormat(e.target.value as 'plain' | 'html')}>
                <option value="plain">plain</option>
                <option value="html">html</option>
              </Select>
            </Field>
            <Field label="Müşteriye gider mi">
              <label className="flex items-center gap-2 pt-2 text-sm">
                <input type="checkbox" checked={isCustomerFacing} onChange={(e) => setIsCustomerFacing(e.target.checked)} />
                <span>Müşteri görür</span>
              </label>
            </Field>
            <Field label="Durum">
              <label className="flex items-center gap-2 pt-2 text-sm">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                <span>Aktif</span>
              </label>
            </Field>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">İzinli Değişkenler</h4>
            <p className="mb-2 text-[11px] text-slate-500">Şablonda hangi değişkenler beklenmeli? Önizleme'de eksik olanlar uyarı çıkarır.</p>
            <div className="flex flex-wrap gap-1">
              {VARIABLE_OPTIONS.map((v) => {
                const on = requiredVariables.includes(v);
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => toggleVar(v)}
                    className={`rounded-full border px-2 py-0.5 font-mono text-[10px] transition ${on ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
                  >
                    {`{{${v}}}`}
                  </button>
                );
              })}
            </div>
          </div>

          {preview && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Önizleme</h4>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs dark:border-ndark-border dark:bg-ndark-bg/40">
                <div className="mb-1 font-semibold text-slate-800 dark:text-ndark-text">{preview.subject}</div>
                {preview.format === 'html' ? (
                  // HTML şablon: tasarımı render et (sanitizeMailHtml = BE allowlist
                  // ile birebir; AdminEmailTemplatesPage önizlemesiyle aynı desen).
                  // Beyaz zeminde göster ki mailin kendi arka planı görünsün.
                  <div
                    className="overflow-x-auto rounded bg-white"
                    dangerouslySetInnerHTML={{ __html: sanitizeMailHtml(preview.body) }}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap font-sans text-slate-700 dark:text-ndark-muted">{preview.body}</pre>
                )}
              </div>
              {preview.missing.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                  Eksik değişken{preview.missing.length > 1 ? 'ler' : ''}: {preview.missing.join(', ')}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
