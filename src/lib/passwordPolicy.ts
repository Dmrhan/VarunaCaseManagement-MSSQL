/**
 * Şifre güvenlik politikası — davet kabulü, şifre belirleme ve şifre sıfırlama
 * sayfalarinda paylaşılan tek kaynak.
 *
 * Kural (Phase 1):
 *  - Minimum 10 karakter
 *  - En az 1 büyük harf
 *  - En az 1 küçük harf
 *  - En az 1 rakam
 *  - En az 1 özel karakter (!@#$%^&* gibi)
 *  - Yaygın/zayıf şifreleri reddet (password, 123456, varuna, vs.)
 *  - Kullanıcının kendi e-postası ya da adıyla eşleşmesin (substring kontrol)
 *
 * Saf fonksiyon: UI taraflı (PasswordChecklist) ve form submit validation tek
 * yerden çalışır. Backend tarafında ekstra kontrol değiştirme zamanı yok —
 * Supabase'in kendi minimumu (6) zaten geçilir; bu sıkı politika UI'da uygulanır.
 */

const SPECIAL_RX = /[!@#$%^&*()_\-+=[\]{}|\\:;"'<>,.?/~`]/;
const COMMON_WEAK = new Set([
  'password',
  'password1',
  'password!',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty',
  'qwerty123',
  'asdf1234',
  'admin',
  'admin123',
  'letmein',
  'welcome',
  'welcome1',
  'iloveyou',
  'varuna',
  'varuna123',
  'turkiye',
  'turkey',
]);

export interface PasswordCheck {
  /** Kural anahtarı — UI checklist'inde label match için kullanılır. */
  key:
    | 'length'
    | 'uppercase'
    | 'lowercase'
    | 'number'
    | 'special'
    | 'notCommon'
    | 'notEmailLocal'
    | 'notFullName';
  /** Kullanıcıya gösterilen label (Türkçe). */
  label: string;
  /** Bu kural geçti mi? */
  pass: boolean;
}

export interface PasswordEvaluation {
  checks: PasswordCheck[];
  /** Tüm kurallar geçti mi? */
  ok: boolean;
}

export interface EvaluateOptions {
  /** Kullanıcının e-postası (varsa) — local-part substring match'i için. */
  email?: string | null;
  /** Kullanıcının fullName'i (varsa) — substring match'i için. */
  fullName?: string | null;
}

/**
 * Boş bir şifre veya tanımsız değerleri güvenli şekilde değerlendir.
 */
export function evaluatePassword(
  password: string | null | undefined,
  options: EvaluateOptions = {},
): PasswordEvaluation {
  const pwd = typeof password === 'string' ? password : '';
  const lower = pwd.toLowerCase();
  const emailLocal = options.email ? options.email.split('@')[0]?.toLowerCase() : '';
  const fullNameNormalized = options.fullName ? options.fullName.toLowerCase().replace(/\s+/g, '') : '';

  const checks: PasswordCheck[] = [
    {
      key: 'length',
      label: 'En az 10 karakter',
      pass: pwd.length >= 10,
    },
    {
      key: 'uppercase',
      label: 'En az bir büyük harf (A-Z)',
      pass: /[A-Z]/.test(pwd),
    },
    {
      key: 'lowercase',
      label: 'En az bir küçük harf (a-z)',
      pass: /[a-z]/.test(pwd),
    },
    {
      key: 'number',
      label: 'En az bir rakam (0-9)',
      pass: /[0-9]/.test(pwd),
    },
    {
      key: 'special',
      label: 'En az bir özel karakter (!@#$ gibi)',
      pass: SPECIAL_RX.test(pwd),
    },
    {
      key: 'notCommon',
      label: 'Yaygın/zayıf şifre değil',
      pass: pwd.length > 0 && !COMMON_WEAK.has(lower),
    },
    {
      key: 'notEmailLocal',
      label: 'E-postanın @ öncesi ile aynı değil',
      pass: pwd.length > 0 && (!emailLocal || (emailLocal.length >= 3 && !lower.includes(emailLocal))),
    },
    {
      key: 'notFullName',
      label: 'Adınızı içermiyor',
      pass:
        pwd.length > 0 &&
        (!fullNameNormalized
          || fullNameNormalized.length < 4
          || !lower.replace(/\s+/g, '').includes(fullNameNormalized)),
    },
  ];

  return {
    checks,
    ok: checks.every((c) => c.pass),
  };
}
