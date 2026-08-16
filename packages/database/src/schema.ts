/**
 * monkyesuite — database schema (Drizzle ORM / Postgres)
 * packages/database/src/schema.ts
 *
 * Two realms live in one database, separated by a single rule:
 *   GLOBAL tables       — scraped once, shared by everyone, no RLS.
 *   PROJECT-SCOPED      — gated by project membership, RLS enforced.
 *
 * Five keys carry the whole system: universeId, userId, capturedAt (date),
 * term, and a synthetic id for scoped rows. Get those stamped consistently
 * and every cross-domain question becomes a join.
 *
 * RLS note: Railway Postgres has no built-in auth context (unlike Supabase's
 * auth.uid()). The API sets the current user per transaction with:
 *     SET LOCAL app.current_user_id = '<uuid>';
 * Policies below read current_setting('app.current_user_id', true).
 * The API membership check is the primary gate; RLS is the backstop.
 */

import { sql, relations } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  pgPolicy,
  type AnyPgColumn,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  doublePrecision,
  jsonb,
  uuid,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/* -------------------------------------------------------------------------- */
/*  Enums                                                                      */
/* -------------------------------------------------------------------------- */

export const tagAxis = pgEnum("tag_axis", [
  "genre", // what it is           (tycoon, simulator, obby, tower_defense, rpg)
  "mechanic", // what you do          (collect, fight, build, trade, roll)
  "progression", // how you advance      (rebirth, unlock_tree, gacha, level_grind, collection)
  "social", // how players interact (coop, pvp, trading, guilds, solo)
  "monetization", // how it charges       (gamepass, gacha, ugc, cosmetics, subscription)
]);

export const lifecycleStage = pgEnum("lifecycle_stage", [
  "launching",
  "growing",
  "stable",
  "cooling",
  "declining",
  "dormant",
  "revived",
]);

// Pulse-page lifecycle taxonomy. Distinct from the 7-stage classifier above,
// which is a scientific/analytical grouping; pulse rolls those into a compact
// 4-bucket feed model tuned for the "what's moving right now" surface.
// Populated alongside `lifecycle` in the derive pass — mapping lives in derive,
// not in a view, so the reasoning is explicit and cheap to change.
export const pulseStage = pgEnum("pulse_stage", [
  "new",
  "growing",
  "peaking",
  "declining",
]);

// Cohort basis for cohort_stats. "genre" = grouped by robloxGenre; "global"
// = whole-population percentile (used when a game has no genre bucket).
export const cohortBasis = pgEnum("cohort_basis", ["genre", "global"]);

export const lifecycleEventType = pgEnum("lifecycle_event_type", [
  "launch",
  "spike",
  "cooldown",
  "decline",
  "revival",
  "death",
  "sort_appearance", // entered a Roblox discovery sort (debounced 24h)
  "sort_exit", // dropped out of all sorts
  "update_shipped", // a virtual event went live / a game update landed
]);

export const demandKind = pgEnum("demand_kind", ["game", "theme"]);

// Game notes are user-authored and live in the GLOBAL realm, so unlike scraped
// data they DO need an access rule: shared (whole team) or private (author only).
export const noteVisibility = pgEnum("note_visibility", ["shared", "private"]);

export const memberRole = pgEnum("member_role", ["owner", "member"]);

export const projectStatus = pgEnum("project_status", [
  "active",
  "paused",
  "shipped",
  "archived",
]);

// Board columns. Order here is the canonical left-to-right column order.
export const taskStatus = pgEnum("task_status", [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "done",
  "archived",
]);

export const taskPriority = pgEnum("task_priority", [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
]);

export const milestoneStatus = pgEnum("milestone_status", [
  "planned",
  "active",
  "done",
]);

// Card-detail activity feed event kinds (specs/08-web card modal). Append-only
// history rendered in the modal side column.
export const taskActivityKind = pgEnum("task_activity_kind", [
  "create",
  "status_change",
  "title_change",
  "assignee_change",
  "comment",
  "attachment",
  "checklist_add",
  "checklist_complete",
]);

/* ========================================================================== */
/*  GLOBAL REALM — scraped once, shared across all projects.                   */
/*  Scraped tables have no RLS. The one exception is game_notes (user-authored */
/*  content), which is global but access-controlled by author + visibility.    */
/* ========================================================================== */

/**
 * games — one row per tracked Roblox experience. Slowly-changing dimension.
 * Keyed on the Roblox universeId (the stable id; place ids can change).
 */
export const games = pgTable(
  "games",
  {
    universeId: bigint("universe_id", { mode: "number" }).primaryKey(),
    rootPlaceId: bigint("root_place_id", { mode: "number" }),
    name: text("name").notNull(),
    description: text("description"),
    creatorType: text("creator_type"), // "User" | "Group"
    creatorId: bigint("creator_id", { mode: "number" }),
    creatorName: text("creator_name"),
    robloxGenre: text("roblox_genre"), // Roblox's coarse native genre
    createdAt: timestamp("created_at", { withTimezone: true }), // Roblox-side creation
    updatedAt: timestamp("updated_at", { withTimezone: true }), // Roblox-side last update
    // tracking lifecycle on OUR side
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    isTracked: boolean("is_tracked").notNull().default(true),
    source: text("source"), // "charts" | "manual" | "discover"
    // discovery-sort state (from Explore API) — best rank across all sorts this tick
    currentSort: text("current_sort"), // e.g. "top-trending"; null when in no sort
    currentSortRank: integer("current_sort_rank"), // lowest (best) rank this tick
    lastSortSeen: timestamp("last_sort_seen", { withTimezone: true }), // debounce sort-appearance events
    // enrichment (daily fan-out) — place details + icon
    iconUrl: text("icon_url"),
    maxPlayers: integer("max_players"),
    playableDevices: jsonb("playable_devices"),
    supportedLanguages: jsonb("supported_languages"),
    ageRecommendation: text("age_recommendation"),
    descriptors: jsonb("descriptors"),
  },
  (t) => [
    index("games_updated_idx").on(t.updatedAt),
    index("games_genre_idx").on(t.robloxGenre),
    index("games_tracked_idx").on(t.isTracked),
    index("games_sort_idx").on(t.currentSort, t.currentSortRank),
    index("games_creator_idx").on(t.creatorId),
  ],
);

/**
 * game_metrics — the RAW landing layer. Immutable, append-only snapshots.
 * Nothing derived lives here. Idempotent on (universeId, capturedAt).
 */
export const gameMetrics = pgTable(
  "game_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universeId: bigint("universe_id", { mode: "number" })
      .notNull()
      .references(() => games.universeId, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    playing: integer("playing"), // CCU
    visits: bigint("visits", { mode: "number" }),
    favoritedCount: bigint("favorited_count", { mode: "number" }),
    upVotes: bigint("up_votes", { mode: "number" }),
    downVotes: bigint("down_votes", { mode: "number" }),
    hasVerifiedBadge: boolean("has_verified_badge"),
    activeEvent: boolean("active_event").default(false), // scheduled/live event flag
    raw: jsonb("raw"), // full untrimmed payload, for reprocessing
  },
  (t) => [
    uniqueIndex("game_metrics_universe_captured_uq").on(
      t.universeId,
      t.capturedAt,
    ),
    index("game_metrics_captured_idx").on(t.capturedAt),
  ],
);

/**
 * game_stats — DERIVED layer. Rebuilt from game_metrics by the derive job.
 * One row per game per compute tick (keep history so signals are auditable).
 */
export const gameStats = pgTable(
  "game_stats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universeId: bigint("universe_id", { mode: "number" })
      .notNull()
      .references(() => games.universeId, { onDelete: "cascade" }),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
    // headline signals
    trendScore: doublePrecision("trend_score"),
    velocity: doublePrecision("velocity"), // short-window CCU rate of change
    spikeScore: doublePrecision("spike_score"), // deviation vs own baseline
    lifecycle: lifecycleStage("lifecycle"),
    // pulse-feed signals (populated by derive; nullable during warm-up)
    pulseStage: pulseStage("pulse_stage"),
    spark: jsonb("spark"), // last-24h CCU sparkline as number[] (bounded ~24 pts)
    delta24hPct: doublePrecision("delta_24h_pct"), // (ccu_now - ccu_24h_ago) / ccu_24h_ago
    velocityChange24hPct: doublePrecision("velocity_change_24h_pct"),
    annotation: text("annotation"), // human-readable "why it's here" kicker
    // growth
    ccuSlope7d: doublePrecision("ccu_slope_7d"),
    ccuSlope28d: doublePrecision("ccu_slope_28d"),
    ccuMean24h: doublePrecision("ccu_mean_24h"),
    // retention proxies
    troughPeakRatio: doublePrecision("trough_peak_ratio"),
    likeRatio: doublePrecision("like_ratio"),
    favoritesPerVisit: doublePrecision("favorites_per_visit"),
    // cadence
    daysSinceUpdate: integer("days_since_update"),
    updatesPer28d: integer("updates_per_28d"),
    // cohort context
    genrePercentile: doublePrecision("genre_percentile"),
  },
  (t) => [
    uniqueIndex("game_stats_universe_computed_uq").on(
      t.universeId,
      t.computedAt,
    ),
    index("game_stats_lifecycle_idx").on(t.lifecycle),
    index("game_stats_trend_idx").on(t.trendScore),
  ],
);

/**
 * game_stats_latest — denormalized "current row" per universe, upserted by the
 * derive job at the end of every tick. Pulse reads exclusively from this table
 * so the hot path is a single indexed scan; history stays in `game_stats`.
 *
 * Idempotent on universeId (PK). Any column here is a mirror of the most recent
 * game_stats row's values, plus latestCcu carried forward from game_metrics so
 * pulse doesn't need to join the raw table at request time.
 */
export const gameStatsLatest = pgTable(
  "game_stats_latest",
  {
    universeId: bigint("universe_id", { mode: "number" })
      .primaryKey()
      .references(() => games.universeId, { onDelete: "cascade" }),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
    latestCcu: integer("latest_ccu").notNull().default(0),
    trendScore: doublePrecision("trend_score"),
    velocity: doublePrecision("velocity"),
    spikeScore: doublePrecision("spike_score"),
    lifecycle: lifecycleStage("lifecycle"),
    pulseStage: pulseStage("pulse_stage"),
    spark: jsonb("spark"),
    delta24hPct: doublePrecision("delta_24h_pct"),
    velocityChange24hPct: doublePrecision("velocity_change_24h_pct"),
    annotation: text("annotation"),
    genrePercentile: doublePrecision("genre_percentile"),
  },
  (t) => [
    // Pulse sort/filter indexes. Compound with latestCcu breaks ties + keeps
    // planner honest for the (spike desc, ccu desc) combined sort in tlw.
    index("gsl_spike_ccu_idx").on(t.spikeScore, t.latestCcu),
    index("gsl_trend_idx").on(t.trendScore),
    index("gsl_ccu_idx").on(t.latestCcu),
    index("gsl_delta_idx").on(t.delta24hPct),
    index("gsl_pulse_stage_idx").on(t.pulseStage),
    index("gsl_computed_idx").on(t.computedAt),
  ],
);

/**
 * cohort_stats — per-game percentile within its cohort (genre or global). One
 * row per universe, refreshed by derive alongside game_stats_latest.
 */
export const cohortStats = pgTable(
  "cohort_stats",
  {
    universeId: bigint("universe_id", { mode: "number" })
      .primaryKey()
      .references(() => games.universeId, { onDelete: "cascade" }),
    velocityPctInCohort: doublePrecision("velocity_pct_in_cohort"),
    cohortBasis: cohortBasis("cohort_basis"),
    cohortSize: integer("cohort_size").notNull().default(0),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

/**
 * feed_health — singleton snapshot of pulse-page aggregates, refreshed once
 * per derive tick. A single-row table (enforced by `id = 1`) so pulse reads it
 * with `select … from feed_health limit 1`, no aggregation at request time.
 */
export const feedHealth = pgTable("feed_health", {
  id: integer("id").primaryKey().default(1), // singleton
  distributionNew: integer("distribution_new").notNull().default(0),
  distributionGrowing: integer("distribution_growing").notNull().default(0),
  distributionPeaking: integer("distribution_peaking").notNull().default(0),
  distributionDeclining: integer("distribution_declining").notNull().default(0),
  transitionsToNew6h: integer("transitions_to_new_6h").notNull().default(0),
  transitionsToGrowing6h: integer("transitions_to_growing_6h").notNull().default(0),
  transitionsToPeaking6h: integer("transitions_to_peaking_6h").notNull().default(0),
  transitionsToDeclining6h: integer("transitions_to_declining_6h").notNull().default(0),
  firstTime10kToday: integer("first_time_10k_today").notNull().default(0),
  newGames48h: integer("new_games_48h").notNull().default(0),
  liveSince: timestamp("live_since", { withTimezone: true }).notNull().defaultNow(),
  degradedMode: boolean("degraded_mode").notNull().default(false),
});

/**
 * lifecycle_events — discrete detected transitions (spike, cooldown, death…).
 */
export const lifecycleEvents = pgTable(
  "lifecycle_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universeId: bigint("universe_id", { mode: "number" })
      .notNull()
      .references(() => games.universeId, { onDelete: "cascade" }),
    type: lifecycleEventType("type").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
    magnitude: doublePrecision("magnitude"),
    meta: jsonb("meta"),
  },
  (t) => [
    index("lifecycle_events_universe_idx").on(t.universeId),
    index("lifecycle_events_detected_idx").on(t.detectedAt),
  ],
);

/* ------------------------- Discovery & enrichment ------------------------- */

/**
 * creators — user/group dimension. Populated as new creators are first seen.
 */
export const creators = pgTable("creators", {
  creatorId: bigint("creator_id", { mode: "number" }).primaryKey(),
  type: text("type").notNull(), // "User" | "Group"
  name: text("name"),
  hasVerifiedBadge: boolean("has_verified_badge"),
  memberCount: integer("member_count"), // groups only
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * sort_snapshots — top-50 per Explore sort category per tick. Rank IS the data:
 * sort position is the discovery signal. Short retention (pruned ~24h).
 */
export const sortSnapshots = pgTable(
  "sort_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universeId: bigint("universe_id", { mode: "number" })
      .notNull()
      .references(() => games.universeId, { onDelete: "cascade" }),
    sortName: text("sort_name").notNull(), // e.g. "up-and-coming"
    rank: integer("rank").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("sort_snapshots_uq").on(t.universeId, t.sortName, t.capturedAt),
    index("sort_snapshots_captured_idx").on(t.capturedAt), // for pruning
    index("sort_snapshots_sort_idx").on(t.sortName, t.rank),
  ],
);

/**
 * game_events — Roblox virtual (in-game) events. Upserted; drives update_shipped.
 */
export const gameEvents = pgTable(
  "game_events",
  {
    eventId: text("event_id").primaryKey(),
    universeId: bigint("universe_id", { mode: "number" })
      .notNull()
      .references(() => games.universeId, { onDelete: "cascade" }),
    title: text("title"),
    subtitle: text("subtitle"),
    tagline: text("tagline"),
    startUtc: timestamp("start_utc", { withTimezone: true }),
    endUtc: timestamp("end_utc", { withTimezone: true }),
    hostId: bigint("host_id", { mode: "number" }),
    hostName: text("host_name"),
    categories: jsonb("categories"),
    thumbnailUrl: text("thumbnail_url"),
    status: text("status"),
    createdUtc: timestamp("created_utc", { withTimezone: true }),
    updatedUtc: timestamp("updated_utc", { withTimezone: true }),
  },
  (t) => [index("game_events_universe_idx").on(t.universeId)],
);

/**
 * game_passes / dev_products — monetization SKUs (gated data, via 3rd-party
 * proxy). Refreshed on the daily enrichment fan-out. Was a KV blob; now a table
 * so it's queryable for the monetization-pressure analysis.
 */
export const gamePasses = pgTable(
  "game_passes",
  {
    passId: bigint("pass_id", { mode: "number" }).primaryKey(),
    universeId: bigint("universe_id", { mode: "number" })
      .notNull()
      .references(() => games.universeId, { onDelete: "cascade" }),
    name: text("name"),
    priceRobux: integer("price_robux"),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("game_passes_universe_idx").on(t.universeId)],
);

export const devProducts = pgTable(
  "dev_products",
  {
    productId: bigint("product_id", { mode: "number" }).primaryKey(),
    universeId: bigint("universe_id", { mode: "number" })
      .notNull()
      .references(() => games.universeId, { onDelete: "cascade" }),
    name: text("name"),
    priceRobux: integer("price_robux"),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("dev_products_universe_idx").on(t.universeId)],
);

/**
 * creator_portfolio — a creator's other games (top by visits). Some rows may
 * reference games we don't track, so universeId here is NOT a FK to games.
 */
export const creatorPortfolio = pgTable(
  "creator_portfolio",
  {
    creatorId: bigint("creator_id", { mode: "number" })
      .notNull()
      .references(() => creators.creatorId, { onDelete: "cascade" }),
    universeId: bigint("universe_id", { mode: "number" }).notNull(),
    name: text("name"),
    visits: bigint("visits", { mode: "number" }),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.creatorId, t.universeId] })],
);

/**
 * enrich_jobs — the daily enrichment work queue (specs/01-ingestion.md §1.4).
 * The worker fans every tracked game/creator into rows here; a small goroutine
 * pool then claims them with `SELECT … FOR UPDATE SKIP LOCKED`, processes with a
 * retry budget, and dead-letters exhausted rows as `failed`. GLOBAL, worker-
 * owned, no RLS. `target_id` is polymorphic (a universeId or a creatorId per
 * `kind`), so it is intentionally NOT a foreign key.
 */
export const enrichJobs = pgTable(
  "enrich_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(), // "universe" | "creator"
    targetId: bigint("target_id", { mode: "number" }).notNull(),
    status: text("status").notNull().default("pending"), // pending|running|done|failed
    attempts: integer("attempts").notNull().default(0),
    runAfter: timestamp("run_after", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Why a row dead-lettered. `attempts` alone says a job gave up but not what
    // it hit, which makes a `failed` row unactionable in the admin queue panel
    // (specs/09 §9.4.2). Cleared on requeue.
    lastError: text("last_error"),
    // Touched on every status change, so the age of a `running` claim is
    // derivable — a claim older than a tick is a crash, not work in progress.
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // claim query: pending rows whose run_after is due, oldest first.
    index("enrich_jobs_claim_idx").on(t.status, t.runAfter),
  ],
);

/**
 * game_notes — user-authored notes ON a tracked game. GLOBAL (follows the game
 * across every project), but access-controlled by author + visibility:
 *   shared  → readable by anyone with tracker access
 *   private → readable/writable only by the author
 * This is the one global table that carries RLS, because it's user content,
 * not scraped data.
 */
export const gameNotes = pgTable(
  "game_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universeId: bigint("universe_id", { mode: "number" })
      .notNull()
      .references(() => games.universeId, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    visibility: noteVisibility("visibility").notNull().default("shared"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("game_notes_universe_idx").on(t.universeId, t.createdAt),
    index("game_notes_author_idx").on(t.authorId),
    // read: shared to all, private to author only
    pgPolicy("game_notes_select", {
      for: "select",
      using: sql`visibility = 'shared' or author_id = current_setting('app.current_user_id', true)`,
    }),
    // write: only the author may create/update/delete their own note
    pgPolicy("game_notes_write", {
      for: "all",
      using: sql`author_id = current_setting('app.current_user_id', true)`,
      withCheck: sql`author_id = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS();

/**
 * tags — controlled vocabulary. Adding a tag is a deliberate act.
 * Uniqueness on (axis, slug) prevents "pets" / "Pets" / "pet_system" drift.
 */
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    axis: tagAxis("axis").notNull(),
    slug: text("slug").notNull(), // machine key, e.g. "pets"
    label: text("label").notNull(), // display, e.g. "Pets"
    description: text("description"), // definition — a tag without one rots
    createdBy: text("created_by"), // users.id
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("tags_axis_slug_uq").on(t.axis, t.slug)],
);

/**
 * game_tags — join. Descriptive, not aspirational: records what a game HAS.
 * Carries who/when so multi-person tagging is traceable.
 */
export const gameTags = pgTable(
  "game_tags",
  {
    universeId: bigint("universe_id", { mode: "number" })
      .notNull()
      .references(() => games.universeId, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    addedBy: text("added_by"), // users.id
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.universeId, t.tagId] }),
    index("game_tags_tag_idx").on(t.tagId),
  ],
);

/* ----------------------- Off-platform demand (global) --------------------- */

/**
 * demand_terms — the hand-curated bridge between on-platform (universeId) and
 * off-platform (search string). kind="game" maps to a universeId; kind="theme"
 * maps to a genre label. This table IS the join between the two worlds.
 */
export const demandTerms = pgTable(
  "demand_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    term: text("term").notNull(),
    kind: demandKind("kind").notNull(),
    universeId: bigint("universe_id", { mode: "number" }).references(
      () => games.universeId,
      { onDelete: "set null" },
    ),
    genreLabel: text("genre_label"), // for kind="theme"
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("demand_terms_term_kind_uq").on(t.term, t.kind)],
);

/**
 * demand_snapshots — daily off-platform interest per term.
 */
export const demandSnapshots = pgTable(
  "demand_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    termId: uuid("term_id")
      .notNull()
      .references(() => demandTerms.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    ytVideoCount7d: integer("yt_video_count_7d"),
    ytViewDelta7d: bigint("yt_view_delta_7d", { mode: "number" }),
    trendsScore: doublePrecision("trends_score"), // 0-100, direction only
  },
  (t) => [
    uniqueIndex("demand_snapshots_term_captured_uq").on(
      t.termId,
      t.capturedAt,
    ),
  ],
);

/* ========================================================================== */
/*  IDENTITY — managed by Better Auth (its own tables). We reference user.id.  */
/*  Declared minimally here so FKs and RLS can point at it.                    */
/* ========================================================================== */

// Better Auth owns these four identity tables. JS property names below match
// Better Auth's field names exactly (id, emailVerified, createdAt, …) so its
// drizzle adapter maps without a field remap. They carry NO RLS: session lookup
// must succeed before any user context exists, so the app role reads them
// unfiltered. They are granted to the app role in roles.sql.
export const users = pgTable("users", {
  id: text("id").primaryKey(), // Better Auth user id
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // The GLOBAL admin role (specs/09 §9.1) — distinct from project owner/member,
  // which are per-project and confer nothing here. A flag rather than a
  // global_roles table: there is exactly one global role, the gate reads it on
  // every /admin request, and `users` carries no RLS so it resolves without a
  // policy. Set out of band by SQL only; no code path writes it (that would let
  // the panel escalate its own privilege).
  isAdmin: boolean("is_admin").notNull().default(false),
  // Closed-suite revocation (specs/06 §6.6). A revoked user is disabled, never
  // deleted — deleting would orphan game_notes.author_id, audit_log.actor_id,
  // and every created_by/assignee_id reference this user left behind. The
  // session resolver (apps/api/src/middleware.ts) treats a disabled user's
  // session as absent; revoking also deletes their `sessions` rows outright so
  // an already-open tab dies on its next request, not just on next sign-in.
  disabled: boolean("disabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"), // hashed; email/password provider
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

/* ========================================================================== */
/*  OPERATIONS REALM — worker telemetry + the admin control plane.             */
/*  GLOBAL (no RLS, no project_id). Declared after the identity block only     */
/*  because two of the three carry a users FK. specs/09-admin.md §9.6.         */
/*                                                                             */
/*  The worker exposes no HTTP: it is a tick loop, not a service. So every      */
/*  health number the admin panel reads is a row left behind here (job_runs),   */
/*  and every action it takes is a row the worker picks up (job_commands).      */
/*  Postgres is the whole control plane.                                        */
/* ========================================================================== */

/**
 * job_runs — one row per job execution, written by the scheduler (not by each
 * job), so a new job is instrumented by existing rather than by remembering.
 * Replaces slog as the queryable record: log lines can't be read from the API
 * and don't survive a restart.
 *
 * `metrics` carries the per-job counter contract in §9.6 (snapshot's
 * tracked/real/carried, discover's sortsOk/…, etc.) plus the Roblox call
 * counters every job records: callsIssued, callsSkipped, and an `endpoints`
 * map of {ok,fail,skipped} per endpoint group.
 */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job: text("job").notNull(), // discover|snapshot|events|enrich|enrich-drain|derive|trend-drift|demand
    tick: bigint("tick", { mode: "number" }).notNull(),
    // Which limiter pool the job drew from (specs/01 §1.0). This is what lets
    // the admin limiter panel verify the two-tier reservation holds under load:
    // enrich-tier skips are the design working, critical-tier skips are a bug.
    tier: text("tier").notNull(), // critical|enrich
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    status: text("status").notNull(), // ok|error|skipped
    rowsWritten: integer("rows_written").notNull().default(0),
    error: text("error"),
    metrics: jsonb("metrics").notNull().default({}),
  },
  (t) => [
    index("job_runs_job_started_idx").on(t.job, t.startedAt.desc()),
    index("job_runs_started_idx").on(t.startedAt.desc()),
  ],
);

/**
 * job_commands — the admin panel → worker channel (specs/09 §9.5).
 * The panel cannot run a job: the worker owns the tick loop. It inserts a
 * command row and the worker claims it at the top of its next tick with
 * `FOR UPDATE SKIP LOCKED` — the same pattern as enrich_jobs. Keep `kind` a
 * closed, small vocabulary; this is the only path into the worker.
 */
export const jobCommands = pgTable(
  "job_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(), // run_job
    job: text("job").notNull(),
    status: text("status").notNull().default("pending"), // pending|claimed|done|failed
    requestedBy: text("requested_by")
      .notNull()
      .references(() => users.id),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [index("job_commands_claim_idx").on(t.status, t.requestedAt)],
);

/**
 * audit_log — who did what, when, on the highest-privilege surface.
 * Written in the SAME transaction as the effect it records: an action that
 * succeeds without an audit row, or a row for an effect that rolled back, both
 * defeat the point. Also written for every 403 at the admin gate — attempted
 * access is the entry worth having.
 *
 * APPEND-ONLY, enforced by grant (select+insert only in roles.sql), not by
 * convention. `detail` holds named, whitelisted fields — NEVER a raw request
 * body, and never a secret value, password or invite token (§9.3b).
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(), // job.trigger|enrich.requeue|…|admin.denied
    target: text("target"), // affected id: universeId, job name, email, …
    detail: jsonb("detail").notNull().default({}),
    outcome: text("outcome").notNull(), // ok|error|denied
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_log_created_idx").on(t.createdAt.desc()),
    index("audit_log_actor_idx").on(t.actorId, t.createdAt.desc()),
  ],
);

/* ========================================================================== */
/*  PROJECT-SCOPED REALM — RLS enforced. Every table carries project_id.       */
/* ========================================================================== */

const authedInsert = sql`current_setting('app.current_user_id', true) is not null`;

/**
 * Membership predicates, centralized. These call SECURITY DEFINER functions
 * (defined in the migration, drizzle/0001_*.sql) rather than inlining an
 * `exists (select … from memberships …)`. Inlining recurses: a policy that
 * subqueries `memberships` re-triggers `memberships`'s own RLS policy forever.
 * The functions run as the table owner, so their membership lookup bypasses
 * RLS — no recursion — and `current_setting(..., true)` is NULL when unset,
 * so a missing session still fails closed (the functions return false).
 */
const memberOf = (project: AnyPgColumn) => sql`is_project_member(${project})`;
const ownerOf = (project: AnyPgColumn) => sql`is_project_owner(${project})`;

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    status: projectStatus("status").notNull().default("active"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("projects_slug_uq").on(t.slug),
    index("projects_status_idx").on(t.status),
    // RLS: read/update if member; insert if authenticated.
    pgPolicy("projects_select", {
      for: "select",
      using: memberOf(t.id),
    }),
    pgPolicy("projects_insert", {
      for: "insert",
      withCheck: authedInsert,
    }),
    pgPolicy("projects_update", {
      for: "update",
      using: ownerOf(t.id),
    }),
    pgPolicy("projects_delete", {
      for: "delete",
      using: ownerOf(t.id),
    }),
  ],
).enableRLS();

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_project_user_uq").on(t.projectId, t.userId),
    index("memberships_user_idx").on(t.userId),
    // a user may read membership rows for projects they belong to
    pgPolicy("memberships_select", {
      for: "select",
      using: memberOf(t.projectId),
    }),
    // writes to membership go through the API (owner-gated) — service role bypasses RLS
  ],
).enableRLS();

/**
 * milestones — phases within a build project ("prototype", "closed test",
 * "launch"). Tasks belong to at most one. This grouping is what makes the
 * board a build tracker rather than a flat list.
 */
export const milestones = pgTable(
  "milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: milestoneStatus("status").notNull().default("planned"),
    orderKey: text("order_key").notNull(), // fractional index for manual sort
    targetDate: timestamp("target_date", { withTimezone: true }),
    createdBy: text("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("milestones_project_idx").on(t.projectId),
    pgPolicy("milestones_member_rw", {
      for: "all",
      using: memberOf(t.projectId),
      withCheck: memberOf(t.projectId),
    }),
  ],
).enableRLS();

/**
 * tasks — board cards. `status` is the board column; `orderKey` is the manual
 * position within a (project, status) lane via fractional indexing, so a
 * drag-reorder rewrites one row, not the column. One level of subtasks via
 * self-referencing parentTaskId — no arbitrary nesting.
 */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    milestoneId: uuid("milestone_id").references(() => milestones.id, {
      onDelete: "set null",
    }),
    parentTaskId: uuid("parent_task_id"), // self-ref, one level only (see relations)
    title: text("title").notNull(),
    body: text("body"),
    status: taskStatus("status").notNull().default("backlog"),
    priority: taskPriority("priority").notNull().default("none"),
    orderKey: text("order_key").notNull(), // fractional index within (project,status)
    assigneeId: text("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // optional research link into the GLOBAL tracker (Reading B). A project
    // with zero links is valid (Reading A) — this is an attachment, not the point.
    universeId: bigint("universe_id", { mode: "number" }).references(
      () => games.universeId,
      { onDelete: "set null" },
    ),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    // Cover image: references a task_attachment id (no FK — avoids circular
    // dependency with task_attachments which already references tasks).
    coverAttachmentId: uuid("cover_attachment_id"),
  },
  (t) => [
    index("tasks_project_idx").on(t.projectId),
    // board queries fetch a project's lane and sort by orderKey
    index("tasks_board_idx").on(t.projectId, t.status, t.orderKey),
    index("tasks_milestone_idx").on(t.milestoneId),
    index("tasks_assignee_idx").on(t.assigneeId),
    index("tasks_parent_idx").on(t.parentTaskId),
    index("tasks_universe_idx").on(t.universeId),
    pgPolicy("tasks_member_rw", {
      for: "all",
      using: memberOf(t.projectId),
      withCheck: memberOf(t.projectId),
    }),
  ],
).enableRLS();

/**
 * docs — long-form project documents (specs, design notes, meeting notes),
 * distinct from the short pinned `notes` below.
 */
export const docs = pgTable(
  "docs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body"), // markdown
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("docs_project_idx").on(t.projectId),
    pgPolicy("docs_member_rw", {
      for: "all",
      using: memberOf(t.projectId),
      withCheck: memberOf(t.projectId),
    }),
  ],
).enableRLS();

/**
 * notes — short pinned notes, optionally attached to a tracked game (a quick
 * observation, a dated "call"). Long-form writing lives in `docs`.
 */
export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title"),
    body: text("body"),
    universeId: bigint("universe_id", { mode: "number" }).references(
      () => games.universeId,
      { onDelete: "set null" },
    ),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("notes_project_idx").on(t.projectId),
    index("notes_universe_idx").on(t.universeId),
    pgPolicy("notes_member_rw", {
      for: "all",
      using: memberOf(t.projectId),
      withCheck: memberOf(t.projectId),
    }),
  ],
).enableRLS();

/**
 * project_game — the ONLY bridge between scoped projects and global games.
 * Lets a project pin a curated watch-set from the shared tracker.
 */
export const projectGame = pgTable(
  "project_game",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    universeId: bigint("universe_id", { mode: "number" })
      .notNull()
      .references(() => games.universeId, { onDelete: "cascade" }),
    note: text("note"),
    addedBy: text("added_by").references(() => users.id),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.universeId] }),
    index("project_game_universe_idx").on(t.universeId),
    pgPolicy("project_game_member_rw", {
      for: "all",
      using: memberOf(t.projectId),
      withCheck: memberOf(t.projectId),
    }),
  ],
).enableRLS();

/**
 * task_comments — free-form markdown comments on a card. Author-only edits;
 * everyone with project membership can read/create.
 */
export const taskComments = pgTable(
  "task_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("task_comments_task_idx").on(t.taskId, t.createdAt),
    index("task_comments_project_idx").on(t.projectId),
    pgPolicy("task_comments_member_rw", {
      for: "all",
      using: memberOf(t.projectId),
      withCheck: memberOf(t.projectId),
    }),
  ],
).enableRLS();

/**
 * task_checklist_items — ordered subtasks under a card. `orderKey` is a
 * fractional index within a taskId, same pattern as tasks.orderKey.
 */
export const taskChecklistItems = pgTable(
  "task_checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    done: boolean("done").notNull().default(false),
    orderKey: text("order_key").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("task_checklist_task_idx").on(t.taskId, t.orderKey),
    index("task_checklist_project_idx").on(t.projectId),
    pgPolicy("task_checklist_member_rw", {
      for: "all",
      using: memberOf(t.projectId),
      withCheck: memberOf(t.projectId),
    }),
  ],
).enableRLS();

/**
 * task_attachments — file metadata for files stored in R2. r2Key is the
 * canonical opaque object key; presigned URLs are minted per read.
 */
export const taskAttachments = pgTable(
  "task_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => users.id),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    r2Key: text("r2_key").notNull(),
    thumbnailKey: text("thumbnail_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("task_attachments_r2_key_idx").on(t.r2Key),
    index("task_attachments_task_idx").on(t.taskId, t.createdAt),
    index("task_attachments_project_idx").on(t.projectId),
    pgPolicy("task_attachments_member_rw", {
      for: "all",
      using: memberOf(t.projectId),
      withCheck: memberOf(t.projectId),
    }),
  ],
).enableRLS();

/**
 * task_activity — append-only event feed for a card. payload is a jsonb with
 * event-shaped fields (old/new for changes, ids for referenced rows).
 */
export const taskActivity = pgTable(
  "task_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    kind: taskActivityKind("kind").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("task_activity_task_idx").on(t.taskId, t.createdAt),
    index("task_activity_project_idx").on(t.projectId),
    pgPolicy("task_activity_member_rw", {
      for: "all",
      using: memberOf(t.projectId),
      withCheck: memberOf(t.projectId),
    }),
  ],
).enableRLS();

/* -------------------------------------------------------------------------- */
/*  Relations                                                                  */
/* -------------------------------------------------------------------------- */

export const gamesRelations = relations(games, ({ many, one }) => ({
  metrics: many(gameMetrics),
  stats: many(gameStats),
  events: many(lifecycleEvents),
  tags: many(gameTags),
  virtualEvents: many(gameEvents),
  passes: many(gamePasses),
  devProducts: many(devProducts),
  notes: many(gameNotes),
  creator: one(creators, {
    fields: [games.creatorId],
    references: [creators.creatorId],
  }),
}));

export const creatorsRelations = relations(creators, ({ many }) => ({
  portfolio: many(creatorPortfolio),
}));

export const gameNotesRelations = relations(gameNotes, ({ one }) => ({
  game: one(games, {
    fields: [gameNotes.universeId],
    references: [games.universeId],
  }),
  author: one(users, {
    fields: [gameNotes.authorId],
    references: [users.id],
  }),
}));

export const gameTagsRelations = relations(gameTags, ({ one }) => ({
  game: one(games, {
    fields: [gameTags.universeId],
    references: [games.universeId],
  }),
  tag: one(tags, { fields: [gameTags.tagId], references: [tags.id] }),
}));

export const projectsRelations = relations(projects, ({ many }) => ({
  memberships: many(memberships),
  milestones: many(milestones),
  tasks: many(tasks),
  docs: many(docs),
  notes: many(notes),
  games: many(projectGame),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  project: one(projects, {
    fields: [memberships.projectId],
    references: [projects.id],
  }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}));

export const milestonesRelations = relations(milestones, ({ one, many }) => ({
  project: one(projects, {
    fields: [milestones.projectId],
    references: [projects.id],
  }),
  tasks: many(tasks),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  milestone: one(milestones, {
    fields: [tasks.milestoneId],
    references: [milestones.id],
  }),
  assignee: one(users, {
    fields: [tasks.assigneeId],
    references: [users.id],
  }),
  // one-level subtasks: a parent and its children
  parent: one(tasks, {
    fields: [tasks.parentTaskId],
    references: [tasks.id],
    relationName: "subtasks",
  }),
  subtasks: many(tasks, { relationName: "subtasks" }),
  comments: many(taskComments),
  checklistItems: many(taskChecklistItems),
  attachments: many(taskAttachments),
  activity: many(taskActivity),
}));

export const taskCommentsRelations = relations(taskComments, ({ one }) => ({
  task: one(tasks, { fields: [taskComments.taskId], references: [tasks.id] }),
  author: one(users, {
    fields: [taskComments.authorId],
    references: [users.id],
  }),
}));

export const taskChecklistItemsRelations = relations(
  taskChecklistItems,
  ({ one }) => ({
    task: one(tasks, {
      fields: [taskChecklistItems.taskId],
      references: [tasks.id],
    }),
  }),
);

export const taskAttachmentsRelations = relations(taskAttachments, ({ one }) => ({
  task: one(tasks, {
    fields: [taskAttachments.taskId],
    references: [tasks.id],
  }),
  uploader: one(users, {
    fields: [taskAttachments.uploadedBy],
    references: [users.id],
  }),
}));

export const taskActivityRelations = relations(taskActivity, ({ one }) => ({
  task: one(tasks, { fields: [taskActivity.taskId], references: [tasks.id] }),
  actor: one(users, {
    fields: [taskActivity.actorId],
    references: [users.id],
  }),
}));

/*
 * MIGRATION FOOTNOTE — service vs. app connection.
 * The scraper/derive jobs connect as a role that BYPASSES RLS (they operate on
 * global tables and must not be filtered). The API connects as a restricted
 * role and runs `SET LOCAL app.current_user_id = $userId` inside each
 * request transaction so the scoped policies above resolve correctly.
 * Grant global tables to both roles; grant scoped tables to the app role
 * with RLS on, and to the service role only for admin/maintenance.
 */
