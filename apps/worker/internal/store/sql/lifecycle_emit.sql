-- lifecycle_emit.sql — analytical lifecycle events, emit-on-change only (§2.2).
--
-- Compares each game's newest game_stats.lifecycle (this tick) to the prior row.
-- An event is emitted ONLY on a genuine stage transition (prior row exists and
-- differs). The first-ever classification establishes a baseline silently — it
-- is a state, not a transition. Sort entry/exit + update_shipped are emitted by
-- ingestion (§1), never here. Reading game_stats.lifecycle here is change
-- DETECTION, not derivation — no game_stats VALUE is computed from another.
--
-- Idempotent: a NOT EXISTS guard on (universe_id, type, detected_at) means a
-- re-run of the same tick emits nothing.
--
-- $1 = computed_at of the tick just derived.
insert into lifecycle_events (universe_id, type, detected_at, magnitude, meta)
with ranked as (
  select universe_id, computed_at, lifecycle, trend_score,
    row_number() over (partition by universe_id order by computed_at desc) as rn
  from game_stats
  where computed_at <= $1
),
cur  as (select * from ranked where rn = 1),
prev as (select * from ranked where rn = 2)
select
  c.universe_id, m.evt::lifecycle_event_type, c.computed_at, c.trend_score,
  jsonb_build_object('from', p.lifecycle, 'to', c.lifecycle)
from cur c
join prev p on p.universe_id = c.universe_id           -- transition needs a prior row
join lateral (
  select case c.lifecycle
    when 'launching' then 'launch'
    when 'revived'   then 'revival'
    when 'declining' then 'decline'
    when 'cooling'   then 'cooldown'
    when 'dormant'   then 'death'
    when 'growing'   then 'spike'
    else null
  end as evt
) m on true
where m.evt is not null
  and c.lifecycle is distinct from p.lifecycle
  and not exists (
    select 1 from lifecycle_events le
    where le.universe_id = c.universe_id
      and le.type = m.evt::lifecycle_event_type
      and le.detected_at = c.computed_at
  );
