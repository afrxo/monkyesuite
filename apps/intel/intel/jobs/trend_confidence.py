"""Trend confidence — a continuous score per tag direction.

Upgrades the binary confirmation rule (>= N rising carriers) into a graded
signal: how strongly is this tag's cohort moving, relative to every other tag
right now? Aggregation happens in Postgres (CPU strategy: the worker/intel
never fold raw rows in app memory); Python scores the few-hundred-row
tag-level result.

The confirmation rule survives as a floor, not a ceiling: tags need >= 2
carriers to appear at all, and the rising-carrier fraction is the heaviest
component — a single spiking game can never mint a "trend".
"""

from datetime import datetime
from typing import Any

import psycopg

from ..scoring import clamp01, percentile_rank, sigmoid, zscore
from ..write import write_insights

MAX_ROWS = 15

# Seeded weights (documented, transparent; replaced by a fitted model once
# enough forward history exists — see README). Feature order:
#   rising_frac      fraction of carriers in growing/launching
#   velocity_z       tag avg CCU velocity, z-scored across tags
#   spike_z          tag avg spike score, z-scored across tags
#   breadth          log-damped carrier count (more carriers = more evidence)
WEIGHTS = {
    "rising_frac": 3.0,
    "velocity_z": 1.2,
    "spike_z": 0.6,
    "breadth": 0.8,
}
BIAS = -2.2  # centers "half the carriers rising, average motion" near 0.5

SQL = """
with ls as (
  select distinct on (universe_id)
    universe_id, lifecycle, velocity, spike_score
  from game_stats
  order by universe_id, computed_at desc
)
select
  t.axis,
  t.slug,
  t.label,
  count(*)::int                                                     as carriers,
  count(*) filter (where ls.lifecycle in ('growing','launching'))::int as rising,
  coalesce(avg(ls.velocity), 0)::float                              as avg_velocity,
  coalesce(avg(ls.spike_score), 0)::float                           as avg_spike
from game_tags gt
join tags t on t.id = gt.tag_id
join ls on ls.universe_id = gt.universe_id
group by t.axis, t.slug, t.label
having count(*) >= 2
"""


def run(conn: psycopg.Connection, computed_at: datetime) -> int:
    with conn.cursor() as cur:
        cur.execute(SQL)
        tags = [
            {
                "axis": r[0],
                "slug": r[1],
                "label": r[2],
                "carriers": r[3],
                "rising": r[4],
                "avg_velocity": r[5],
                "avg_spike": r[6],
            }
            for r in cur.fetchall()
        ]

    if not tags:
        write_insights(conn, "trend_confidence", computed_at, [])
        return 0

    velocities = [t["avg_velocity"] for t in tags]
    spikes = [t["avg_spike"] for t in tags]
    max_carriers = max(t["carriers"] for t in tags)

    rows: list[dict[str, Any]] = []
    for t in tags:
        rising_frac = t["rising"] / t["carriers"]
        velocity_z = zscore(velocities, t["avg_velocity"])
        spike_z = zscore(spikes, t["avg_spike"])
        breadth = t["carriers"] / max_carriers if max_carriers else 0.0

        components = [
            {"name": "rising_frac", "value": round(rising_frac, 3), "weight": WEIGHTS["rising_frac"]},
            {"name": "velocity_z", "value": round(velocity_z, 3), "weight": WEIGHTS["velocity_z"]},
            {"name": "spike_z", "value": round(spike_z, 3), "weight": WEIGHTS["spike_z"]},
            {"name": "breadth", "value": round(breadth, 3), "weight": WEIGHTS["breadth"]},
        ]
        score = clamp01(
            sigmoid(BIAS + sum(c["weight"] * c["value"] for c in components))
        )
        vel_pct = percentile_rank(velocities, t["avg_velocity"])

        # A percentile over a handful of tags is noise dressed as precision —
        # only claim one once the population can support it.
        if len(tags) >= 5:
            top_pct = max(1, round((1 - vel_pct) * 100))
            rel = f"cohort velocity in the top {top_pct}% of tags"
        else:
            rel = f"avg velocity {t['avg_velocity']:+.2f} (few tags tracked yet)"
        headline = (
            f"{t['label']}: {t['rising']}/{t['carriers']} carriers rising, "
            f"{rel} (estimate)"
        )
        rows.append(
            {
                "subject_type": "tag",
                "subject_key": f"{t['axis']}:{t['slug']}",
                "score": score,
                "headline": headline,
                "evidence": {
                    "carriers": t["carriers"],
                    "risingCarriers": t["rising"],
                    "avgVelocity": round(t["avg_velocity"], 4),
                    "avgSpike": round(t["avg_spike"], 4),
                    "velocityPercentile": round(vel_pct, 3),
                    "components": components,
                },
            }
        )

    rows.sort(key=lambda r: r["score"], reverse=True)
    rows = rows[:MAX_ROWS]
    write_insights(conn, "trend_confidence", computed_at, rows)
    return len(rows)
