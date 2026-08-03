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
  onlyYazilim?: '1';            // TFS var
  onlyKodlandi?: '1';
  hedef?: 'dev' | 'bi';         // Dev (Univera Defect) / BI (DinRap)
  keyAccount?: '0' | '1';
}

export type ReportDimension = 'Proje' | 'Dist' | 'KokNeden' | 'Tipi';
