import crypto from 'node:crypto';

/**
 * WR-A2 / PM-01 — VKN / TCKN / Phone validation + privacy helpers.
 *
 * Güvenlik kuralları (Decision Sprint #1):
 *  - Plain TCKN HİÇBİR koşulda DB'ye, log'a, response'a, AI/analytics/cache'e gitmez.
 *  - TCKN hash: HMAC-SHA256(plainTckn, TCKN_HASH_PEPPER) — pepper env değişkeni.
 *  - Pepper missing + TCKN hash istenirse: `hashTckn` exception fırlatır;
 *    caller 400 "TCKN yapılandırılmamış" döndürmeli (safe-fail).
 *  - VKN: app-layer format + checksum validation; DB-level @unique mevcut.
 *  - Phone: E.164 normalize; TR yaygın formları + uluslararası geçerli E.164 kabul.
 *    DB unique YOK — paylaşılan call center numarası iki Account'ta görünebilir.
 */

const PEPPER_ENV_KEY = 'TCKN_HASH_PEPPER';

// ─────────────────────────────────────────────────────────────────
// VKN — Turkish corporate tax number (10 digits + checksum)
// ─────────────────────────────────────────────────────────────────

/**
 * VKN checksum (T.C. Gelir İdaresi Başkanlığı algoritması).
 *
 * 10 haneli; ilk 9 hane veri, son hane checksum.
 * Algoritma:
 *   for i in 0..8:
 *     tmp[i] = (digit[i] + (9 - i)) % 10
 *     if tmp[i] != 0:
 *       tmp[i] = (tmp[i] * 2^(9 - i)) % 9
 *       if tmp[i] == 0: tmp[i] = 9
 *   checksum = (10 - (sum(tmp) % 10)) % 10
 *   checksum must equal digit[9]
 */
function vknChecksumValid(digits) {
  if (digits.length !== 10) return false;
  const ds = digits.split('').map(Number);
  const tmp = new Array(9);
  for (let i = 0; i < 9; i++) {
    let t = (ds[i] + (9 - i)) % 10;
    if (t !== 0) {
      t = (t * Math.pow(2, 9 - i)) % 9;
      if (t === 0) t = 9;
    }
    tmp[i] = t;
  }
  const sum = tmp.reduce((a, b) => a + b, 0);
  const expected = (10 - (sum % 10)) % 10;
  return expected === ds[9];
}

/**
 * VKN validation.
 * @returns {{ ok: boolean, normalized: string|null, reason?: string }}
 */
export function validateVkn(input) {
  if (input == null || input === '') return { ok: false, normalized: null, reason: 'VKN boş.' };
  const s = String(input).trim();
  if (!/^\d{10}$/.test(s)) {
    return { ok: false, normalized: null, reason: 'VKN 10 haneli rakam olmalı.' };
  }
  if (!vknChecksumValid(s)) {
    return { ok: false, normalized: null, reason: 'VKN doğrulanamadı (checksum hatalı).' };
  }
  return { ok: true, normalized: s };
}

// ─────────────────────────────────────────────────────────────────
// TCKN — Turkish national ID (11 digits + checksum)
// ─────────────────────────────────────────────────────────────────

/**
 * Standart TCKN checksum:
 *   - 11 hane, ilk hane > 0
 *   - digit[10] = (digit[0..9] sum) % 10
 *   - digit[9]  = ((odd_pos_sum * 7) - even_pos_sum) % 10
 *     odd_pos_sum  = d0+d2+d4+d6+d8
 *     even_pos_sum = d1+d3+d5+d7
 */
function tcknChecksumValid(digits) {
  if (digits.length !== 11) return false;
  const ds = digits.split('').map(Number);
  if (ds[0] === 0) return false;
  const odd = ds[0] + ds[2] + ds[4] + ds[6] + ds[8];
  const even = ds[1] + ds[3] + ds[5] + ds[7];
  const d9 = ((odd * 7) - even) % 10;
  const d9Final = ((d9 % 10) + 10) % 10;
  if (d9Final !== ds[9]) return false;
  const sum10 = ds.slice(0, 10).reduce((a, b) => a + b, 0);
  const d10 = sum10 % 10;
  return d10 === ds[10];
}

/**
 * TCKN validation. **Sadece doğrulama** — hashing/storage caller sorumluluğunda.
 * @returns {{ ok: boolean, normalized: string|null, reason?: string }}
 */
export function validateTckn(input) {
  if (input == null || input === '') return { ok: false, normalized: null, reason: 'TCKN boş.' };
  const s = String(input).trim();
  if (!/^\d{11}$/.test(s)) {
    return { ok: false, normalized: null, reason: 'TCKN 11 haneli rakam olmalı.' };
  }
  if (!tcknChecksumValid(s)) {
    return { ok: false, normalized: null, reason: 'TCKN doğrulanamadı (checksum hatalı).' };
  }
  return { ok: true, normalized: s };
}

/**
 * TCKN HMAC + last4. Pepper missing → throw (caller 400 ile yansıtır).
 *
 * @returns {{ hash: string, last4: string }}
 */
export function hashTckn(plainTckn) {
  const pepper = process.env[PEPPER_ENV_KEY];
  if (!pepper || pepper.length < 16) {
    const err = new Error(
      'TCKN sistemi yapılandırılmamış (TCKN_HASH_PEPPER env eksik veya çok kısa). Yöneticiye başvur.',
    );
    err.code = 'tckn_pepper_missing';
    err.status = 400;
    throw err;
  }
  const validation = validateTckn(plainTckn);
  if (!validation.ok || !validation.normalized) {
    const err = new Error(validation.reason ?? 'TCKN geçersiz.');
    err.code = 'tckn_invalid';
    err.status = 400;
    throw err;
  }
  const normalized = validation.normalized;
  const hash = crypto
    .createHmac('sha256', pepper)
    .update(normalized)
    .digest('hex');
  const last4 = normalized.slice(-4);
  return { hash, last4 };
}

/**
 * TCKN pepper'ı kullanılabilir mi? Read path için (search) sessizce skip
 * kararı verirken kullanılır. Caller throw etmemeli.
 */
export function tcknPepperAvailable() {
  const pepper = process.env[PEPPER_ENV_KEY];
  return !!pepper && pepper.length >= 16;
}

/**
 * TCKN last4 → maskeli display ("*******1234").
 */
export function maskTcknLast4(last4) {
  if (!last4 || last4.length !== 4) return null;
  return `*******${last4}`;
}

// ─────────────────────────────────────────────────────────────────
// Phone — E.164 normalize (TR-first, international permissive)
// ─────────────────────────────────────────────────────────────────

/**
 * Phone E.164 normalize. Türkiye yaygın formları + uluslararası geçerli
 * E.164 kabul edilir. libphonenumber yok; basit pattern matching.
 *
 * TR pattern'leri (output: +905XXXXXXXXX):
 *   - "05XX XXX XX XX", "05XXXXXXXXX"  → +90 prefix
 *   - "5XX XXX XX XX", "5XXXXXXXXX"    → +90 prefix
 *   - "+90 5XX ...", "+905XXXXXXXXX"   → as-is
 *   - "0090 5XX ...", "00905XXXXXXXXX" → +90 prefix
 *
 * Non-TR: zaten + ile başlayan ve 8-15 haneli E.164 → as-is.
 * Bozuk format → null.
 *
 * @returns {string|null}
 */
export function normalizePhoneE164(input) {
  if (input == null || input === '') return null;
  const raw = String(input).trim();
  if (!raw) return null;
  // Tüm whitespace + parantez + tire kaldır
  const cleaned = raw.replace(/[\s()\-./]/g, '');
  if (!cleaned) return null;

  // 0090 → +90 dönüşümü (uluslararası TR çağrı kuralı)
  let canonical = cleaned;
  if (canonical.startsWith('0090')) {
    canonical = '+90' + canonical.slice(4);
  }
  // 00<country> → +<country>
  else if (canonical.startsWith('00')) {
    canonical = '+' + canonical.slice(2);
  }

  // Zaten + ile başlıyor → E.164 doğrulaması
  if (canonical.startsWith('+')) {
    if (/^\+[1-9]\d{7,14}$/.test(canonical)) return canonical;
    return null;
  }

  // TR yaygın: "0XXXXXXXXXX" (11 hane, 05XX başlangıç) → +90...
  if (/^0\d{10}$/.test(canonical)) {
    return '+90' + canonical.slice(1);
  }
  // TR yaygın: "5XXXXXXXXX" (10 hane, 5 başlangıç) → +90...
  if (/^[1-9]\d{9}$/.test(canonical) && canonical.startsWith('5')) {
    return '+90' + canonical;
  }

  // Tanınmayan format
  return null;
}

/**
 * Test helper — sadece dev/test için. Production'da kullanılmaz.
 */
export const _internalAccountValidation = {
  vknChecksumValid,
  tcknChecksumValid,
};
