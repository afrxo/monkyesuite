-- trend_drift.sql — the confirmation rule, in SQL (specs/02 §2.3).
--
-- A tag is a DIRECTION only when carried by multiple games that are ALSO
-- growing. Both halves of the rule (multi-game AND growth) are enforced in the
-- query via the HAVING clause — nothing clears as a "trend" in application code.
-- Runs daily; read-only (no trend table in the schema, so results are returned
-- for logging / the API to read, never persisted here).
--
-- $1 = :min_rising threshold.
select
  t.axis,
  t.slug,
  count(*) filter (where s.lifecycle in ('growing', 'launching')) as rising_carriers,
  count(*)                                                        as total_carriers
from game_tags gt
join tags t on t.id = gt.tag_id
join lateral (
  select gs.lifecycle
  from game_stats gs
  where gs.universe_id = gt.universe_id
  order by gs.computed_at desc
  limit 1
) s on true
group by t.axis, t.slug
having count(*) filter (where s.lifecycle in ('growing', 'launching')) >= $1
order by rising_carriers desc, total_carriers desc;
