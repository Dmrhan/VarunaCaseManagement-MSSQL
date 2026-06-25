/**
 * Mail M2.3 — LearnedSenderAccount repository.
 *
 * SADECE CRUD + role-address tespiti. Hiçbir matching/scoring/intake yapmaz;
 * suggestCustomerMatches (customerMatchRepository) bu repo'dan getByEmail()
 * çağırır, intake (inboundMailIntake) auto-link kararını burada üretilen
 * isRoleAddress bayrağıyla verir.
 *
 * KURALLAR:
 *  - companyId-scoped (tenant izolasyon).
 *  - senderEmail normalize edilir (trim + lowercase).
 *  - @@unique([companyId, senderEmail]) — yeni manuel link OVERWRITE eder
 *    (en güncel insan kararı kazanır; self-correction).
 *  - Yalnız MANUEL linkAccount öğrenir (intake'in auto-link çağrısı
 *    bunu invoke ETMEZ — caller davranışı).
 *  - Account silinirse FK cascade ile eşleme silinir.
 *
 * Spec: feature/mail-learned-sender-m2-3.
 */

import { prisma } from './client.js';

const RAW_SOURCE = 'learned-sender-account';

/**
 * Rol-adres local-part listesi. Bu adresler birden çok kişi tarafından
 * kullanılır → kişisel sinyal değil; auto-link tetiklemez (sadece öneri).
 */
const ROLE_ADDRESS_LOCAL_PARTS = new Set([
  'info', 'support', 'sales', 'noreply', 'no-reply',
  'contact', 'admin', 'help', 'hello', 'team', 'office',
  'mail', 'destek', 'bilgi', 'satis', 'iletisim',
]);

function normalizeSenderEmail(email) {
  if (typeof email !== 'string') return null;
  const s = email.trim().toLowerCase();
  if (!s || !s.includes('@')) return null;
  return s;
}

/**
 * Email'in rol adresi olup olmadığını döner (local-part allowlist).
 *
 * Örnek:
 *   isRoleAddress('info@acme.com')    → true
 *   isRoleAddress('ahmet@acme.com')   → false
 *   isRoleAddress('destek@varuna.tr') → true
 */
export function isRoleAddress(email) {
  const norm = normalizeSenderEmail(email);
  if (!norm) return false;
  const localPart = norm.split('@')[0];
  if (!localPart) return false;
  return ROLE_ADDRESS_LOCAL_PARTS.has(localPart);
}

export const learnedSenderAccountRepo = {
  /**
   * Manuel linkAccount sırasında çağrılır.
   *
   * companyId + senderEmail birleşik anahtar (unique). Mevcut satır varsa
   * OVERWRITE edilir (accountId / isRoleAddress / createdByUserId güncellenir);
   * yoksa create.
   *
   * @returns {Promise<object|null>} oluşan/güncellenen satır
   *   veya invalid input için null.
   */
  async upsert(companyId, senderEmail, accountId, opts = {}) {
    if (!companyId || !accountId) return null;
    const norm = normalizeSenderEmail(senderEmail);
    if (!norm) return null;

    const role = opts.isRoleAddress !== undefined ? !!opts.isRoleAddress : isRoleAddress(norm);
    const data = {
      companyId,
      senderEmail: norm,
      accountId,
      isRoleAddress: role,
      source: opts.source ?? 'manual_link',
      createdByUserId: opts.createdByUserId ?? null,
    };

    return prisma.learnedSenderAccount.upsert({
      where: { companyId_senderEmail: { companyId, senderEmail: norm } },
      create: data,
      update: {
        accountId,
        isRoleAddress: role,
        source: opts.source ?? 'manual_link',
        // createdByUserId her update'te güncellenir → son link'i yapan
        // kullanıcı audit. Eski createdByUserId kaybedilir (kabul).
        createdByUserId: opts.createdByUserId ?? null,
      },
    });
  },

  /**
   * Inbound intake / suggest engine bu fonksiyonu çağırır.
   *
   * Account hâlâ aktif değilse null döner (silinmiş/pasif hesaba bağlı
   * eşleme tetik tetikleyemez).
   *
   * @returns {Promise<{
   *   id: string,
   *   accountId: string,
   *   isRoleAddress: boolean,
   *   source: string,
   * } | null>}
   */
  async getByEmail(companyId, senderEmail) {
    if (!companyId) return null;
    const norm = normalizeSenderEmail(senderEmail);
    if (!norm) return null;

    const row = await prisma.learnedSenderAccount.findUnique({
      where: { companyId_senderEmail: { companyId, senderEmail: norm } },
      include: { account: { select: { isActive: true } } },
    });
    if (!row) return null;
    if (!row.account?.isActive) return null;
    return {
      id: row.id,
      accountId: row.accountId,
      isRoleAddress: row.isRoleAddress,
      source: row.source,
    };
  },

  /**
   * Revocation: bir öğrenilmiş eşlemeyi sil.
   *
   * @returns {Promise<boolean>} silindi mi?
   */
  async remove(companyId, senderEmail) {
    if (!companyId) return false;
    const norm = normalizeSenderEmail(senderEmail);
    if (!norm) return false;
    const res = await prisma.learnedSenderAccount.deleteMany({
      where: { companyId, senderEmail: norm },
    });
    return res.count > 0;
  },

  // Internal helper exported for test harness.
  _normalizeSenderEmail: normalizeSenderEmail,
};

export const _internal = { ROLE_ADDRESS_LOCAL_PARTS, RAW_SOURCE };
