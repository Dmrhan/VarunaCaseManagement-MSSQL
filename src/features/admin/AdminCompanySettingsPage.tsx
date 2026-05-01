import { useEffect, useMemo, useState } from 'react';
import { Building2, Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextInput } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { HelpButton, HelpDrawer } from '@/components/ui/HelpDrawer';
import { adminService, type CompanySettings, type CompanySettingsInput } from '@/services/adminService';
import { lookupService } from '@/services/caseService';
import { COMPANY_SETTINGS_HELP } from './helpContents';

/**
 * Şirket bazında marka/yapılandırma ayarları.
 * Logo şu an URL alır; ileri sprint'te Supabase Storage upload'u eklenir.
 */
export function AdminCompanySettingsPage() {
  const companies = useMemo(() => lookupService.companies(), []);
  const [companyId, setCompanyId] = useState<string>(companies[0]?.id ?? '');
  const [form, setForm] = useState<CompanySettingsInput>({
    logoUrl: '',
    primaryColor: '#7C3AED',
    appName: '',
    supportEmail: '',
  });
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const settings: CompanySettings | null = await adminService.companySettings.get(companyId);
      if (cancelled) return;
      setForm({
        logoUrl: settings?.logoUrl ?? '',
        primaryColor: settings?.primaryColor ?? '#7C3AED',
        appName: settings?.appName ?? '',
        supportEmail: settings?.supportEmail ?? '',
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  async function handleSave() {
    if (!companyId) return;
    setSubmitting(true);
    const r = await adminService.companySettings.upsert(companyId, form);
    setSubmitting(false);
    if (r.ok) {
      toast({ type: 'success', message: 'Şirket ayarları kaydedildi.', duration: 2000 });
    } else {
      toast({ type: 'error', message: r.error });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Building2 size={18} className="text-slate-500" />
          <h1 className="text-lg font-semibold text-slate-800 dark:text-ndark-text">
            Şirket Ayarları
          </h1>
        </div>
        <HelpButton onClick={() => setHelpOpen(true)} active={helpOpen} />
      </div>
      <p className="text-sm text-slate-500 dark:text-ndark-muted">
        Seçili şirket için marka kimliği, destek e-postası ve renk paleti.
      </p>
      <HelpDrawer
        open={helpOpen}
        title={COMPANY_SETTINGS_HELP.title}
        sections={COMPANY_SETTINGS_HELP.sections}
        onClose={() => setHelpOpen(false)}
      />

      <div className="max-w-xl space-y-4 rounded-lg bg-white p-6 ring-1 ring-slate-200 dark:bg-ndark-card dark:ring-ndark-border">
        <Field label="Şirket" required>
          <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Uygulama Adı" hint="Header'da bu şirket aktifken gösterilir">
          <TextInput
            value={form.appName ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, appName: e.target.value }))}
            placeholder="örn. PARAM Vaka Yönetim"
            disabled={loading}
          />
        </Field>

        <Field label="Logo URL" hint="Supabase Storage upload'u sonraki sprint">
          <TextInput
            value={form.logoUrl ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))}
            placeholder="https://..."
            disabled={loading}
          />
        </Field>

        <Field label="Birincil Renk" hint="Hex (örn. #7C3AED) — buton/accent rengi">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={form.primaryColor ?? '#7C3AED'}
              onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))}
              className="h-9 w-12 cursor-pointer rounded border border-slate-200 dark:border-ndark-border"
              disabled={loading}
            />
            <TextInput
              value={form.primaryColor ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))}
              placeholder="#7C3AED"
              disabled={loading}
            />
          </div>
        </Field>

        <Field label="Destek E-postası">
          <TextInput
            type="email"
            value={form.supportEmail ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, supportEmail: e.target.value }))}
            placeholder="destek@firma.com"
            disabled={loading}
          />
        </Field>

        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} disabled={submitting || loading} leftIcon={<Save size={14} />}>
            {submitting ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </div>
      </div>
    </div>
  );
}
