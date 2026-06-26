import { useMemo, useState } from 'react';
import { Mail, UserPlus, AlertTriangle, Sparkles, KeyRound, User } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { CompanySelector } from '@/components/ui/CompanySelector';
import { useToast } from '@/components/ui/Toast';
import { adminService } from '@/services/adminService';
import type { AdminUser, CompanyRole } from '@/services/adminService';
import { lookupService } from '@/services/caseService';

interface InviteUserModalProps {
  open: boolean;
  onClose: () => void;
  /** Oluşturma başarılı olduğunda parent listeyi yenilesin. */
  onInvited: () => void;
}

// 5 sistem rolü gösterilir; SystemAdmin oluşturma kabul edilmez.
const SYSTEM_ROLES: Array<{ value: AdminUser['role']; label: string; description: string }> = [
  { value: 'Agent',      label: 'Agent',       description: 'Vaka çözen frontline kullanıcı' },
  { value: 'Backoffice', label: 'Backoffice',  description: 'Operasyonel arka ofis' },
  { value: 'Supervisor', label: 'Supervisor',  description: 'Takım yöneticisi' },
  { value: 'CSM',        label: 'CSM',         description: 'Müşteri başarı yöneticisi' },
  { value: 'Admin',      label: 'Admin',       description: 'Şirket yöneticisi' },
];

const COMPANY_ROLES: Array<{ value: CompanyRole; label: string }> = [
  { value: 'Agent',      label: 'Agent' },
  { value: 'Supervisor', label: 'Supervisor' },
  { value: 'Admin',      label: 'Admin' },
];

/** Basit geçici şifre üretici — admin isterse kendi yazabilir. */
function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let pw = pick(upper) + pick(lower) + pick(digits) + pick('!@#$%');
  for (let i = 0; i < 8; i++) pw += pick(all);
  return pw;
}

/**
 * Admin'den kullanıcı oluşturma modalı (Faz 3 — local auth).
 *
 * E-posta GÖNDERİLMEZ: admin başlangıç şifresi belirler (veya üretir) ve
 * kullanıcıya kendisi iletir. Kullanıcı ilk girişte şifresini değiştirmek
 * zorunda kalır (mustChangePassword bayrağı).
 */
export function InviteUserModal({ open, onClose, onInvited }: InviteUserModalProps) {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<AdminUser['role']>('Agent');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyRole, setCompanyRole] = useState<CompanyRole>('Agent');
  const [teamId, setTeamId] = useState<string>('');
  const [password, setPassword] = useState('');

  const teamOptions = useMemo(
    () => companyId ? lookupService.teams().filter((t) => t.companyId === companyId) : [],
    [companyId],
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setEmail('');
    setFullName('');
    setRole('Agent');
    setCompanyId(null);
    setCompanyRole('Agent');
    setTeamId('');
    setPassword('');
    setError(null);
    setSubmitting(false);
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  async function handleSubmit() {
    setError(null);
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Geçerli bir e-posta adresi gir.');
      return;
    }
    if (!companyId) {
      setError('Şirket seçimi zorunlu.');
      return;
    }
    if (password.length < 8) {
      setError('Başlangıç şifresi en az 8 karakter olmalı.');
      return;
    }
    setSubmitting(true);
    const result = await adminService.users.createUser({
      email: trimmedEmail,
      fullName: fullName.trim() || undefined,
      role,
      companyId,
      companyRole,
      password,
      teamId: teamId || undefined,
    });
    setSubmitting(false);
    if (result.ok) {
      toast({
        type: 'success',
        title: 'Kullanıcı oluşturuldu',
        message: `${result.item.email} hesabı açıldı. Başlangıç şifresini kullanıcıya iletin.`,
      });
      onInvited();
      reset();
      onClose();
    } else {
      setError(result.error);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="md"
      title={(
        <span className="inline-flex items-center gap-2">
          <Sparkles size={14} className="text-violet-500" />
          Yeni Kullanıcı Oluştur
        </span>
      )}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" onClick={handleClose} disabled={submitting}>Vazgeç</Button>
          <Button size="sm" variant="primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Oluşturuluyor…
              </>
            ) : (
              <>
                <UserPlus size={12} />
                Kullanıcı Oluştur
              </>
            )}
          </Button>
        </div>
      )}
    >
      <div className="space-y-3 text-sm">
        {error && (
          <div className="flex items-start gap-2 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:bg-rose-900/30 dark:text-rose-200">
            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Field label="E-posta Adresi" required>
          <div className="relative">
            <Mail size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <TextInput
              autoFocus
              type="email"
              placeholder="ornek@firma.com"
              value={email}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
              disabled={submitting}
              className="pl-7"
            />
          </div>
        </Field>

        <Field label="Ad Soyad" hint="Boş bırakılırsa e-postanın @ öncesi kullanılır.">
          <div className="relative">
            <User size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <TextInput
              placeholder="Ad Soyad"
              value={fullName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFullName(e.target.value)}
              disabled={submitting}
              className="pl-7"
            />
          </div>
        </Field>

        <Field label="Sistem Rolü" required hint="Kullanıcının uygulama içindeki ana rolü.">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as AdminUser['role'])}
            disabled={submitting}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
          >
            {SYSTEM_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label} — {r.description}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Şirket" required hint="Kullanıcı hangi şirkete bağlansın?">
          <CompanySelector
            value={companyId}
            onChange={(id) => { setCompanyId(id); setTeamId(''); }}
            required
            disabled={submitting}
          />
        </Field>

        {teamOptions.length > 0 && (
          <Field label="Takım" hint="Opsiyonel — seçilirse kişi kaydı bu takıma bağlanır.">
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              disabled={submitting}
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
            >
              <option value="">— Takım seçme</option>
              {teamOptions.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Şirketteki Rol" required hint="Bu şirket içindeki erişim seviyesi.">
          <select
            value={companyRole}
            onChange={(e) => setCompanyRole(e.target.value as CompanyRole)}
            disabled={submitting}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
          >
            {COMPANY_ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Başlangıç Şifresi" required hint="Kullanıcı ilk girişte değiştirmek zorunda kalır.">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <KeyRound size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <TextInput
                type="text"
                placeholder="En az 8 karakter"
                value={password}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                disabled={submitting}
                className="pl-7 font-mono"
              />
            </div>
            <Button size="sm" variant="outline" onClick={() => setPassword(generatePassword())} disabled={submitting}>
              Üret
            </Button>
          </div>
        </Field>

        <div className="rounded-md bg-slate-50 px-3 py-2 text-[11px] text-slate-600 dark:bg-ndark-bg/40 dark:text-ndark-muted">
          <strong>Ne olacak?</strong>
          {' '}E-posta gönderilmez. Hesap hemen açılır; başlangıç şifresini
          kullanıcıya siz iletirsiniz. Kullanıcı ilk girişinde yeni şifresini
          belirlemeden uygulamaya giremez.
        </div>
      </div>
    </Modal>
  );
}
