// Discovery surfaces (08-web.md §8.2). Signal payloads derived from tags (03)
// + latest stats (02), NOT raw tables. Every flagged trend carries carrierCount
// + ccuGrowth so the confirmation rule (multi-game AND CCU growth) is visible.
// Aggregation runs in SQL.

import {
  creators,
  gameMetrics,
  gameStats,
  games,
  gameTags,
  tags,
} from "@monkyesuite/database";
import type { DiscoverItem, DiscoverSurface } from "@monkyesuite/shared";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "./db.js";

const MIN_RISING = 2; // confirmation-rule floor: a direction needs ≥2 rising carriers.

// Latest stats per game, reused across surfaces.
function latestStats() {
  return db
    .selectDistinctOn([gameStats.universeId], {
      universeId: gameStats.universeId,
      computedAt: gameStats.computedAt,
      lifecycle: gameStats.lifecycle,
      velocity: gameStats.velocity,
      spikeScore: gameStats.spikeScore,
      trendScore: gameStats.trendScore,
    })
    .from(gameStats)
    .orderBy(gameStats.universeId, desc(gameStats.computedAt))
    .as("ls");
}

const rising = (col: SqlCol) =>
  sql<number>`count(*) filter (where ${col} in ('growing','launching'))::int`;

// (drizzle column refs used in raw sql)
type SqlCol = Parameters<typeof eq>[0];

async function trendDrift(): Promise<DiscoverItem[]> {
  const ls = latestStats();
  const rows = await db
    .select({
      axis: tags.axis,
      slug: tags.slug,
      label: tags.label,
      totalCarriers: sql<number>`count(*)::int`,
      risingCarriers: rising(ls.lifecycle),
      ccuGrowth: sql<number>`coalesce(round(avg(${ls.velocity})::numeric, 2), 0)`,
      computedAt: sql<Date>`max(${ls.computedAt})`,
    })
    .from(gameTags)
    .innerJoin(tags, eq(tags.id, gameTags.tagId))
    .innerJoin(ls, eq(ls.universeId, gameTags.universeId))
    .groupBy(tags.axis, tags.slug, tags.label)
    .having(
      sql`count(*) filter (where ${ls.lifecycle} in ('growing','launching')) >= ${MIN_RISING}`,
    )
    .orderBy(
      desc(
        sql`count(*) filter (where ${ls.lifecycle} in ('growing','launching'))`,
      ),
    );

  return rows.map((r) => ({
    axis: r.axis,
    slug: r.slug,
    label: r.label,
    carrierCount: r.totalCarriers,
    risingCarriers: r.risingCarriers,
    ccuGrowth: Number(r.ccuGrowth),
    // max() over a subquery column returns a string from pg, not a Date.
    computedAt: new Date(r.computedAt).toISOString(),
  }));
}

async function acceleration(): Promise<DiscoverItem[]> {
  const ls = latestStats();
  const rows = await db
    .select({
      universeId: games.universeId,
      name: games.name,
      iconUrl: games.iconUrl,
      velocity: ls.velocity,
      spikeScore: ls.spikeScore,
      lifecycle: ls.lifecycle,
      computedAt: ls.computedAt,
    })
    .from(ls)
    .innerJoin(games, eq(games.universeId, ls.universeId))
    .orderBy(desc(ls.velocity))
    .limit(20);

  return rows.map((r) => ({
    universeId: r.universeId,
    name: r.name,
    iconUrl: r.iconUrl,
    lifecycle: r.lifecycle,
    spikeScore: r.spikeScore,
    carrierCount: 1,
    ccuGrowth: r.velocity ?? 0,
    computedAt: new Date(r.computedAt ?? Date.now()).toISOString(),
  }));
}

async function spotlight(): Promise<DiscoverItem[]> {
  const lm = db
    .selectDistinctOn([gameMetrics.universeId], {
      universeId: gameMetrics.universeId,
      playing: gameMetrics.playing,
    })
    .from(gameMetrics)
    .orderBy(gameMetrics.universeId, desc(gameMetrics.capturedAt))
    .as("lm");

  const rows = await db
    .select({
      creatorId: creators.creatorId,
      name: creators.name,
      type: creators.type,
      gameCount: sql<number>`count(distinct ${games.universeId})::int`,
      totalCcu: sql<number>`coalesce(sum(${lm.playing}), 0)::int`,
    })
    .from(creators)
    .innerJoin(games, eq(games.creatorId, creators.creatorId))
    .leftJoin(lm, eq(lm.universeId, games.universeId))
    .groupBy(creators.creatorId, creators.name, creators.type)
    .orderBy(desc(sql`sum(${lm.playing})`))
    .limit(10);

  return rows.map((r) => ({
    creatorId: r.creatorId,
    name: r.name,
    type: r.type,
    gameCount: r.gameCount,
    carrierCount: r.gameCount,
    ccuGrowth: r.totalCcu,
    computedAt: new Date().toISOString(),
  }));
}

async function whitespace(): Promise<DiscoverItem[]> {
  // Vacancy: vocabulary axes/slugs carried by ≤1 tracked game — thin coverage,
  // a candidate for whitespace. carrierCount is the whole point here.
  const rows = await db
    .select({
      axis: tags.axis,
      slug: tags.slug,
      label: tags.label,
      carrierCount: sql<number>`count(${gameTags.universeId})::int`,
    })
    .from(tags)
    .leftJoin(gameTags, eq(gameTags.tagId, tags.id))
    .groupBy(tags.axis, tags.slug, tags.label)
    .having(sql`count(${gameTags.universeId}) <= 1`)
    .orderBy(sql`count(${gameTags.universeId}) asc`);

  return rows.map((r) => ({
    axis: r.axis,
    slug: r.slug,
    label: r.label,
    carrierCount: r.carrierCount,
    ccuGrowth: 0,
    computedAt: new Date().toISOString(),
  }));
}

async function patterns(): Promise<DiscoverItem[]> {
  // Co-occurring tag pairs across tracked games — the "pattern index".
  const rows = await db.execute<{
    axis_a: string;
    slug_a: string;
    axis_b: string;
    slug_b: string;
    carrier_count: number;
  }>(sql`
    select ta.axis as axis_a, ta.slug as slug_a,
           tb.axis as axis_b, tb.slug as slug_b,
           count(*)::int as carrier_count
    from ${gameTags} gta
    join ${gameTags} gtb on gtb.universe_id = gta.universe_id and gtb.tag_id > gta.tag_id
    join ${tags} ta on ta.id = gta.tag_id
    join ${tags} tb on tb.id = gtb.tag_id
    group by ta.axis, ta.slug, tb.axis, tb.slug
    having count(*) >= 2
    order by count(*) desc
    limit 25
  `);

  return rows.rows.map((r) => ({
    pair: [
      { axis: r.axis_a, slug: r.slug_a },
      { axis: r.axis_b, slug: r.slug_b },
    ],
    carrierCount: r.carrier_count,
    ccuGrowth: 0,
    computedAt: new Date().toISOString(),
  }));
}

export function getDiscover(surface: DiscoverSurface): Promise<DiscoverItem[]> {
  switch (surface) {
    case "trend-drift":
      return trendDrift();
    case "acceleration":
      return acceleration();
    case "spotlight":
      return spotlight();
    case "whitespace":
      return whitespace();
    case "patterns":
      return patterns();
  }
}
