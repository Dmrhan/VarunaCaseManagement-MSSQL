import { useEffect, useMemo, useState } from 'react';
import { GitBranch, Save, Info, Lock, CheckCircle2 } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/services/AuthContext';
import {
  adminService,
  type ExternalDevOpsSetting,
  type ExternalDevOpsSettingInput,
} from '@/services/adminService';
import { lookupService } from '@/services/caseService';

/**
 * DevOps Faz 2.1 — Per-tenant TFS/Azure DevOps Entegrasyonu (Admin yapılandırma).
 *
 * PAT (Personal Access Token) güvenliği:
 *  - WRITE-ONLY input: server PAT plain text'i ASLA GET response'unda
 *    dönmez (sadece patIsSet + patSetAt). UI patIsSet=true ise "ayarlı"
 *    durumu gösterir, "Değiştir" tıklanmadan input kapalıdır.
 *  - Save'de PAT YALNIZ inputu açıp girdiysen gönderilir; yoksa server
 *    mevcut şifreli PAT'a dokunmaz (rotate semantiği).
 *  - Server tarafta AES-256-GCM ile şifrelenir
 *    (server/lib/secretCipher.js, DEVOPS_PAT_ENC_KEY env).
 *
 * Per-company admin gate: BFF tarafında `assertCompanyAdmin` enforce edilir.
 */

const TIMEOUT_MIN = 1000;
const TIMEOUT_MAX = 300000;

interface DraftState {
  enabled: boolean;
  baseUrl: string;
  apiVersion: string;
  timeoutMs: number;
  /**
   * UI-only — "Değiştir" tıklanıp input açıldıysa true. Save'de bu true'sa
   * pat değeri patch'e konur; false'sa pat patch'e GİRMEZ → mevcut PAT
   * korunur.
   */
  editingPat: boolean;
  patInput: string;
}

function toDraft(s: ExternalDevOpsSetting): DraftState {
  return {
    enabled: s.enabled,
    baseUrl: s.baseUrl ?? '',
    apiVersion: s.apiVersion ?? '4.1',
    timeoutMs: s.timeoutMs,
    editingPat: false,
    patInput: '',
  };
}

function toPatch(d: DraftState): ExternalDevOpsSettingInput {
  const patch: ExternalDevOpsSettingInput = {
    enabled: d.enabled,
    baseUrl: d.baseUrl.trim() ? d.baseUrl.trim() : null,
    apiVersion: d.apiVersion.trim() ? d.apiVersion.trim() : null,
    timeoutMs: d.timeoutMs,
  };
  // PAT yalnız değiştirmek için input açıldıysa ve girildiyse gönder.
  if (d.editingPat && d.patInput.trim().length > 0) {
    patch.pat = d.patInput.trim();
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

export function AdminExternalDevOpsPage() {
  const { user } = useAuth();
  void user;

  const manageable = useMemo(() => lookupService.companies(), []);

  const [companyId, setCompanyId] = useState<string>('');
  const [setting, setSetting] = useState<ExternalDevOpsSetting | null>(null);
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
    void adminService.externalDevOpsSettings
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
    if (d.baseUrl.trim() && !/^https?:\/\//i.test(d.baseUrl.trim())) {
      e.baseUrl = 'http(s):// ile başlamalı.';
    }
    if (
      !Number.isFinite(d.timeoutMs) ||
      d.timeoutMs < TIMEOUT_MIN ||
      d.timeoutMs > TIMEOUT_MAX
    ) {
      e.timeoutMs = `${TIMEOUT_MIN}-${TIMEOUT_MAX} arası olmalı.`;
    }
    if (d.editingPat && d.patInput.trim().length > 0 && d.patInput.trim().length < 8) {
      e.patInput = 'PAT en az 8 karakter olmalı.';
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
    const r = await adminService.externalDevOpsSettings.save(companyId, toPatch(draft));
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
    const result = await adminService.externalDevOpsSettings.test(companyId);
    setTesting(false);
    if (!result) return;
    if (result.ok) {
      toast({
        type: 'success',
        message: `Bağlantı OK — Work item #${result.workItem?.id ?? '?'} alındı (${result.meta?.latencyMs ?? '?'} ms).`,
        duration: 4000,
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
        <GitBranch size={18} className="text-brand-600" />
        <h2 className="text-lg font-semibold text-slate-800 dark:text-ndark-text">
          DevOps / TFS Entegrasyonu
        </h2>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-200">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          Per-tenant Azure DevOps / TFS bağlantı tanımları. PAT (Personal
          Access Token) burada <strong>şifreli</strong> saklanır (AES-256-GCM)
          ve hiçbir GET response'unda görünmez. Aktif değilse vaka detayında
          DevOps bölümü çalışmaz (env'e düşmez).
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
              <Field label="Entegrasyon Aktif" hint="Kapalıyken vaka detayında DevOps bölümü çalışmaz.">
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
                  label="TFS Base URL"
                  hint="ör: https://unitfs.univera.com.tr/tfs/DefaultCollection/_apis"
                  error={errors.baseUrl}
                >
                  <TextInput
                    value={draft.baseUrl}
                    onChange={(e) => update('baseUrl', e.target.value)}
                    placeholder="https://unitfs.univera.com.tr/tfs/DefaultCollection/_apis"
                  />
                </Field>
                <Field label="API Version" hint='ör: "4.1" (on-prem) veya "6.0" (cloud)'>
                  <TextInput
                    value={draft.apiVersion}
                    onChange={(e) => update('apiVersion', e.target.value)}
                    placeholder="4.1"
                  />
                </Field>
                <Field
                  label="Timeout (ms)"
                  hint={`${TIMEOUT_MIN}-${TIMEOUT_MAX} ms`}
                  error={errors.timeoutMs}
                >
                  <TextInput
                    type="number"
                    value={String(draft.timeoutMs)}
                    onChange={(e) => update('timeoutMs', Number(e.target.value))}
                    placeholder="15000"
                  />
                </Field>
              </div>

              {/* PAT — WRITE-ONLY widget. */}
              <Field
                label="Personal Access Token (PAT)"
                hint="Sunucuda AES-256-GCM ile şifreli saklanır; bu sayfada geri gösterilmez."
                error={errors.patInput}
              >
                {!draft.editingPat ? (
                  <div className="flex items-center gap-3">
                    {setting?.patIsSet ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        <CheckCircle2 size={12} />
                        PAT ayarlı · {formatDate(setting.patSetAt)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                        <Lock size={12} />
                        PAT henüz ayarlanmadı
                      </span>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => update('editingPat', true)}
                    >
                      {setting?.patIsSet ? 'Değiştir' : 'PAT gir'}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <TextInput
                      type="password"
                      autoComplete="new-password"
                      value={draft.patInput}
                      onChange={(e) => update('patInput', e.target.value)}
                      placeholder={
                        setting?.patIsSet
                          ? 'Değiştirmek için yeni PAT gir'
                          : 'PAT gir (en az 8 karakter)'
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
                          update('editingPat', false);
                          update('patInput', '');
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
                  disabled={testing || !setting?.patIsSet}
                  title={
                    !setting?.patIsSet
                      ? 'Önce PAT kaydet, sonra test edebilirsin.'
                      : 'Saklı PAT ile bir test work item çekmeyi dener.'
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

export default AdminExternalDevOpsPage;
