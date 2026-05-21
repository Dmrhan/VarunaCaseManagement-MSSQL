/**
 * WR-A8 — Data Integration Studio shared types.
 */

export type Step = 'source' | 'map' | 'validate' | 'preview' | 'commit' | 'result';

export const STEP_ORDER: Step[] = ['source', 'map', 'validate', 'preview', 'commit', 'result'];

export const STEP_LABELS: Record<Step, string> = {
  source: 'Kaynak Seç',
  map: 'Alanları Eşleştir',
  validate: 'Doğrula',
  preview: 'Ön İzleme',
  commit: 'İçe Aktar',
  result: 'Sonuç',
};

export type SourceType = 'file' | 'api';

export interface ParsedSource {
  sourceType: SourceType;
  fileName: string | null;
  sourceName: string | null;
  sourceUrlMasked: string | null;
  dataPath: string | null;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  /** First 5 rows for preview */
  sample: Array<Record<string, unknown>>;
  totalRows: number;
}
