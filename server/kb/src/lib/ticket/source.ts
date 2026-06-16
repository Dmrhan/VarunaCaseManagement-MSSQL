/*
 * Ticket veri kaynağı allowlist'i.
 *
 * Tek view ile çalışıyoruz: dbo.VIEW_BILDIRIM_AI_ANALIZ_DATA.
 * Tablo adı, kolon adları ve hangi kolonun ne anlama geldiği burada
 * sabit. query-builder.ts bu sabitleri okuyarak SQL üretir; başka hiçbir
 * tablo/kolon erişilmez.
 *
 * Üretilen SQL'de kolon ve tablo adları interpolasyon ile yerleşir,
 * ama her bir identifier `identifiers.ts:assertSafeIdentifier` ile
 * doğrulanır. Değerler hiçbir zaman string concat ile geçmez —
 * `runReadOnly(query, params)` ile bind edilir.
 */

export const TICKET_VIEW = {
  schema: "dbo",
  name: "VIEW_BILDIRIM_AI_ANALIZ_DATA",
} as const;

/** Kanonik kolon adları (view'de bire bir aynı yazılım). */
export const COL = {
  id: "Bildirim_No",
  year: "Yil",
  monthInt: "AyINT",
  date: "Bildirim_Tarihi_",
  categoryShort: "Kategori_Adi",
  categoryLong: "Uzun_Kategori_Adi",
  type: "Bildirim_Tipi",
  product: "Urun",
  mainCategory: "Ana_Kategori",
  subCategory: "Alt_Kategori",
  layer: "Katman",
  priority: "Oncelik",
  project: "PROJE",
  supportLevel: "Support_L1_L2",
  rootCause: "Konunun_Kok_Nedeni",
  urgent: "Acil_Ticket",
  description: "Bildirim_Aciklamasi",
  solution: "Cozum_Aciklamasi",
  customerNote: "Musteri_Notu",
  tfsNo: "TfsNo",
  tfsStatus: "TfsDurum",
  tfsType: "TfsTip",
  /** Nokta içeren kolon — query-builder bunu otomatik köşeli parantezle sarar. */
  bugGroup: "Univera.BugGroup",
} as const;

export type ColumnKey = keyof typeof COL;

/** Bir analiz yanıtında parolasız geri dönen alt küme. */
export const DEFAULT_SELECT: ReadonlyArray<ColumnKey> = [
  "id",
  "date",
  "year",
  "monthInt",
  "type",
  "priority",
  "urgent",
  "layer",
  "product",
  "project",
  "categoryShort",
  "categoryLong",
  "mainCategory",
  "subCategory",
  "rootCause",
  "supportLevel",
  "description",
  "solution",
  "customerNote",
  "tfsNo",
  "tfsStatus",
  "tfsType",
  "bugGroup",
];
