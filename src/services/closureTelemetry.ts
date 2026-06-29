// ─────────────────────────────────────────────────────────────────
// Kapanış telemetry — ai_suggested / human_applied attribution.
//
// Amaç (closure RCA roadmap): kapanış doğruluğu düşük olduğunda hatayı
// PARÇALAYABİLMEK için AI'nın öneri anında ne gördüğü/önerdiği ile insanın
// final uyguladığı etiketi AYRI sakla. Bu telemetry prompt'a beslenmez;
// yalnız hata-tipi ayrımı (bağlam hatası / taksonomi belirsizliği / insan
// override / label drift) içindir.
//
// İki ekran da (Case Detail StatusTransitionPanel + SmartTicketNewPage Stage 3)
// AYNI yapıyı üretsin diye tek kaynak: bu helper.
//
// Geriye uyumluluk: üretilen objenin KÖK alanları (source/appliedAt/
// appliedFields/perField/unmatched/confidence/reason/modelUsed) mevcut
// rapor kolonlarıyla (örn. st.closure.closureSuggestion.confidence) birebir
// aynı kalır; `aiSuggested` + `humanApplied` yalnız EKLENİR.
// ─────────────────────────────────────────────────────────────────
import type { SuggestClosureResponse } from './caseService';

/** AI öneri promptunun sürümü — drift/karşılaştırma için sabit. */
export const CLOSURE_PROMPT_VERSION = 'closure-v1';

/** Kapanışın 4 bağımsız alanı (decouple — grup/detay ilişkisi yok). */
export const CLOSURE_TELEMETRY_FIELDS = [
  'rootCauseGroup',
  'rootCauseDetail',
  'resolutionType',
  'permanentPrevention',
] as const;
export type ClosureTelemetryField = (typeof CLOSURE_TELEMETRY_FIELDS)[number];

/** İnsanın kapanışta final uyguladığı seçim (alan başına code + label). */
export type AppliedClosureSelection = Partial<
  Record<ClosureTelemetryField, { code?: string; label?: string }>
>;

/**
 * `customFields.smartTicket.closure.closureSuggestion` altına yazılacak
 * telemetry objesini kurar.
 *
 * @param suggestion   KB'den dönen normalize öneri (raw KB DEĞİL).
 * @param suggestedAt  Önerinin client'a ulaştığı an (ISO) — yoksa atlanır.
 * @param applied      İnsanın final seçimi (alan başına code/label).
 * @param appliedAt    Kapanış submit anı (ISO) — yoksa now().
 */
export function buildClosureSuggestionTelemetry(params: {
  suggestion: SuggestClosureResponse;
  suggestedAt?: string | null;
  applied: AppliedClosureSelection;
  appliedAt?: string;
}): Record<string, unknown> {
  const { suggestion, applied } = params;
  const meta = suggestion.meta ?? {};
  const appliedAt = params.appliedAt ?? new Date().toISOString();
  const globalConfidence =
    typeof meta.confidence === 'number' ? meta.confidence : undefined;

  const unmatched = suggestion.unmatched.map((u) => ({
    taxonomyType: u.taxonomyType,
    rawValue: u.rawValue,
  }));

  // ── Geriye uyumlu KÖK alanlar (mevcut raporlar bunları okur) ──
  // appliedFields/perField semantiği AYNEN korunur: AI önerisi insan
  // tarafından KABUL edilen (final === suggested) alanlar.
  const appliedFields: string[] = [];
  const perField: Record<string, { matchedBy: string; suggestedCode: string }> = {};
  for (const key of CLOSURE_TELEMETRY_FIELDS) {
    const s = suggestion.suggestions[key];
    const finalCode = applied[key]?.code;
    if (s && finalCode && finalCode === s.code) {
      appliedFields.push(key);
      perField[key] = { matchedBy: s.matchedBy, suggestedCode: s.code };
    }
  }

  // ── aiSuggested — öneri anında AI ne GÖRDÜ + ne ÖNERDİ ──
  const aiPerField: Record<
    string,
    { code: string; label: string; matchedBy: string; confidence?: number }
  > = {};
  for (const key of CLOSURE_TELEMETRY_FIELDS) {
    const s = suggestion.suggestions[key];
    if (!s) continue;
    aiPerField[key] = {
      code: s.code,
      label: s.label,
      matchedBy: s.matchedBy,
      // Per-field confidence upstream'de yok → global confidence fallback.
      ...(globalConfidence != null ? { confidence: globalConfidence } : {}),
    };
  }
  const aiSuggested: Record<string, unknown> = {
    ...(params.suggestedAt ? { suggestedAt: params.suggestedAt } : {}),
    // resolutionSeen: AI'ya GERÇEKTEN gönderilen çözüm metni (override varsa o,
    // yoksa backend'in step'lerden compose ettiği). Bağlam hatasını açar.
    ...(typeof meta.resolutionSeen === 'string'
      ? { resolutionSeen: meta.resolutionSeen }
      : {}),
    ...(typeof meta.modelUsed === 'string' ? { modelUsed: meta.modelUsed } : {}),
    // tier / taxonomyVersion upstream'de henüz yoksa undefined kalır; kod hazır.
    ...(typeof meta.tier === 'string' ? { tier: meta.tier } : {}),
    promptVersion: CLOSURE_PROMPT_VERSION,
    ...(typeof meta.taxonomyVersion === 'string'
      ? { taxonomyVersion: meta.taxonomyVersion }
      : {}),
    ...(globalConfidence != null ? { confidence: globalConfidence } : {}),
    ...(typeof meta.reason === 'string' ? { reason: meta.reason } : {}),
    perField: aiPerField,
    unmatched,
  };

  // ── humanApplied — kapanışta insan neyi UYGULADI + AI'dan değişti mi ──
  const humanPerField: Record<
    string,
    { code?: string; label?: string; changedFromAi: boolean }
  > = {};
  for (const key of CLOSURE_TELEMETRY_FIELDS) {
    const finalCode = applied[key]?.code;
    if (!finalCode) continue; // insan bu alanı boş bıraktıysa telemetry'ye girme
    const aiCode = suggestion.suggestions[key]?.code;
    const label = applied[key]?.label;
    humanPerField[key] = {
      code: finalCode,
      ...(label ? { label } : {}),
      // AI öneri yoksa (aiCode undefined) insan kendi seçtiği için değişmiş sayılır.
      changedFromAi: aiCode !== finalCode,
    };
  }
  const humanApplied = { appliedAt, perField: humanPerField };

  return {
    source: 'external_kb',
    appliedAt,
    appliedFields,
    perField,
    unmatched,
    ...(globalConfidence != null ? { confidence: globalConfidence } : {}),
    ...(typeof meta.reason === 'string' ? { reason: meta.reason } : {}),
    ...(typeof meta.modelUsed === 'string' ? { modelUsed: meta.modelUsed } : {}),
    aiSuggested,
    humanApplied,
  };
}
