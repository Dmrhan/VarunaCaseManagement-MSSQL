/**
 * Turkish-aware search variants.
 *
 * MSSQL notu: veritabanı Turkish_100_CI_AS_SC_UTF8 collation ile kurulu —
 * `contains`/`equals` zaten case-insensitive ve Türkçe kurallarına uygun
 * (i↔İ, ı↔I dahil; smoke-turkish-search-mssql.js ile doğrulandı). Prisma'nın
 * `mode: 'insensitive'` argümanı sqlserver'da DESTEKLENMEZ ve kaldırıldı.
 *
 * Bu helper yine de değerli: ASCII-fold varyantları sayesinde kullanıcı
 * "Ilhami" yazınca diakritikli "İlhami" kayıtlarının bulunmasını sağlar
 * (collation diakritik-duyarlıdır: AS). Caller bu varyantları OR ile
 * sorguya ekler. Şema değişikliği yok, ekstra extension yok.
 *
 * Variants:
 *   - original
 *   - tr-TR lowercase
 *   - tr-TR uppercase
 *   - tr-TR title-case (each whitespace-separated token)
 *   - ASCII-fold (Türkçe diakritikleri Latin'e indir)
 *   - ASCII-fold lower/upper
 *
 * Kasıtlı dışarıda: phone/vkn/email/externalCustomerCode — bu alanlar
 * sayısal/kod, Turkish casing relevant değil. Caller bu helper'ı sadece
 * "name" benzeri serbest metin alanları için kullanmalı.
 */

const TR_DIACRITIC_FOLD = {
  İ: 'I',
  ı: 'i',
  Ş: 'S',
  ş: 's',
  Ç: 'C',
  ç: 'c',
  Ğ: 'G',
  ğ: 'g',
  Ö: 'O',
  ö: 'o',
  Ü: 'U',
  ü: 'u',
};

function asciiFold(s) {
  let out = '';
  for (const ch of s) {
    out += TR_DIACRITIC_FOLD[ch] ?? ch;
  }
  return out;
}

function titleCaseTr(s) {
  return s
    .split(/(\s+)/)
    .map((part) => {
      if (!part || /^\s+$/.test(part)) return part;
      return part[0].toLocaleUpperCase('tr-TR') + part.slice(1).toLocaleLowerCase('tr-TR');
    })
    .join('');
}

/**
 * @param {string} q Trimmed, non-empty search input.
 * @returns {string[]} Distinct, non-empty variants. Original `q` is always first.
 */
export function generateTurkishSearchVariants(q) {
  if (typeof q !== 'string') return [];
  const trimmed = q.trim();
  if (!trimmed) return [];

  const set = new Set();
  set.add(trimmed);
  set.add(trimmed.toLocaleLowerCase('tr-TR'));
  set.add(trimmed.toLocaleUpperCase('tr-TR'));
  set.add(titleCaseTr(trimmed));
  const folded = asciiFold(trimmed);
  set.add(folded);
  set.add(folded.toLowerCase());
  set.add(folded.toUpperCase());
  // ASCII-lower → TR title-case. "ILHAMI" gibi all-caps Latin girdilerde
  // titleCaseTr direkt çağrı 'Ilhamı' verir ('I' upper-tr 'I' + 'LHAMI'
  // lower-tr 'lhamı'). Stored "İlhami …" ile byte-match için 'i' → 'İ'
  // dönüşümü gerek — bunun için önce ASCII'ye fold edip plain lower yap,
  // sonra titleCaseTr ile ilk harfi 'İ'ye çevir.
  set.add(titleCaseTr(folded.toLowerCase()));
  set.add(titleCaseTr(trimmed.toLowerCase()));

  return [...set].filter((v) => v && v.length > 0);
}

export const __testing__ = { asciiFold, titleCaseTr };
