"""Movement explanation — "why did this move?"

Takes the biggest movers from game_stats_latest and attributes each move to
co-occurring, observable causes: a shipped update, a live event, presence in a
discovery sort, a lifecycle transition. When nothing correlates the row says
so explicitly — an honest "unexplained" beats a fabricated cause.

Correlates are gathered in three batched queries (never per-game loops
against the DB) and joined in Python over <= MAX_MOVERS rows.
"""

from datetime import datetime, timedelta, timezone
from typing import Any

import psycopg

from ..scoring import percentile_rank
from ..write import write_insights

MAX_MOVERS = 12
# Noise floor: tiny games swing wildly on scrape jitter; below this CCU a
# "move" is more likely sampling error than signal.
MIN_CCU = 50

MOVERS_SQL = """
select
  gsl.universe_id,
  g.name,
  g.icon_url,
  gsl.delta_24h_pct,
  gsl.spike_score,
  gsl.latest_ccu,
  g.current_sort,
  g.current_sort_rank,
  g.updated_at
from game_stats_latest gsl
join games g on g.universe_id = gsl.universe_id
where gsl.latest_ccu >= %s
  and (gsl.delta_24h_pct is not null or gsl.spike_score is not null)
order by greatest(abs(coalesce(gsl.delta_24h_pct, 0)),
                  abs(coalesce(gsl.spike_score, 0))) desc
limit %s
"""

TRANSITIONS_SQL = """
select universe_id, type, detected_at
from lifecycle_events
where universe_id = any(%s) and detected_at >= %s
order by detected_at desc
"""

LIVE_EVENTS_SQL = """
select universe_id, title
from game_events
where universe_id = any(%s)
  and start_utc is not null and end_utc is not null
  and now() between start_utc and end_utc
"""


def run(conn: psycopg.Connection, computed_at: datetime) -> int:
    with conn.cursor() as cur:
        cur.execute(MOVERS_SQL, (MIN_CCU, MAX_MOVERS))
        movers = [
            {
                "universe_id": r[0],
                "name": r[1],
                "icon_url": r[2],
                "delta_pct": r[3],
                "spike_score": r[4],
                "latest_ccu": r[5],
                "current_sort": r[6],
                "current_sort_rank": r[7],
                "updated_at": r[8],
            }
            for r in cur.fetchall()
        ]

    if not movers:
        write_insights(conn, "movement", computed_at, [])
        return 0

    ids = [m["universe_id"] for m in movers]
    since = datetime.now(timezone.utc) - timedelta(hours=48)

    transitions: dict[int, tuple[str, datetime]] = {}
    live_events: dict[int, str] = {}
    with conn.cursor() as cur:
        cur.execute(TRANSITIONS_SQL, (ids, since))
        for uid, ev_type, detected in cur.fetchall():
            transitions.setdefault(uid, (ev_type, detected))
        cur.execute(LIVE_EVENTS_SQL, (ids,))
        for uid, title in cur.fetchall():
            live_events.setdefault(uid, title or "live event")

    now = datetime.now(timezone.utc)
    magnitudes = [abs(m["delta_pct"] or 0.0) for m in movers]

    rows: list[dict[str, Any]] = []
    for m in movers:
        # Factors in fixed attribution order: shipped work first (strongest
        # causal claim), then events, discovery placement, stage changes.
        factors: list[dict[str, str]] = []
        updated_at = m["updated_at"]
        if updated_at is not None:
            age_days = (now - updated_at).days
            if age_days <= 3:
                day_word = "today" if age_days == 0 else f"{age_days}d ago"
                factors.append(
                    {"kind": "update_shipped", "detail": f"shipped an update {day_word}"}
                )
        if m["universe_id"] in live_events:
            factors.append(
                {
                    "kind": "active_event",
                    "detail": f"running “{live_events[m['universe_id']]}” right now",
                }
            )
        if m["current_sort"]:
            rank = m["current_sort_rank"]
            rank_txt = f" at #{rank}" if rank is not None else ""
            factors.append(
                {
                    "kind": "sort_entry",
                    "detail": f"placed in “{m['current_sort']}”{rank_txt} this tick",
                }
            )
        if m["universe_id"] in transitions:
            ev_type, _ = transitions[m["universe_id"]]
            factors.append(
                {"kind": "stage_change", "detail": f"lifecycle transition: {ev_type} (48h)"}
            )
        if not factors:
            factors.append(
                {
                    "kind": "unexplained",
                    "detail": "no correlated update, event, or placement found — organic or off-platform driver",
                }
            )

        delta = m["delta_pct"]
        if delta is not None:
            move_txt = f"CCU {'+' if delta >= 0 else ''}{round(delta * 100)}% over 24h"
        else:
            spike = m["spike_score"] or 0.0
            move_txt = f"spike {spike:+.1f} vs own baseline"
        headline = f"{m['name']}: {move_txt} — {factors[0]['detail']}"

        rows.append(
            {
                "subject_type": "game",
                "subject_key": str(m["universe_id"]),
                # Score = how big this move is relative to the other movers.
                "score": percentile_rank(magnitudes, abs(delta or 0.0)),
                "headline": headline,
                "evidence": {
                    "universeId": m["universe_id"],
                    "name": m["name"],
                    "iconUrl": m["icon_url"],
                    "deltaPct": delta,
                    "spikeScore": m["spike_score"],
                    "latestCcu": m["latest_ccu"],
                    "factors": factors,
                },
            }
        )

    write_insights(conn, "movement", computed_at, rows)
    return len(rows)
