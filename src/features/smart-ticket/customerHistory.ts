/**
 * Smart Ticket — Customer History helpers.
 *
 * Müşteri seçimi sonrası geçmiş çözüm kartlarını zenginleştirmek için
 * Case.customFields içindeki Smart Ticket kapanış bloğunu defansif parse eder.
 *
 * customFields hem JSON string hem doğrudan object olabilir (Case tip ve
 * backend pattern'i):
 *   - Yeni vakalarda backend JSON string olarak geri yazıyor (NVARCHAR(MAX))
 *   - Frontend tarafında runtime'da object haline gelmiş olabilir
 *
 * Parse fail ederse UI kırılmaz; null döner, caller display'i atlatır.
 */

export interface ClosureSummary {
  rootCauseGroup?: string;
  rootCauseGroupLabel?: string;
  rootCauseDetail?: string;
  rootCauseDetailLabel?: string;
  resolutionType?: string;
  resolutionTypeLabel?: string;
  permanentPrevention?: string;
  permanentPreventionLabel?: string;
}

/**
 * customFields → ClosureSummary | null.
 *
 * - customFields null/undefined/boş → null
 * - String + valid JSON → object'e parse + path'i izle
 * - Object → doğrudan path'i izle
 * - Hata her durumda yutulur (defansif)
 */
export function parseClosureFromCustomFields(
  customFields: string | Record<string, unknown> | null | undefined,
): ClosureSummary | null {
  if (customFields == null) return null;

  let obj: Record<string, unknown> | null = null;
  if (typeof customFields === 'string') {
    const trimmed = customFields.trim();
    if (trimmed.length === 0) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        obj = parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  } else if (typeof customFields === 'object' && !Array.isArray(customFields)) {
    obj = customFields;
  }
  if (!obj) return null;

  const smartTicket = (obj.smartTicket ?? null) as Record<string, unknown> | null;
  if (!smartTicket || typeof smartTicket !== 'object') return null;
  const closure = (smartTicket.closure ?? null) as Record<string, unknown> | null;
  if (!closure || typeof closure !== 'object') return null;

  const pickString = (v: unknown): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  };

  const summary: ClosureSummary = {
    rootCauseGroup: pickString(closure.rootCauseGroup),
    rootCauseGroupLabel: pickString(closure.rootCauseGroupLabel),
    rootCauseDetail: pickString(closure.rootCauseDetail),
    rootCauseDetailLabel: pickString(closure.rootCauseDetailLabel),
    resolutionType: pickString(closure.resolutionType),
    resolutionTypeLabel: pickString(closure.resolutionTypeLabel),
    permanentPrevention: pickString(closure.permanentPrevention),
    permanentPreventionLabel: pickString(closure.permanentPreventionLabel),
  };

  // En az bir alan dolu mu? Tamamen boşsa null döner — UI gereksiz başlık çizmesin.
  const hasAny =
    summary.rootCauseGroup ||
    summary.rootCauseGroupLabel ||
    summary.rootCauseDetail ||
    summary.rootCauseDetailLabel ||
    summary.resolutionType ||
    summary.resolutionTypeLabel ||
    summary.permanentPrevention ||
    summary.permanentPreventionLabel;
  return hasAny ? summary : null;
}

/**
 * Label varsa label göster, yoksa code göster, hiç yoksa undefined.
 * Caller `&& <span>{labelOrCode(...)}</span>` ile koşullu render edebilir.
 */
export function labelOrCode(label?: string, code?: string): string | undefined {
  if (label && label.length > 0) return label;
  if (code && code.length > 0) return code;
  return undefined;
}

/**
 * Banner state — açık vaka sayısı, duplicate var mı, SLA breach var mı ile
 * tek seferlik hesap. Pulse fetch gerektirmez (banner hızlı render olmalı).
 */
export type CustomerContextRiskState = 'clear' | 'watch' | 'critical';

export function computeBannerRiskState(input: {
  openCount: number;
  slaBreachCount: number;
  hasDuplicate: boolean;
}): CustomerContextRiskState {
  if (input.hasDuplicate) return 'critical';
  if (input.openCount >= 3 || input.slaBreachCount > 0) return 'watch';
  if (input.openCount > 0) return 'watch';
  return 'clear';
}
