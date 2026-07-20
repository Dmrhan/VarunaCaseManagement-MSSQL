/**
 * thirdPartyNoteGuard.js — U-C (2026-07-20) saf karar fonksiyonu.
 *
 * ThirdParty.requiresNote=true olan bir tanıma devirde açıklama zorunlu mu,
 * ve kalıcı olarak yazılacak (trim edilmiş) değer ne olmalı. DB'ye/Prisma'ya
 * dokunmaz — server/db/caseRepository.js'in enteringPause bloğu, tp (zaten
 * çekilmiş ThirdParty satırı) ve payload ile çağırır, throw kararını kendisi
 * verir (CaseValidationError caseRepository.js'de tanımlı — circular import
 * önlemek için burada throw edilmez, sonuç objesi döner).
 */

/**
 * @param {{ requiresNote?: boolean } | null | undefined} tp
 * @param {{ thirdPartyNote?: unknown } | null | undefined} payload
 * @returns {{ note: string | null, missing: boolean }}
 *   note    — kalıcı olarak yazılacak trim edilmiş değer (boşsa null)
 *   missing — tp.requiresNote true ve açıklama boşsa true (çağıran 400 fırlatmalı)
 */
export function resolveThirdPartyNote(tp, payload) {
  const trimmed = typeof payload?.thirdPartyNote === 'string' ? payload.thirdPartyNote.trim() : '';
  const required = tp?.requiresNote === true;
  return {
    note: trimmed || null,
    missing: required && !trimmed,
  };
}
