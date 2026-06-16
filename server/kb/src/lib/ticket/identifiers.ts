/*
 * SQL identifier validator + quoter.
 *
 * MSSQL identifier kurallarına göre güvenli kabul ettiğimiz set:
 *   - İlk karakter A-Z, a-z veya _
 *   - Sonraki karakterler A-Z, a-z, 0-9, _ veya .
 *   - Uzunluk 1..64
 *
 * Nokta (".") sadece "Univera.BugGroup" gibi mevcut view kolonları için
 * gerekli; köşeli parantezle sarıldığında MSSQL nokta içeren kolon adını
 * literal olarak ele alır.
 *
 * Identifier doğrulaması TIPLE değil RUNTIME ile yapılır çünkü kolonlar
 * source.ts'de string olarak tanımlı. Yine de hepsi sabit; runtime check
 * defansif bir katman.
 */

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_.]{0,63}$/;

export function assertSafeIdentifier(ident: string): void {
  if (!SAFE_IDENT.test(ident)) {
    throw new Error(`Güvensiz SQL identifier reddedildi: ${JSON.stringify(ident)}`);
  }
}

/** `[Foo.Bar]` halinde döner. Köşeli parantez içinde tek bir `]` reddedilir. */
export function quoteIdent(ident: string): string {
  assertSafeIdentifier(ident);
  if (ident.includes("]")) {
    // Defansif — regex zaten yakalar ama bir güvence.
    throw new Error(`SQL identifier kapalı parantez içeremez: ${ident}`);
  }
  return `[${ident}]`;
}

/** `[dbo].[VIEW_BILDIRIM_AI_ANALIZ_DATA]` */
export function qualifyTable(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}
