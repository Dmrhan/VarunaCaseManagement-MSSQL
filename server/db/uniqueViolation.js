/**
 * P2002 (unique violation) hedef eşleştirme — cross-provider.
 *
 * Prisma `err.meta.target` biçimi sağlayıcıya göre değişir:
 *  - PostgreSQL: kolon adları dizisi → ['accountId', 'companyId']
 *  - MSSQL, unique INDEX ihlali (2601; filtered index'lerimiz): index adı
 *    string'i → 'Account_vkn_key'
 *  - MSSQL, UNIQUE KEY constraint ihlali (2627): yalnız tablo adı →
 *    'dbo.AccountCompany' (constraint adı kaybolur!)
 *
 * Bu helper üç biçimi de normalize eder: verilen isimlerden herhangi biri
 * target içinde (dizi elemanı, tam eşleşme veya substring) geçiyorsa true.
 * Substring eşleşmesi Prisma'nın Model_kolon1_kolon2_key adlandırmasına
 * dayanır ve case-sensitive'dir.
 */
export function uniqueTargetHas(err, ...names) {
  const t = err?.meta?.target ?? [];
  const parts = Array.isArray(t) ? t.map(String) : [String(t)];
  return names.some((n) => parts.some((p) => p === n || p.includes(n)));
}
