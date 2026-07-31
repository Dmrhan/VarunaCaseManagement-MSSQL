// İZOLE monitoring feature — tipler (yalnız bu modül kullanır).

export interface FunnelMetrics {
  acilan: number;
  l2ye: number;
  yazilima: number;
  kodlandi: number;
  geriDondu: number;
  hataL2: number;
}

export interface Summary extends FunnelMetrics {
  ortCozumSaat: number | null;
}

export interface TimeseriesPoint extends FunnelMetrics {
  period: string;
}

export interface BreakdownRow extends FunnelMetrics {
  key: string;
}

export interface FiltersResponse {
  bounds: { minYil: number | null; maxYil: number | null; sonTarih: string | null };
  projeler: { key: string; c: number }[];
  tipler: { key: string; c: number }[];
}

export interface MonitoringFilters {
  from?: string;
  to?: string;
  all?: '1';
  keyAccount?: '0' | '1';
  tipi?: string;
  kaynak?: string;
  proje?: string;
  dist?: string;
  onlyL2?: '1';
  onlyYazilim?: '1';
}

export type Grain = 'day' | 'week' | 'month' | 'year';
export type Dimension =
  | 'Proje' | 'Dist' | 'KokNeden' | 'Tipi' | 'KeyAccount'
  | 'Durum' | 'Takim' | 'Kaynak' | 'KodlamaSonucu' | 'DestekSeviyesi';
