// İZOLE raporlama feature — manuel "Bildirim Sayıları" Excel'ini birebir üretir.
export interface PivotRow { key: string; values: number[]; total: number; }
export interface PivotResponse {
  periods: string[];                              // ["2026-01", ...]
  rows: PivotRow[];
  totalRow: { values: number[]; total: number };
}

export interface ReportFilters {
  from?: string;
  to?: string;
  kaynak?: string;              // 'Canlı (Varuna)' | 'Geçmiş (next4biz)'
  tipi?: string;                // Hata/Talep/Soru/Öneri
  onlyL2?: '1';                 // L2'ye ulaşmış
  onlyYazilim?: '1';            // TFS var (= yazılıma/L3'e iletilen)
  onlyKodlandi?: '1';           // RootCause = Kodlama Yapılan
  onlyKodlanmadan?: '1';        // RootCause = Kodlama Yapılmayan
  bugGrubu?: 'var' | 'yok';     // Sheet 1 blok3/4: BugGroup açıklaması var/yok
  hedef?: 'dev' | 'bi';         // Dev (Univera Defect) / BI (DinRap)
  keyAccount?: '0' | '1';
}

export type ReportDimension = 'Proje' | 'Dist' | 'KokNeden' | 'Tipi';

// Sheet 4 (Süre) — mesai-duyarlı. Hücre: s=sayı, d=toplam dk.
export interface S4Cell { s: number; d: number; }
export interface S4Row { tipi: string; cells: S4Cell[]; tot: S4Cell; }
export interface S4Block { wall: S4Row[]; biz: S4Row[]; } // wall=ham takvim, biz=mesai
export interface S4Response {
  netDayMin: number;                // dk→gün katsayısı (ort. günlük net mesai)
  periods: string[];
  blocks: { all: S4Block; tfsVar: S4Block; tfsYok: S4Block };
}
