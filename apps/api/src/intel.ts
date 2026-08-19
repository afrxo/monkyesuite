// Intel dashboard read surface (specs/10-intel.md). The apps/intel batch
// service writes ranked, pre-headlined rows into intel_insights; this module
// only selects the LATEST run per kind and groups it into the payload — no
// scoring, no aggregation, no joins at request time. If no run has landed yet
// (fresh deploy, warm-up), the payload carries computedAt: null and empty
// sections; the page renders an honest "accumulating" state, never an error.

import { intelInsights } from "@monkyesuite/database";
import type {
  IntelPayload,
  MovementEvidence,
  MovementInsight,
  TrendConfidenceEvidence,
  TrendConfidenceInsight,
  WatchEvidence,
  WatchInsight,
} from "@monkyesuite/shared";
import { sql } from "drizzle-orm";
import { db } from "./db.js";

// Row shape as a discriminated union so kind narrows evidence — the evidence
// jsonb is written exclusively by apps/intel to the shapes in shared/dto.ts,
// the same trust discover.ts places in derive-written columns. Unknown kinds
// (a V2 service writing "forecast" before this API redeploys) fall through the
// switch and are simply not surfaced yet.
type IntelRow = {
  subject_type: "tag" | "game";
  subject_key: string;
  rank: number;
  score: number;
  headline: string;
  computed_at: string;
} & (
  | { kind: "trend_confidence"; evidence: TrendConfidenceEvidence }
  | { kind: "movement"; evidence: MovementEvidence }
  | { kind: "watch"; evidence: WatchEvidence }
);

export async function getIntel(): Promise<IntelPayload> {
  const result = await db.execute<IntelRow>(sql`
    select i.kind, i.subject_type, i.subject_key, i.rank, i.score,
           i.headline, i.evidence, i.computed_at
    from ${intelInsights} i
    join (
      select kind, max(computed_at) as latest
      from ${intelInsights}
      group by kind
    ) l on l.kind = i.kind and l.latest = i.computed_at
    order by i.kind, i.rank
  `);

  const payload: IntelPayload = {
    computedAt: null,
    trendConfidence: [],
    movements: [],
    watchlist: [],
  };

  for (const r of result.rows) {
    const computedAt = new Date(r.computed_at).toISOString();
    // Payload timestamp = newest run across kinds (runs land together, but a
    // partially failed run should still show the freshest time we have).
    if (payload.computedAt === null || computedAt > payload.computedAt) {
      payload.computedAt = computedAt;
    }
    const base = {
      subjectType: r.subject_type,
      subjectKey: r.subject_key,
      rank: r.rank,
      score: r.score,
      headline: r.headline,
      computedAt,
    };
    switch (r.kind) {
      case "trend_confidence": {
        const item: TrendConfidenceInsight = {
          ...base,
          kind: r.kind,
          evidence: r.evidence,
        };
        payload.trendConfidence.push(item);
        break;
      }
      case "movement": {
        const item: MovementInsight = {
          ...base,
          kind: r.kind,
          evidence: r.evidence,
        };
        payload.movements.push(item);
        break;
      }
      case "watch": {
        const item: WatchInsight = {
          ...base,
          kind: r.kind,
          evidence: r.evidence,
        };
        payload.watchlist.push(item);
        break;
      }
    }
  }

  return payload;
}
