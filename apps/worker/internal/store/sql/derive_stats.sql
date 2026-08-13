-- derive_stats.sql — per-game signals (specs/02 §2.1 + §2.2 classification).
--
-- The worker TRIGGERS this; Postgres RUNS it. Every value is a pure function of
-- game_metrics (+ games/sort presence and ingestion-emitted update_shipped
-- events) computed with window/aggregate functions here in the database — never
-- pulled into worker memory. Idempotent on (universe_id, computed_at): re-running
-- the same tick inserts nothing. No derived value reads game_stats.
--
-- $1 = computed_at (the tick timestamp; also the "as of" upper bound).
insert into game_stats (
  universe_id, computed_at, trend_score, velocity, spike_score, lifecycle,
  ccu_slope_7d, ccu_slope_28d, ccu_mean_24h, trough_peak_ratio,
  like_ratio, favorites_per_visit, days_since_update, updates_per_28d, genre_percentile
)
with
-- latest raw snapshot per game, as of $1
latest as (
  select distinct on (universe_id)
    universe_id, playing, visits, favorited_count, up_votes, down_votes
  from game_metrics
  where captured_at <= $1
  order by universe_id, captured_at desc
),
-- linear-fit slopes + means over their windows (regr_slope = least squares in SQL)
slopes as (
  select universe_id,
    regr_slope(playing, extract(epoch from captured_at))
      filter (where captured_at > $1 - interval '7 days')  as ccu_slope_7d,
    regr_slope(playing, extract(epoch from captured_at))
      filter (where captured_at > $1 - interval '28 days') as ccu_slope_28d,
    regr_slope(playing, extract(epoch from captured_at))
      filter (where captured_at > $1 - interval '2 hours')  as velocity,
    (avg(playing) filter (where captured_at > $1 - interval '24 hours'))::float as ccu_mean_24h,
    count(*) filter (where captured_at > $1 - interval '7 days') as n7
  from game_metrics
  where captured_at <= $1 and captured_at > $1 - interval '28 days'
  group by universe_id
),
-- z-score of the LATEST reading vs the trailing 288-tick (~24h) window
spike as (
  select universe_id, spike_z from (
    select universe_id,
      (playing - avg(playing) over w) / nullif(stddev_pop(playing) over w, 0) as spike_z,
      row_number() over (partition by universe_id order by captured_at desc) as rn
    from game_metrics
    where captured_at <= $1 and captured_at > $1 - interval '3 days'
    window w as (
      partition by universe_id order by captured_at
      rows between 288 preceding and 1 preceding
    )
  ) z where rn = 1
),
-- today's trough/peak retention proxy
trough as (
  select universe_id,
    min(playing)::float / nullif(max(playing), 0) as trough_peak_ratio
  from game_metrics
  where captured_at >= date_trunc('day', $1::timestamptz) and captured_at <= $1
  group by universe_id
),
-- dormancy baseline for revival: how low the game sat before the recent window
baseline as (
  select universe_id, max(playing) as base_max
  from game_metrics
  where captured_at <= $1 - interval '2 days' and captured_at > $1 - interval '30 days'
  group by universe_id
),
-- update cadence from ingestion-emitted update_shipped events (NOT a derived stat)
updates as (
  select universe_id, count(*) as updates_28d
  from lifecycle_events
  where type = 'update_shipped' and detected_at > $1 - interval '28 days'
  group by universe_id
),
base as (
  select
    g.universe_id, $1::timestamptz as computed_at,
    (g.current_sort is not null) as in_sort,
    g.updated_at, g.first_seen_at, g.roblox_genre,
    l.visits, l.favorited_count, l.up_votes, l.down_votes,
    s.ccu_slope_7d, s.ccu_slope_28d, s.velocity, s.ccu_mean_24h, s.n7,
    sp.spike_z, tr.trough_peak_ratio, b.base_max,
    coalesce(u.updates_28d, 0)::int as updates_28d
  from games g
  join latest l on l.universe_id = g.universe_id
  left join slopes   s  on s.universe_id  = g.universe_id
  left join spike    sp on sp.universe_id = g.universe_id
  left join trough   tr on tr.universe_id = g.universe_id
  left join baseline b  on b.universe_id  = g.universe_id
  left join updates  u  on u.universe_id  = g.universe_id
  where g.is_tracked
),
scored as (
  select *,
    case when (up_votes + down_votes) > 0
         then up_votes::float / (up_votes + down_votes) end as like_ratio,
    case when visits > 0
         then favorited_count::float / visits end as favorites_per_visit,
    case when updated_at is not null
         then floor(extract(epoch from ($1::timestamptz - updated_at)) / 86400)::int end as days_since_update
  from base
),
-- §2.2: stage from slope + spike + days_since_update, incorporating sort presence.
-- Sparse series (n7 < 3) or brand-new games classify 'launching' but keep NULL
-- numeric signals — never fabricated.
classified as (
  select *,
    case
      when n7 is null or n7 < 3 or first_seen_at > $1 - interval '3 days'
        then 'launching'
      when base_max is not null and base_max < 50 and coalesce(spike_z, 0) > 2 and in_sort
        then 'revived'
      when coalesce(ccu_slope_7d, 0) > 0 and coalesce(days_since_update, 999) <= 14
        then 'growing'
      when coalesce(ccu_slope_7d, 0) < 0 and coalesce(days_since_update, 999) > 14
        then 'declining'
      when coalesce(ccu_mean_24h, 0) < 20 and coalesce(days_since_update, 999) > 60
        then 'dormant'
      when coalesce(ccu_slope_7d, 0) < 0
        then 'cooling'
      else 'stable'
    end::lifecycle_stage as lifecycle
  from scored
),
pct as (
  select *,
    case when ccu_mean_24h is not null
      then percent_rank() over (partition by roblox_genre order by ccu_mean_24h)
    end as genre_percentile
  from classified
)
select
  universe_id, computed_at,
  -- headline blend of spike + short-term growth; NULL when the series is too
  -- sparse to have a spike z-score (sparse → null, not a fabricated 0).
  case when spike_z is null then null
       else spike_z * 0.6
          + coalesce(sign(velocity) * ln(1 + abs(velocity) * 1000), 0) * 0.4
  end as trend_score,
  velocity, spike_z as spike_score, lifecycle,
  ccu_slope_7d, ccu_slope_28d, ccu_mean_24h, trough_peak_ratio,
  like_ratio, favorites_per_visit, days_since_update, updates_28d, genre_percentile
from pct
on conflict (universe_id, computed_at) do nothing;
