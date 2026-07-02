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
  type InboxTestResult,
} from '@/services/adminService';
import { lookupService } from '@/services/caseService';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Field';
import { HelpButton, HelpDrawer } from '@/components/ui/HelpDrawer';
import { MAIL_INTEGRATION_HELP } from './helpContents';

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
  // 2026-07-02 go-live sadeleştirmesi:
  // Legacy IMAP alanları (inboundAddress / imapHost / imapPort / authMode)
  // UI'dan kaldırıldı; polling artık ExternalMailInbox satırlarını okuyor.
  // Bu alanlar patch'e KOYULMAZ → backend
  // externalMailSettingRepository.js:128 `patch.X !== undefined` guard'ı
  // sayesinde mevcut değerler DOKUNULMAZ (schema'da alanlar duruyor).
  const patch: ExternalMailSettingInput = {
    enabled: d.enabled,
    fromAddress: d.fromAddress.trim() ? d.fromAddress.trim() : null,
    smtpHost: d.smtpHost.trim() ? d.smtpHost.trim() : null,
    smtpPort: d.smtpPort || null,
    smtpSecure: d.smtpSecure,
    // username SMTP giden hesabı için üst kartta korundu.
    username: d.username.trim() ? d.username.trim() : null,
  };
  // Secret yalnız "Değiştir" açıldıysa ve girildiyse gönder.
  if (d.editingSecret && d.secretInput.trim().length > 0) {
    patch.secret = d.secretInput.trim();
  }
  return patch;
}

/**
 * 2026-07-02 — Test sonucu Türkçe aksiyon mesajı.
 * Admin okuduğunda ne yapacağını anlasın (help/explainability kuralı):
 *   ok                 → Bağlantı başarılı — polling için hazır.
 *   auth_failed        → Kullanıcı adı / App Password'ü kontrol et.
 *   connection_failed  → Sunucu/port erişilemiyor — IT'den giden 993 iznini doğrulat.
 *   config_incomplete  → IMAP host / kullanıcı adı / şifre eksik.
 *   inbox_disabled     → Inbox pasif — önce aktifleştir.
 *   inbox_invalid      → Inbox tanımı bozuk (yeniden aç).
 *   not_found          → Inbox bulunamadı (silinmiş olabilir; listeyi yenile).
 * Bilinmeyen kod → backend message'ı geri gönderilir.
 */
function formatInboxTestMessage(result: InboxTestResult): string {
  switch (result.code) {
    case 'ok':
      return 'Bağlantı başarılı — polling için hazır.';
    case 'auth_failed':
      return 'Kimlik doğrulama başarısız — kullanıcı adı / App Password\'ü kontrol et.';
    case 'connection_failed':
      return 'Sunucu/port erişilemiyor — IT\'den 993 giden erişimini doğrulat.';
    case 'config_incomplete':
      return 'IMAP host / kullanıcı adı / şifre eksik.';
    case 'inbox_disabled':
      return 'Inbox pasif — önce aktifleştir.';
    case 'inbox_invalid':
      return 'Inbox tanımı geçersiz.';
    case 'not_found':
      return 'Inbox bulunamadı — listeyi yenile.';
    default:
      return result.message || 'Bilinmeyen hata.';
  }
}

/**
 * FAZ B (2026-07-02) — Kanal başına test sonucu Türkçe mesajı.
 * IMAP: mail çekme; SMTP: mail gönderme.
 */
function formatChannelTestMessage(ch: { ok: boolean; code: string; message: string; fallbackAvailable?: boolean }, channel: 'imap' | 'smtp'): string {
  if (ch.ok) return channel === 'imap' ? 'bağlandı' : 'bağlandı';
  if (channel === 'smtp' && ch.fallbackAvailable) {
    return 'config yok — tenant fallback devrede';
  }
  switch (ch.code) {
    case 'auth_failed':
      return channel === 'imap'
        ? 'kimlik hatası (App Password?)'
        : 'kimlik hatası (App Password?)';
    case 'connection_failed':
      return channel === 'imap'
        ? 'sunucu erişilemedi (993 açık mı?)'
        : 'sunucu erişilemedi (587/465 açık mı?)';
    case 'config_incomplete':
      return channel === 'imap'
        ? 'host/kullanıcı/şifre eksik'
        : 'host/kullanıcı/şifre eksik';
    default:
      return ch.message || 'hata';
  }
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
  // 2026-07-02 — Kullanıcı dilinde detaylı yardım drawer'ı.
  const [helpOpen, setHelpOpen] = useState(false);
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
    // 2026-07-02 — IMAP port validasyonu UI'dan kaldırıldı (alan yok).
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
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Mail size={18} className="text-brand-600" />
          <h2 className="text-lg font-semibold text-slate-800 dark:text-ndark-text">
            Mail Entegrasyonu
          </h2>
        </div>
        {/* 2026-07-02 — Detaylı kullanıcı dilinde yardım drawer'ı.
            İçerik: MAIL_INTEGRATION_HELP (bu ekran ne için + multi-inbox +
            SMTP + no-reply + adım adım yeni inbox + test sonuçları + sık
            karşılaşılan sorunlar + güvenlik). */}
        <HelpButton onClick={() => setHelpOpen(true)} active={helpOpen} />
      </div>

      <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-200">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          Bu tenant için <strong>giden</strong> mail (SMTP) ve <strong>gelen</strong> mailbox'ları
          (aşağıdaki "Gelen Mail Inbox'ları" listesi) tanımlanır. Secret
          değerleri <strong>şifreli</strong> saklanır (AES-256-GCM) ve hiçbir
          GET response'unda görünmez. Entegrasyon Aktif kapalıyken tüm inbox'ların
          polling'i ve mail gönderimi durur.
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

      {/* FAZ B (2026-07-02) — Layout swap: Multi-Inbox sayfa merkezi, SMTP
          fallback kart en altta collapse. Her inbox artık kendi SMTP+IMAP
          kredisiyle çalışır; tenant-ortak SMTP yalnız SMTP'si tanımsız
          inbox'lar için fallback. */}
      {companyId && <MailInboxManager companyId={companyId} />}

      {/* Compose-Signature F2 — Şirket imza şablonu (lazy) — Multi-Inbox'ın altında,
          agent'ın sık kullandığı yer. */}
      {companyId && (
        <Suspense fallback={<p className="text-sm text-slate-400">Şirket imza şablonu yükleniyor…</p>}>
          <CompanySignatureTemplate companyId={companyId} />
        </Suspense>
      )}

      {/* From alias yönetimi — composer dropdown beslemesi. Multi-Inbox
          adresleri otomatik köprülenir; bu kart nadir manuel ekleme için. */}
      {companyId && <FromAliasManager companyId={companyId} fallbackFrom={draft?.fromAddress ?? ''} />}

      {/* Sistem Bildirim Mailleri (no-reply). Collapse şeklinde; nadiren
          değiştirilir. FAZ B sonrası composer mailleri her inbox'un kendi
          SMTP'siyle gider; buradaki hesap SİSTEM ürettiği otomatik
          bildirimleri (vaka açıldı / durum güncellendi / çözüldü /
          aksiyon uyarıları) gönderir. Ayrıca SMTP'si tanımsız kalan
          inbox'lar için güvenlik ağı görevi de görür. */}
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
            <details className="space-y-5" open={false}>
              <summary className="cursor-pointer text-sm font-semibold text-slate-800 dark:text-ndark-text">
                Sistem Bildirim Mailleri (no-reply)
                <span className="ml-2 text-[11px] font-normal text-slate-500 dark:text-ndark-muted">
                  (vaka açıldı / durum güncellendi / çözüldü bildirimlerini bu hesap gönderir)
                </span>
              </summary>
              <div className="mt-3 flex items-center gap-2 border-b border-slate-200 pb-2 dark:border-ndark-border">
                <span className="text-[11px] text-slate-500 dark:text-ndark-muted">
                  Agent'ın composer'dan gönderdiği mailler her inbox'un kendi SMTP'siyle
                  gider; bu kart <strong>sistemin ürettiği otomatik bildirim maillerini</strong>
                  gönderen hesabı tanımlar. İdealde ayrı bir "no-reply" hesabı; şu anki
                  hesabı istediğin zaman değiştirebilirsin. Boş bırakılırsa sistem
                  bildirimleri hata verir.
                </span>
              </div>

              <Field
                label="Entegrasyon Aktif"
                hint="Kill switch — kapalıyken TÜM inbox'ların polling'i ve mail gönderimi durur."
              >
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
                <Field
                  label="SMTP Kullanıcı Adı"
                  hint="Giden SMTP hesabının kullanıcı adı (genelde From adresi)"
                >
                  <TextInput
                    value={draft.username}
                    onChange={(e) => update('username', e.target.value)}
                    placeholder="support@univera.com.tr"
                    autoComplete="off"
                  />
                </Field>
              </div>

              {/* 2026-07-02 — Gelen mail (IMAP) ayarları artık aşağıdaki
                  "Gelen Mail Inbox'ları" bölümünden yönetiliyor. Legacy
                  ExternalMailSetting.inboundAddress / imapHost / imapPort /
                  authMode alanları polling'de KULLANILMIYOR (imapPoller
                  yalnız ExternalMailInbox okuyor). Bu alanlar payload'a
                  gönderilmez → mevcut update endpoint'i alan gelmeyince
                  satırı korur (upsert semantik). Schema'da alanlar kalır. */}
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600 dark:border-ndark-border dark:bg-ndark-surface dark:text-ndark-muted">
                <span className="font-medium">Gelen mail (IMAP) tanımları</span> artık
                aşağıdaki <strong>Gelen Mail Inbox'ları</strong> bölümünden
                yönetilir — her adres ayrı satır (Multi-Inbox v1).
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
            </details>
          )}
        </CardBody>
      </Card>
      {/* NOT: Multi-Inbox / Signature / FromAlias kartları yukarı taşındı (FAZ B layout swap). */}

      {/* 2026-07-02 — Detaylı yardım drawer'ı (kullanıcı dilinde, admin/CS
          ekibi için). Trigger: sayfa header'ındaki "Yardım" butonu. */}
      <HelpDrawer
        open={helpOpen}
        title={MAIL_INTEGRATION_HELP.title}
        sections={MAIL_INTEGRATION_HELP.sections}
        onClose={() => setHelpOpen(false)}
      />
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
  // 2026-07-02 — Inbox-başına test sonucu ve pending state.
  //   testResults[inboxId] = { ok, code, message } · yeni test yapılınca kaydolur.
  //   testingId = testin şu an çalıştığı inbox id (buton disabled + label).
  const [testResults, setTestResults] = useState<Record<string, InboxTestResult>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
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
    // Şirket / inbox listesi değişince eski test rozetlerini bırakma —
    // "yanıltıcı geçmiş sonuç göstermeyelim" ilkesi.
    setTestResults({});
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

  // 2026-07-02 — Inbox-başına IMAP bağlantı testi.
  // Backend: POST /api/admin/external-mail-settings/:companyId/inboxes/:id/test
  // (imapPoller.testInboxConnection reuse; mail çekmez, mutate etmez).
  async function handleTest(item: MailInboxItem) {
    setTestingId(item.id);
    const result = await adminService.externalMailSettings.inboxes.test(companyId, item.id);
    setTestResults((prev) => ({ ...prev, [item.id]: result }));
    setTestingId(null);
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
            {items.map((it) => {
              const testResult = testResults[it.id];
              const isTesting = testingId === it.id;
              return (
                <li key={it.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
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
                    {/* FAZ B (2026-07-02) — IMAP + SMTP ayrı rozet.
                        Her kanal için kendi kod → mesaj eşlemesi. */}
                    {testResult && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5" role="status">
                        {testResult.imap && (
                          <span
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${
                              testResult.imap.ok
                                ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                                : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
                            }`}
                          >
                            {testResult.imap.ok ? <CheckCircle2 size={10} /> : <Info size={10} />}
                            <span>IMAP: {formatChannelTestMessage(testResult.imap, 'imap')}</span>
                          </span>
                        )}
                        {testResult.smtp && (
                          <span
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${
                              testResult.smtp.ok
                                ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                                : testResult.smtp.fallbackAvailable
                                  ? 'bg-slate-100 text-slate-700 dark:bg-ndark-surface dark:text-ndark-muted'
                                  : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
                            }`}
                          >
                            {testResult.smtp.ok
                              ? <CheckCircle2 size={10} />
                              : testResult.smtp.fallbackAvailable
                                ? <Info size={10} />
                                : <Info size={10} />}
                            <span>SMTP: {formatChannelTestMessage(testResult.smtp, 'smtp')}</span>
                          </span>
                        )}
                        {/* Kanallar yoksa (inbox_disabled / inbox_invalid vb.) toplam kod'u göster. */}
                        {!testResult.imap && !testResult.smtp && (
                          <span
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${
                              testResult.ok
                                ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                                : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
                            }`}
                          >
                            {testResult.ok ? <CheckCircle2 size={10} /> : <Info size={10} />}
                            <span>{formatInboxTestMessage(testResult)}</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void handleTest(it)}
                    disabled={busy || isTesting}
                    title="IMAP bağlantısını test eder (mail çekmez, hiçbir şey değiştirmez)."
                  >
                    {isTesting ? 'Test ediliyor…' : 'Bağlantıyı test et'}
                  </Button>
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
              );
            })}
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
  // FAZ B (2026-07-02) — Per-inbox SMTP alanları.
  // Default'lar Gmail için doğru (smtp.gmail.com:587 STARTTLS). Backend
  // upsert boş bırakılırsa NULL saklar → tenant-ortak fallback devrede.
  const [smtpHost, setSmtpHost] = useState<string>(initial?.smtpHost ?? 'smtp.gmail.com');
  const [smtpPort, setSmtpPort] = useState<number>(initial?.smtpPort ?? 587);
  const [smtpSecure, setSmtpSecure] = useState<boolean>(initial?.smtpSecure === true);
  const [fromAddress, setFromAddress] = useState<string>(initial?.fromAddress ?? '');
  const [username, setUsername] = useState(initial?.username ?? '');
  const [assignedTeamId, setAssignedTeamId] = useState<string>(initial?.assignedTeamId ?? '');
  const [enabled, setEnabled] = useState<boolean>(initial?.enabled ?? false);
  // Secret rotation: yeni inbox'ta zorunlu input; düzenleme modunda
  // "Şifreyi değiştir" toggle açık değilse secret undefined gider (rotate yok).
  const [rotateSecret, setRotateSecret] = useState<boolean>(!isEdit);
  const [secret, setSecret] = useState<string>('');
  const [saving, setSaving] = useState(false);
  // 2026-07-02 — "Kaydet ve Test Et" akışı. Save başarılı → dönen id ile
  // hemen IMAP test. Sonuç inline banner; kullanıcı "Kapat"a basınca
  // liste refresh (onSaved).
  const [inlineTest, setInlineTest] = useState<
    | { status: 'idle' }
    | { status: 'testing' }
    | { status: 'done'; result: InboxTestResult }
  >({ status: 'idle' });

  // Username default: address ile aynı (ilk açılışta)
  useEffect(() => {
    if (!isEdit && address && !username) {
      setUsername(address);
    }
  }, [address, username, isEdit]);

  async function persistDraft(): Promise<MailInboxItem | undefined> {
    const addr = address.trim();
    if (!addr) {
      toast({ type: 'warn', message: 'Adres zorunlu.' });
      return undefined;
    }
    if (rotateSecret && secret.trim().length < 4) {
      toast({ type: 'warn', message: 'Şifre en az 4 karakter olmalı.' });
      return undefined;
    }
    // FAZ B — fromAddress default: kullanıcı boş bıraktıysa
    // "Display <address>" (display doluysa) veya çıplak address.
    const trimmedDisplayName = displayName.trim();
    const trimmedFromAddress = fromAddress.trim();
    const finalFromAddress = trimmedFromAddress
      || (trimmedDisplayName ? `${trimmedDisplayName} <${addr}>` : addr);

    const draft: MailInboxDraft = {
      address: addr,
      displayName: trimmedDisplayName || null,
      imapHost: imapHost.trim() || null,
      imapPort: Number(imapPort) || null,
      imapSecure,
      // FAZ B — SMTP alanları; boş bırakılırsa NULL (tenant fallback).
      smtpHost: smtpHost.trim() || null,
      smtpPort: Number(smtpPort) || null,
      smtpSecure,
      fromAddress: finalFromAddress || null,
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
    return r;
  }

  async function handleSave() {
    const r = await persistDraft();
    if (r) {
      toast({ type: 'success', message: isEdit ? 'Inbox güncellendi.' : 'Inbox eklendi.' });
      onSaved();
    }
  }

  // 2026-07-02 — Modal içinde tek adım "Kaydet ve Test Et".
  // Save başarılı → hemen inbox.id ile IMAP test → sonuç inline banner.
  // Kullanıcı "Kapat"a basınca liste refresh (onSaved).
  async function handleSaveAndTest() {
    const r = await persistDraft();
    if (!r) return;
    toast({ type: 'success', message: isEdit ? 'Inbox güncellendi.' : 'Inbox eklendi.' });
    setInlineTest({ status: 'testing' });
    const testRes = await adminService.externalMailSettings.inboxes.test(companyId, r.id);
    setInlineTest({ status: 'done', result: testRes });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Inbox\'ı Düzenle' : 'Yeni Inbox'}
      size="lg"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {inlineTest.status === 'done' ? (
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                setInlineTest({ status: 'idle' });
                onSaved();
              }}
            >
              Kapat
            </Button>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={onClose} disabled={saving || inlineTest.status === 'testing'}>
                İptal
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void handleSaveAndTest()}
                disabled={saving || inlineTest.status === 'testing'}
              >
                {inlineTest.status === 'testing' ? 'Test ediliyor…' : 'Kaydet ve Test Et'}
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => void handleSave()}
                disabled={saving || inlineTest.status === 'testing'}
                leftIcon={<Save size={14} />}
              >
                {saving ? 'Kaydediliyor…' : 'Kaydet'}
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {/* 2026-07-02 — Inline test sonucu (Kaydet ve Test Et sonrası). */}
        {inlineTest.status === 'done' && (
          <div
            className={`rounded-md px-3 py-2.5 text-sm ${
              inlineTest.result.ok
                ? 'border border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200'
                : 'border border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200'
            }`}
            role="status"
          >
            <div className="flex items-start gap-2">
              {inlineTest.result.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <Info size={14} className="mt-0.5 shrink-0" />}
              <div>
                <p className="font-medium">{formatInboxTestMessage(inlineTest.result)}</p>
                {!inlineTest.result.ok && inlineTest.result.message && inlineTest.result.message !== formatInboxTestMessage(inlineTest.result) && (
                  <p className="mt-0.5 text-xs opacity-80">Sunucu detayı: {inlineTest.result.message}</p>
                )}
              </div>
            </div>
          </div>
        )}
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

        {/* IMAP credentials — GELEN mail */}
        <div className="rounded-md border border-slate-200 p-3 dark:border-ndark-border">
          <p className="mb-2 text-xs font-semibold text-slate-600 dark:text-ndark-muted">
            GELEN MAİL (IMAP) — Bu adrese gelen mailler polling ile çekilir
          </p>
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
        </div>

        {/* FAZ B (2026-07-02) — GİDEN mail (SMTP) — Per-inbox tam kredi.
            Boş bırakılırsa tenant-ortak SMTP fallback devrede
            (mevcut inbox'lar backfill sonrası dolu; yeni inbox'lar isterse
            tenant'a düşer). */}
        <div className="rounded-md border border-slate-200 p-3 dark:border-ndark-border">
          <p className="mb-2 text-xs font-semibold text-slate-600 dark:text-ndark-muted">
            GİDEN MAİL (SMTP) — Bu adresten gönderim ayrı hesapla yapılır
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="SMTP sunucusu" hint="Gmail: smtp.gmail.com">
              <TextInput
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                placeholder="smtp.gmail.com"
              />
            </Field>
            <Field label="Port" hint="587 (STARTTLS) veya 465 (SSL)">
              <TextInput
                type="number"
                value={String(smtpPort)}
                onChange={(e) => setSmtpPort(Number(e.target.value))}
                placeholder="587"
              />
            </Field>
            <Field label="SSL/TLS">
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={smtpSecure}
                  onChange={(e) => setSmtpSecure(e.target.checked)}
                />
                <span>SSL (465 için açık)</span>
              </label>
            </Field>
          </div>
          <div className="mt-3">
            <Field
              label="From adresi"
              hint={
                'Bu inbox\'tan çıkan mailler bu "From" ile gider. Boş bırakırsan '
                + '"Görünen ad <mail adresi>" formatı otomatik uygulanır.'
              }
            >
              <TextInput
                value={fromAddress}
                onChange={(e) => setFromAddress(e.target.value)}
                placeholder={
                  displayName.trim()
                    ? `${displayName.trim()} <${address || 'adres@ornek.com'}>`
                    : (address || 'adres@ornek.com')
                }
              />
            </Field>
          </div>
        </div>

        {/* Auth — SMTP + IMAP paylaşımlı (Gmail App Password tek kredi). */}
        <div className="rounded-md border border-slate-200 p-3 dark:border-ndark-border">
          <p className="mb-2 text-xs font-semibold text-slate-600 dark:text-ndark-muted">
            KİMLİK BİLGİLERİ — SMTP ve IMAP paylaşımlı (tek App Password)
          </p>
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
              hint={isEdit ? 'Yeni şifre girmek için aşağıdaki seçeneği işaretle.' : 'Gmail için App Password (16 karakter). Hem SMTP hem IMAP için kullanılır.'}
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
