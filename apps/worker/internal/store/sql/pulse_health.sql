-- pulse_health.sql — singleton feed_health row for the pulse rail.
--
-- Aggregates that would otherwise run at request time: lifecycle-stage
-- distribution, 6h stage transitions ("stuck" — game still in its new stage),
-- first-time 10k-CCU events today, count of new games in the last 48h, and
-- degraded flag (true when derive hasn't produced fresh stats in >2 ticks).
--
-- Rewritten in full each derive tick. id=1 keeps it a singleton.
insert into feed_health (
  id,
  distribution_new, distribution_growing, distribution_peaking, distribution_declining,
  transitions_to_new_6h, transitions_to_growing_6h,
  transitions_to_peaking_6h, transitions_to_declining_6h,
  first_time_10k_today, new_games_48h,
  live_since, degraded_mode
)
with
dist as (
  select
    count(*) filter (where pulse_stage = 'new')       as d_new,
    count(*) filter (where pulse_stage = 'growing')   as d_growing,
    count(*) filter (where pulse_stage = 'peaking')   as d_peaking,
    count(*) filter (where pulse_stage = 'declining') as d_declining,
    max(computed_at) as live_since
  from game_stats_latest
),
-- 6h stuck transitions: game's PREVIOUS pulse_stage row (from game_stats
-- history) differs from CURRENT and the transition landed inside the last 6h.
-- Requires history rows to carry pulse_stage too; when they don't yet (early
-- ticks) the count is simply zero, which is honest.
transitions as (
  select
    to_stage,
    count(distinct universe_id) as n
  from (
    select
      gsl.universe_id,
      gsl.pulse_stage as to_stage,
      lag(gs.pulse_stage) over (partition by gs.universe_id order by gs.computed_at) as from_stage,
      gs.computed_at
    from game_stats gs
    join game_stats_latest gsl on gsl.universe_id = gs.universe_id
    where gs.computed_at > now() - interval '6 hours'
      and gs.pulse_stage is not null
  ) w
  where from_stage is not null
    and from_stage <> to_stage
  group by to_stage
),
first_10k as (
  select count(distinct universe_id) as n
  from lifecycle_events
  where detected_at > now() - interval '24 hours'
    and type = 'spike'  -- proxy: first-time high-CCU crossing surfaces as a spike event
    and magnitude >= 10000
),
new_48h as (
  select count(*) as n from games
  where first_seen_at > now() - interval '48 hours'
),
freshness as (
  -- degraded when the most recent derive tick is more than 20 min old
  -- (2× the ~10 min snapshot cadence + slack). Missing entirely → degraded.
  select coalesce(max(computed_at) < now() - interval '20 minutes', true) as degraded,
         max(computed_at) as live
  from game_stats_latest
)
select
  1,
  coalesce(dist.d_new, 0),
  coalesce(dist.d_growing, 0),
  coalesce(dist.d_peaking, 0),
  coalesce(dist.d_declining, 0),
  coalesce((select n from transitions where to_stage = 'new'), 0),
  coalesce((select n from transitions where to_stage = 'growing'), 0),
  coalesce((select n from transitions where to_stage = 'peaking'), 0),
  coalesce((select n from transitions where to_stage = 'declining'), 0),
  coalesce((select n from first_10k), 0),
  coalesce((select n from new_48h), 0),
  coalesce(freshness.live, now()),
  coalesce(freshness.degraded, false)
from dist, freshness
on conflict (id) do update set
  distribution_new              = excluded.distribution_new,
  distribution_growing          = excluded.distribution_growing,
  distribution_peaking          = excluded.distribution_peaking,
  distribution_declining        = excluded.distribution_declining,
  transitions_to_new_6h         = excluded.transitions_to_new_6h,
  transitions_to_growing_6h     = excluded.transitions_to_growing_6h,
  transitions_to_peaking_6h     = excluded.transitions_to_peaking_6h,
  transitions_to_declining_6h   = excluded.transitions_to_declining_6h,
  first_time_10k_today          = excluded.first_time_10k_today,
  new_games_48h                 = excluded.new_games_48h,
  live_since                    = excluded.live_since,
  degraded_mode                 = excluded.degraded_mode;
