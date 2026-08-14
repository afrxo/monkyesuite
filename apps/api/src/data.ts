// Global read queries. Pure data access → DTOs; no HTTP concerns here.
// Every function reads only GLOBAL-realm tables (plus game_notes, whose RLS
// policy self-limits to shared rows when no session is set). Aggregation lives
// in SQL, never in a big in-memory array (CLAUDE.md CPU strategy).

import {
  cohortStats,
  creators,
  demandSnapshots,
  demandTerms,
  devProducts,
  feedHealth,
  gameEvents,
  gameMetrics,
  gameNotes,
  gamePasses,
  gameStats,
  gameStatsLatest,
  games,
  gameTags,
  lifecycleEvents,
  sortSnapshots,
  tags,
  users,
} from "@monkyesuite/database";
import type {
  CohortBasis,
  DemandOverlay,
  FeedItem,
  FeedQuery,
  GameDetail,
  GameEvent,
  GameMetric,
  GameNote,
  GameStat,
  LifecycleEvent,
  MetricsQuery,
  Monetization,
  Paged,
  PulseCardGame,
  PulseFilter,
  PulsePayload,
  PulseSearchResult,
  PulseSort,
  PulseStage,
  SortSnapshot,
  Tag,
  TagAxis,
  TimeseriesQuery,
} from "@monkyesuite/shared";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  lt,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "./db.js";
import { iso, isoReq } from "./serialize.js";
import { type Tx, withUser } from "./tx.js";

/* --------------------------- shared sub-selects --------------------------- */

// Latest derived stats per game (distinct on universe_id, newest computed_at).
function latestStatsSub() {
  return db
    .selectDistinctOn([gameStats.universeId], {
      universeId: gameStats.universeId,
      computedAt: gameStats.computedAt,
      trendScore: gameStats.trendScore,
      velocity: gameStats.velocity,
      spikeScore: gameStats.spikeScore,
      lifecycle: gameStats.lifecycle,
    })
    .from(gameStats)
    .orderBy(gameStats.universeId, desc(gameStats.computedAt))
    .as("ls");
}

// Latest raw metric per game.
function latestMetricSub() {
  return db
    .selectDistinctOn([gameMetrics.universeId], {
      universeId: gameMetrics.universeId,
      capturedAt: gameMetrics.capturedAt,
      playing: gameMetrics.playing,
      visits: gameMetrics.visits,
      upVotes: gameMetrics.upVotes,
      downVotes: gameMetrics.downVotes,
      favoritedCount: gameMetrics.favoritedCount,
    })
    .from(gameMetrics)
    .orderBy(gameMetrics.universeId, desc(gameMetrics.capturedAt))
    .as("lm");
}

/* -------------------------------- feed ------------------------------------ */

export async function getFeed(q: FeedQuery): Promise<Paged<FeedItem>> {
  const ls = latestStatsSub();
  const lm = latestMetricSub();

  const filters: SQL[] = [eq(games.isTracked, true)];
  if (q.genre) filters.push(eq(games.robloxGenre, q.genre));
  if (q.lifecycle) filters.push(eq(ls.lifecycle, q.lifecycle));
  const where = and(...filters);

  const orderBy = ((): SQL => {
    switch (q.sort) {
      case "ccu":
        return sql`${lm.playing} desc nulls last`;
      case "velocity":
        return sql`${ls.velocity} desc nulls last`;
      case "spike":
        return sql`${ls.spikeScore} desc nulls last`;
      case "newest":
        return sql`${games.firstSeenAt} desc nulls last`;
      default:
        return sql`${ls.trendScore} desc nulls last`;
    }
  })();

  const offset = (q.page - 1) * q.pageSize;

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        universeId: games.universeId,
        name: games.name,
        iconUrl: games.iconUrl,
        robloxGenre: games.robloxGenre,
        creatorName: games.creatorName,
        currentSort: games.currentSort,
        currentSortRank: games.currentSortRank,
        mCapturedAt: lm.capturedAt,
        mPlaying: lm.playing,
        mVisits: lm.visits,
        mUpVotes: lm.upVotes,
        mDownVotes: lm.downVotes,
        mFavoritedCount: lm.favoritedCount,
        sComputedAt: ls.computedAt,
        sTrendScore: ls.trendScore,
        sVelocity: ls.velocity,
        sSpikeScore: ls.spikeScore,
        sLifecycle: ls.lifecycle,
      })
      .from(games)
      .leftJoin(ls, eq(ls.universeId, games.universeId))
      .leftJoin(lm, eq(lm.universeId, games.universeId))
      .where(where)
      .orderBy(orderBy)
      .limit(q.pageSize)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(games)
      .leftJoin(ls, eq(ls.universeId, games.universeId))
      .where(where),
  ]);

  const items: FeedItem[] = rows.map((r) => ({
    universeId: r.universeId,
    name: r.name,
    iconUrl: r.iconUrl,
    robloxGenre: r.robloxGenre,
    creatorName: r.creatorName,
    currentSort: r.currentSort,
    currentSortRank: r.currentSortRank,
    latestMetric: r.mCapturedAt
      ? {
          playing: r.mPlaying,
          visits: r.mVisits,
          upVotes: r.mUpVotes,
          downVotes: r.mDownVotes,
          favoritedCount: r.mFavoritedCount,
          capturedAt: isoReq(r.mCapturedAt),
        }
      : null,
    latestStats: r.sComputedAt
      ? {
          trendScore: r.sTrendScore,
          velocity: r.sVelocity,
          spikeScore: r.sSpikeScore,
          lifecycle: r.sLifecycle,
          computedAt: isoReq(r.sComputedAt),
        }
      : null,
  }));

  return {
    items,
    page: q.page,
    pageSize: q.pageSize,
    total: totalRow[0]?.total ?? 0,
  };
}

/* ----------------------------- game detail -------------------------------- */

function mapStat(row: typeof gameStats.$inferSelect): GameStat {
  return {
    computedAt: isoReq(row.computedAt),
    trendScore: row.trendScore,
    velocity: row.velocity,
    spikeScore: row.spikeScore,
    lifecycle: row.lifecycle,
    ccuSlope7d: row.ccuSlope7d,
    ccuSlope28d: row.ccuSlope28d,
    ccuMean24h: row.ccuMean24h,
    troughPeakRatio: row.troughPeakRatio,
    likeRatio: row.likeRatio,
    favoritesPerVisit: row.favoritesPerVisit,
    daysSinceUpdate: row.daysSinceUpdate,
    updatesPer28d: row.updatesPer28d,
    genrePercentile: row.genrePercentile,
  };
}

export async function getGameDetail(
  universeId: number,
): Promise<GameDetail | null> {
  const [game] = await db
    .select()
    .from(games)
    .where(eq(games.universeId, universeId))
    .limit(1);
  if (!game) return null;

  const [creator] = game.creatorId
    ? await db
        .select()
        .from(creators)
        .where(eq(creators.creatorId, game.creatorId))
        .limit(1)
    : [];
  const [stat] = await db
    .select()
    .from(gameStats)
    .where(eq(gameStats.universeId, universeId))
    .orderBy(desc(gameStats.computedAt))
    .limit(1);

  return {
    universeId: game.universeId,
    rootPlaceId: game.rootPlaceId,
    name: game.name,
    description: game.description,
    robloxGenre: game.robloxGenre,
    creator: creator
      ? {
          creatorId: creator.creatorId,
          type: creator.type,
          name: creator.name,
          hasVerifiedBadge: creator.hasVerifiedBadge,
          memberCount: creator.memberCount,
        }
      : null,
    createdAt: iso(game.createdAt),
    updatedAt: iso(game.updatedAt),
    firstSeenAt: isoReq(game.firstSeenAt),
    lastSeenAt: isoReq(game.lastSeenAt),
    isTracked: game.isTracked,
    currentSort: game.currentSort,
    currentSortRank: game.currentSortRank,
    iconUrl: game.iconUrl,
    maxPlayers: game.maxPlayers,
    playableDevices: game.playableDevices,
    supportedLanguages: game.supportedLanguages,
    ageRecommendation: game.ageRecommendation,
    descriptors: game.descriptors,
    latestStats: stat ? mapStat(stat) : null,
  };
}

export async function gameExists(universeId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: games.universeId })
    .from(games)
    .where(eq(games.universeId, universeId))
    .limit(1);
  return row !== undefined;
}

/* ------------------------------ time series ------------------------------- */

function rangeFilters(col: AnyPgColumn, q: TimeseriesQuery): SQL[] {
  const f: SQL[] = [];
  if (q.from) f.push(gte(col, new Date(q.from)));
  if (q.to) f.push(lte(col, new Date(q.to)));
  return f;
}

export async function getMetrics(
  universeId: number,
  q: MetricsQuery,
): Promise<Paged<GameMetric>> {
  const where = and(
    eq(gameMetrics.universeId, universeId),
    ...rangeFilters(gameMetrics.capturedAt, q),
  );
  const offset = (q.page - 1) * q.pageSize;

  if (q.interval === "raw") {
    const [rows, totalRow] = await Promise.all([
      db
        .select({
          capturedAt: gameMetrics.capturedAt,
          playing: gameMetrics.playing,
          visits: gameMetrics.visits,
          favoritedCount: gameMetrics.favoritedCount,
          upVotes: gameMetrics.upVotes,
          downVotes: gameMetrics.downVotes,
          activeEvent: gameMetrics.activeEvent,
        })
        .from(gameMetrics)
        .where(where)
        .orderBy(asc(gameMetrics.capturedAt))
        .limit(q.pageSize)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(gameMetrics)
        .where(where),
    ]);
    const items: GameMetric[] = rows.map((r) => ({
      capturedAt: isoReq(r.capturedAt),
      playing: r.playing,
      visits: r.visits,
      favoritedCount: r.favoritedCount,
      upVotes: r.upVotes,
      downVotes: r.downVotes,
      activeEvent: r.activeEvent,
    }));
    return {
      items,
      page: q.page,
      pageSize: q.pageSize,
      total: totalRow[0]?.total ?? 0,
    };
  }

  // Bucketed: average the raw series into hour/day buckets in SQL. Group/order
  // by the select ordinal, not a second copy of the bucket expression: a
  // parameterized date_trunc() in both SELECT and GROUP BY binds distinct
  // placeholders, so Postgres won't treat them as the same expression.
  const bucket = sql`date_trunc(${q.interval}, ${gameMetrics.capturedAt})`;
  const [rows, totalRow] = await Promise.all([
    db
      .select({
        capturedAt: sql<string>`${bucket}`.as("bucket"),
        playing: sql<number | null>`round(avg(${gameMetrics.playing}))::int`,
        // pg returns max(bigint) as a string; coerced to number below.
        visits: sql<string | null>`max(${gameMetrics.visits})`,
        favoritedCount: sql<string | null>`max(${gameMetrics.favoritedCount})`,
        upVotes: sql<string | null>`max(${gameMetrics.upVotes})`,
        downVotes: sql<string | null>`max(${gameMetrics.downVotes})`,
        activeEvent: sql<boolean | null>`bool_or(${gameMetrics.activeEvent})`,
      })
      .from(gameMetrics)
      .where(where)
      .groupBy(sql`1`)
      .orderBy(sql`1 asc`)
      .limit(q.pageSize)
      .offset(offset),
    db
      .select({ total: sql<number>`count(distinct ${bucket})::int` })
      .from(gameMetrics)
      .where(where),
  ]);
  const num = (v: string | null): number | null =>
    v === null ? null : Number(v);
  const items: GameMetric[] = rows.map((r) => ({
    capturedAt: new Date(r.capturedAt).toISOString(),
    playing: r.playing,
    visits: num(r.visits),
    favoritedCount: num(r.favoritedCount),
    upVotes: num(r.upVotes),
    downVotes: num(r.downVotes),
    activeEvent: r.activeEvent,
  }));
  return {
    items,
    page: q.page,
    pageSize: q.pageSize,
    total: totalRow[0]?.total ?? 0,
  };
}

export async function getStatsHistory(
  universeId: number,
  q: TimeseriesQuery,
): Promise<Paged<GameStat>> {
  const where = and(
    eq(gameStats.universeId, universeId),
    ...rangeFilters(gameStats.computedAt, q),
  );
  const offset = (q.page - 1) * q.pageSize;
  const [rows, totalRow] = await Promise.all([
    db
      .select()
      .from(gameStats)
      .where(where)
      .orderBy(asc(gameStats.computedAt))
      .limit(q.pageSize)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(gameStats)
      .where(where),
  ]);
  return {
    items: rows.map(mapStat),
    page: q.page,
    pageSize: q.pageSize,
    total: totalRow[0]?.total ?? 0,
  };
}

export async function getLifecycleEvents(
  universeId: number,
): Promise<LifecycleEvent[]> {
  const rows = await db
    .select()
    .from(lifecycleEvents)
    .where(eq(lifecycleEvents.universeId, universeId))
    .orderBy(desc(lifecycleEvents.detectedAt));
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    detectedAt: isoReq(r.detectedAt),
    magnitude: r.magnitude,
    meta: r.meta,
  }));
}

export async function getSorts(universeId: number): Promise<SortSnapshot[]> {
  const rows = await db
    .select()
    .from(sortSnapshots)
    .where(eq(sortSnapshots.universeId, universeId))
    .orderBy(asc(sortSnapshots.capturedAt));
  return rows.map((r) => ({
    sortName: r.sortName,
    rank: r.rank,
    capturedAt: isoReq(r.capturedAt),
  }));
}

export async function getEvents(universeId: number): Promise<GameEvent[]> {
  const rows = await db
    .select()
    .from(gameEvents)
    .where(eq(gameEvents.universeId, universeId))
    .orderBy(desc(gameEvents.startUtc));
  return rows.map((r) => ({
    eventId: r.eventId,
    title: r.title,
    subtitle: r.subtitle,
    tagline: r.tagline,
    startUtc: iso(r.startUtc),
    endUtc: iso(r.endUtc),
    hostId: r.hostId,
    hostName: r.hostName,
    categories: r.categories,
    thumbnailUrl: r.thumbnailUrl,
    status: r.status,
    createdUtc: iso(r.createdUtc),
    updatedUtc: iso(r.updatedUtc),
  }));
}

export async function getMonetization(
  universeId: number,
): Promise<Monetization> {
  const [passes, products] = await Promise.all([
    db
      .select()
      .from(gamePasses)
      .where(eq(gamePasses.universeId, universeId))
      .orderBy(desc(gamePasses.priceRobux)),
    db
      .select()
      .from(devProducts)
      .where(eq(devProducts.universeId, universeId))
      .orderBy(desc(devProducts.priceRobux)),
  ]);
  return {
    passes: passes.map((p) => ({
      passId: p.passId,
      name: p.name,
      priceRobux: p.priceRobux,
      refreshedAt: isoReq(p.refreshedAt),
    })),
    products: products.map((p) => ({
      productId: p.productId,
      name: p.name,
      priceRobux: p.priceRobux,
      refreshedAt: isoReq(p.refreshedAt),
    })),
  };
}

export async function getDemand(universeId: number): Promise<DemandOverlay> {
  const terms = await db
    .select()
    .from(demandTerms)
    .where(
      and(
        eq(demandTerms.universeId, universeId),
        eq(demandTerms.isActive, true),
      ),
    );
  const overlay: DemandOverlay = { terms: [] };
  for (const t of terms) {
    const snaps = await db
      .select()
      .from(demandSnapshots)
      .where(eq(demandSnapshots.termId, t.id))
      .orderBy(asc(demandSnapshots.capturedAt));

    // The heating flag (§4.3): compare the latest external view-velocity against
    // the matched on-platform CCU slope. The comparison slope is the matched
    // game's 7-day slope (game-term) or the genre aggregate (theme-term); it is
    // null where no valid on-platform match exists, in which case the flag is
    // uncomputable and the term surfaces unflagged for curation.
    const matchedCcuSlope =
      t.universeId != null
        ? await gameCcuSlope(t.universeId)
        : t.genreLabel != null
          ? await genreCcuSlope(t.genreLabel)
          : null;
    const extVelocity = snaps.at(-1)?.ytViewDelta7d ?? null;
    const heating =
      extVelocity != null && matchedCcuSlope != null
        ? extVelocity > 0 && matchedCcuSlope <= 0
        : null;

    overlay.terms.push({
      term: t.term,
      kind: t.kind,
      genreLabel: t.genreLabel,
      snapshots: snaps.map((s) => ({
        capturedAt: isoReq(s.capturedAt),
        ytVideoCount7d: s.ytVideoCount7d,
        ytViewDelta7d: s.ytViewDelta7d,
        trendsScore: s.trendsScore,
      })),
      heating,
      matchedCcuSlope,
    });
  }
  return overlay;
}

/**
 * gameCcuSlope — the matched game's latest 7-day CCU slope, the on-platform
 * comparison for a game-term's heating flag. null when the game has no derived
 * stats yet.
 */
async function gameCcuSlope(universeId: number): Promise<number | null> {
  const [stat] = await db
    .select({ ccuSlope7d: gameStats.ccuSlope7d })
    .from(gameStats)
    .where(eq(gameStats.universeId, universeId))
    .orderBy(desc(gameStats.computedAt))
    .limit(1);
  return stat?.ccuSlope7d ?? null;
}

/**
 * genreCcuSlope — the genre-aggregate 7-day CCU slope for a theme-term: the mean
 * latest slope across games in that Roblox genre (aggregation in SQL, not in a
 * JS array). null when no game in the genre has a slope yet.
 */
async function genreCcuSlope(genreLabel: string): Promise<number | null> {
  const latest = db
    .selectDistinctOn([gameStats.universeId], {
      universeId: gameStats.universeId,
      ccuSlope7d: gameStats.ccuSlope7d,
    })
    .from(gameStats)
    .orderBy(gameStats.universeId, desc(gameStats.computedAt))
    .as("latest");
  const [row] = await db
    .select({ slope: sql<number | null>`avg(${latest.ccuSlope7d})` })
    .from(latest)
    .innerJoin(games, eq(games.universeId, latest.universeId))
    .where(eq(games.robloxGenre, genreLabel));
  return row?.slope ?? null;
}

/* --------------------------------- tags ----------------------------------- */

export async function getTags(axis?: TagAxis): Promise<Tag[]> {
  const rows = await db
    .select()
    .from(tags)
    .where(axis ? eq(tags.axis, axis) : undefined)
    .orderBy(asc(tags.axis), asc(tags.label));
  return rows.map((r) => ({
    id: r.id,
    axis: r.axis,
    slug: r.slug,
    label: r.label,
    description: r.description,
  }));
}

export async function getGameTags(universeId: number): Promise<Tag[]> {
  const rows = await db
    .select({
      id: tags.id,
      axis: tags.axis,
      slug: tags.slug,
      label: tags.label,
      description: tags.description,
    })
    .from(gameTags)
    .innerJoin(tags, eq(tags.id, gameTags.tagId))
    .where(eq(gameTags.universeId, universeId))
    .orderBy(asc(tags.axis), asc(tags.label));
  return rows;
}

/* ------------------------------ game notes -------------------------------- */

// Global/optional read. With no session set, the game_notes RLS policy returns
// shared notes only. Signed-in (userId set): run inside a withUser tx so the
// game_notes_select RLS policy also returns the caller's own private notes, and
// flip isOwn. Never returns another user's private note either way.
export async function getGameNotes(
  universeId: number,
  userId?: string,
): Promise<GameNote[]> {
  const query = (runner: typeof db | Tx) =>
    runner
      .select({
        id: gameNotes.id,
        universeId: gameNotes.universeId,
        authorId: gameNotes.authorId,
        authorName: users.name,
        body: gameNotes.body,
        visibility: gameNotes.visibility,
        createdAt: gameNotes.createdAt,
        updatedAt: gameNotes.updatedAt,
      })
      .from(gameNotes)
      .leftJoin(users, eq(users.id, gameNotes.authorId))
      .where(eq(gameNotes.universeId, universeId))
      .orderBy(desc(gameNotes.createdAt));

  const rows = userId
    ? await withUser(userId, (tx) => query(tx))
    : await query(db);
  return rows.map((r) => ({
    id: r.id,
    universeId: r.universeId,
    authorId: r.authorId,
    authorName: r.authorName,
    body: r.body,
    visibility: r.visibility,
    isOwn: userId ? r.authorId === userId : false,
    createdAt: isoReq(r.createdAt),
    updatedAt: isoReq(r.updatedAt),
  }));
}

/* --------------------------------- pulse ---------------------------------- */

// Bounded by tlw's page shape. Kept server-side (not a query param) so a
// misconfigured client cannot ask for the whole table.
const PULSE_LIMIT = 24;
// Match tlw's Ln-scaled compound rank when sort=spike:
//   (spike + min(trend*3, spike*0.5)) * ln(latestCcu + 1)
// Rendered as raw SQL because we want the planner to sort on the expression
// without materializing intermediates.
function pulseSpikeOrder(): SQL {
  return sql`(${gameStatsLatest.spikeScore} + least(${gameStatsLatest.trendScore} * 3, ${gameStatsLatest.spikeScore} * 0.5)) * ln(${gameStatsLatest.latestCcu} + 1) desc nulls last`;
}
function pulseOrder(sort: PulseSort): SQL {
  switch (sort) {
    case "trend":
      return sql`${gameStatsLatest.trendScore} desc nulls last`;
    case "ccu":
      return sql`${gameStatsLatest.latestCcu} desc nulls last`;
    case "velocity":
      return sql`${gameStatsLatest.delta24hPct} desc nulls last`;
    case "newest":
      return sql`${games.createdAt} desc nulls last`;
    default:
      return pulseSpikeOrder();
  }
}

// Filter gates mirror tlw's loadFeed. Guards against near-empty pages: the
// "all" filter falls back to top-by-CCU when strict gates would yield <6 rows.
function pulseFilters(filter: PulseFilter): SQL[] {
  const strict: SQL[] = [];
  switch (filter) {
    case "new":
      strict.push(
        gte(games.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
        gte(gameStatsLatest.latestCcu, 100),
        ne(gameStatsLatest.pulseStage, "declining"),
      );
      break;
    case "growing":
      strict.push(
        eq(gameStatsLatest.pulseStage, "growing"),
        gte(gameStatsLatest.latestCcu, 200),
        lt(gameStatsLatest.latestCcu, 25_000),
        gte(gameStatsLatest.delta24hPct, 15),
        gte(games.firstSeenAt, new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)),
      );
      break;
    case "peaking":
      strict.push(
        eq(gameStatsLatest.pulseStage, "peaking"),
        gte(gameStatsLatest.latestCcu, 200),
        gte(gameStatsLatest.spikeScore, 1.4),
      );
      break;
    case "declining":
      strict.push(
        eq(gameStatsLatest.pulseStage, "declining"),
        gte(gameStatsLatest.latestCcu, 200),
      );
      break;
    default:
      strict.push(
        gte(gameStatsLatest.latestCcu, 500),
        gte(gameStatsLatest.spikeScore, 1.15),
      );
      break;
  }
  return strict;
}

export async function getPulse(
  filter: PulseFilter,
  sort: PulseSort,
): Promise<PulsePayload> {
  const baseSelect = () =>
    db
      .select({
        universeId: gameStatsLatest.universeId,
        name: games.name,
        createdAt: games.createdAt,
        firstSeenAt: games.firstSeenAt,
        genre: games.robloxGenre,
        iconUrl: games.iconUrl,
        currentSort: games.currentSort,
        currentSortRank: games.currentSortRank,
        creatorName: creators.name,
        creatorVerified: creators.hasVerifiedBadge,
        computedAt: gameStatsLatest.computedAt,
        latestCcu: gameStatsLatest.latestCcu,
        trendScore: gameStatsLatest.trendScore,
        velocity: gameStatsLatest.velocity,
        spikeScore: gameStatsLatest.spikeScore,
        pulseStage: gameStatsLatest.pulseStage,
        spark: gameStatsLatest.spark,
        delta24hPct: gameStatsLatest.delta24hPct,
        velocityChange24hPct: gameStatsLatest.velocityChange24hPct,
        annotation: gameStatsLatest.annotation,
        velocityPctInCohort: cohortStats.velocityPctInCohort,
        cohortBasis: cohortStats.cohortBasis,
        cohortSize: cohortStats.cohortSize,
      })
      .from(gameStatsLatest)
      .innerJoin(games, eq(games.universeId, gameStatsLatest.universeId))
      .leftJoin(creators, eq(creators.creatorId, games.creatorId))
      .leftJoin(
        cohortStats,
        eq(cohortStats.universeId, gameStatsLatest.universeId),
      );

  let rows = await baseSelect()
    .where(and(...pulseFilters(filter)))
    .orderBy(pulseOrder(sort))
    .limit(PULSE_LIMIT);

  // Fallback identical to tlw: quiet Roblox stretch / narrow gate → surface
  // top games by current CCU rather than an empty page.
  if (rows.length < 6 && filter === "all") {
    rows = await baseSelect()
      .orderBy(sql`${gameStatsLatest.latestCcu} desc nulls last`)
      .limit(PULSE_LIMIT);
  }

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const games24: PulseCardGame[] = rows.map((r) => ({
    id: Number(r.universeId),
    name: r.name,
    creatorName: r.creatorName ?? "Unknown studio",
    creatorVerified: r.creatorVerified ?? false,
    genre: r.genre,
    thumbnail: r.iconUrl,
    ccu: r.latestCcu,
    ccu24hAgo:
      r.delta24hPct !== null && r.latestCcu > 0
        ? Math.round(r.latestCcu / (1 + r.delta24hPct / 100))
        : null,
    velocity: r.velocity !== null ? Math.round(r.velocity) : 0,
    spike: r.spikeScore,
    trendScore: r.trendScore,
    lifecycle: (r.pulseStage as PulseStage | null) ?? null,
    reason: r.annotation ?? "",
    spark: Array.isArray(r.spark) ? (r.spark as number[]) : [],
    currentSort: r.currentSort,
    currentSortRank: r.currentSortRank,
    createdAtMs: r.createdAt ? r.createdAt.getTime() : null,
    trackingDays: Math.max(
      0,
      Math.floor((now - r.firstSeenAt.getTime()) / dayMs),
    ),
    velocityPctInCohort: r.velocityPctInCohort,
    cohortBasis: (r.cohortBasis as CohortBasis | null) ?? null,
    cohortSize: r.cohortSize ?? 0,
    velocityChange24hPct: r.velocityChange24hPct,
    delta24hPct: r.delta24hPct,
  }));

  // Second read: singleton feed_health. Missing row → zero-filled payload +
  // degradedMode=true so pulse's rail hides distribution/transitions until
  // derive has run at least once (early boot).
  const healthRow = await db
    .select()
    .from(feedHealth)
    .where(eq(feedHealth.id, 1))
    .limit(1);
  const health = healthRow[0];

  const trackedCcu = games24.reduce((s, g) => s + g.ccu, 0);
  const movers = games24.filter(
    (g) =>
      g.lifecycle === "peaking" ||
      (g.lifecycle === "growing" && (g.trendScore ?? -Infinity) >= 0.05),
  ).length;
  const new48h = games24.filter((g) => g.lifecycle === "new").length;

  return {
    games: games24,
    hero: { trackedCcu, movers, new48h },
    liveSince: health?.liveSince ? health.liveSince.getTime() : now,
    rail: {
      signal: null,
      distribution: {
        new: health?.distributionNew ?? 0,
        growing: health?.distributionGrowing ?? 0,
        peaking: health?.distributionPeaking ?? 0,
        declining: health?.distributionDeclining ?? 0,
      },
      transitions6h: {
        toNew: health?.transitionsToNew6h ?? 0,
        toGrowing: health?.transitionsToGrowing6h ?? 0,
        toPeaking: health?.transitionsToPeaking6h ?? 0,
        toDeclining: health?.transitionsToDeclining6h ?? 0,
      },
    },
    degradedMode: health?.degradedMode ?? true,
  };
}

/* -------------------------------- search ---------------------------------- */

// Search over games+creators by name substring. Rank prefix > substring so a
// game named "Blox Fruits" surfaces before a game whose creator name contains
// "blox". Capped at 8; auth-gated same as pulse.
export async function getPulseSearch(q: string): Promise<PulseSearchResult[]> {
  const trimmed = q.trim();
  if (trimmed.length < 2) return [];
  const pattern = `%${trimmed}%`;
  const prefix = `${trimmed}%`;
  const rank = sql<number>`case
    when lower(${games.name}) like lower(${prefix}) then 3
    when lower(${games.name}) like lower(${pattern}) then 2
    else 1
  end`;
  const rows = await db
    .select({
      universeId: gameStatsLatest.universeId,
      name: games.name,
      genre: games.robloxGenre,
      iconUrl: games.iconUrl,
      creatorName: creators.name,
      latestCcu: gameStatsLatest.latestCcu,
      pulseStage: gameStatsLatest.pulseStage,
    })
    .from(games)
    .innerJoin(
      gameStatsLatest,
      eq(gameStatsLatest.universeId, games.universeId),
    )
    .leftJoin(creators, eq(creators.creatorId, games.creatorId))
    .where(or(ilike(games.name, pattern), ilike(creators.name, pattern)))
    .orderBy(desc(rank), desc(gameStatsLatest.latestCcu))
    .limit(8);

  return rows.map((r) => ({
    id: Number(r.universeId),
    name: r.name,
    creatorName: r.creatorName ?? "Unknown studio",
    genre: r.genre,
    thumbnail: r.iconUrl,
    ccu: r.latestCcu,
    lifecycle: (r.pulseStage as PulseStage | null) ?? null,
  }));
}
