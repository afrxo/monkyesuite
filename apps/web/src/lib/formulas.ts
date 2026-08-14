/**
 * Canonical human-readable descriptions of every computed metric surfaced in the UI.
 *
 * These strings are the single source of truth for caption text under sort
 * controls (§4.2), formula lines under At a Glance tiles (§4.3, §4.4), and any
 * tooltip explaining how a number is derived. Keep in sync with the JSDoc on
 * the corresponding compute function in `apps/worker/src/jobs/derive.ts` and
 * `apps/worker/src/jobs/engagement.ts`. If a formula changes, update both
 * places — there is no auto-sync.
 *
 * The strings are intentionally plain English, not math notation, so they read
 * cleanly inside small UI captions.
 */

export const FORMULA_VOLATILITY = "24h MAD ÷ 24h mean";
export const FORMULA_SPIKE = "24h peak CCU ÷ 7d mean CCU";
export const FORMULA_VELOCITY = "(latest CCU − CCU 24h ago) ÷ CCU 24h ago";
export const FORMULA_TREND = "(latest CCU − 6h mean) ÷ 6h mean";
export const FORMULA_DELTA_24H = "(latest CCU − CCU 24h ago) ÷ CCU 24h ago";
export const FORMULA_VISITS_PER_CCU_24H = "24h visits ÷ 24h avg CCU";

export type SortKey = "spike" | "trend" | "ccu" | "velocity" | "newest";

export const SORT_CAPTION: Record<SortKey, string> = {
  spike: `Spike = ${FORMULA_SPIKE}`,
  trend: `Trend = ${FORMULA_TREND}`,
  ccu: "CCU = current concurrent users",
  velocity: `Velocity = ${FORMULA_VELOCITY}`,
  newest: "Indexed by Trend Lens, most recent first",
};
