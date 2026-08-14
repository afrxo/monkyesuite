-- pulse_stats.sql — populate game_stats_latest (denorm hot-path row per game).
--
-- Runs AFTER derive_stats.sql each tick so it can pull the freshest game_stats
-- row + freshest game_metrics reading + a 24h-ago metric window in one shot.
-- Purely SQL — no aggregation in Go. Upsert keyed by universe_id.
--
-- The pulse fields (spike/spark/delta/velocity_change/pulse_stage/annotation)
-- live here in denormalized form; they are also written back to the same-tick
-- game_stats row by pulse_backfill.sql if we want the historical audit trail,
-- but the hot path only ever reads game_stats_latest.
--
-- $1 = computed_at (this tick's timestamp; matches the game_stats row just written)
insert into game_stats_latest (
  universe_id, computed_at, latest_ccu,
  trend_score, velocity, spike_score, lifecycle, pulse_stage,
  spark, delta_24h_pct, velocity_change_24h_pct, annotation, genre_percentile
)
with
-- fresh derived row from this tick's derive_stats.sql pass
gs as (
  select
    universe_id, computed_at, trend_score, velocity, spike_score,
    lifecycle, genre_percentile
  from game_stats
  where computed_at = $1
),
-- newest CCU reading for each game as of this tick
latest_metric as (
  select distinct on (universe_id)
    universe_id, playing as ccu, captured_at
  from game_metrics
  where captured_at <= $1
  order by universe_id, captured_at desc
),
-- CCU reading closest to 24h ago (± 2h tolerance window). Missing → NULL,
-- which becomes NULL delta_24h_pct — never a fabricated zero.
ccu_24h_ago as (
  select distinct on (universe_id)
    universe_id, playing as ccu_then
  from game_metrics
  where captured_at between $1 - interval '26 hours' and $1 - interval '22 hours'
  order by universe_id, abs(extract(epoch from (captured_at - ($1 - interval '24 hours'))))
),
-- previous derive tick's velocity for the 24h velocity-change delta
velocity_24h_ago as (
  select distinct on (universe_id)
    universe_id, velocity as velocity_then
  from game_stats
  where computed_at between $1 - interval '26 hours' and $1 - interval '22 hours'
  order by universe_id, abs(extract(epoch from (computed_at - ($1 - interval '24 hours'))))
),
-- 24-point sparkline built entirely in SQL — one point per hour for 24h.
-- array_agg over hour-bucketed averages keeps the payload small (~200 bytes).
spark_series as (
  select universe_id,
    jsonb_agg(hour_avg order by hour) filter (where hour_avg is not null) as spark
  from (
    select universe_id,
      date_trunc('hour', captured_at) as hour,
      avg(playing)::int as hour_avg
    from game_metrics
    where captured_at > $1 - interval '24 hours' and captured_at <= $1
    group by universe_id, date_trunc('hour', captured_at)
  ) h
  group by universe_id
),
-- baseline for spike z-score (mirrors derive_stats.sql spike CTE)
spike_ref as (
  select universe_id,
    (avg(playing) filter (
      where captured_at > $1 - interval '3 days'
        and captured_at <= $1 - interval '3 hours'
    ))::float as baseline_avg
  from game_metrics
  where captured_at > $1 - interval '3 days'
  group by universe_id
),
computed as (
  select
    gs.universe_id, gs.computed_at,
    coalesce(lm.ccu, 0) as latest_ccu,
    gs.trend_score, gs.velocity, gs.spike_score, gs.lifecycle,
    gs.genre_percentile,
    -- multiplicative spike ratio: current / baseline_avg. Distinct from
    -- game_stats.spike_score (a z-score). Both live on the row — the ratio is
    -- the shape the pulse feed wants ("2.4× baseline").
    case when sr.baseline_avg is not null and sr.baseline_avg > 0
      then lm.ccu::float / sr.baseline_avg
      else null
    end as spike_ratio,
    ss.spark,
    -- 24h percentage delta (null when baseline missing or zero)
    case when ca.ccu_then is not null and ca.ccu_then > 0
      then ((lm.ccu - ca.ccu_then)::float / ca.ccu_then) * 100.0
      else null
    end as delta_24h_pct,
    -- 24h velocity-change delta (percent). Sign preserved.
    case when va.velocity_then is not null and va.velocity_then <> 0
      then ((gs.velocity - va.velocity_then) / abs(va.velocity_then)) * 100.0
      else null
    end as velocity_change_24h_pct
  from gs
  left join latest_metric   lm on lm.universe_id = gs.universe_id
  left join ccu_24h_ago     ca on ca.universe_id = gs.universe_id
  left join velocity_24h_ago va on va.universe_id = gs.universe_id
  left join spark_series    ss on ss.universe_id = gs.universe_id
  left join spike_ref       sr on sr.universe_id = gs.universe_id
),
-- Map the 7-stage lifecycle to the 4-stage pulse taxonomy. Explicit here so a
-- schema change to either enum surfaces in this file rather than as silently
-- unlabeled rows in the pulse feed. `stable` folds into `growing` if the game
-- is genuinely holding up (positive velocity), else `declining`.
pulse_map as (
  select
    universe_id, computed_at, latest_ccu,
    trend_score, velocity, spike_score, lifecycle, genre_percentile,
    spike_ratio, spark, delta_24h_pct, velocity_change_24h_pct,
    case
      when lifecycle = 'launching' then 'new'
      when lifecycle = 'revived'   then 'growing'
      when lifecycle = 'growing'   then 'growing'
      when lifecycle = 'stable' and coalesce(velocity, 0) >= 0 then 'growing'
      when lifecycle = 'stable' and coalesce(velocity, 0) <  0 then 'declining'
      when lifecycle = 'cooling'   then 'peaking'
      when lifecycle = 'declining' then 'declining'
      when lifecycle = 'dormant'   then 'declining'
      else null
    end::pulse_stage as pulse_stage,
    -- annotation: short editorial kicker. Kept null when nothing notable —
    -- pulse UI hides the row instead of rendering a fabricated reason.
    case
      when coalesce(spike_ratio, 0) >= 2.0
        then 'Spiking · ' || round(spike_ratio::numeric, 1) || '× baseline'
      when coalesce(delta_24h_pct, 0) >= 25
        then 'Up ' || round(delta_24h_pct::numeric, 0) || '% in 24h'
      when coalesce(delta_24h_pct, 0) <= -25
        then 'Down ' || round(abs(delta_24h_pct)::numeric, 0) || '% in 24h'
      when lifecycle = 'launching'
        then 'New arrival'
      when lifecycle = 'revived'
        then 'Revived from dormancy'
      else null
    end as annotation
  from computed
)
select
  universe_id, computed_at, latest_ccu,
  trend_score, velocity, spike_ratio, lifecycle, pulse_stage,
  spark, delta_24h_pct, velocity_change_24h_pct, annotation, genre_percentile
from pulse_map
on conflict (universe_id) do update set
  computed_at             = excluded.computed_at,
  latest_ccu              = excluded.latest_ccu,
  trend_score             = excluded.trend_score,
  velocity                = excluded.velocity,
  spike_score             = excluded.spike_score,
  lifecycle               = excluded.lifecycle,
  pulse_stage             = excluded.pulse_stage,
  spark                   = excluded.spark,
  delta_24h_pct           = excluded.delta_24h_pct,
  velocity_change_24h_pct = excluded.velocity_change_24h_pct,
  annotation              = excluded.annotation,
  genre_percentile        = excluded.genre_percentile;
