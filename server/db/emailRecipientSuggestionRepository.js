/**
 * emailRecipientSuggestionRepository.js — 2026-07-10
 *
 * Composer To/Cc/Bcc alıcı-önerisi (autocomplete) v1 kaynağı. SALT-OKUR:
 * hiçbir yazma/gönderim/intake yolu buradan geçmez — mail düzenine dikişi
 * yoktur (kullanıcı kısıtı: çalışan mail bozulamaz).
 *
 * v1 kapsamı (kullanıcı kararı 2026-07-10): yazışma geçmişi + iç ekip.
 * Hesap kontakları (AccountContact, ~5k, sunucu-arama ister) 2. adım.
 *
 * Kaynaklar:
 *  A) 'correspondence' — CaseEmail'lerden (tenant-kapsamlı, son
 *     CORRESPONDENCE_SCAN_CAP satır) fromAddress + toAddresses/ccAddresses;
 *     son yazışma tarihine göre sıralı ("en son yazıştığın en üstte").
 *  B) 'team' — aktif tenant kullanıcıları (User × UserCompany), alfabetik.
 *
 * Dışlama seti — YALNIZ mailbox kimlikleri (kendine-mail/loop önlemi):
 * ExternalMailInbox.address/fromAddress + FromAlias.address +
 * ExternalMailSetting.fromAddress + CompanySettings.supportEmail.
 * ⚠️ isInternalAddress() BİLEREK reuse edilmedi: o cache User.email'i de
 * içerir (internalAddressCache.js buildInternalAddressSet) → 'team'
 * kaynağını komple silerdi. Buradaki set User İÇERMEZ.
 *
 * Dedup: adres lowercase anahtar; çakışmada 'correspondence' kazanır
 * (recency bilgisi daha değerli).
 */
import { prisma } from './client.js';

/** Tenant başına taranacak en yeni CaseEmail satır sayısı (JSON parse maliyeti sınırı). */
const CORRESPONDENCE_SCAN_CAP = 2000;
/** Dönen toplam öneri sınırı (FE zaten client-side filtreler; taşırma koruması). */
const RESULT_CAP = 500;

/** "Display Name <email@host>" | "email@host" → normalize email | null. */
function extractEmail(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const bracketed = raw.match(/<([^>]+)>/);
  const addr = bracketed ? bracketed[1] : raw;
  const norm = addr.trim().toLowerCase();
  return norm.includes('@') ? norm : null;
}

/** CaseEmail.toAddresses/ccAddresses JSON-as-string → [{address,name}] (bozuksa []). */
function parseAddressList(raw) {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Mailbox kimlikleri dışlama seti (User YOK — bkz. üst docblock).
 * @returns {Promise<Set<string>>} normalize edilmiş adresler
 */
async function buildMailboxExclusionSet(companyId) {
  const [inboxes, aliases, settings, cs] = await Promise.all([
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
  const set = new Set();
  for (const i of inboxes) {
    const a = extractEmail(i.address); if (a) set.add(a);
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

export const emailRecipientSuggestionRepo = {
  /**
   * Composer öneri havuzu (v1: yazışma + ekip).
   * @param {string} companyId — vaka üzerinden route'ta çözülür (tenant scope)
   * @param {object} [opts]
   * @param {object|null} [opts.securityWhere] — Codex #509 P1: aktörün vaka
   *   görünürlük filtresi (buildCaseListSecurityWhere çıktısı; enforcement
   *   kapalıysa null). Yazışma taraması yalnız aktörün GÖREBİLDİĞİ vakaların
   *   mailleriyle sınırlanır — güvenlik filtreli kullanıcı, gizli vakaların
   *   ad/adreslerini öneri havuzundan sızdıramaz. Arşivli vakalar da (liste
   *   default'u ile hizalı) koşulsuz dışlanır.
   * @returns {Promise<Array<{address:string,name:string|null,source:'correspondence'|'team'}>>}
   */
  async listSuggestions(companyId, { securityWhere = null } = {}) {
    const caseVisibility = securityWhere
      ? { AND: [{ isArchived: false }, securityWhere] }
      : { isArchived: false };
    const [emails, users, exclusion] = await Promise.all([
      prisma.caseEmail.findMany({
        where: { companyId, case: caseVisibility },
        orderBy: { createdAt: 'desc' },
        take: CORRESPONDENCE_SCAN_CAP,
        select: {
          fromAddress: true,
          fromName: true,
          toAddresses: true,
          ccAddresses: true,
          createdAt: true,
        },
      }),
      prisma.user.findMany({
        where: {
          isActive: true,
          companies: { some: { companyId, isActive: true } },
        },
        select: { email: true, fullName: true },
        orderBy: { fullName: 'asc' },
      }),
      buildMailboxExclusionSet(companyId),
    ]);

    // A) Yazışma — createdAt desc geldiğinden ilk görülen = en güncel;
    //    Map insertion-order recency sırasını korur.
    const byAddress = new Map(); // addr -> {address,name,source}
    const pushCorrespondence = (rawAddr, rawName) => {
      const addr = extractEmail(rawAddr);
      if (!addr || exclusion.has(addr) || byAddress.has(addr)) return;
      const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : null;
      byAddress.set(addr, { address: addr, name, source: 'correspondence' });
    };
    for (const e of emails) {
      pushCorrespondence(e.fromAddress, e.fromName);
      for (const r of parseAddressList(e.toAddresses)) pushCorrespondence(r?.address, r?.name);
      for (const r of parseAddressList(e.ccAddresses)) pushCorrespondence(r?.address, r?.name);
    }

    // B) Ekip — yazışmada zaten görünen meslektaş 'correspondence' kalır
    //    (dedup önceliği), görünmeyenler alfabetik sırayla eklenir.
    //    Codex #509 P2: mailbox dışlaması BURADA DA uygulanır — paylaşımlı
    //    mailbox/alias adresi aynı zamanda aktif User olarak tanımlıysa
    //    'team' etiketiyle havuza geri sızamaz (loop önlemi garantisi).
    const team = [];
    for (const u of users) {
      const addr = extractEmail(u.email);
      if (!addr || exclusion.has(addr) || byAddress.has(addr)) continue;
      byAddress.set(addr, { address: addr, name: u.fullName ?? null, source: 'team' });
      team.push(addr);
    }

    return Array.from(byAddress.values()).slice(0, RESULT_CAP);
  },
};
