/**
 * Lightweight feature-flag bootstrap.
 *
 * Phase 1 uses env-var-based flags only. Phase 2 may add runtime config.
 *
 * - `actionCenterEnabled` — WR-ACTION-CENTER Phase 1 Approval Visibility
 *   MVP. Default OFF in production until pilot rollout. Default ON in
 *   dev so contributors see the bell.
 *
 *   Hide controls: when false, ActionCenterBell + PendingApprovalsPanel
 *   are not rendered. Backend keeps writing ActionItems regardless so
 *   flag flip seamless (no backfill needed).
 */

function readFlag(name: string, defaultValue: boolean): boolean {
  // Vite exposes import.meta.env at build time. In test/SSR contexts
  // (no Vite) fall back to the default.
  if (typeof import.meta === 'undefined' || !import.meta.env) return defaultValue;
  const raw = import.meta.env[name];
  if (raw === undefined || raw === null) return defaultValue;
  const str = String(raw).toLowerCase();
  if (str === 'true' || str === '1' || str === 'yes') return true;
  if (str === 'false' || str === '0' || str === 'no') return false;
  return defaultValue;
}

const IS_DEV = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true;

export const featureFlags = {
  /** Action Center bell + MyHome panel. Phase 1 — Approval Visibility MVP. */
  actionCenterEnabled: readFlag('VITE_ACTION_CENTER_ENABLED', IS_DEV),
  /**
   * WR-NOTIFICATION-CENTER Phase 2A — restores the old right-side
   * MentionBellBadge if true. Default false → only the unified
   * Aksiyonlarım bell renders. Phase 3'te tamamen kaldırılacak;
   * Phase 2A boyunca acil rollback yolu olarak ayakta durur.
   */
  legacyMentionBellEnabled: readFlag('VITE_LEGACY_MENTION_BELL_ENABLED', false),
  /**
   * L1 Case Resolution Console Phase 1 — şu an layout-only shell.
   * true → klasik CaseDetailPage yerine L1CaseResolutionConsole render
   * edilir. Default false (hem dev hem prod) — flag açık olmadığında
   * mevcut Case Detail davranışı bire bir korunur, zero runtime impact.
   */
  l1CaseConsoleEnabled: readFlag('VITE_L1_CASE_CONSOLE_ENABLED', false),
  /**
   * WR-Smart-Ticket Phase 1c — ayrı "Akıllı Ticket Aç" intake screen.
   * true → Case List'te bir giriş butonu görünür ve `smart-ticket-new`
   * view'i render edilir. Default false — flag kapalıyken Quick Case ve
   * New Case akışları **bire bir** korunur; intake screen reachable
   * değildir. Backend tarafında hiçbir değişiklik yok (POST /api/cases
   * + customFields.smartTicket).
   */
  smartTicketIntakeEnabled: readFlag('VITE_SMART_TICKET_INTAKE_ENABLED', IS_DEV),
  /**
   * Cases list'teki "Hızlı Vaka" butonu. Default false — Smart Ticket
   * ve Yeni Vaka akışları ile çakışıp kafa karıştırıyordu, pratik
   * kullanım yok. Buton + modal kodu intact bırakıldı; geri açmak için
   * VITE_QUICK_CASE_ENABLED=true. Akıllı Ticket akışı ile değiştirilen
   * "müşteri arama → vaka aç" senaryosu için tercih edilen yol artık
   * Akıllı Ticket butonudur.
   */
  quickCaseEnabled: readFlag('VITE_QUICK_CASE_ENABLED', false),
  /**
   * Authorization Management — runtime sidebar menu filtering. Default false:
   * policy CRUD/preview güvenle devreye alınabilir; gerçek menü enforcement
   * UAT'ta açıkça bu flag ile test edilir.
   */
  authorizationMenuEnforcementEnabled: readFlag('VITE_AUTHORIZATION_MENU_ENFORCEMENT_ENABLED', false),
  /**
   * Authorization Management — Case Detail field visible/readable/editable/masked
   * pilot. Default false: field policies can be modeled safely; UI masking/hide
   * behavior is enabled explicitly during UAT.
   */
  authorizationFieldUiEnforcementEnabled: readFlag('VITE_AUTHORIZATION_FIELD_UI_ENFORCEMENT_ENABLED', false),
};
