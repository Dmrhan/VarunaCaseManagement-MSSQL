import { useEffect, useMemo, useState } from 'react';
import { Mail, Save, Info, Lock, CheckCircle2 } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/services/AuthContext';
import {
  adminService,
  type ExternalMailSetting,
  type ExternalMailSettingInput,
} from '@/services/adminService';
import { lookupService } from '@/services/caseService';

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
    </div>
  );
}

export default AdminExternalMailPage;
