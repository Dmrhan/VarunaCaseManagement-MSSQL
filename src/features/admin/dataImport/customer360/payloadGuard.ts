/**
 * Customer 360 dry-run payload size guard.
 *
 * Sunucudaki body parser sınırı (server/app.js → express.json({limit:'2mb'}))
 * pratik olarak 2 MB. Büyük workbook'lar (örn. ~5000 müşteri + ilişkili 5
 * entity) bunu rahatlıkla aşıyor → server 413 dönüyor → kullanıcıya generic
 * hata gösteriliyordu.
 *
 * Phase A hotfix:
 *   1. Sunucu structured 413 dönüyor (server/app.js içinde error handler).
 *   2. apiFetch 413'ü truthful mesajla gösteriyor.
 *   3. UI POST etmeden ÖNCE bu guard ile payload boyutunu ölçüp,
 *      sunucu limit'ine yaklaşan istekleri preflight'ta keser.
 *
 * Phase B (gelecek PR, bu PR'da yok):
 *   - C360 için XLSX'i multipart/form-data ile sunucuya yükle;
 *     parse + dry-run sunucu tarafında yapılsın.
 *   - Veya staged ImportJob upload flow.
 *
 * Eşik seçimi: 2 MB sunucu sınırının %85'i (~1.7 MB) — header/encoding
 * overhead'i için güvenli marj bırakır. Limit env-driven değil; sunucu
 * limit'iyle birlikte değişmesi gereken bilinçli bir çift.
 */
export const C360_DRY_RUN_SERVER_LIMIT_BYTES = 2 * 1024 * 1024;
export const C360_DRY_RUN_SAFE_THRESHOLD_BYTES = Math.floor(
  C360_DRY_RUN_SERVER_LIMIT_BYTES * 0.85,
);

export interface PayloadSizeReport {
  bytes: number;
  mb: number; // 1 decimal
}

export function measurePayloadSize(payload: unknown): PayloadSizeReport {
  const json = JSON.stringify(payload);
  const bytes = new Blob([json]).size;
  const mb = Math.round((bytes / (1024 * 1024)) * 10) / 10;
  return { bytes, mb };
}

export interface PayloadGuardResult {
  ok: boolean;
  size: PayloadSizeReport;
  serverLimitBytes: number;
  serverLimitMb: number;
  message?: string;
}

export function evaluateDryRunPayload(payload: unknown): PayloadGuardResult {
  const size = measurePayloadSize(payload);
  const serverLimitMb = Math.round(
    (C360_DRY_RUN_SERVER_LIMIT_BYTES / (1024 * 1024)) * 10,
  ) / 10;
  if (size.bytes <= C360_DRY_RUN_SAFE_THRESHOLD_BYTES) {
    return {
      ok: true,
      size,
      serverLimitBytes: C360_DRY_RUN_SERVER_LIMIT_BYTES,
      serverLimitMb,
    };
  }
  return {
    ok: false,
    size,
    serverLimitBytes: C360_DRY_RUN_SERVER_LIMIT_BYTES,
    serverLimitMb,
    message:
      `Dosya dry-run için çok büyük (~${size.mb} MB; sunucu sınırı ~${serverLimitMb} MB). ` +
      `Lütfen Excel'i daha küçük parçalara bölüp her parçayı ayrı dry-run + commit ile yükleyin.`,
  };
}
