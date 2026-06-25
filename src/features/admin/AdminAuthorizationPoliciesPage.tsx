import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Filter, KeyRound, Pencil, Power, PowerOff, ShieldCheck } from 'lucide-react';
import { CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { CompanySelector } from '@/components/ui/CompanySelector';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { lookupService } from '@/services/caseService';
import {
  adminService,
  type AuthorizationPolicy,
  type AuthorizationEffectivePreview,
  type AuthorizationPolicyEffect,
  type AuthorizationPolicyInput,
  type AuthorizationPolicyTarget,
  type AuthorizationPrincipalType,
} from '@/services/adminService';
import { AdminListLayout } from './AdminListLayout';
import { AUTHORIZATION_POLICIES_HELP } from './helpContents';

const POLICY_TARGETS: { value: AuthorizationPolicyTarget; label: string }[] = [
  { value: 'menu', label: 'Menü' },
  { value: 'resource', label: 'Kayıt İşlemleri' },
  { value: 'field', label: 'Alan Yetkisi' },
  { value: 'securityFilter', label: 'Güvenlik Filtresi' },
];

const PRINCIPAL_TYPES: { value: AuthorizationPrincipalType; label: string }[] = [
  { value: 'systemRole', label: 'Sistem rolü' },
  { value: 'companyRole', label: 'Şirket rolü' },
  { value: 'team', label: 'Takım' },
  { value: 'user', label: 'Kullanıcı' },
];

const EFFECTS: { value: AuthorizationPolicyEffect; label: string }[] = [
  { value: 'allow', label: 'İzin ver' },
  { value: 'deny', label: 'Engelle' },
];

const TARGET_LABELS = Object.fromEntries(POLICY_TARGETS.map((x) => [x.value, x.label])) as Record<
  AuthorizationPolicyTarget,
  string
>;
const PRINCIPAL_LABELS = Object.fromEntries(PRINCIPAL_TYPES.map((x) => [x.value, x.label])) as Record<
  AuthorizationPrincipalType,
  string
>;

const DEFAULT_FILTER_JSON = `{
  "op": "in",
  "field": "@record.companyId",
  "value": "@user.allowedCompanyIds"
}`;

/**
 * Bu ekran eski Varuna'daki yetkilendirme matrisini menü, kayıt işlemi, alan ve
 * güvenlik filtresi düzeyinde yönetmek için kullanılır.
 */
export function AdminAuthorizationPoliciesPage() {
  const companies = useMemo(() => lookupService.companies(), []);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '');
  const [target, setTarget] = useState<AuthorizationPolicyTarget | ''>('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<AuthorizationPolicy[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null);
  const [previewPrincipalType, setPreviewPrincipalType] = useState<AuthorizationPrincipalType>('systemRole');
  const [previewPrincipalKey, setPreviewPrincipalKey] = useState('Agent');
  const [preview, setPreview] = useState<AuthorizationEffectivePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const { toast } = useToast();

  async function refresh() {
    if (!companyId) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await adminService.authorizationPolicies.list({
        companyId,
        target: target || undefined,
        isActive: includeInactive ? undefined : true,
      });
      setItems(list);
    } catch (err) {
      setError((err as Error).message ?? 'Bilinmeyen hata');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, target, includeInactive]);

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    if (!q) return items;
    return items.filter((p) => {
      const haystack = [
        p.target,
        p.principalType,
        p.principalKey,
        p.effect,
        p.menuKey,
        p.viewKey,
        p.resourceKey,
        p.action,
        p.scope,
        p.fieldKey,
        p.notes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('tr-TR');
      return haystack.includes(q);
    });
  }, [items, search]);

  async function handleToggleActive(row: AuthorizationPolicy) {
    const result = await adminService.authorizationPolicies.setActive(row.id, !row.isActive);
    if (result.ok) {
      await refresh();
      toast({
        type: 'success',
        message: result.item.isActive ? 'Yetki kuralı aktif edildi.' : 'Yetki kuralı pasifleştirildi.',
        duration: 2000,
      });
    } else {
      toast({ type: 'error', message: result.error });
    }
  }

  async function handlePreview() {
    if (!companyId || !previewPrincipalKey.trim()) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await adminService.authorizationPolicies.effectivePreview({
        companyId,
        principalType: previewPrincipalType,
        principalKey: previewPrincipalKey.trim(),
        featureFlags: { smartTicketIntakeEnabled: true },
      });
      setPreview(result);
    } catch (err) {
      setPreviewError((err as Error).message ?? 'Önizleme hesaplanamadı');
    } finally {
      setPreviewLoading(false);
    }
  }

  if (!companyId) {
    return (
      <AdminListLayout
        title="Yetkilendirme Yönetimi"
        description="Menü görünürlüğü, kayıt işlemleri, alan zorunluluğu ve kayıt erişim kuralları."
        helpTitle={AUTHORIZATION_POLICIES_HELP.title}
        helpSections={AUTHORIZATION_POLICIES_HELP.sections}
      >
        <CardBody>
          <EmptyState
            icon={<ShieldCheck size={22} />}
            title="Şirket seçilmedi"
            description="Yetki kuralı yönetimi için önce bir şirket seçin."
          />
        </CardBody>
      </AdminListLayout>
    );
  }

  return (
    <>
      <AdminListLayout
        title="Yetkilendirme Yönetimi"
        description="Kullanıcı, rol ve takım bazında menü görünürlüğünü yönetin; kayıt işlemi, alan ve kayıt erişim kurallarını önizleyip kontrollü devreye alın."
        count={filtered.length}
        searchPlaceholder="Kime uygulanır, kaynak, işlem veya nota göre ara…"
        searchValue={search}
        onSearchChange={setSearch}
        onAdd={() => setEditor({ mode: 'create' })}
        addLabel="Yeni Yetki Kuralı"
        loading={loading}
        error={error}
        onRetry={() => void refresh()}
        helpTitle={AUTHORIZATION_POLICIES_HELP.title}
        helpSections={AUTHORIZATION_POLICIES_HELP.sections}
        filters={
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-52">
              <CompanySelector
                label="Şirket"
                value={companyId}
                onChange={(id) => setCompanyId(id ?? '')}
                required
              />
            </div>
            <div className="w-48">
              <Field label="Kural Tipi">
                <Select
                  value={target}
                  onChange={(e) => setTarget(e.target.value as AuthorizationPolicyTarget | '')}
                >
                  <option value="">Tümü</option>
                  {POLICY_TARGETS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <label className="flex items-center gap-2 pb-1.5 text-sm text-slate-700">
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
        <EffectivePreviewPanel
          principalType={previewPrincipalType}
          principalKey={previewPrincipalKey}
          preview={preview}
          loading={previewLoading}
          error={previewError}
          onPrincipalTypeChange={(value) => {
            setPreviewPrincipalType(value);
            setPreview(null);
          }}
          onPrincipalKeyChange={(value) => {
            setPreviewPrincipalKey(value);
            setPreview(null);
          }}
          onPreview={() => void handlePreview()}
        />

        {filtered.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<ShieldCheck size={22} />}
              title={search ? 'Aramaya uyan yetki kuralı yok' : 'Henüz yetki kuralı yok'}
              description={
                search
                  ? 'Farklı bir arama deneyin.'
                  : 'İlk menü, kayıt işlemi, alan veya güvenlik filtresi yetki kuralını oluşturun.'
              }
              action={
                !search ? (
                  <Button size="sm" onClick={() => setEditor({ mode: 'create' })}>
                    Yeni Yetki Kuralı
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
                  <Th>Kural</Th>
                  <Th>Kime Uygulanır?</Th>
                  <Th>Etki</Th>
                  <Th>Hedef</Th>
                  <Th align="right">Öncelik</Th>
                  <Th>Durum</Th>
                  <Th align="right">Aksiyon</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <Td>
                      <div className="flex items-center gap-2">
                        <Badge tint="violet">{TARGET_LABELS[row.target]}</Badge>
                        <span className="font-mono text-[10px] text-slate-400">{row.id}</span>
                      </div>
                      {row.notes && <div className="mt-1 text-xs text-slate-500">{row.notes}</div>}
                    </Td>
                    <Td>
                      <div className="font-medium text-slate-800">{row.principalKey}</div>
                      <div className="text-xs text-slate-500">{PRINCIPAL_LABELS[row.principalType]}</div>
                    </Td>
                    <Td>
                      {row.effect === 'allow' ? (
                        <Badge tint="emerald">İzin</Badge>
                      ) : (
                        <Badge tint="rose">Engel</Badge>
                      )}
                    </Td>
                    <Td>
                      <PolicyTargetSummary row={row} />
                    </Td>
                    <Td align="right" className="text-slate-600">{row.priority}</Td>
                    <Td>
                      {row.isActive ? <Badge tint="emerald">Aktif</Badge> : <Badge tint="slate">Pasif</Badge>}
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

      <AuthorizationPolicyModal
        open={editor !== null}
        mode={editor?.mode ?? 'create'}
        editingId={editor?.mode === 'edit' ? editor.id : null}
        companyId={companyId}
        items={items}
        onClose={() => setEditor(null)}
        onSaved={() => void refresh()}
      />
    </>
  );
}

function EffectivePreviewPanel({
  principalType,
  principalKey,
  preview,
  loading,
  error,
  onPrincipalTypeChange,
  onPrincipalKeyChange,
  onPreview,
}: {
  principalType: AuthorizationPrincipalType;
  principalKey: string;
  preview: AuthorizationEffectivePreview | null;
  loading: boolean;
  error: string | null;
  onPrincipalTypeChange: (value: AuthorizationPrincipalType) => void;
  onPrincipalKeyChange: (value: string) => void;
  onPreview: () => void;
}) {
  const visibleMenus = preview?.menus.filter((m) => m.allowed).slice(0, 6) ?? [];
  const deniedMenus = preview?.menus.filter((m) => !m.allowed).slice(0, 4) ?? [];
  const resourceHighlights = preview?.resources
    .flatMap((r) => r.actions.map((a) => ({ ...a, resourceKey: r.key, label: r.label })))
    .filter((a) => a.reason === 'override_deny' || a.reason === 'override_allow')
    .slice(0, 6) ?? [];

  return (
    <div className="border-b border-slate-200 bg-slate-50/70 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <ShieldCheck size={16} className="text-violet-600" />
            Etkili Yetki Önizlemesi
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Kayıtlı aktif yetki kuralları seçilen rol, takım veya kullanıcı için nasıl sonuç üretir?
            Bu panel kontrol amaçlıdır.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Kime uygulanır?" className="w-44">
            <Select
              value={principalType}
              onChange={(e) => onPrincipalTypeChange(e.target.value as AuthorizationPrincipalType)}
            >
              {PRINCIPAL_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Hedef Değer" className="w-56">
            <TextInput
              value={principalKey}
              onChange={(e) => onPrincipalKeyChange(e.target.value)}
              placeholder="Agent / team-id / user-id"
            />
          </Field>
          <Button
            variant="outline"
            onClick={onPreview}
            disabled={loading || !principalKey.trim()}
            leftIcon={<ShieldCheck size={14} />}
          >
            {loading ? 'Hesaplanıyor…' : 'Önizle'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </div>
      )}

      {preview && (
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-white p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Özet</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <Metric label="Menü açık" value={preview.summary.menuAllowed} tint="emerald" />
              <Metric label="Menü kapalı" value={preview.summary.menuDenied} tint="rose" />
              <Metric label="İşlem izni" value={preview.summary.resourceAllowed} tint="emerald" />
              <Metric label="İşlem engeli" value={preview.summary.resourceDenied} tint="amber" />
            </div>
            <div className="mt-2">
              <Badge tint={preview.summary.securityFilterCount > 0 ? 'violet' : 'slate'}>
                {preview.summary.securityFilterCount} güvenlik filtresi
              </Badge>
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Menüler</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {visibleMenus.map((m) => (
                <Badge key={m.key} tint="emerald">{m.label}</Badge>
              ))}
              {deniedMenus.map((m) => (
                <Badge key={m.key} tint="slate">{m.label}</Badge>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Override Etkileri</div>
            {resourceHighlights.length === 0 ? (
              <div className="mt-2 text-xs text-slate-500">Kayıt işlemleri için özel izin veya engel yok.</div>
            ) : (
              <div className="mt-2 space-y-1">
                {resourceHighlights.map((r) => (
                  <div key={`${r.resourceKey}:${r.action}`} className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-slate-700">{r.resourceKey}.{r.action}</span>
                    <Badge tint={r.allowed ? 'emerald' : 'rose'}>
                      {r.allowed ? 'İzin' : 'Engel'}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tint }: { label: string; value: number; tint: 'emerald' | 'rose' | 'amber' }) {
  return (
    <div className="rounded-md bg-slate-50 px-2 py-1">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-lg font-semibold ${
        tint === 'emerald' ? 'text-emerald-700' : tint === 'rose' ? 'text-rose-700' : 'text-amber-700'
      }`}>
        {value}
      </div>
    </div>
  );
}

function PolicyTargetSummary({ row }: { row: AuthorizationPolicy }) {
  if (row.target === 'menu') {
    return <SummaryLine icon={<KeyRound size={13} />} title={row.viewKey ?? row.menuKey ?? '—'} detail="Menü görünürlüğü" />;
  }
  if (row.target === 'resource') {
    return <SummaryLine icon={<ShieldCheck size={13} />} title={row.resourceKey ?? '—'} detail={row.action ?? 'Aksiyon yok'} />;
  }
  if (row.target === 'field') {
    return (
      <SummaryLine
        icon={<KeyRound size={13} />}
        title={`${row.scope ?? 'bölüm yok'} · ${row.fieldKey ?? 'alan yok'}`}
        detail={row.action ?? 'Alan aksiyonu yok'}
      />
    );
  }
  return <SummaryLine icon={<Filter size={13} />} title={row.resourceKey ?? '—'} detail="Güvenlik filtresi" />;
}

function SummaryLine({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-slate-400">{icon}</span>
      <div>
        <div className="font-mono text-xs text-slate-700">{title}</div>
        <div className="text-xs text-slate-500">{detail}</div>
      </div>
    </div>
  );
}

function AuthorizationPolicyModal({
  open,
  mode,
  editingId,
  companyId,
  items,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  editingId: string | null;
  companyId: string;
  items: AuthorizationPolicy[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<AuthorizationPolicyInput>(() => emptyPolicy(companyId));
  const [filterText, setFilterText] = useState(DEFAULT_FILTER_JSON);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === 'edit' && editingId) {
      const row = items.find((x) => x.id === editingId);
      if (row) {
        setForm({
          companyId: row.companyId,
          target: row.target,
          principalType: row.principalType,
          principalKey: row.principalKey,
          effect: row.effect,
          menuKey: row.menuKey,
          viewKey: row.viewKey,
          resourceKey: row.resourceKey,
          action: row.action,
          scope: row.scope,
          fieldKey: row.fieldKey,
          filterJson: row.filterJson,
          priority: row.priority,
          isActive: row.isActive,
          notes: row.notes,
        });
        setFilterText(prettyJson(row.filterJson) || DEFAULT_FILTER_JSON);
      }
      return;
    }
    setForm(emptyPolicy(companyId));
    setFilterText(DEFAULT_FILTER_JSON);
  }, [open, mode, editingId, companyId, items]);

  function patch(patchValue: Partial<AuthorizationPolicyInput>) {
    setForm((f) => ({ ...f, ...patchValue }));
  }

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    const payload = buildPayload(form, filterText);
    if ('error' in payload) {
      setSubmitting(false);
      setError(payload.error);
      return;
    }

    const result =
      mode === 'create'
        ? await adminService.authorizationPolicies.create(payload.value)
        : editingId
          ? await adminService.authorizationPolicies.update(editingId, payload.value)
          : null;
    setSubmitting(false);

    if (!result) {
      setError('Yetki kuralı bulunamadı.');
      return;
    }
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved();
    onClose();
    toast({
      type: 'success',
      message: mode === 'create' ? 'Yetki kuralı oluşturuldu.' : 'Yetki kuralı güncellendi.',
      duration: 2500,
    });
  }

  const canSubmit = form.principalKey?.trim() && !submitting;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={mode === 'create' ? 'Yeni Yetki Kuralı' : 'Yetki Kuralını Düzenle'}
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
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Şirket">
          <TextInput value={form.companyId} disabled />
        </Field>

        <Field label="Kural Tipi" required>
          <Select
            value={form.target}
            onChange={(e) => patch(resetTargetSpecific(e.target.value as AuthorizationPolicyTarget))}
          >
            {POLICY_TARGETS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Kime Uygulanır?" required>
          <Select
            value={form.principalType}
            onChange={(e) => patch({ principalType: e.target.value as AuthorizationPrincipalType })}
          >
            {PRINCIPAL_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Hedef Değer"
          required
          hint="Sistem rolünde rol adı; şirket rolünde companyId:rol; takım ve kullanıcıda ilgili kayıt ID'si. Örn. Agent, COMP-UNIVERA:Supervisor."
        >
          <TextInput
            autoFocus
            value={form.principalKey}
            onChange={(e) => patch({ principalKey: e.target.value })}
          />
        </Field>

        <Field label="Etki" required>
          <Select
            value={form.effect}
            onChange={(e) => patch({ effect: e.target.value as AuthorizationPolicyEffect })}
          >
            {EFFECTS.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Öncelik" hint="Yüksek değer daha baskın değerlendirilir.">
          <TextInput
            type="number"
            value={String(form.priority ?? 100)}
            onChange={(e) => patch({ priority: Number(e.target.value) || 0 })}
          />
        </Field>

        {form.target === 'menu' && (
          <>
            <Field label="Ekran Anahtarı" required hint="Hangi sayfa/menü kontrol edilecek? Örn. cases, admin-users, smart-ticket-new">
              <TextInput value={form.viewKey ?? ''} onChange={(e) => patch({ viewKey: e.target.value })} />
            </Field>
            <Field label="Menü Anahtarı" hint="Genellikle boş bırakılır; sistem ekran anahtarından çözer.">
              <TextInput value={form.menuKey ?? ''} onChange={(e) => patch({ menuKey: e.target.value })} />
            </Field>
          </>
        )}

        {form.target === 'resource' && (
          <>
            <Field label="Kayıt/Kaynak Anahtarı" required hint="Hangi kayıt türü? Örn. case, case.note, account">
              <TextInput
                value={form.resourceKey ?? ''}
                onChange={(e) => patch({ resourceKey: e.target.value })}
              />
            </Field>
            <Field label="İşlem" required hint="Ne yapabilir? create/read/update/delete/transfer/close/export…">
              <TextInput value={form.action ?? ''} onChange={(e) => patch({ action: e.target.value })} />
            </Field>
          </>
        )}

        {form.target === 'field' && (
          <>
            <Field label="Ekran/Bölüm" required hint="Alan hangi form veya bölümde? Örn. case.close, smartTicket.stage3Transfer">
              <TextInput value={form.scope ?? ''} onChange={(e) => patch({ scope: e.target.value })} />
            </Field>
            <Field label="Alan Anahtarı" required hint="Kontrol edilecek alan. Örn. resolutionNote, priority">
              <TextInput value={form.fieldKey ?? ''} onChange={(e) => patch({ fieldKey: e.target.value })} />
            </Field>
            <Field label="Alan Davranışı" required hint="visible/readable/editable/required/masked">
              <TextInput value={form.action ?? ''} onChange={(e) => patch({ action: e.target.value })} />
            </Field>
            <Field label="Kayıt/Kaynak Anahtarı" hint="Genellikle case.">
              <TextInput
                value={form.resourceKey ?? ''}
                onChange={(e) => patch({ resourceKey: e.target.value })}
              />
            </Field>
          </>
        )}

        {form.target === 'securityFilter' && (
          <>
            <Field label="Kayıt/Kaynak Anahtarı" required hint="Hangi kayıtlar filtrelenecek? Örn. case, account">
              <TextInput
                value={form.resourceKey ?? ''}
                onChange={(e) => patch({ resourceKey: e.target.value })}
              />
            </Field>
            <Field label="Güvenlik Filtresi JSON" required className="md:col-span-2">
              <TextArea
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                className="min-h-[150px] font-mono text-xs"
              />
            </Field>
          </>
        )}

        <Field label="Not" className="md:col-span-2">
          <TextArea
            value={form.notes ?? ''}
            onChange={(e) => patch({ notes: e.target.value })}
            placeholder="Bu yetki kuralı neden var, hangi ekip veya akış için tanımlandı?"
          />
        </Field>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.isActive ?? true}
            onChange={(e) => patch({ isActive: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          Aktif
        </label>

        {error && (
          <p className="md:col-span-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function emptyPolicy(companyId: string): AuthorizationPolicyInput {
  return {
    companyId,
    target: 'menu',
    principalType: 'systemRole',
    principalKey: 'Agent',
    effect: 'allow',
    viewKey: 'cases',
    priority: 100,
    isActive: true,
    notes: '',
  };
}

function resetTargetSpecific(target: AuthorizationPolicyTarget): Partial<AuthorizationPolicyInput> {
  const base = {
    target,
    menuKey: null,
    viewKey: null,
    resourceKey: null,
    action: null,
    scope: null,
    fieldKey: null,
    filterJson: null,
  };
  if (target === 'menu') return { ...base, viewKey: 'cases' };
  if (target === 'resource') return { ...base, resourceKey: 'case', action: 'read' };
  if (target === 'field') {
    return { ...base, resourceKey: 'case', scope: 'case.detail', fieldKey: 'priority', action: 'editable' };
  }
  return { ...base, resourceKey: 'case', filterJson: DEFAULT_FILTER_JSON };
}

function buildPayload(
  form: AuthorizationPolicyInput,
  filterText: string,
): { value: AuthorizationPolicyInput } | { error: string } {
  const payload: AuthorizationPolicyInput = {
    ...form,
    principalKey: form.principalKey.trim(),
    menuKey: trimOrNull(form.menuKey),
    viewKey: trimOrNull(form.viewKey),
    resourceKey: trimOrNull(form.resourceKey),
    action: trimOrNull(form.action),
    scope: trimOrNull(form.scope),
    fieldKey: trimOrNull(form.fieldKey),
    notes: trimOrNull(form.notes),
    priority: Number.isFinite(form.priority) ? Number(form.priority) : 100,
    isActive: form.isActive ?? true,
  };

  if (!payload.principalKey) return { error: 'Hedef Değer zorunlu.' };

  if (payload.target === 'securityFilter') {
    try {
      payload.filterJson = JSON.parse(filterText);
    } catch {
      return { error: 'Güvenlik filtresi geçerli JSON olmalı.' };
    }
  } else {
    payload.filterJson = null;
  }

  return { value: payload };
}

function trimOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function prettyJson(value: string | null | undefined): string {
  if (!value) return '';
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function Th({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return <th className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}>{children}</th>;
}

function Td({
  children,
  align = 'left',
  className = '',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <td className={`px-3 py-2 align-top ${align === 'right' ? 'text-right' : ''} ${className}`}>
      {children}
    </td>
  );
}
