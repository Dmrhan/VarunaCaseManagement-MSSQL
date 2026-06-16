/**
 * View kolonlarının runtime'da bekleneni temsil eden tip. mssql sürücüsü
 * NULL'ları `null`, NVARCHAR(MAX) verilerini `string` ve INT/BIGINT'i
 * `number` olarak döndürür (BIGINT'in JS hassasiyetine sığdığı varsayımıyla;
 * Bildirim_No için sorun değil, TfsNo için de pratik bir sınır içinde).
 */
export type TicketRow = {
  Bildirim_No: number;
  Yil: number | null;
  AyINT: number | null;
  Bildirim_Tarihi_: Date | null;
  Kategori_Adi: string | null;
  Uzun_Kategori_Adi: string | null;
  Bildirim_Tipi: string | null;
  Urun: string | null;
  Ana_Kategori: string | null;
  Alt_Kategori: string | null;
  Katman: string;
  Oncelik: string | null;
  PROJE: string | null;
  Support_L1_L2: string | null;
  Konunun_Kok_Nedeni: string | null;
  Acil_Ticket: string | null;
  Bildirim_Aciklamasi: string | null;
  Cozum_Aciklamasi: string | null;
  Musteri_Notu: string | null;
  TfsNo: number | null;
  TfsDurum: string;
  TfsTip: string | null;
  /** `Univera.BugGroup` kolonu — runtime'da bind sırasında alias verilir. */
  BugGroup: string | null;
};

export type Severity = "Normal" | "Yüksek" | "Kritik";
