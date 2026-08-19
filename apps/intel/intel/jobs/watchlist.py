"""Watchlist triage — early-stage games worth tracking before they're obvious.

Candidates: launching/growing lifecycle with positive velocity. Ranked by a
composite of cohort-relative velocity, engagement proxies (like ratio), and an
earliness bonus — a small game accelerating matters more here than a giant
drifting up, because the whole point of a watchlist is lead time.

All proxies; every reason string reads as an estimate, never a fact.
"""

from datetime import datetime
from typing import Any

import psycopg

from ..scoring import clamp01, percentile_rank
from ..write import write_insights

MAX_ROWS = 15

# Composite weights, documented and transparent (see README "How ML grows in").
W_COHORT = 0.45   # velocity percentile within cohort (or population fallback)
W_ENGAGE = 0.25   # like ratio, already 0..1
W_EARLY = 0.30    # inverse CCU percentile among candidates — smaller = earlier

SQL = """
with ls as (
  select distinct on (universe_id)
    universe_id, like_ratio, ccu_slope_7d
  from game_stats
  order by universe_id, computed_at desc
)
select
  gsl.universe_id,
  g.name,
  g.icon_url,
  gsl.lifecycle::text,
  gsl.latest_ccu,
  gsl.velocity,
  cs.velocity_pct_in_cohort,
  ls.like_ratio,
  ls.ccu_slope_7d
from game_stats_latest gsl
join games g on g.universe_id = gsl.universe_id
left join cohort_stats cs on cs.universe_id = gsl.universe_id
left join ls on ls.universe_id = gsl.universe_id
where gsl.lifecycle in ('launching', 'growing')
  and coalesce(gsl.velocity, 0) > 0
"""


def run(conn: psycopg.Connection, computed_at: datetime) -> int:
    with conn.cursor() as cur:
        cur.execute(SQL)
        candidates = [
            {
                "universe_id": r[0],
                "name": r[1],
                "icon_url": r[2],
                "lifecycle": r[3],
                "latest_ccu": r[4],
                "velocity": r[5],
                "cohort_pct": r[6],
                "like_ratio": r[7],
                "slope_7d": r[8],
            }
            for r in cur.fetchall()
        ]

    if not candidates:
        write_insights(conn, "watch", computed_at, [])
        return 0

    ccus = [float(c["latest_ccu"] or 0) for c in candidates]
    velocities = [float(c["velocity"] or 0.0) for c in candidates]

    rows: list[dict[str, Any]] = []
    for c in candidates:
        # Cohort percentile when derive has one; population-relative velocity
        # percentile as the warm-up fallback (thin history -> cohort_stats may
        # trail behind).
        cohort_pct = c["cohort_pct"]
        if cohort_pct is None:
            cohort_pct = percentile_rank(velocities, float(c["velocity"] or 0.0))
        engage = clamp01(float(c["like_ratio"])) if c["like_ratio"] is not None else 0.5
        early = 1.0 - percentile_rank(ccus, float(c["latest_ccu"] or 0))

        score = clamp01(W_COHORT * cohort_pct + W_ENGAGE * engage + W_EARLY * early)

        reasons = [
            f"velocity estimated in the top {max(1, round((1 - cohort_pct) * 100))}% of its cohort",
            f"{c['lifecycle']} stage at {c['latest_ccu']:,} CCU — early enough to have lead time",
        ]
        if c["like_ratio"] is not None:
            reasons.append(f"like ratio ≈ {round(engage * 100)}% (engagement proxy)")
        if c["slope_7d"] is not None and c["slope_7d"] > 0:
            reasons.append("7d CCU slope positive — growth is sustained, not one spike")

        headline = (
            f"{c['name']}: {c['lifecycle']} at {c['latest_ccu']:,} CCU, "
            f"{reasons[0]} (estimate)"
        )
        rows.append(
            {
                "subject_type": "game",
                "subject_key": str(c["universe_id"]),
                "score": score,
                "headline": headline,
                "evidence": {
                    "universeId": c["universe_id"],
                    "name": c["name"],
                    "iconUrl": c["icon_url"],
                    "lifecycle": c["lifecycle"],
                    "latestCcu": c["latest_ccu"],
                    "velocityPctInCohort": round(cohort_pct, 3),
                    "likeRatio": c["like_ratio"],
                    "reasons": reasons,
                },
            }
        )

    rows.sort(key=lambda r: r["score"], reverse=True)
    rows = rows[:MAX_ROWS]
    write_insights(conn, "watch", computed_at, rows)
    return len(rows)
