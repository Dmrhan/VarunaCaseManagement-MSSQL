import { useState } from 'react';
import { Mail, Send, AlertTriangle, Sparkles } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { CompanySelector } from '@/components/ui/CompanySelector';
import { useToast } from '@/components/ui/Toast';
import { adminService } from '@/services/adminService';
import type { AdminUser, CompanyRole } from '@/services/adminService';

interface InviteUserModalProps {
  open: boolean;
  onClose: () => void;
  /** Davet başarılı olduğunda parent listeyi yenilesin. */
  onInvited: () => void;
}

// Phase 5C ürün kararı: 5 sistem rolü gösterilir; SystemAdmin invite kabul edilmez.
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

/**
 * Admin'den e-posta ile kullanıcı davet modalı (Phase 5C).
 *
 * Davet edilen kullanıcıya Supabase Auth üzerinden magic-link davet maili gider;
 * DB'de placeholder User satırı (`fullName=email`) ve UserCompany ataması yaratılır.
 * Kullanıcı linke tıklayıp Supabase'de hesap kurar, ilk login'inde verifyJwt
 * DB User'i bulur (auto-provision tetiklenmez). Davet bekleyen kullanıcı admin
 * sayfasında "Davet bekliyor" rozetiyle görünür.
 */
export function InviteUserModal({ open, onClose, onInvited }: InviteUserModalProps) {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AdminUser['role']>('Agent');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyRole, setCompanyRole] = useState<CompanyRole>('Agent');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setEmail('');
    setRole('Agent');
    setCompanyId(null);
    setCompanyRole('Agent');
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
    setSubmitting(true);
    const result = await adminService.users.invite({
      email: trimmedEmail,
      role,
      companyId,
      companyRole,
    });
    setSubmitting(false);
    if (result.ok) {
      const orphanNote = result.item.orphanRecovered
        ? ' (Supabase Auth\'ta zaten kayıtlıydı; mevcut hesap bağlandı.)'
        : '';
      toast({
        type: 'success',
        title: 'Davet gönderildi',
        message: `${result.item.email} adresine davet maili gönderildi.${orphanNote}`,
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
          Yeni Kullanıcı Davet Et
        </span>
      )}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" onClick={handleClose} disabled={submitting}>Vazgeç</Button>
          <Button size="sm" variant="primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Gönderiliyor…
              </>
            ) : (
              <>
                <Send size={12} />
                Davet Gönder
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

        <Field label="Şirket" required hint="Davet edilen kullanıcı hangi şirkete bağlansın?">
          <CompanySelector
            value={companyId}
            onChange={(id) => setCompanyId(id)}
            required
            disabled={submitting}
          />
        </Field>

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

        <div className="rounded-md bg-slate-50 px-3 py-2 text-[11px] text-slate-600 dark:bg-ndark-bg/40 dark:text-ndark-muted">
          <strong>Ne olacak?</strong>
          {' '}Bu e-posta adresine Supabase üzerinden bir davet maili gider.
          Kullanıcı linke tıklayıp şifresini belirleyince uygulamaya girebilir.
          Davet bekleyen kullanıcı listede "Davet bekliyor" rozetiyle görünür.
        </div>
      </div>
    </Modal>
  );
}
