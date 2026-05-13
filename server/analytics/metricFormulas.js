/**
 * Operations Intelligence Dashboard — Metric Formulas (Phase 1)
 *
 * Tek kaynak: docs/OPERATIONS_DASHBOARD_DESIGN.md §2.6.2 + §2.6.3
 *
 * Bu modul SAF FONKSIYONLAR icerir. DB'ye dokunmaz, side effect yapmaz.
 * Aggregator (operationsAggregator.js) DB sorgu sonucunu bu fonksiyonlara
 * besler; UI ile export ayni helper'i kullanir (§2.6.8 tek kaynak ilkesi).
 *
 * Phase 1 kararlari (kullanici onaylı):
 *  - avgResolutionWallClockHours sergilenir; "net work time" simdilik yok
 *  - reopenRatePct payda = period icinde COZULMUS vakalar (resolved-based)
 *  - firstResponseTimeMin Phase 1'de YOK (mark 'not_available')
 *  - Min sample: agent 20, QA 10, team/company 30
 *  - Timezone: Europe/Istanbul
 *  - Tum metric'ler deterministic; AI hesaplamaz
 */

export const FORMULA_VERSION = 'v1';

export const MIN_SAMPLE = Object.freeze({
  agentPerformance: 20,
  qaScore: 10,
  teamAggregate: 30,
  companyAggregate: 30,
  // Genel period metric'ler (slaViolationRatePct, reopenRatePct, avgTtr):
  default: 5,
});

// Acik vaka statusleri — snapshot ve "open" hesaplamalarinda kullanilir.
export const OPEN_STATUSES = Object.freeze([
  'Acik',
  'Incelemede',
  'ThirdPartyWaiting',
  'Eskalasyon',
  'YenidenAcildi',
]);

// ---------- Sayisal yardimcilar ----------

/**
 * NULL-safe yuzde hesabi. Payda 0 ise null doner (UI "—" gosterir).
 * Sonuc 1 ondalik basamak.
 */
export function safePct(numerator, denominator) {
  if (denominator == null || denominator === 0) return null;
  if (numerator == null) return null;
  return roundPct((100 * numerator) / denominator);
}

export function roundPct(value) {
  if (value == null || Number.isNaN(value)) return null;
  return Math.round(value * 10) / 10; // 1 ondalik
}

export function roundHours(value) {
  if (value == null || Number.isNaN(value)) return null;
  return Math.round(value * 10) / 10;
}

export function roundInt(value) {
  if (value == null || Number.isNaN(value)) return null;
  return Math.round(value);
}

/**
 * Min sample altinda mi? UI bu metric'i "Yetersiz veri" gosterir.
 * Threshold kind: agentPerformance | qaScore | teamAggregate | default.
 */
export function isInsufficientSample(sampleSize, kind = 'default') {
  const min = MIN_SAMPLE[kind] ?? MIN_SAMPLE.default;
  return (sampleSize ?? 0) < min;
}

// ---------- Formul fonksiyonlari (§2.6.2 dictionary) ----------

/**
 * totalCases — period icindeki toplam vaka sayisi.
 * Pure: agg input'undan COUNT alir.
 */
export function computeTotalCases({ totalCount }) {
  return roundInt(totalCount);
}

/**
 * openCases — su an acik vakalar (snapshot, period-independent).
 */
export function computeOpenCases({ openCount }) {
  return roundInt(openCount);
}

/**
 * slaViolationRatePct — period icinde cozulen vakalardan SLA ihlal eden %.
 * Formula: 100 * (slaResolvedCount) / (totalResolvedCount); resolved-only.
 * Min sample: default (5). Altinda null doner; aggregator
 * minSampleViolations array'ine ekler.
 */
export function computeSlaViolationRatePct({ slaResolvedCount, totalResolvedCount }) {
  if (isInsufficientSample(totalResolvedCount, 'default')) return null;
  return safePct(slaResolvedCount, totalResolvedCount);
}

/**
 * avgResolutionWallClockHours — Phase 1 official TTR.
 * AVG(resolvedAt - createdAt) saat cinsinden, period icinde cozulen vakalar.
 * Pause/3rd-party wait SUREsi CIKARILMAZ (wall-clock).
 * Min sample: default (5).
 */
export function computeAvgResolutionWallClockHours({ totalResolutionSeconds, resolvedSampleSize }) {
  if (isInsufficientSample(resolvedSampleSize, 'default')) return null;
  if (!totalResolutionSeconds || resolvedSampleSize === 0) return null;
  const hours = totalResolutionSeconds / resolvedSampleSize / 3600;
  return roundHours(hours);
}

/**
 * reopenRatePct — period icinde cozulen vakalardan yeniden acilanlarin %'si.
 * Karar (Phase 1): payda = period icinde COZULMUS vakalar (resolved-based).
 * Kalite sinyali — cozumden sonra ne kadar geri donduk.
 * Min sample: default 5 — yine de domain expert onayi ile teamAggregate
 * threshold'una (30) cekilebilir; simdilik default.
 */
export function computeReopenRatePct({ reopenedAfterResolutionCount, totalResolvedCount }) {
  if (isInsufficientSample(totalResolvedCount, 'default')) return null;
  return safePct(reopenedAfterResolutionCount, totalResolvedCount);
}

/**
 * escalationRatePct — period icinde escalationLevel != 'Yok' olan vakalar %.
 * Created-based payda.
 */
export function computeEscalationRatePct({ escalatedCount, totalCreatedCount }) {
  if (isInsufficientSample(totalCreatedCount, 'default')) return null;
  return safePct(escalatedCount, totalCreatedCount);
}

/**
 * transferRatePct — period icinde acilan vakalardan en az bir kez aktarilanlar %.
 */
export function computeTransferRatePct({ transferredCount, totalCreatedCount }) {
  if (isInsufficientSample(totalCreatedCount, 'default')) return null;
  return safePct(transferredCount, totalCreatedCount);
}

/**
 * retentionSuccessPct — caseType=Churn olan vakalarda retentionStatus='Basarili' %.
 * Excluded: retentionStatus='DevamEdiyor' (henuz outcome yok).
 */
export function computeRetentionSuccessPct({ successCount, decidedChurnCount }) {
  if (isInsufficientSample(decidedChurnCount, 'default')) return null;
  return safePct(successCount, decidedChurnCount);
}

/**
 * Delta (period-over-period) hesabi. Sonuc:
 *   { value: number|null, direction: 'up'|'down'|'flat'|null, sourceMissing: boolean }
 * Sourcemissing true ise previous period verisi yok (ilk hafta vs.).
 */
export function computeDelta(current, previous) {
  if (current == null) {
    return { value: null, direction: null, sourceMissing: previous == null };
  }
  if (previous == null) {
    return { value: null, direction: null, sourceMissing: true };
  }
  if (previous === 0) {
    // Bolumu sifir: nispi degil mutlak fark gostermek dogru olur
    const delta = current - previous;
    return { value: delta, direction: delta === 0 ? 'flat' : 'up', sourceMissing: false };
  }
  const diff = current - previous;
  const direction = diff === 0 ? 'flat' : diff > 0 ? 'up' : 'down';
  return { value: roundPct((100 * diff) / previous), direction, sourceMissing: false };
}

/**
 * minSampleNote — UI'a aktarilan etiket. Aggregator response.minSampleViolations
 * array'inde toplar; UI tile'i "Yetersiz veri" gosterir.
 */
export function minSampleNote(metricKey, sampleSize, kind) {
  const min = MIN_SAMPLE[kind] ?? MIN_SAMPLE.default;
  return {
    metric: metricKey,
    sampleSize: sampleSize ?? 0,
    minimum: min,
    reason: `Yetersiz veri (n=${sampleSize ?? 0}, min=${min})`,
  };
}
