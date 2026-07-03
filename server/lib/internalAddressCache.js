/**
 * İç adres cache — tenant'a ait sistem/çalışan adreslerini belleğe alır.
 *
 * TTL: 5 dakika. Upsert/auto-link kararlarından önce sorgulanır; iç
 * adresler learnedSenderAccount'a yazılmaz ve auto-link tetiklemez.
 *
 * Kaynaklar (companyId kapsamında):
 *   - User.email                              (tenant çalışanları)
 *   - ExternalMailInbox.address / fromAddress (gelen kutusu adresleri)
 *   - ExternalMailSettingFromAlias.address    (outbound alias — RFC 5322)
 *   - ExternalMailSetting.fromAddress         (legacy outbound)
 *   - CompanySettings.supportEmail            (marka destek adresi)
 */

import { prisma } from '../db/client.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

/** @type {Map<string, { addresses: Set<string>, expiresAt: number }>} */
const _cache = new Map();

/**
 * "Display Name <email@host>" veya sade "email@host" formatından
 * normalize edilmiş email'i çıkarır. Geçersiz giriş için null döner.
 */
function extractEmail(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const bracketed = raw.match(/<([^>]+)>/);
  const addr = bracketed ? bracketed[1] : raw;
  const norm = addr.trim().toLowerCase();
  return norm.includes('@') ? norm : null;
}

async function buildInternalAddressSet(companyId) {
  const set = new Set();

  // HOTFIX P1 (2026-07-03): User modelinde companyId alanı YOK.
  // İlişki: User.companies UserCompany[] (N:M köprü). Önceki sorgu
  // prisma.user.findMany({where:{companyId}}) her çağrıda
  // PrismaClientValidationError fırlatıyordu → F1 iç-adres dışlaması
  // devre dışı + M2.3 öğrenme (learned upsert) ölü. Doğru şekli
  // UserCompany join'i üzerinden.
  const [users, inboxes, aliases, settings, cs] = await Promise.all([
    prisma.user.findMany({
      where: {
        isActive: true,
        companies: { some: { companyId, isActive: true } },
      },
      select: { email: true },
    }),
    prisma.externalMailInbox.findMany({
      where: { companyId },
      select: { address: true, fromAddress: true },
    }),
    prisma.externalMailSettingFromAlias.findMany({
      where: { companyId },
      select: { address: true },
    }),
    prisma.externalMailSetting.findMany({
      where: { companyId },
      select: { fromAddress: true },
    }),
    prisma.companySettings.findUnique({
      where: { companyId },
      select: { supportEmail: true },
    }),
  ]);

  for (const u of users) {
    const e = extractEmail(u.email); if (e) set.add(e);
  }
  for (const i of inboxes) {
    const a = extractEmail(i.address);     if (a) set.add(a);
    const f = extractEmail(i.fromAddress); if (f) set.add(f);
  }
  for (const a of aliases) {
    const e = extractEmail(a.address); if (e) set.add(e);
  }
  for (const s of settings) {
    const e = extractEmail(s.fromAddress); if (e) set.add(e);
  }
  if (cs?.supportEmail) {
    const e = extractEmail(cs.supportEmail); if (e) set.add(e);
  }

  return set;
}

/**
 * companyId için iç adres setini döner (5 dk cache).
 *
 * HOTFIX P1 (2026-07-03): fail-open guard. Prisma sorgusu bir sebeple
 * throw ederse (schema drift, DB down, geçersiz where) koruma SESSİZ
 * devre dışı kalmaz — YÜKSEK SESLE log basar + boş Set döner.
 * "İntake ASLA ölmez" felsefesi: iç-adres dışlaması yapılamıyor →
 * F1 devre dışı, ama mail düşmez; monitörden hemen görülür.
 *
 * @param {string} companyId
 * @returns {Promise<Set<string>>}
 */
export async function getInternalAddresses(companyId) {
  const now = Date.now();
  const entry = _cache.get(companyId);
  if (entry && entry.expiresAt > now) return entry.addresses;
  try {
    const addresses = await buildInternalAddressSet(companyId);
    _cache.set(companyId, { addresses, expiresAt: now + CACHE_TTL_MS });
    return addresses;
  } catch (err) {
    // Yüksek sesli log (silent-fail YASAK — koruma kapalı ama görünmez
    // olmasın). Cache YAZILMAZ → bir sonraki çağrı yeniden deneme
    // yapar (transient hata iyileşirse otomatik toparlanır).
    console.error(
      '[internalAddressCache] BUILD FAIL — koruma devre dışı (fail-open)',
      { companyId, code: err?.code, message: err?.message },
    );
    return new Set();
  }
}

/**
 * Verilen email'in tenant iç adres setinde olup olmadığını döner.
 * @param {string|null} email   — normalize edilmemiş sender email
 * @param {string}      companyId
 * @returns {Promise<boolean>}
 */
export async function isInternalAddress(email, companyId) {
  if (!email || !companyId) return false;
  const norm = email.trim().toLowerCase();
  if (!norm.includes('@')) return false;
  const set = await getInternalAddresses(companyId);
  return set.has(norm);
}
