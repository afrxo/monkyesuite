// Adapter between the API's PulsePayload (packages/shared) and the tlw
// presentational stack's FeedPayload (this app's lib/types). Two type systems
// exist because the pulse components were ported wholesale and their local
// types encode assumptions (non-null spike/velocity/lifecycle, jobHealth
// record, kicker string) that don't belong in the network contract. This is
// the seam where those assumptions get filled in with safe defaults.

import type { PulsePayload } from "@monkyesuite/shared";
import { fmtKicker } from "./format";
import type {
  FeedPayload,
  LifecycleStage as PulseLifecycle,
  PulseCardGame as TlwPulseCard,
} from "./types";

// Map the shared CohortBasis ("genre" | "global") to tlw's basis vocabulary
// ("full" | "no_age" | "scale_only"). tlw's UI treats "full" as the strong
// cohort and everything else as caveats, so genre → full, global → scale_only.
function adaptCohortBasis(
  b: PulsePayload["games"][number]["cohortBasis"],
): TlwPulseCard["cohortBasis"] {
  if (b === "genre") return "full";
  if (b === "global") return "scale_only";
  return null;
}

// A card is drawn only when it has a pulse_stage (i.e. derive has classified
// it). Warm-up rows without a stage get filtered upstream; if one leaks
// through here we drop it rather than surface `null as LifecycleStage`.
function adaptCard(g: PulsePayload["games"][number]): TlwPulseCard | null {
  if (g.lifecycle === null) return null;
  return {
    id: g.id,
    name: g.name,
    creatorName: g.creatorName,
    creatorVerified: g.creatorVerified,
    genre: g.genre,
    thumbnail: g.thumbnail,
    ccu: g.ccu,
    ccu24hAgo: g.ccu24hAgo,
    velocity: g.velocity,
    // tlw treats spike/trendScore as non-null; a missing value → 1 (baseline)
    // for spike and 0 for trendScore keeps the card renderable without
    // fabricating an "on fire" reading.
    spike: g.spike ?? 1,
    trendScore: g.trendScore ?? 0,
    lifecycle: g.lifecycle as PulseLifecycle,
    reason: g.reason,
    spark: g.spark,
    currentSort: g.currentSort,
    currentSortRank: g.currentSortRank,
    createdAtMs: g.createdAtMs,
    trackingDays: g.trackingDays,
    velocityPctInCohort: g.velocityPctInCohort,
    cohortBasis: adaptCohortBasis(g.cohortBasis),
    cohortSize: g.cohortSize,
    velocityChange24hPct: g.velocityChange24hPct,
    delta24hPct: g.delta24hPct,
  };
}

export function adaptPulsePayload(p: PulsePayload): FeedPayload {
  return {
    games: p.games.map(adaptCard).filter((g): g is TlwPulseCard => g !== null),
    hero: p.hero,
    kicker: fmtKicker(p.liveSince),
    liveSince: p.liveSince,
    rail: {
      // Signal derivation is not wired yet server-side; the rail still renders
      // distribution + transitions without it, which is the honest fallback.
      signal: null,
      distribution: p.rail.distribution,
      transitions6h: p.rail.transitions6h,
    },
    degradedMode: p.degradedMode,
    // jobHealth is a tlw-only telemetry hook (worker per-job staleness). We
    // don't surface it in pulse today; empty record keeps the topbar's
    // "Live · N ago" chip on the payload-derived liveSince path.
    jobHealth: {},
  };
}
