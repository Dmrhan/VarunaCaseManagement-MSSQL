import { useEffect, useMemo, useState } from 'react';
import { Mail, Pencil, PowerOff, RefreshCw, Send, Shield, ShieldCheck, Users } from 'lucide-react';
import { CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, Select } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/services/AuthContext';
import {
  adminService,
  type AdminUser,
  type Company,
  type CompanyRole,
} from '@/services/adminService';
import { AdminListLayout } from './AdminListLayout';
import { InviteUserModal } from './InviteUserModal';
import { USERS_HELP } from './helpContents';

/**
 * Phase 5B + 5C — Kullanıcı yönetimi.
 *
 * SystemAdmin: tüm kullanıcıları görür, herhangi birinin atamalarını değiştirir.
 * Admin: yalnızca atandığı şirketlerde assignment'ı olan kullanıcıları görür;
 * yalnızca kendi şirketlerine atama yapabilir.
 *
 * Phase 5C: Admin'den davet, pasifleştir, yeniden aktiflestir akışları eklendi.
 * "Davet bekliyor" rozet `fullName === email` heuristic'i ile tespit edilir
 * (kullanıcı ilk login sonrası fullName'i Supabase'den günceller).
 */

const ASSIGNABLE_ROLES: CompanyRole[] = ['Agent', 'Supervisor', 'Admin'];

const ROLE_LABELS: Record<CompanyRole, string> = {
  Agent: 'Agent',
  Supervisor: 'Supervisor',
  Admin: 'Admin',
  SystemAdmin: 'SystemAdmin',
};

const ROLE_TINTS: Record<CompanyRole, 'slate' | 'blue' | 'amber' | 'emerald'> = {
  Agent: 'slate',
  Supervisor: 'blue',
  Admin: 'amber',
  SystemAdmin: 'emerald',
};

export function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const isSystemAdmin = currentUser?.role === 'SystemAdmin';

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<AdminUser | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<{ user: AdminUser; action: 'deactivate' | 'reactivate' } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  /** Resend yalnız tek bir satırın spinning'i için — global modal yok */
  const [resendingId, setResendingId] = useState<string | null>(null);

  async function handleResend(user: AdminUser) {
    setResendingId(user.id);
    const result = await adminService.users.resendInvite(user.id);
    setResendingId(null);
    if (result.ok) {
      toast({
        type: 'success',
        title: 'Davet maili yeniden gönderildi',
        message: `${result.item.email} adresine yeni link gönderildi.`,
      });
    } else {
      toast({ type: 'error', message: result.error });
    }
  }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [u, c] = await Promise.all([
        adminService.users.list(),
        adminService.companies.list(),
      ]);
      setUsers(u);
      setCompanies(c);
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
    if (!q) return users;
    return users.filter(
      (u) =>
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q),
    );
  }, [users, search]);

  return (
    <>
      <AdminListLayout
        title="Kullanıcılar"
        description={
          isSystemAdmin
            ? 'Tüm sistemdeki kullanıcılar ve şirket atamaları. SystemAdmin sistem rolüne sahip kullanıcıların ataması salt-okunur (otomatik tüm şirketlere erişir).'
            : 'Şirket(ler)inize atanmış kullanıcılar. Yalnızca yetkili olduğunuz şirketlere atama yapabilirsiniz.'
        }
        count={filtered.length}
        searchEnabled
        searchPlaceholder="Ad, e-posta veya rol..."
        searchValue={search}
        onSearchChange={setSearch}
        onAdd={() => setInviteOpen(true)}
        addLabel="Yeni Kullanıcı Davet Et"
        loading={loading}
        error={error}
        onRetry={refresh}
        helpTitle={USERS_HELP.title}
        helpSections={USERS_HELP.sections}
      >
        {filtered.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<Users size={22} />}
              title={search ? 'Kullanıcı bulunamadı' : 'Henüz kullanıcı yok'}
              description={
                search
                  ? 'Aramayı temizlemeyi deneyin.'
                  : 'Yeni Supabase Auth kullanıcısı ilk girişte otomatik kayıt olur, sonra buradan şirkete atayabilirsiniz.'
              }
            />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-ndark-border">
              <thead className="bg-slate-50 dark:bg-ndark-bg">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
                  <th className="px-4 py-2.5">Kullanıcı</th>
                  <th className="px-4 py-2.5">E-posta</th>
                  <th className="px-4 py-2.5">Sistem Rolü</th>
                  <th className="px-4 py-2.5">Şirket Atamaları</th>
                  <th className="px-4 py-2.5">Durum</th>
                  <th className="px-4 py-2.5 text-right">Aksiyonlar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-ndark-border">
                {filtered.map((u) => {
                  const isReadOnly = u.role === 'SystemAdmin';
                  // "Davet bekliyor" heuristic: fullName === email → kullanıcı ilk login
                  // sonrası Supabase metadata'sıyla fullName'i güncelleyene kadar placeholder kalır.
                  const inviteePending = u.fullName === u.email;
                  const isSelf = u.id === currentUser?.id;
                  return (
                    <tr key={u.id} className="text-sm hover:bg-slate-50 dark:hover:bg-ndark-bg/50">
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800 dark:text-ndark-text">
                        <div className="flex items-center gap-2">
                          {isReadOnly ? (
                            <ShieldCheck size={14} className="text-emerald-500" />
                          ) : (
                            <Shield size={14} className="text-slate-400" />
                          )}
                          {inviteePending ? (
                            <span className="italic text-slate-500 dark:text-ndark-muted">
                              (henüz giriş yapmadı)
                            </span>
                          ) : (
                            u.fullName
                          )}
                          {inviteePending && (
                            <Badge tint="amber" className="font-normal">Davet bekliyor</Badge>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700 dark:text-ndark-text">
                        <span className="inline-flex items-center gap-1 text-xs">
                          <Mail size={11} className="text-slate-400" />
                          {u.email}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Badge tint={u.role === 'SystemAdmin' ? 'emerald' : 'slate'}>
                          {u.role}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {u.assignments.length === 0 ? (
                            <span className="text-xs italic text-slate-400">— atama yok —</span>
                          ) : (
                            u.assignments.map((a) => (
                              <span
                                key={a.companyId}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
                                title={`${a.companyName} → ${a.role}`}
                              >
                                <span
                                  className="font-medium"
                                  style={{
                                    color: companies.find((c) => c.id === a.companyId)?.primaryColor ?? undefined,
                                  }}
                                >
                                  {a.companyName}
                                </span>
                                <span className="text-slate-400">·</span>
                                <span className="text-slate-500 dark:text-ndark-muted">
                                  {ROLE_LABELS[a.role]}
                                </span>
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {u.isActive ? (
                          <Badge tint="emerald">Aktif</Badge>
                        ) : (
                          <Badge tint="slate">Pasif</Badge>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {/* "Yeniden gönder" — yalnız davet bekleyen aktif kullanıcılar için.
                              Eski davet mailindeki link localhost olabilir (yanlış env ile gönderildiyse);
                              yeni mail SUPABASE_INVITE_REDIRECT_URL ile gider. */}
                          {inviteePending && u.isActive && !isReadOnly && (
                            <Button
                              size="sm"
                              variant="outline"
                              leftIcon={
                                resendingId === u.id ? (
                                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
                                ) : (
                                  <Send size={12} />
                                )
                              }
                              onClick={() => handleResend(u)}
                              disabled={resendingId !== null}
                              title="Davet mailini yeniden gönder (prod link)"
                            >
                              {resendingId === u.id ? 'Gönderiliyor…' : 'Yeniden gönder'}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            leftIcon={<Pencil size={12} />}
                            onClick={() => setEditor(u)}
                            disabled={isReadOnly}
                            title={
                              isReadOnly
                                ? 'SystemAdmin sistem rolü — atama otomatik, değiştirilemez.'
                                : 'Şirket atamalarını düzenle'
                            }
                          >
                            Düzenle
                          </Button>
                          {u.isActive ? (
                            <Button
                              size="sm"
                              variant="outline"
                              leftIcon={<PowerOff size={12} />}
                              onClick={() => setConfirmTarget({ user: u, action: 'deactivate' })}
                              disabled={isReadOnly || isSelf}
                              title={
                                isSelf
                                  ? 'Kendi hesabını pasifleştiremezsin.'
                                  : isReadOnly
                                    ? 'SystemAdmin pasifleştirilemez.'
                                    : 'Kullanıcıyı pasifleştir'
                              }
                            >
                              Pasifleştir
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              leftIcon={<RefreshCw size={12} />}
                              onClick={() => setConfirmTarget({ user: u, action: 'reactivate' })}
                              disabled={isReadOnly}
                              title="Kullanıcıyı yeniden aktiflestir"
                            >
                              Yeniden aktif et
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </AdminListLayout>

      {editor && (
        <UserAssignmentEditor
          user={editor}
          companies={companies}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await refresh();
            toast({ type: 'success', message: 'Şirket atamaları güncellendi.' });
          }}
        />
      )}

      <InviteUserModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvited={refresh}
      />

      {confirmTarget && (
        <Modal
          open
          onClose={() => (actionBusy ? null : setConfirmTarget(null))}
          size="sm"
          title={
            confirmTarget.action === 'deactivate'
              ? 'Kullanıcıyı pasifleştir'
              : 'Kullanıcıyı yeniden aktif et'
          }
          footer={(
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setConfirmTarget(null)} disabled={actionBusy}>
                Vazgeç
              </Button>
              <Button
                size="sm"
                variant={confirmTarget.action === 'deactivate' ? 'danger' : 'primary'}
                onClick={async () => {
                  setActionBusy(true);
                  const result = confirmTarget.action === 'deactivate'
                    ? await adminService.users.deactivate(confirmTarget.user.id)
                    : await adminService.users.reactivate(confirmTarget.user.id);
                  setActionBusy(false);
                  if (result.ok) {
                    toast({
                      type: 'success',
                      message:
                        confirmTarget.action === 'deactivate'
                          ? `${confirmTarget.user.email} pasifleştirildi.`
                          : `${confirmTarget.user.email} yeniden aktifleştirildi.`,
                    });
                    setConfirmTarget(null);
                    await refresh();
                  } else {
                    toast({ type: 'error', message: result.error });
                  }
                }}
                disabled={actionBusy}
              >
                {actionBusy
                  ? 'İşleniyor…'
                  : confirmTarget.action === 'deactivate'
                    ? 'Pasifleştir'
                    : 'Yeniden aktif et'}
              </Button>
            </div>
          )}
        >
          <div className="space-y-2 text-sm text-slate-700 dark:text-ndark-text">
            <p>
              <strong>{confirmTarget.user.fullName === confirmTarget.user.email ? confirmTarget.user.email : `${confirmTarget.user.fullName} (${confirmTarget.user.email})`}</strong>
              {' '}
              {confirmTarget.action === 'deactivate'
                ? 'kullanıcısını pasifleştirmek istediğine emin misin?'
                : 'kullanıcısını yeniden aktiflestirmek istediğine emin misin?'}
            </p>
            {confirmTarget.action === 'deactivate' ? (
              <p className="text-xs text-slate-500 dark:text-ndark-muted">
                Kullanıcı sonraki API çağrısında 403 alır ve uygulamadan çıkmış olur. Şirket
                atamaları silinmez — yeniden aktive ederek geri açabilirsin. Supabase Auth hesabı
                silinmez (audit izi korunur).
              </p>
            ) : (
              <p className="text-xs text-slate-500 dark:text-ndark-muted">
                Önceki şirket atamaları korunur. Kullanıcı mevcut şifresiyle veya cached
                JWT'siyle uygulamaya tekrar girebilir.
              </p>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- */
/*  UserAssignmentEditor modal                                       */
/* ---------------------------------------------------------------- */

function UserAssignmentEditor({
  user,
  companies,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // Mevcut atamaları map olarak tut: companyId → role
  const initialMap: Record<string, CompanyRole> = {};
  for (const a of user.assignments) initialMap[a.companyId] = a.role;
  const [draft, setDraft] = useState<Record<string, CompanyRole>>(initialMap);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const selectedCount = Object.keys(draft).length;
  const canSave = selectedCount > 0 && !submitting;

  function toggleCompany(companyId: string) {
    setDraft((prev) => {
      const next = { ...prev };
      if (next[companyId]) {
        delete next[companyId];
      } else {
        next[companyId] = 'Agent'; // default per-company rol
      }
      return next;
    });
  }

  function setRole(companyId: string, role: CompanyRole) {
    setDraft((prev) => ({ ...prev, [companyId]: role }));
  }

  async function handleSubmit() {
    if (selectedCount === 0) {
      toast({ type: 'error', message: 'En az bir şirket seçilmeli.' });
      return;
    }
    const assignments = Object.entries(draft).map(([companyId, role]) => ({ companyId, role }));
    setSubmitting(true);
    const r = await adminService.users.replaceCompanies(user.id, assignments);
    setSubmitting(false);
    if (r.ok) {
      onSaved();
    }
    // !ok ise apiFetch toast göstermiş
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${user.fullName} — Şirket Atamaları`}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500 dark:text-ndark-muted">
            Seçili: <strong>{selectedCount}</strong> şirket
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Vazgeç
            </Button>
            <Button onClick={handleSubmit} disabled={!canSave}>
              {submitting ? 'Kaydediliyor…' : 'Kaydet'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-muted">
          <div><strong>E-posta:</strong> {user.email}</div>
          <div><strong>Sistem rolü:</strong> {user.role}</div>
        </div>

        <Field label="Şirket Erişimi" hint="Kullanıcının erişebileceği şirketler ve her birindeki rolü.">
          {companies.length === 0 ? (
            <p className="text-sm text-slate-500">Önce bir şirket oluşturun.</p>
          ) : (
            <div className="space-y-1.5">
              {companies.map((c) => {
                const checked = draft[c.id] !== undefined;
                return (
                  <div
                    key={c.id}
                    className={`flex items-center gap-3 rounded-md border px-3 py-2 transition ${
                      checked
                        ? 'border-brand-400 bg-brand-50/60 dark:border-brand-700 dark:bg-brand-950/40'
                        : 'border-slate-200 bg-white dark:border-ndark-border dark:bg-ndark-card'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleCompany(c.id)}
                      disabled={!c.isActive}
                      className="h-4 w-4 accent-brand-600"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        {c.primaryColor && (
                          <span
                            className="inline-block h-3 w-3 rounded-sm ring-1 ring-inset ring-slate-200 dark:ring-ndark-border"
                            style={{ backgroundColor: c.primaryColor }}
                          />
                        )}
                        <span className="text-sm font-medium text-slate-800 dark:text-ndark-text">
                          {c.name}
                        </span>
                        {!c.isActive && <Badge tint="slate">Pasif</Badge>}
                      </div>
                      {c.appName && (
                        <div className="mt-0.5 text-xs text-slate-500 dark:text-ndark-muted">
                          {c.appName}
                        </div>
                      )}
                    </div>
                    {checked && (
                      <Select
                        value={draft[c.id]}
                        onChange={(e) => setRole(c.id, e.target.value as CompanyRole)}
                        className="h-8 w-32 py-1 text-sm"
                      >
                        {ASSIGNABLE_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Field>

        {selectedCount === 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            En az bir şirket seçilmeli — son atama kaldırılamaz.
          </div>
        )}
      </div>
    </Modal>
  );
}

// ROLE_TINTS şu an direkt kullanılmıyor (assignments inline render); ileride
// Badge ile değiştirilirse kullanılabilir.
void ROLE_TINTS;
