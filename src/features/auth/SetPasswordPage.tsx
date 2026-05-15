import { useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, LogOut } from 'lucide-react';
import { supabase } from '@/services/supabase';
import { useAuth } from '@/services/AuthContext';
import { evaluatePassword } from '@/lib/passwordPolicy';
import { PasswordChecklist } from '@/components/auth/PasswordChecklist';

/**
 * Davet kabulü / şifre belirleme sayfası.
 *
 * Tetik: main.tsx URL hash'inde `type=invite` veya `type=recovery` tespit eder
 * ve `sessionStorage.varuna.pendingPasswordSetup = '1'` yazar. AuthGate bunu
 * görüp normal app yerine bu sayfayı render eder.
 *
 * Akış:
 *  1. Supabase JS SDK invite link'inden gelen access_token ile zaten session açtı
 *  2. Kullanıcı buraya düşer, yeni şifre belirler
 *  3. `supabase.auth.updateUser({ password })` çağrısı
 *  4. Başarılıysa flag temizlenir, AuthContext refresh edilir, kullanıcı app'e girer
 *  5. İptal/Çıkış: `signOut` + flag temizle → LoginPage
 */
export function SetPasswordPage() {
  const { user, refresh, signOut } = useAuth();
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
  const canSubmit = evaluation.ok && password === confirmPassword && password.length > 0;

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
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    if (updateErr) {
      setSubmitting(false);
      setError(updateErr.message || 'Şifre belirleme başarısız.');
      return;
    }
    // Başarılı — flag temizle, AuthGate'e haber ver, session refresh
    try {
      sessionStorage.removeItem('varuna.pendingPasswordSetup');
    } catch {
      // sessionStorage erişim engeli — sessizce yut
    }
    // AuthGate ayni tab'da sessionStorage removeItem'i 'storage' event'iyle goremez;
    // custom event ile re-read tetikle.
    window.dispatchEvent(new CustomEvent('varuna:password-setup-complete'));
    setDone(true);
    // Kullanıcının görmesi için kısa bir başarı state'i, sonra app'e geç
    setTimeout(() => {
      void refresh();
    }, 800);
  }

  async function handleCancel() {
    try {
      sessionStorage.removeItem('varuna.pendingPasswordSetup');
    } catch {
      // ignore
    }
    await signOut();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-ndark-bg">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-ndark-border dark:bg-ndark-card">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
            <KeyRound size={22} />
          </div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-ndark-text">
            Hesabını Tamamla
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-ndark-muted">
            {user?.email
              ? `${user.email} için yeni bir şifre belirle.`
              : 'Davetini kabul etmek için yeni bir şifre belirle.'}
          </p>
        </div>

        {done ? (
          <div className="flex items-start gap-2 rounded-md bg-emerald-50 px-3 py-3 text-sm text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200">
            <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" />
            <span>Şifre belirlendi. Uygulamaya yönlendiriliyorsun…</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="flex items-start gap-2 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:bg-rose-900/30 dark:text-rose-200">
                <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

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
                  autoFocus
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
                Şifreyi tekrar gir
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Aynı şifreyi tekrar yaz"
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
                  Belirleniyor…
                </>
              ) : (
                <>
                  <KeyRound size={14} />
                  Şifreyi Belirle ve Devam Et
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleCancel}
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-xs text-slate-600 transition hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted dark:hover:bg-ndark-bg"
            >
              <LogOut size={12} />
              İptal et ve çıkış yap
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
