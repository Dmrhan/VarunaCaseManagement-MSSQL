/**
 * AES-256-GCM simetrik şifreleme — server-side secret saklama için.
 *
 * Kullanım: DevOps PAT (Personal Access Token) DB'de plain tutulmaz;
 * encrypt() ile { ciphertext, iv, authTag } base64 üçlüsü saklanır,
 * decrypt() server tarafında runtime'da plain text üretir.
 *
 * Anahtar: `process.env.DEVOPS_PAT_ENC_KEY`
 *   - 32 byte (AES-256 zorunlu).
 *   - base64 (44 char) veya hex (64 char) kabul edilir.
 *   - **LAZY THROW** — anahtar yoksa boot crash etmez; encrypt/decrypt
 *     çağrıldığında SecretCipherError fırlar (kod: 'devops_enc_key_missing').
 *
 * GCM güvenliği:
 *   - Her encrypt'te taze 12-byte IV (crypto.randomBytes).
 *   - decrypt authTag'i doğrular; tampered/yanlış key → throw
 *     ('devops_enc_decrypt_failed').
 *   - Aynı anahtarla aynı plain her zaman farklı ciphertext (IV randomized).
 *
 * Spec: docs/DEVOPS_INTEGRATION.md Faz 2.1.
 * Anahtar rotation Faz 3 — bu modülde out-of-scope.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

const KEY_ENV_NAME = 'DEVOPS_PAT_ENC_KEY';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export class SecretCipherError extends Error {
  constructor(message, { code = 'secret_cipher_error', status = 500 } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Lazy key resolver. Yalnız encrypt/decrypt çağrı anında çalışır;
 * boot crash etmez (anahtar dev'de tanımsız kalabilir, üretim için
 * mandatorydir).
 *
 * @returns {Buffer} 32-byte key
 * @throws {SecretCipherError} anahtar yok veya hatalı boyut/format
 */
function resolveKey() {
  const raw = process.env[KEY_ENV_NAME];
  if (!raw) {
    // 503 + kullanıcı dostu mesaj (admin UI'da toast'ta görünür). Teknik
    // detay (env adı + 32 byte + openssl) ops konfigürasyon dokümanında.
    // Status 503: "Service Unavailable" — geçici durum, ops müdahalesi
    // gerekir (generic 500 değil — sistem yöneticisi farkında olsun).
    throw new SecretCipherError(
      'DevOps PAT şifreleme anahtarı (DEVOPS_PAT_ENC_KEY) sunucuda tanımlı değil. Sistem yöneticisiyle iletişime geçin.',
      { code: 'devops_enc_key_missing', status: 503 },
    );
  }
  // Önce base64 dene
  let key;
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(raw) && raw.length >= 43 && raw.length <= 44) {
    try {
      key = Buffer.from(raw, 'base64');
    } catch {
      /* fall through */
    }
  }
  // Yoksa hex dene
  if (!key && /^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');
  }
  if (!key || key.length !== KEY_BYTES) {
    throw new SecretCipherError(
      `${KEY_ENV_NAME} 32 byte olmalı (base64 44 char veya hex 64 char). Mevcut decode boyutu uyumsuz.`,
      { code: 'devops_enc_key_invalid', status: 500 },
    );
  }
  return key;
}

/**
 * Plain text'i AES-256-GCM ile şifrele.
 *
 * @param {string} plain - Şifrelenecek metin (PAT). Boş/null → throw.
 * @returns {{ ciphertext: string, iv: string, authTag: string }} hepsi base64
 * @throws {SecretCipherError}
 */
export function encrypt(plain) {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new SecretCipherError(
      'Şifrelenecek değer boş string olamaz.',
      { code: 'devops_enc_input_empty', status: 400 },
    );
  }
  const key = resolveKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * Şifreli üçlüyü çöz.
 *
 * @param {{ ciphertext: string, iv: string, authTag: string }} parts base64
 * @returns {string} plain text
 * @throws {SecretCipherError} eksik alan / tamper / yanlış key
 */
export function decrypt({ ciphertext, iv, authTag }) {
  if (
    typeof ciphertext !== 'string' || !ciphertext ||
    typeof iv !== 'string' || !iv ||
    typeof authTag !== 'string' || !authTag
  ) {
    throw new SecretCipherError(
      'Şifre çözmek için ciphertext/iv/authTag (base64) gerekli.',
      { code: 'devops_enc_input_invalid', status: 400 },
    );
  }
  const key = resolveKey();
  const ivBuf = Buffer.from(iv, 'base64');
  const tagBuf = Buffer.from(authTag, 'base64');
  if (ivBuf.length !== IV_BYTES) {
    throw new SecretCipherError(
      `IV ${IV_BYTES} byte olmalı.`,
      { code: 'devops_enc_iv_invalid', status: 500 },
    );
  }
  if (tagBuf.length !== AUTH_TAG_BYTES) {
    throw new SecretCipherError(
      `authTag ${AUTH_TAG_BYTES} byte olmalı.`,
      { code: 'devops_enc_authtag_invalid', status: 500 },
    );
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, ivBuf);
    decipher.setAuthTag(tagBuf);
    const ctBuf = Buffer.from(ciphertext, 'base64');
    const plain = Buffer.concat([decipher.update(ctBuf), decipher.final()]);
    return plain.toString('utf8');
  } catch (e) {
    // GCM authTag mismatch → "Unsupported state or unable to authenticate data"
    throw new SecretCipherError(
      'Şifre çözülemedi: ciphertext bozulmuş veya anahtar yanlış.',
      { code: 'devops_enc_decrypt_failed', status: 500 },
    );
  }
}

/**
 * Test/diag: anahtar configürasyon sağlığını döner. PAT/raw key sızdırmaz.
 */
export function diag() {
  try {
    const k = resolveKey();
    return { ok: true, keyBytes: k.length };
  } catch (e) {
    return { ok: false, error: { code: e.code, message: e.message } };
  }
}
