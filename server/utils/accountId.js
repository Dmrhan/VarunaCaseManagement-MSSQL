/**
 * Account.id generator — Phase 1: `cus_` standardization.
 *
 * Yeni Account kayıtları için sistem müşteri ID'sini standardize eder.
 * Mevcut cuid-tabanlı Account.id değerleri DEĞİŞTİRİLMEZ; bu helper
 * yalnız create path'lerinde yeni satırlar için çağrılır. Account.id
 * şeması "@id String @default(cuid())" olarak kalır — create path'leri
 * `id` alanını explicit set ettiğinde default tetiklenmez, bu sayede
 * legacy + yeni format yan yana yaşar.
 *
 * Format:
 *   cus_<22 char base32 Crockford>
 *   örn. cus_V1STGXR8Z5JDHI6BMYTQK
 *
 * Tasarım:
 * - Prefix `cus_` — diğer entity ID'leri (case, project, …) için aynı
 *   pattern öngörülebilir.
 * - Alfabe: Crockford base32 (0-9, A-H, J-N, P-T, V-Z). I/O/L/U yok →
 *   karışmasın diye human-readable + URL-safe.
 * - Uzunluk: 22 karakter × 5 bit = 110 bit entropy. 14M+ kayıt
 *   ölçeğinde collision pratikte sıfır (birthday-bound ≈ 2^55 kayda
 *   kadar güvenli).
 * - Modulo bias'tan kaçınma: 256'dan 32'ye eşit dağılım için byte
 *   değeri 224 ve üzeri reddedilir (256 - (256 % 32) = 224).
 * - Math.random / Date.now KULLANILMAZ — `crypto.randomBytes` ile
 *   tahmin edilemez.
 *
 * Collision retry: küçük bütçe (5 deneme) yeterli; bir collision
 * olasılığı yok denecek kadar küçüktür (~10^-22). Yine de retry
 * vardır, gelecekteki schema değişiklikleri ya da denetlenmedik
 * eşleşmeler için.
 */

import { randomBytes } from 'node:crypto';
import { prisma } from '../db/client.js';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TOKEN_LENGTH = 22;
const PREFIX = 'cus_';
const MAX_BYTE_FOR_NO_BIAS = 224; // 256 - (256 % 32)
const MAX_RETRIES = 5;

/**
 * Pure random Account ID. DB'ye bakmaz — collision riski yok denecek
 * kadar düşük olduğundan low-level çağrılar (smoke, helper test) için
 * kullanılır. Production create path'leri `generateUniqueAccountId()`
 * tercih etmeli.
 */
export function generateAccountId() {
  const chars = [];
  while (chars.length < TOKEN_LENGTH) {
    const buf = randomBytes(TOKEN_LENGTH * 2);
    for (let i = 0; i < buf.length && chars.length < TOKEN_LENGTH; i++) {
      const b = buf[i];
      if (b >= MAX_BYTE_FOR_NO_BIAS) continue;
      chars.push(ALPHABET[b % 32]);
    }
  }
  return PREFIX + chars.join('');
}

/**
 * DB-doğrulanmış benzersiz Account ID. Çakışma durumunda yeni token
 * üretip tekrar dener; MAX_RETRIES içinde çözülmezse fırlatır (bu
 * pratikte hiç olmayacak).
 */
export async function generateUniqueAccountId() {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const candidate = generateAccountId();
    const existing = await prisma.account.findUnique({
      where: { id: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  throw new Error(
    `generateUniqueAccountId: collision after ${MAX_RETRIES} attempts (impossibly unlikely).`,
  );
}

/**
 * Verilen Account.id'nin yeni `cus_` formatında olup olmadığını
 * gösterir. Legacy cuid kayıtlarını ayırt etmek için kullanılabilir
 * (UI raporlama gerekirse).
 */
export function isCusAccountId(id) {
  if (typeof id !== 'string') return false;
  if (!id.startsWith(PREFIX)) return false;
  const token = id.slice(PREFIX.length);
  if (token.length !== TOKEN_LENGTH) return false;
  for (let i = 0; i < token.length; i++) {
    if (!ALPHABET.includes(token[i])) return false;
  }
  return true;
}

// Test/debug için sabitler — smoke scriptlerinde format doğrulaması.
export const ACCOUNT_ID_PREFIX = PREFIX;
export const ACCOUNT_ID_TOKEN_LENGTH = TOKEN_LENGTH;
export const ACCOUNT_ID_ALPHABET = ALPHABET;
