import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { AtSign, CheckCircle2, Inbox, Info, Lock, Mail, Pencil, Plus, Save, Star, Trash2, Users } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';

// Compose-Signature F2 — Lazy load şirket imza şablonu editörü (TipTap
// ağır chunk'ı main bundle'a girmesin).
const CompanySignatureTemplate = lazy(() =>
  import('./CompanySignatureTemplate').then((m) => ({ default: m.CompanySignatureTemplate })),
);
import { Button } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/services/AuthContext';
import {
  adminService,
  type ExternalMailSetting,
  type ExternalMailSettingInput,
  type FromAliasItem,
  type MailInboxItem,
  type MailInboxDraft,
} from '@/services/adminService';
import { lookupService } from '@/services/caseService';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Field';

/**
 * Mail M5 — Per-tenant SMTP/IMAP Entegrasyonu (Admin yapılandırma).
 *
 * DevOps Faz 2.1 Admin Page (AdminExternalDevOpsPage) deseninin AYNASI.
 *
 * Secret (SMTP password / OAuth2 refresh_token) güvenliği:
 *  - WRITE-ONLY input: server secret plain text'i ASLA GET response'unda
 *    dönmez (sadece secretIsSet + secretSetAt). UI secretIsSet=true ise
 *    "ayarlı" durumu gösterir, "Değiştir" tıklanmadan input kapalıdır.
 *  - Save'de secret YALNIZ inputu açıp girdiysen gönderilir; yoksa server
 *    mevcut şifreli secret'a dokunmaz (rotate semantiği).
 *  - Server tarafta AES-256-GCM ile şifrelenir
 *    (server/lib/secretCipher.js, DEVOPS_PAT_ENC_KEY env REUSE).
 *
 * Per-company admin gate: BFF tarafında `assertCompanyAdmin` enforce edilir.
 */

const PORT_MIN = 1;
const PORT_MAX = 65535;

interface DraftState {
  enabled: boolean;
  fromAddress: string;
  inboundAddress: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  imapHost: string;
  imapPort: number;
  authMode: 'password' | 'oauth2';
  username: string;
  /**
   * UI-only — "Değiştir" tıklanıp input açıldıysa true. Save'de bu true'sa
   * secret değeri patch'e konur; false'sa secret patch'e GİRMEZ → mevcut
   * secret korunur.
   */
  editingSecret: boolean;
  secretInput: string;
}

function toDraft(s: ExternalMailSetting): DraftState {
  return {
    enabled: s.enabled,
    fromAddress: s.fromAddress ?? '',
    inboundAddress: s.inboundAddress ?? '',
    smtpHost: s.smtpHost ?? '',
    smtpPort: s.smtpPort ?? 587,
    smtpSecure: s.smtpSecure,
    imapHost: s.imapHost ?? '',
    imapPort: s.imapPort ?? 993,
    authMode: s.authMode,
    username: s.username ?? '',
    editingSecret: false,
    secretInput: '',
  };
}

function toPatch(d: DraftState): ExternalMailSettingInput {
  const patch: ExternalMailSettingInput = {
    enabled: d.enabled,
    fromAddress: d.fromAddress.trim() ? d.fromAddress.trim() : null,
    inboundAddress: d.inboundAddress.trim() ? d.inboundAddress.trim() : null,
    smtpHost: d.smtpHost.trim() ? d.smtpHost.trim() : null,
    smtpPort: d.smtpPort || null,
    smtpSecure: d.smtpSecure,
    imapHost: d.imapHost.trim() ? d.imapHost.trim() : null,
    imapPort: d.imapPort || null,
    authMode: d.authMode,
    username: d.username.trim() ? d.username.trim() : null,
  };
  // Secret yalnız "Değiştir" açıldıysa ve girildiyse gönder.
  if (d.editingSecret && d.secretInput.trim().length > 0) {
    patch.secret = d.secretInput.trim();
  }
  return patch;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('tr-TR');
  } catch {
    return iso;
  }
}

export function AdminExternalMailPage() {
  const { user } = useAuth();
  void user;

  const manageable = useMemo(() => lookupService.companies(), []);

  const [companyId, setCompanyId] = useState<string>('');
  const [setting, setSetting] = useState<ExternalMailSetting | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { toast } = useToast();

  useEffect(() => {
    if (!companyId && manageable.length > 0) {
      setCompanyId(manageable[0].id);
    }
  }, [companyId, manageable]);

  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    setLoading(true);
    setErrors({});
    void adminService.externalMailSettings
      .get(companyId)
      .then((s) => {
        if (!alive) return;
        if (s) {
          setSetting(s);
          setDraft(toDraft(s));
        } else {
          setSetting(null);
          setDraft(null);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [companyId]);

  function update<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    if (errors[key as string]) {
      setErrors((e) => {
        const { [key as string]: _, ...rest } = e;
        return rest;
      });
    }
  }

  function validate(d: DraftState): Record<string, string> {
    const e: Record<string, string> = {};
    if (d.smtpHost.trim() && !/^[a-zA-Z0-9.-]+$/.test(d.smtpHost.trim())) {
      e.smtpHost = 'SMTP host geçersiz.';
    }
    if (d.smtpPort && (d.smtpPort < PORT_MIN || d.smtpPort > PORT_MAX)) {
      e.smtpPort = `${PORT_MIN}-${PORT_MAX} arası olmalı.`;
    }
    if (d.imapPort && (d.imapPort < PORT_MIN || d.imapPort > PORT_MAX)) {
      e.imapPort = `${PORT_MIN}-${PORT_MAX} arası olmalı.`;
    }
    if (d.editingSecret && d.secretInput.trim().length > 0 && d.secretInput.trim().length < 4) {
      e.secretInput = 'Secret en az 4 karakter olmalı.';
    }
    return e;
  }

  async function handleSave() {
    if (!draft || !companyId) return;
    const validationErrors = validate(draft);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setSaving(true);
    const r = await adminService.externalMailSettings.save(companyId, toPatch(draft));
    setSaving(false);
    if (r.ok) {
      setSetting(r.item);
      setDraft(toDraft(r.item));
      toast({ type: 'success', message: 'Ayarlar kaydedildi ✓', duration: 2500 });
    }
  }

  async function handleTest() {
    if (!companyId) return;
    setTesting(true);
    const result = await adminService.externalMailSettings.test(companyId);
    setTesting(false);
    if (!result) return;
    if (result.ok) {
      toast({
        type: 'success',
        message: result.previewUrl
          ? `Bağlantı OK — preview: ${result.previewUrl}`
          : `Bağlantı OK — messageId: ${result.messageId ?? '—'}`,
        duration: 6000,
      });
    } else {
      toast({
        type: 'error',
        message: `Bağlantı başarısız: ${result.error?.message ?? 'bilinmeyen hata'}`,
        duration: 6000,
      });
    }
  }

  if (manageable.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-slate-600 dark:text-ndark-muted">
            Yönetebileceğin şirket bulunmuyor. Yöneticilik atanmış bir şirkette olman gerekiyor.
          </p>
        </CardBody>
      </Card>
    );
  }

  const showSkeleton = loading || !draft;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Mail size={18} className="text-brand-600" />
        <h2 className="text-lg font-semibold text-slate-800 dark:text-ndark-text">
          Mail Entegrasyonu (SMTP/IMAP)
        </h2>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-200">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          Per-tenant SMTP gönderim + IMAP gelen mailbox tanımları. Secret
          (SMTP parola / OAuth2 refresh_token) burada <strong>şifreli</strong>{' '}
          saklanır (AES-256-GCM) ve hiçbir GET response'unda görünmez. Aktif
          değilse mail entegrasyonu çalışmaz (env'e düşmez).
        </span>
      </div>

      {manageable.length > 1 && (
        <Card>
          <CardBody>
            <Field label="Şirket" hint="Yönetim yetkin olan şirketler listelenir">
              <select
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:bg-ndark-bg dark:border-ndark-border"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
              >
                {manageable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody>
          {showSkeleton ? (
            <div className="space-y-3">
              <Skeleton height={20} width="40%" />
              <Skeleton height={14} width="80%" />
              <Skeleton height={14} width="70%" />
              <Skeleton height={14} width="60%" />
            </div>
          ) : (
            <div className="space-y-5">
              <Field label="Entegrasyon Aktif" hint="Kapalıyken mail entegrasyonu çalışmaz.">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300"
                    checked={draft.enabled}
                    onChange={(e) => update('enabled', e.target.checked)}
                  />
                  <span className="text-sm text-slate-700 dark:text-ndark-muted">
                    {draft.enabled ? 'Aktif' : 'Pasif'}
                  </span>
                </label>
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="From Address (gönderen)"
                  hint='ör: "Varuna <no-reply@univera.com.tr>"'
                >
                  <TextInput
                    value={draft.fromAddress}
                    onChange={(e) => update('fromAddress', e.target.value)}
                    placeholder="Varuna <no-reply@univera.com.tr>"
                  />
                </Field>
                <Field
                  label="Inbound Address (gelen mailbox)"
                  hint="IMAP polling hedefi (M3'te kullanılır)"
                >
                  <TextInput
                    value={draft.inboundAddress}
                    onChange={(e) => update('inboundAddress', e.target.value)}
                    placeholder="support@univera.com.tr"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="SMTP Host" hint="Giden mail sunucusu" error={errors.smtpHost}>
                  <TextInput
                    value={draft.smtpHost}
                    onChange={(e) => update('smtpHost', e.target.value)}
                    placeholder="smtp.gmail.com"
                  />
                </Field>
                <Field label="SMTP Port" hint="587 (STARTTLS) veya 465 (SSL)" error={errors.smtpPort}>
                  <TextInput
                    type="number"
                    value={String(draft.smtpPort)}
                    onChange={(e) => update('smtpPort', Number(e.target.value))}
                    placeholder="587"
                  />
                </Field>
                <Field label="SMTP Secure (SSL/TLS)" hint="465 SSL için açık; 587 STARTTLS için kapalı">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={draft.smtpSecure}
                      onChange={(e) => update('smtpSecure', e.target.checked)}
                    />
                    <span className="text-sm text-slate-700 dark:text-ndark-muted">
                      {draft.smtpSecure ? 'Açık' : 'Kapalı'}
                    </span>
                  </label>
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="IMAP Host" hint="Gelen mailbox sunucusu (M3'te)">
                  <TextInput
                    value={draft.imapHost}
                    onChange={(e) => update('imapHost', e.target.value)}
                    placeholder="imap.gmail.com"
                  />
                </Field>
                <Field label="IMAP Port" hint="993 (SSL standart)" error={errors.imapPort}>
                  <TextInput
                    type="number"
                    value={String(draft.imapPort)}
                    onChange={(e) => update('imapPort', Number(e.target.value))}
                    placeholder="993"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Auth Mode" hint="M5'te yalnız 'password'; oauth2 sonraki PR'da">
                  <select
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:bg-ndark-bg dark:border-ndark-border"
                    value={draft.authMode}
                    onChange={(e) => update('authMode', e.target.value as 'password' | 'oauth2')}
                  >
                    <option value="password">Password (SMTP App Password)</option>
                    <option value="oauth2">OAuth2 (M3+)</option>
                  </select>
                </Field>
                <Field label="Kullanıcı Adı" hint="SMTP/IMAP user (genelde inbound adres)">
                  <TextInput
                    value={draft.username}
                    onChange={(e) => update('username', e.target.value)}
                    placeholder="support@univera.com.tr"
                    autoComplete="off"
                  />
                </Field>
              </div>

              {/* Secret — WRITE-ONLY widget */}
              <Field
                label="Secret (SMTP parola / OAuth2 refresh_token)"
                hint="Sunucuda AES-256-GCM ile şifreli saklanır; bu sayfada geri gösterilmez."
                error={errors.secretInput}
              >
                {!draft.editingSecret ? (
                  <div className="flex items-center gap-3">
                    {setting?.secretIsSet ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        <CheckCircle2 size={12} />
                        Secret ayarlı · {formatDate(setting.secretSetAt)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                        <Lock size={12} />
                        Secret henüz ayarlanmadı
                      </span>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => update('editingSecret', true)}
                    >
                      {setting?.secretIsSet ? 'Değiştir' : 'Secret gir'}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <TextInput
                      type="password"
                      autoComplete="new-password"
                      value={draft.secretInput}
                      onChange={(e) => update('secretInput', e.target.value)}
                      placeholder={
                        setting?.secretIsSet
                          ? 'Değiştirmek için yeni secret gir'
                          : 'SMTP parola / refresh_token gir'
                      }
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 dark:text-ndark-muted">
                        Save'e basana kadar gönderilmez. Boş bırakıp iptal edebilirsin.
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          update('editingSecret', false);
                          update('secretInput', '');
                        }}
                      >
                        İptal
                      </Button>
                    </div>
                  </div>
                )}
              </Field>

              <div className="flex items-center gap-3 pt-2">
                <Button
                  variant="primary"
                  onClick={handleSave}
                  disabled={saving}
                >
                  <Save size={14} />
                  {saving ? 'Kaydediliyor…' : 'Kaydet'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleTest}
                  disabled={testing || !setting?.secretIsSet}
                  title={
                    !setting?.secretIsSet
                      ? 'Önce secret kaydet, sonra test edebilirsin.'
                      : 'Saklı secret ile mailProvider üzerinden bir test gönderim yapar.'
                  }
                >
                  {testing ? 'Test ediliyor…' : 'Bağlantıyı test et'}
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* M5-extension — Per-company From alias yönetimi */}
      {companyId && <FromAliasManager companyId={companyId} fallbackFrom={draft?.fromAddress ?? ''} />}

      {/* Multi-Inbox A4 — Per-company gelen mailbox yönetimi (N hesap → N takım) */}
      {companyId && <MailInboxManager companyId={companyId} />}

      {/* Compose-Signature F2 — Şirket imza şablonu (lazy load) */}
      {companyId && (
        <Suspense fallback={<p className="text-sm text-slate-400">Şirket imza şablonu yükleniyor…</p>}>
          <CompanySignatureTemplate companyId={companyId} />
        </Suspense>
      )}
    </div>
  );
}

/**
 * Mail M5-extension — Per-company FromAlias yönetim component'i.
 *
 * AdminExternalMailPage'in alt bölümünde, ana ExternalMailSetting kartından
 * sonra render edilir. Mevcut tek `fromAddress` field'ı LEGACY/VARSAYILAN
 * konumda kalır; composer (M6.2) dropdown'u BU listeden beslenir.
 *
 * REUSE: adminService.externalMailSettings.aliases CRUD; Card/Button/Field
 * mevcut design system desenleriyle aynı.
 */
function FromAliasManager({ companyId, fallbackFrom }: { companyId: string; fallbackFrom: string }) {
  const [items, setItems] = useState<FromAliasItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newAddress, setNewAddress] = useState('');
  const [newDisplay, setNewDisplay] = useState('');
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const reload = useCallback(async () => {
    setLoading(true);
    const out = await adminService.externalMailSettings.aliases.list(companyId);
    setItems(out);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { void reload(); }, [reload]);

  async function handleAdd() {
    const addr = newAddress.trim();
    if (!addr) return;
    setBusy(true);
    const r = await adminService.externalMailSettings.aliases.create(companyId, {
      address: addr,
      displayName: newDisplay.trim() || null,
      isActive: true,
      isDefault: items.length === 0, // ilk eklenen otomatik default
    });
    setBusy(false);
    if (r) {
      toast({ type: 'success', message: 'Adres eklendi.' });
      setNewAddress('');
      setNewDisplay('');
      void reload();
    }
  }

  async function handleToggleActive(item: FromAliasItem) {
    setBusy(true);
    const r = await adminService.externalMailSettings.aliases.update(companyId, item.id, {
      isActive: !item.isActive,
    });
    setBusy(false);
    if (r) void reload();
  }

  async function handleSetDefault(item: FromAliasItem) {
    if (!item.isActive) {
      toast({ type: 'warn', message: 'Önce adresi aktif yap.' });
      return;
    }
    setBusy(true);
    const ok = await adminService.externalMailSettings.aliases.setDefault(companyId, item.id);
    setBusy(false);
    if (ok) {
      toast({ type: 'success', message: 'Varsayılan güncellendi.' });
      void reload();
    }
  }

  async function handleRemove(item: FromAliasItem) {
    if (!window.confirm(`"${item.address}" adresini silmek istiyor musun?`)) return;
    setBusy(true);
    const ok = await adminService.externalMailSettings.aliases.remove(companyId, item.id);
    setBusy(false);
    if (ok) void reload();
  }

  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-800 dark:text-ndark-text">
              <AtSign size={16} />
              Gönderen Adresleri (From)
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-ndark-muted">
              Composer'da agent'ın seçebileceği gönderen adres listesi. Varsayılan (★) composer açılışında ön-seçili gelir.
            </p>
          </div>
        </div>

        {/* Ekleme */}
        <div className="grid grid-cols-1 gap-3 rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 dark:border-ndark-border dark:bg-ndark-card sm:grid-cols-3">
          <Field label="Adres" required>
            <TextInput
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              placeholder='örn. support@univera.com.tr'
            />
          </Field>
          <Field label="Görünen ad (ops.)" hint="Composer dropdown'da gösterilir">
            <TextInput
              value={newDisplay}
              onChange={(e) => setNewDisplay(e.target.value)}
              placeholder="Destek"
            />
          </Field>
          <div className="flex items-end">
            <Button
              type="button"
              onClick={() => void handleAdd()}
              disabled={busy || !newAddress.trim()}
              variant="primary"
              leftIcon={<Plus size={14} />}
            >
              Ekle
            </Button>
          </div>
        </div>

        {/* Liste */}
        <div className="mt-4">
          {loading ? (
            <Skeleton className="h-20 w-full" />
          ) : items.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted">
              Henüz adres tanımlı değil.
              {fallbackFrom && (
                <span className="ml-1">
                  Mevcut "From" alanındaki <code className="rounded bg-slate-200 px-1 dark:bg-ndark-bg">{fallbackFrom}</code> kayıt edilince burada listelenir.
                </span>
              )}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 dark:divide-ndark-border dark:border-ndark-border">
              {items.map((it) => (
                <li key={it.id} className="flex items-center gap-3 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => void handleSetDefault(it)}
                    disabled={busy || it.isDefault}
                    title={it.isDefault ? 'Varsayılan' : 'Varsayılan yap'}
                    className={`shrink-0 ${it.isDefault ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}`}
                    aria-label={it.isDefault ? 'Varsayılan adres' : 'Varsayılan yap'}
                  >
                    <Star size={16} fill={it.isDefault ? 'currentColor' : 'none'} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800 dark:text-ndark-text">
                      {it.displayName ? `${it.displayName} <${it.address}>` : it.address}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-ndark-muted">
                      {it.isActive ? 'Aktif' : 'Pasif'}
                      {it.isDefault && <span className="ml-2 text-amber-600">· Varsayılan</span>}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant={it.isActive ? 'ghost' : 'primary'}
                    onClick={() => void handleToggleActive(it)}
                    disabled={busy}
                  >
                    {it.isActive ? 'Pasifleştir' : 'Aktifleştir'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void handleRemove(it)}
                    disabled={busy}
                    leftIcon={<Trash2 size={14} />}
                    title="Sil"
                  >
                    Sil
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  );
}


/**
 * Mail Multi-Inbox (Faz A) — Per-company gelen mailbox yönetim component'i.
 *
 * AdminExternalMailPage'in alt bölümünde, FromAlias (giden) kartından
 * sonra render edilir.
 *
 * Mimari:
 *  - Her satır AYRI IMAP hesabı (kendi imapHost/Port/Username/Secret)
 *  - assignedTeamId → o inbox'a düşen mail vakaları o takıma atanır (havuz)
 *  - Backfill ile mevcut tek-inbox tenant otomatik 'Varsayılan' kayda düşer
 *
 * UX:
 *  - Modal-bazlı CRUD (alan sayısı fazla; inline form okunmaz olur)
 *  - Secret WRITE-ONLY: yeni inbox eklerken zorunlu; mevcut inbox'ta
 *    "Şifre Değiştir" check'i ile rotation (FromAlias paterni gibi
 *    secretIsSet sinyali)
 *  - Atama Takımı dropdown: lookupService.teams() — aktif takımlar
 *    (companyId filtre admin gate ile uygulanır; backend tarafta
 *    cross-tenant routing engellenir)
 *
 * Help banner: ekran kendini açıklasın — CS/destek admin'i yardımsız
 * kullanabilsin.
 */
function MailInboxManager({ companyId }: { companyId: string }) {
  const [items, setItems] = useState<MailInboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; item?: MailInboxItem } | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  // Aktif takımlar — sadece bu şirkete ait olanlar dropdown'da görünsün.
  // (Backend tarafta cross-tenant routing zaten engellenir; UX filtresi.)
  const allTeams = useMemo(() => lookupService.teams(), []);
  const teams = useMemo(
    () => allTeams.filter((t) => t.companyId === companyId),
    [allTeams, companyId],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    const out = await adminService.externalMailSettings.inboxes.list(companyId);
    setItems(out);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { void reload(); }, [reload]);

  function teamName(id: string | null): string {
    if (!id) return 'Havuz (takım atanmadı)';
    const t = teams.find((x) => x.id === id);
    return t?.name ?? '— bilinmeyen takım —';
  }

  async function handleToggleEnabled(item: MailInboxItem) {
    setBusy(true);
    const r = await adminService.externalMailSettings.inboxes.update(companyId, item.id, {
      enabled: !item.enabled,
    });
    setBusy(false);
    if (r) {
      toast({
        type: 'success',
        message: r.enabled ? 'Inbox açıldı (polling aktif).' : 'Inbox kapatıldı.',
      });
      void reload();
    }
  }

  async function handleRemove(item: MailInboxItem) {
    if (!window.confirm(`"${item.address}" inbox'ını silmek istiyor musun? Bu işlem geri alınamaz.`)) return;
    setBusy(true);
    const ok = await adminService.externalMailSettings.inboxes.remove(companyId, item.id);
    setBusy(false);
    if (ok) {
      toast({ type: 'success', message: 'Inbox silindi.' });
      void reload();
    }
  }

  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-800 dark:text-ndark-text">
              <Inbox size={16} />
              Gelen Mail Inbox'ları
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-ndark-muted">
              Birden fazla mail adresinden gelen vakaları farklı takımlara yönlendirin (örn. yazilimdestek@ → Yazılım Takımı, satis@ → Satış Takımı).
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            leftIcon={<Plus size={14} />}
            onClick={() => setEditor({ mode: 'create' })}
          >
            Yeni Inbox
          </Button>
        </div>

        {/* Help banner — ekran kendini açıklasın */}
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
          <div className="flex items-start gap-2">
            <Info size={14} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Her inbox AYRI bir mail hesabıdır.</p>
              <p className="mt-0.5">
                yazilimdestek@univera.com.tr ve satis@univera.com.tr ayrı Gmail/Exchange hesabı olarak yapılandırılmalı; her biri için ayrı uygulama şifresi (App Password) gerekir.
                Inbox'a atanan takım, o mail adresinden gelen vakaları havuz olarak alır — ekibinizden biri vakayı üstlenir.
              </p>
            </div>
          </div>
        </div>

        {/* Liste */}
        {loading ? (
          <Skeleton className="h-20 w-full" />
        ) : items.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted">
            Henüz inbox tanımlı değil. <strong className="font-medium">Yeni Inbox</strong> ile gelen mail adresini ve hedef takımı tanımlayın.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 dark:divide-ndark-border dark:border-ndark-border">
            {items.map((it) => (
              <li key={it.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-800 dark:text-ndark-text">
                    {it.displayName ? `${it.displayName} <${it.address}>` : it.address}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-ndark-muted">
                    <span className="flex items-center gap-1">
                      <Users size={12} /> {teamName(it.assignedTeamId)}
                    </span>
                    <span className={it.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}>
                      {it.enabled ? '● Aktif (polling açık)' : '○ Pasif'}
                    </span>
                    <span className={it.secretIsSet ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}>
                      {it.secretIsSet ? '🔒 Şifre ayarlı' : '⚠ Şifre ayarlanmamış'}
                    </span>
                    {it.imapHost && (
                      <span className="text-slate-400">IMAP: {it.imapHost}:{it.imapPort ?? '?'}</span>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  variant={it.enabled ? 'ghost' : 'primary'}
                  onClick={() => void handleToggleEnabled(it)}
                  disabled={busy}
                >
                  {it.enabled ? 'Kapat' : 'Aç'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  leftIcon={<Pencil size={14} />}
                  onClick={() => setEditor({ mode: 'edit', item: it })}
                  disabled={busy}
                >
                  Düzenle
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  leftIcon={<Trash2 size={14} />}
                  onClick={() => void handleRemove(it)}
                  disabled={busy}
                  title="Sil"
                >
                  Sil
                </Button>
              </li>
            ))}
          </ul>
        )}

        {editor && (
          <MailInboxEditor
            companyId={companyId}
            mode={editor.mode}
            initial={editor.item}
            teams={teams}
            onClose={() => setEditor(null)}
            onSaved={() => {
              setEditor(null);
              void reload();
            }}
          />
        )}
      </CardBody>
    </Card>
  );
}

interface InboxEditorProps {
  companyId: string;
  mode: 'create' | 'edit';
  initial?: MailInboxItem;
  teams: ReturnType<typeof lookupService.teams>;
  onClose: () => void;
  onSaved: () => void;
}

function MailInboxEditor({ companyId, mode, initial, teams, onClose, onSaved }: InboxEditorProps) {
  const { toast } = useToast();
  const isEdit = mode === 'edit';

  const [address, setAddress] = useState(initial?.address ?? '');
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [imapHost, setImapHost] = useState(initial?.imapHost ?? 'imap.gmail.com');
  const [imapPort, setImapPort] = useState<number>(initial?.imapPort ?? 993);
  const [imapSecure, setImapSecure] = useState<boolean>(initial?.imapSecure ?? true);
  const [username, setUsername] = useState(initial?.username ?? '');
  const [assignedTeamId, setAssignedTeamId] = useState<string>(initial?.assignedTeamId ?? '');
  const [enabled, setEnabled] = useState<boolean>(initial?.enabled ?? false);
  // Secret rotation: yeni inbox'ta zorunlu input; düzenleme modunda
  // "Şifreyi değiştir" toggle açık değilse secret undefined gider (rotate yok).
  const [rotateSecret, setRotateSecret] = useState<boolean>(!isEdit);
  const [secret, setSecret] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Username default: address ile aynı (ilk açılışta)
  useEffect(() => {
    if (!isEdit && address && !username) {
      setUsername(address);
    }
  }, [address, username, isEdit]);

  async function handleSave() {
    const addr = address.trim();
    if (!addr) {
      toast({ type: 'warn', message: 'Adres zorunlu.' });
      return;
    }
    if (rotateSecret && secret.trim().length < 4) {
      toast({ type: 'warn', message: 'Şifre en az 4 karakter olmalı.' });
      return;
    }

    const draft: MailInboxDraft = {
      address: addr,
      displayName: displayName.trim() || null,
      imapHost: imapHost.trim() || null,
      imapPort: Number(imapPort) || null,
      imapSecure,
      username: username.trim() || null,
      assignedTeamId: assignedTeamId || null,
      enabled,
    };
    if (rotateSecret && secret.trim()) {
      draft.secret = secret.trim();
    }

    setSaving(true);
    const r = isEdit && initial
      ? await adminService.externalMailSettings.inboxes.update(companyId, initial.id, draft)
      : await adminService.externalMailSettings.inboxes.create(companyId, draft);
    setSaving(false);
    if (r) {
      toast({ type: 'success', message: isEdit ? 'Inbox güncellendi.' : 'Inbox eklendi.' });
      onSaved();
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Inbox\'ı Düzenle' : 'Yeni Inbox'}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>İptal</Button>
          <Button type="button" variant="primary" onClick={() => void handleSave()} disabled={saving} leftIcon={<Save size={14} />}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Adres + Görünen Ad */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Mail adresi" required hint="Bu adrese gelen mailler vaka açacak.">
            <TextInput
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="yazilimdestek@univera.com.tr"
              autoFocus={!isEdit}
            />
          </Field>
          <Field label="Görünen ad" hint="Admin paneli için label (ops.)">
            <TextInput
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Yazılım Destek"
            />
          </Field>
        </div>

        {/* IMAP credentials */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="IMAP sunucusu" hint="Gmail: imap.gmail.com">
            <TextInput
              value={imapHost}
              onChange={(e) => setImapHost(e.target.value)}
              placeholder="imap.gmail.com"
            />
          </Field>
          <Field label="Port" hint="IMAPS: 993">
            <TextInput
              type="number"
              value={String(imapPort)}
              onChange={(e) => setImapPort(Number(e.target.value))}
              placeholder="993"
            />
          </Field>
          <Field label="SSL/TLS">
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={imapSecure}
                onChange={(e) => setImapSecure(e.target.checked)}
              />
              <span>Güvenli bağlantı (zorunlu)</span>
            </label>
          </Field>
        </div>

        {/* Auth */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Kullanıcı adı" hint="Genelde mail adresi ile aynı">
            <TextInput
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={address || 'kullanici@univera.com.tr'}
            />
          </Field>
          <div>
            <Field
              label={isEdit ? 'Şifre' : 'Şifre (App Password)'}
              hint={isEdit ? 'Yeni şifre girmek için aşağıdaki seçeneği işaretle.' : 'Gmail için App Password (16 karakter)'}
              required={!isEdit}
            >
              {isEdit && (
                <label className="mb-2 flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={rotateSecret}
                    onChange={(e) => {
                      setRotateSecret(e.target.checked);
                      if (!e.target.checked) setSecret('');
                    }}
                  />
                  <span className="text-slate-600 dark:text-ndark-muted">
                    Şifreyi değiştir
                    {initial?.secretIsSet ? ' (mevcut şifre korunur)' : ' (henüz ayarlanmamış)'}
                  </span>
                </label>
              )}
              <TextInput
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={isEdit && !rotateSecret ? '••••••••' : 'App Password'}
                disabled={isEdit && !rotateSecret}
                autoComplete="new-password"
              />
            </Field>
          </div>
        </div>

        {/* Routing — Takım */}
        <Field
          label="Atama Takımı"
          hint="Bu inbox'a düşen vakalar bu takımın havuzuna atanır. Boş bırakılırsa global havuza düşer."
        >
          <Select
            value={assignedTeamId}
            onChange={(e) => setAssignedTeamId(e.target.value)}
          >
            <option value="">— Takım atanmamış (global havuz) —</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
          {teams.length === 0 && (
            <p className="mt-1 text-xs text-amber-600">
              Bu şirkette aktif takım yok. Önce <strong>Takımlar</strong> ekranından bir takım ekleyin.
            </p>
          )}
        </Field>

        {/* Enabled */}
        <Field label="Polling durumu">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>Polling aktif (IMAP cron bu inbox'tan mail çeker)</span>
          </label>
          <p className="mt-1 text-xs text-slate-500 dark:text-ndark-muted">
            Kapalıyken inbox tanımı durur; mevcut vakalar etkilenmez.
          </p>
        </Field>
      </div>
    </Modal>
  );
}


export default AdminExternalMailPage;
