import { useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, LogOut, X } from 'lucide-react';
import { changePassword } from '@/services/authClient';
import { useAuth } from '@/services/AuthContext';
import { evaluatePassword } from '@/lib/passwordPolicy';
import { PasswordChecklist } from '@/components/auth/PasswordChecklist';

/**
 * Şifre değiştirme (Faz 3 — local auth).
 *
 * İki kullanım:
 *  1. SetPasswordPage — AuthGate, user.mustChangePassword=true olduğunda
 *     (admin'in atadığı geçici şifreyle ilk giriş) app yerine bunu render eder.
 *     Kullanıcı mevcut (geçici) şifresini + yeni şifresini girer.
 *  2. ChangePasswordModal — App header'ındaki "Şifre Değiştir" butonu;
 *     aynı form modal içinde, gönüllü değişim.
 *
 * Backend: POST /api/auth/change-password — başarıda mustChangePassword
 * temizlenir ve yeni token çifti döner (authClient saklar, auth-changed
 * event'i AuthContext'i tazeler).
 */

function ChangePasswordForm({
  forced,
  onSuccess,
}: {
  forced: boolean;
  onSuccess?: () => void;
}) {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const evaluation = useMemo(
    () => evaluatePassword(password, { email: user?.email ?? null, fullName: user?.fullName ?? null }),
    [password, user?.email, user?.fullName],
  );
  const canSubmit =
    evaluation.ok && password === confirmPassword && password.length > 0 && currentPassword.length > 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!evaluation.ok) {
      setError('Şifre gereksinimleri karşılanmıyor.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Şifreler eşleşmiyor.');
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(currentPassword, password);
      setDone(true);
      // auth-changed event'i AuthContext'i tazeler; forced akışta
      // mustChangePassword=false gelince AuthGate app'i açar.
      setTimeout(() => onSuccess?.(), 800);
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : 'Şifre güncellenemedi.');
    }
  }

  if (done) {
    return (
      <div className="flex items-start gap-2 rounded-md bg-emerald-50 px-3 py-3 text-sm text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200">
        <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" />
        <span>Şifre güncellendi{forced ? '. Uygulamaya yönlendiriliyorsun…' : '.'}</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:bg-rose-900/30 dark:text-rose-200">
          <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-ndark-text">
          {forced ? 'Geçici şifre (giriş yaptığınız)' : 'Mevcut şifre'}
        </label>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="••••••••"
          autoFocus
          autoComplete="current-password"
          disabled={submitting}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-text"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-ndark-text">
          Yeni şifre
        </label>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Güçlü bir şifre belirleyin"
            autoComplete="new-password"
            disabled={submitting}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 pr-10 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-text"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 grid h-6 w-6 place-items-center text-slate-400 hover:text-slate-600 dark:hover:text-ndark-text"
            tabIndex={-1}
            aria-label="Şifreyi göster/gizle"
          >
            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>

      {/* Canli policy checklist */}
      <PasswordChecklist evaluation={evaluation} dim={password.length === 0} />

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-ndark-text">
          Yeni şifreyi tekrar gir
        </label>
        <input
          type={showPassword ? 'text' : 'password'}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Aynı şifreyi tekrar yaz"
          autoComplete="new-password"
          disabled={submitting}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-text"
        />
        {confirmPassword.length > 0 && password !== confirmPassword && (
          <p className="mt-1 text-[11px] text-rose-700 dark:text-rose-300">
            Şifreler eşleşmiyor.
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={submitting || !canSubmit}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Güncelleniyor…
          </>
        ) : (
          <>
            <KeyRound size={14} />
            Şifreyi Güncelle
          </>
        )}
      </button>
    </form>
  );
}

/** Zorunlu şifre değişimi — tam ekran (AuthGate render eder). */
export function SetPasswordPage() {
  const { user, signOut } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-ndark-bg">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-ndark-border dark:bg-ndark-card">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
            <KeyRound size={22} />
          </div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-ndark-text">
            Şifreni Belirle
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-ndark-muted">
            {user?.email
              ? `${user.email} için geçici şifrenle giriş yaptın; devam etmeden önce yeni bir şifre belirle.`
              : 'Devam etmeden önce yeni bir şifre belirle.'}
          </p>
        </div>

        <ChangePasswordForm forced />

        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-xs text-slate-600 transition hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted dark:hover:bg-ndark-bg"
        >
          <LogOut size={12} />
          İptal et ve çıkış yap
        </button>
      </div>
    </div>
  );
}

/** Gönüllü şifre değişimi — App header'ından açılan modal. */
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg dark:border-ndark-border dark:bg-ndark-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-ndark-text">
            <KeyRound size={16} />
            Şifre Değiştir
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-ndark-bg"
          >
            <X size={16} />
          </button>
        </div>
        <ChangePasswordForm forced={false} onSuccess={onClose} />
      </div>
    </div>
  );
}
