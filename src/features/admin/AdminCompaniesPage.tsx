import { useEffect, useMemo, useState } from 'react';
import { Building2, Mail, Pencil, Power, PowerOff, Users } from 'lucide-react';
import { CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, TextInput } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/services/AuthContext';
import {
  adminService,
  type Company,
  type CompanyInput,
} from '@/services/adminService';
import { AdminListLayout } from './AdminListLayout';
import { COMPANIES_HELP } from './helpContents';

/**
 * Phase 5A — Şirket yönetimi.
 *
 * SystemAdmin: tüm şirketleri görür, oluşturur, düzenler, pasifleştirir.
 * Admin: yalnızca atandığı şirketleri görür ve düzenleyebilir; oluşturma/
 * pasifleştirme yetkisi yok (UI ve backend her ikisinde de bloke).
 */
export function AdminCompaniesPage() {
  const { user } = useAuth();
  const isSystemAdmin = user?.role === 'SystemAdmin';

  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState('');
  const [editor, setEditor] =
    useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const list = await adminService.companies.list();
      setCompanies(list);
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
    if (!q) return companies;
    return companies.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.appName ?? '').toLowerCase().includes(q) ||
        (c.supportEmail ?? '').toLowerCase().includes(q),
    );
  }, [companies, search]);

  async function handleToggleActive(company: Company) {
    if (!isSystemAdmin) {
      toast({ type: 'error', message: 'Şirket pasifleştirmek yalnızca SystemAdmin yetkisinde.' });
      return;
    }
    if (company.isActive) {
      const ok = window.confirm(
        `"${company.name}" pasifleştirilsin mi?\n\n` +
          `Pasif şirketler yeni vaka/kullanıcı atamalarında görünmez. Mevcut vakalar etkilenmez. ` +
          `Bu işlem geri alınabilir (tekrar aktif edilebilir).`,
      );
      if (!ok) return;
      const r = await adminService.companies.remove(company.id);
      if (r.ok) {
        await refresh();
        toast({ type: 'warn', message: `"${company.name}" pasifleştirildi.` });
      } else {
        toast({ type: 'error', message: r.error });
      }
    } else {
      const r = await adminService.companies.setActive(company.id, true);
      if (r.ok) {
        await refresh();
        toast({ type: 'success', message: `"${company.name}" tekrar aktif.` });
      } else {
        toast({ type: 'error', message: r.error });
      }
    }
  }

  return (
    <>
      <AdminListLayout
        title="Şirketler"
        description="Holding altındaki şirketleri (PARAM / UNIVERA / FINROTA gibi) yönet. Her şirketin kendi takımları, kategorileri, SLA kuralları olur. Kullanıcılar birden fazla şirkete atanabilir."
        count={filtered.length}
        searchEnabled
        searchPlaceholder="Şirket adı, marka adı veya destek e-postası..."
        searchValue={search}
        onSearchChange={setSearch}
        onAdd={isSystemAdmin ? () => setEditor({ mode: 'create' }) : undefined}
        addLabel="Yeni Şirket"
        loading={loading}
        error={error}
        onRetry={refresh}
        helpTitle={COMPANIES_HELP.title}
        helpSections={COMPANIES_HELP.sections}
      >
        {filtered.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<Building2 size={22} />}
              title={search ? 'Şirket bulunamadı' : 'Henüz şirket yok'}
              description={
                search
                  ? 'Aramayı temizlemeyi deneyin.'
                  : isSystemAdmin
                  ? 'Yeni şirket oluşturarak başlayın.'
                  : 'Yöneticinizle iletişime geçin — henüz hiçbir şirkete atanmamışsınız.'
              }
            />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-ndark-border">
              <thead className="bg-slate-50 dark:bg-ndark-bg">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
                  <th className="px-4 py-2.5">Şirket</th>
                  <th className="px-4 py-2.5">Renk</th>
                  <th className="px-4 py-2.5">Marka Adı</th>
                  <th className="px-4 py-2.5">Destek E-posta</th>
                  <th className="px-4 py-2.5">Kullanıcı</th>
                  <th className="px-4 py-2.5">Durum</th>
                  <th className="px-4 py-2.5 text-right">Aksiyonlar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-ndark-border">
                {filtered.map((c) => (
                  <tr key={c.id} className="text-sm hover:bg-slate-50 dark:hover:bg-ndark-bg/50">
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800 dark:text-ndark-text">
                      <div className="flex items-center gap-2">
                        <Building2 size={14} className="text-slate-400" />
                        {c.name}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {c.primaryColor ? (
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-5 w-5 rounded ring-1 ring-inset ring-slate-200 dark:ring-ndark-border"
                            style={{ backgroundColor: c.primaryColor }}
                          />
                          <span className="font-mono text-xs text-slate-500 dark:text-ndark-muted">
                            {c.primaryColor}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700 dark:text-ndark-text">
                      {c.appName || <span className="text-slate-400">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700 dark:text-ndark-text">
                      {c.supportEmail ? (
                        <span className="inline-flex items-center gap-1 text-xs">
                          <Mail size={11} className="text-slate-400" />
                          {c.supportEmail}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-sm text-slate-700 dark:text-ndark-text">
                        <Users size={12} className="text-slate-400" />
                        {c.userCount}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {c.isActive ? (
                        <Badge tint="emerald">Aktif</Badge>
                      ) : (
                        <Badge tint="slate">Pasif</Badge>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          leftIcon={<Pencil size={12} />}
                          onClick={() => setEditor({ mode: 'edit', id: c.id })}
                        >
                          Düzenle
                        </Button>
                        {isSystemAdmin && (
                          <Button
                            size="sm"
                            variant="outline"
                            leftIcon={c.isActive ? <PowerOff size={12} /> : <Power size={12} />}
                            onClick={() => handleToggleActive(c)}
                          >
                            {c.isActive ? 'Pasif Yap' : 'Aktif Yap'}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminListLayout>

      {editor && (
        <CompanyEditor
          mode={editor.mode}
          companyId={editor.mode === 'edit' ? editor.id : null}
          existing={editor.mode === 'edit' ? companies.find((c) => c.id === editor.id) : null}
          onClose={() => setEditor(null)}
          onSaved={async (msg) => {
            setEditor(null);
            await refresh();
            toast({ type: 'success', message: msg });
          }}
        />
      )}
    </>
  );
}

/* ---------------------------------------------------------------- */
/*  CompanyEditor modal                                              */
/* ---------------------------------------------------------------- */

function CompanyEditor({
  mode,
  companyId,
  existing,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  companyId: string | null;
  existing: Company | null | undefined;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [primaryColor, setPrimaryColor] = useState(existing?.primaryColor ?? '#7C3AED');
  const [appName, setAppName] = useState(existing?.appName ?? '');
  const [logoUrl, setLogoUrl] = useState(existing?.logoUrl ?? '');
  const [supportEmail, setSupportEmail] = useState(existing?.supportEmail ?? '');
  // Phase D — Vaka açarken müşteri seçimi zorunlu mu (default false)
  const [requireCustomerOnCaseCreate, setRequireCustomerOnCaseCreate] = useState(
    existing?.requireCustomerOnCaseCreate ?? false,
  );
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast({ type: 'error', message: 'Şirket adı boş olamaz.' });
      return;
    }
    if (primaryColor && !/^#[0-9A-Fa-f]{6}$/.test(primaryColor)) {
      toast({ type: 'error', message: 'Geçersiz renk (örn. #7C3AED).' });
      return;
    }
    if (supportEmail && !/.+@.+\..+/.test(supportEmail)) {
      toast({ type: 'error', message: 'Geçersiz e-posta.' });
      return;
    }

    const payload: CompanyInput = {
      name: name.trim(),
      primaryColor: primaryColor.trim() || undefined,
      appName: appName.trim() || undefined,
      logoUrl: logoUrl.trim() || undefined,
      supportEmail: supportEmail.trim() || undefined,
      requireCustomerOnCaseCreate,
    };

    setSubmitting(true);
    const r =
      mode === 'create'
        ? await adminService.companies.create(payload)
        : await adminService.companies.update(companyId!, payload);
    setSubmitting(false);

    if (r.ok) {
      onSaved(mode === 'create' ? `"${r.item.name}" oluşturuldu.` : `"${r.item.name}" güncellendi.`);
    }
    // !ok ise apiFetch zaten toast göstermiş
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'Yeni Şirket' : 'Şirketi Düzenle'}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Vazgeç
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
        <Field label="Şirket Adı *" hint="Liste ve seçim ekranlarında görünecek isim.">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Örn: PARAM"
            autoFocus
            required
          />
        </Field>

        <Field
          label="Birincil Renk"
          hint="Şirkete özel marka rengi (hex). Vaka detay/kart UI'larında öne çıkar."
        >
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={/^#[0-9A-Fa-f]{6}$/.test(primaryColor) ? primaryColor : '#7C3AED'}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded border border-slate-200 bg-white dark:border-ndark-border dark:bg-ndark-card"
            />
            <TextInput
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              placeholder="#7C3AED"
              className="font-mono text-sm"
            />
          </div>
        </Field>

        <Field label="Marka Adı (Uygulama)" hint="Login ve header'da görünebilen kısa marka adı.">
          <TextInput
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            placeholder="Örn: PARAM Vaka"
          />
        </Field>

        <Field label="Logo URL" hint="Tam URL (https://...). Şu an opsiyonel.">
          <TextInput
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://..."
          />
        </Field>

        <Field label="Destek E-postası" hint="Müşteri bildirimlerinde gönderici olarak görünür.">
          <TextInput
            type="email"
            value={supportEmail}
            onChange={(e) => setSupportEmail(e.target.value)}
            placeholder="destek@firma.com.tr"
          />
        </Field>

        {/* Phase D — Vaka Yönetimi Ayarları */}
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-ndark-border dark:bg-ndark-surface">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
            Vaka Yönetimi Ayarları
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700 dark:text-ndark-text">
            <input
              type="checkbox"
              checked={requireCustomerOnCaseCreate}
              onChange={(e) => setRequireCustomerOnCaseCreate(e.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer accent-brand-600"
            />
            <span>
              <span className="font-medium">Vaka açarken müşteri zorunlu</span>
              <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-ndark-muted">
                Açık olduğunda kullanıcılar müşteri seçmeden vaka kaydedemez.
              </span>
            </span>
          </label>
        </div>
      </form>
    </Modal>
  );
}
