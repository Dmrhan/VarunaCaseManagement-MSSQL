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
};
