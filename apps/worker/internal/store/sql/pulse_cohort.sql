-- pulse_cohort.sql — per-game velocity percentile within its cohort.
--
-- Cohort = genre bucket when it exists and has >= 10 members with a computed
-- velocity, else 'global' as fallback so brand-new genres don't hide a game
-- from the pulse rail. Runs AFTER pulse_stats.sql; reads game_stats_latest.
--
-- Idempotent: full-table replace via truncate + insert inside one transaction
-- keeps writers honest; cohort membership shifts every tick, so partial
-- updates would leave stale rows for games that dropped out of a cohort.
truncate cohort_stats;

insert into cohort_stats (universe_id, velocity_pct_in_cohort, cohort_basis, cohort_size, computed_at)
with pop as (
  select gsl.universe_id, gsl.velocity, g.roblox_genre
  from game_stats_latest gsl
  join games g on g.universe_id = gsl.universe_id
  where gsl.velocity is not null
),
sizes as (
  select roblox_genre, count(*) as n
  from pop
  where roblox_genre is not null
  group by roblox_genre
),
-- percentile within genre bucket when the bucket is large enough
genre_pct as (
  select p.universe_id,
    percent_rank() over (partition by p.roblox_genre order by p.velocity) as pct,
    p.roblox_genre,
    s.n as cohort_size
  from pop p
  join sizes s on s.roblox_genre = p.roblox_genre
  where s.n >= 10
),
-- everyone not in a genre_pct row falls through to a global percentile
in_genre as (select universe_id from genre_pct),
global_pop as (
  select universe_id, velocity from pop
  where universe_id not in (select universe_id from in_genre)
),
global_pct as (
  select universe_id,
    percent_rank() over (order by velocity) as pct,
    (select count(*) from global_pop) as cohort_size
  from global_pop
)
select universe_id, pct, 'genre'::cohort_basis,  cohort_size, now() from genre_pct
union all
select universe_id, pct, 'global'::cohort_basis, cohort_size, now() from global_pct;
