import { useState, type FormEvent } from 'react';
import { Zap, Sparkles, BarChart3, AlertCircle, Loader2, Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/services/supabase';

/**
 * Login sayfası — Linear/Vercel/Clerk stil: koyu sol marka paneli + sade sağ form.
 * Mobilde sol panel gizli, sadece form tam ekran.
 */
export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLoading = submitting || oauthLoading;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) {
      setSubmitting(false);
      setError(
        signInError.message === 'Invalid login credentials'
          ? 'E-posta veya şifre hatalı.'
          : signInError.message,
      );
      return;
    }
    // Başarılı — yönlendirme olana kadar form disabled kalsın (AuthContext devralır)
  }

  async function handleGoogle() {
    setError(null);
    setOauthLoading(true);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (oauthError) {
      setOauthLoading(false);
      setError(oauthError.message);
    }
    // Başarılıysa Google'a yönlendiriliyoruz, spinner kalır
  }

  return (
    <div className="flex min-h-screen">
      {/* Sol panel — marka, koyu, animated mesh */}
      <div className="relative hidden flex-col overflow-hidden bg-[#0F0F1A] md:flex md:w-[55%]">
        {/* Animated gradient mesh */}
        <div className="absolute inset-0 opacity-50 [background:radial-gradient(circle_at_20%_30%,#7C3AED40_0%,transparent_45%),radial-gradient(circle_at_80%_70%,#14B8A640_0%,transparent_45%),radial-gradient(circle_at_50%_50%,#7C3AED20_0%,transparent_60%)] [animation:meshShift_18s_ease-in-out_infinite]" />
        <div className="absolute inset-0 [background:radial-gradient(ellipse_at_top_right,#14B8A630,transparent_60%)] [animation:meshShift_24s_ease-in-out_infinite_reverse]" />

        {/* Üst — logo */}
        <div className="relative z-10 flex items-center gap-2.5 px-10 pt-10">
          <img
            src="/varuna-logo.png"
            alt="Varuna"
            className="h-10 w-10 object-contain drop-shadow-[0_0_18px_rgba(124,58,237,0.35)]"
          />
          <span className="text-base font-semibold tracking-wide text-white">VARUNA</span>
        </div>

        {/* Orta — ana başlık + özellikler */}
        <div className="relative z-10 flex flex-1 flex-col justify-center px-10 lg:px-16">
          <h1 className="bg-gradient-to-br from-white to-slate-300 bg-clip-text text-4xl font-bold leading-tight text-transparent lg:text-5xl">
            AI-Assisted Case Management
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-slate-400 lg:text-lg">
            Müşteri taleplerini anlayan, ekipleri birleştiren, SLA'yı kaçırmayan platform.
          </p>

          <ul className="mt-10 space-y-5">
            <FeatureItem
              icon={<Zap size={18} />}
              title="Gerçek zamanlı işbirliği"
              text="Vakaları takım arkadaşlarınla paylaş, herkesin gözü aynı yerde."
            />
            <FeatureItem
              icon={<Sparkles size={18} />}
              title="AI destekli triage ve önceliklendirme"
              text="Vaka açıldığı anda kategori, öncelik ve atama önerisi."
            />
            <FeatureItem
              icon={<BarChart3 size={18} />}
              title="Anlık SLA takibi ve eskalasyon"
              text="Geç kalan iş yok — dakikası dakikasına bildirim."
            />
          </ul>
        </div>

        {/* Alt — telif */}
        <div className="relative z-10 px-10 pb-8 text-xs text-slate-500">
          <div className="font-medium text-slate-400">Türk Elektronik Para Holding</div>
          <div className="mt-1">© {new Date().getFullYear()} VARUNA. Tüm hakları saklıdır.</div>
        </div>
      </div>

      {/* Sağ panel — form */}
      <div className="flex w-full items-center justify-center bg-[#FAFAFA] px-6 py-12 md:w-[45%] dark:bg-ndark-bg">
        <div
          className="w-full max-w-sm [animation:fadeInUp_0.4s_ease-out_both]"
          style={{ opacity: isLoading && !error ? 0.6 : 1, transition: 'opacity 0.2s' }}
        >
          <div className="mb-8">
            <h2 className="text-2xl font-semibold text-slate-900 dark:text-ndark-text">
              Hoş geldiniz
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-ndark-muted">
              Hesabınıza giriş yapın
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="login-email"
                className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-ndark-text"
              >
                E-posta
              </label>
              <input
                id="login-email"
                type="email"
                required
                autoFocus
                autoComplete="email"
                disabled={isLoading}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isLoading) {
                    e.preventDefault();
                    void handleSubmit(e);
                  }
                }}
                placeholder="ornek@firma.com"
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 transition focus:border-[#7C3AED] focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
              />
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-ndark-text"
              >
                Şifre
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  disabled={isLoading}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !isLoading) {
                      e.preventDefault();
                      void handleSubmit(e);
                    }
                  }}
                  placeholder="••••••••"
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 pr-10 text-sm text-slate-800 placeholder-slate-400 transition focus:border-[#7C3AED] focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((s) => !s)}
                  disabled={isLoading}
                  aria-label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-60 dark:text-ndark-muted dark:hover:text-ndark-text"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {error && (
                <p className="mt-1.5 flex items-center gap-1 text-xs text-rose-600">
                  <AlertCircle size={12} />
                  {error}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-gradient-to-r from-[#7C3AED] to-[#14B8A6] py-2.5 text-sm font-medium text-white shadow-sm transition hover:opacity-95 active:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Giriş yapılıyor…
                </>
              ) : (
                'Giriş Yap'
              )}
            </button>
          </form>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200 dark:bg-ndark-border" />
            <span className="text-[11px] uppercase tracking-wider text-slate-400">veya</span>
            <div className="h-px flex-1 bg-slate-200 dark:bg-ndark-border" />
          </div>

          <button
            type="button"
            onClick={handleGoogle}
            disabled={isLoading}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text dark:hover:bg-ndark-bg"
          >
            {oauthLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <GoogleIcon />
            )}
            Google ile Devam Et
          </button>

          <p className="mt-8 text-center text-xs text-slate-500 dark:text-ndark-muted">
            Hesabınız yok mu? <span className="text-slate-700 dark:text-ndark-text">Yöneticinizle iletişime geçin.</span>
          </p>
        </div>
      </div>

      {/* Animasyon keyframe'leri — Tailwind'de inline */}
      <style>{`
        @keyframes meshShift {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33%      { transform: translate(2%, -3%) scale(1.05); }
          66%      { transform: translate(-2%, 2%) scale(0.98); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function FeatureItem({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/5 text-[#A78BFA] ring-1 ring-white/10 backdrop-blur">
        {icon}
      </span>
      <div>
        <div className="text-sm font-medium text-white">{title}</div>
        <div className="text-xs leading-relaxed text-slate-400">{text}</div>
      </div>
    </li>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09 0-.73.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}
