# 02 — Signals & Intelligence

Context: `00-overview.md`. Tables: reads `game_metrics`, `sort_snapshots`, `game_tags`, `demand_snapshots`; writes `game_stats` and analytical `lifecycle_events`.

The derivation pipeline turns raw snapshots into the signals that *are* the product. It is **orchestrated by the Go worker** on the tick loop, but the computation itself **runs in Postgres** — the queries below execute against the database; the worker only triggers them and never pulls the raw series into memory. This is the CPU strategy: aggregation in the database, not the process. Everything here is a **pure function of `game_metrics`** — replayable from scratch, idempotent on `(universeId, computedAt)`. No derived value may depend on another derived value.

## Step 2.1 — Per-game signals (every tick)

Recompute from raw and write to `game_stats`.

**Growth slope** (linear fit on the recent series):
```sql
select universe_id,
       regr_slope(playing, extract(epoch from captured_at)) as ccu_slope_7d
from game_metrics
where captured_at > now() - interval '7 days'
group by universe_id;
```

**Spike vs the game's own baseline** (z-score over the trailing ~24h = 288 ticks):
```sql
select universe_id, captured_at,
       (playing - avg(playing)  over w)
     / nullif(stddev_pop(playing) over w, 0) as spike_z
from game_metrics
window w as (
  partition by universe_id order by captured_at
  rows between 288 preceding and 1 preceding
);
```

**Retention proxy** (daily trough/peak — the closest read on whether players stay):
```sql
select universe_id, date_trunc('day', captured_at) d,
       min(playing)::float / nullif(max(playing),0) as trough_peak_ratio
from game_metrics group by 1,2;
```

Write into `game_stats`: `trend_score`, `velocity`, `spike_score`, `ccu_slope_7d`, `ccu_slope_28d`, `ccu_mean_24h`, `trough_peak_ratio`, `like_ratio`, `favorites_per_visit`, `days_since_update`, `updates_per_28d`, `genre_percentile`. New games with sparse series get **null** signals, never fabricated ones.

## Step 2.2 — Lifecycle classification (emit on change only)

Classify `lifecycle` (`launching` / `growing` / `stable` / `cooling` / `declining` / `dormant` / `revived`) with a small rule set over slope + spike + `days_since_update`, **incorporating discovery-sort presence**:

- positive slope + recent update → `growing`
- negative slope + no recent update → `declining`
- long-dormant then a spike + sort re-entry → `revived`

Emit an analytical `lifecycle_event` only on a **stage transition**. (Sort entry/exit and update-shipped events are emitted by ingestion, not here.)

## Step 2.3 — Trend-drift (daily) — the confirmation rule in SQL

A tag is a **direction** only when carried by **multiple games that are also growing**:

```sql
select t.axis, t.slug,
       count(*) filter (where s.lifecycle in ('growing','launching')) as rising_carriers,
       count(*)                                                        as total_carriers
from game_tags gt
join tags t on t.id = gt.tag_id
join lateral (
  select * from game_stats gs
  where gs.universe_id = gt.universe_id
  order by computed_at desc limit 1
) s on true
group by t.axis, t.slug
having count(*) filter (where s.lifecycle in ('growing','launching')) >= :min_rising;
```

Enforce the confirmation rule **here**, in the query — nothing is surfaced as a "trend" unless it clears both multi-game and growth. Track week-over-week change so a rising `rising_carriers` count is itself a signal.

## Acceptance

- Every signal is reproducible by replaying `game_metrics` from scratch.
- No derived value depends on another derived value.
- Every trend flag satisfies the multi-game + growth confirmation rule.
- Sparse-series games yield null signals, not fabricated ones.
