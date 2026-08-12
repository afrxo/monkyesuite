// Local dev seed — populates the GLOBAL realm with realistic scraped/derived
// data so the API global reads and the web feed have live rows to render before
// the Go worker exists. Connects as the owner role (bypasses RLS/grants).
// Idempotent: safe to re-run (natural keys + onConflictDoNothing).
//
//   DATABASE_URL=… tsx src/seed.ts
//
// NOT part of the deploy pipeline — a dev fixture only.

import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

config();

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (see .env)");

const pool = new Pool({ connectionString: url });
const db = drizzle(pool, { schema });

const HOUR = 3600_000;
const now = Date.now();
const iso = (ms: number) => new Date(ms);

type Lifecycle = (typeof schema.lifecycleStage.enumValues)[number];

interface Seed {
  universeId: number;
  rootPlaceId: number;
  name: string;
  description: string;
  robloxGenre: string;
  creatorId: number;
  creatorName: string;
  creatorType: "User" | "Group";
  iconUrl: string;
  maxPlayers: number;
  currentSort: string | null;
  currentSortRank: number | null;
  // trajectory
  baseCcu: number;
  trend: number; // per-hour drift in CCU
  noise: number;
  lifecycle: Lifecycle;
  tagSlugs: Array<[(typeof schema.tagAxis.enumValues)[number], string]>;
}

const GAMES: Seed[] = [
  {
    universeId: 900001,
    rootPlaceId: 700001,
    name: "Brainrot Tycoon",
    description:
      "Merge, rebirth, and out-earn your friends in the meme factory.",
    robloxGenre: "Tycoon",
    creatorId: 5001,
    creatorName: "MeltedStudios",
    creatorType: "Group",
    iconUrl: "https://placehold.co/150x150/6d28d9/fff?text=BT",
    maxPlayers: 12,
    currentSort: "up-and-coming",
    currentSortRank: 3,
    baseCcu: 42000,
    trend: 320,
    noise: 2600,
    lifecycle: "growing",
    tagSlugs: [
      ["genre", "tycoon"],
      ["mechanic", "collect"],
      ["progression", "rebirth"],
      ["monetization", "gamepass"],
    ],
  },
  {
    universeId: 900002,
    rootPlaceId: 700002,
    name: "Anime Last Stand X",
    description: "Tower-defense with gacha units from every anime you know.",
    robloxGenre: "Strategy",
    creatorId: 5002,
    creatorName: "StandByte",
    creatorType: "Group",
    iconUrl: "https://placehold.co/150x150/db2777/fff?text=ALS",
    maxPlayers: 8,
    currentSort: "top-trending",
    currentSortRank: 1,
    baseCcu: 118000,
    trend: 140,
    noise: 5200,
    lifecycle: "stable",
    tagSlugs: [
      ["genre", "tower_defense"],
      ["mechanic", "fight"],
      ["progression", "gacha"],
      ["social", "coop"],
      ["monetization", "gacha"],
    ],
  },
  {
    universeId: 900003,
    rootPlaceId: 700003,
    name: "Grow a Garden Clone",
    description: "Plant, wait, harvest, sell. Peak idle serotonin.",
    robloxGenre: "Simulator",
    creatorId: 5003,
    creatorName: "QuietFarm",
    creatorType: "User",
    iconUrl: "https://placehold.co/150x150/16a34a/fff?text=GG",
    maxPlayers: 6,
    currentSort: "top-trending",
    currentSortRank: 7,
    baseCcu: 88000,
    trend: 900,
    noise: 4000,
    lifecycle: "growing",
    tagSlugs: [
      ["genre", "simulator"],
      ["mechanic", "collect"],
      ["progression", "collection"],
      ["social", "trading"],
    ],
  },
  {
    universeId: 900004,
    rootPlaceId: 700004,
    name: "Obby but Lava Rises",
    description: "Classic rising-lava obby. Don't touch the floor.",
    robloxGenre: "Adventure",
    creatorId: 5004,
    creatorName: "JumpKingRBX",
    creatorType: "User",
    iconUrl: "https://placehold.co/150x150/ea580c/fff?text=OL",
    maxPlayers: 20,
    currentSort: null,
    currentSortRank: null,
    baseCcu: 9500,
    trend: -85,
    noise: 900,
    lifecycle: "cooling",
    tagSlugs: [
      ["genre", "obby"],
      ["mechanic", "collect"],
      ["social", "solo"],
    ],
  },
  {
    universeId: 900005,
    rootPlaceId: 700005,
    name: "Pet Roll Simulator 99",
    description: "Roll for pets, index them, roll again. Infinite luck.",
    robloxGenre: "Simulator",
    creatorId: 5003,
    creatorName: "QuietFarm",
    creatorType: "User",
    iconUrl: "https://placehold.co/150x150/0891b2/fff?text=PR",
    maxPlayers: 10,
    currentSort: "up-and-coming",
    currentSortRank: 12,
    baseCcu: 31000,
    trend: 640,
    noise: 2100,
    lifecycle: "growing",
    tagSlugs: [
      ["genre", "simulator"],
      ["mechanic", "roll"],
      ["progression", "gacha"],
      ["progression", "collection"],
    ],
  },
  {
    universeId: 900006,
    rootPlaceId: 700006,
    name: "Steal a Brainrot",
    description: "Grab, run, betray. Social chaos in 90-second rounds.",
    robloxGenre: "Fighting",
    creatorId: 5005,
    creatorName: "GremlinGames",
    creatorType: "Group",
    iconUrl: "https://placehold.co/150x150/9333ea/fff?text=SB",
    maxPlayers: 16,
    currentSort: "top-trending",
    currentSortRank: 2,
    baseCcu: 205000,
    trend: 2100,
    noise: 9000,
    lifecycle: "launching",
    tagSlugs: [
      ["genre", "tycoon"],
      ["mechanic", "trade"],
      ["social", "pvp"],
      ["monetization", "ugc"],
    ],
  },
  {
    universeId: 900007,
    rootPlaceId: 700007,
    name: "Retro Sword Fights",
    description: "The 2011 classic, barely alive but stubborn.",
    robloxGenre: "Fighting",
    creatorId: 5006,
    creatorName: "OldGuardRBX",
    creatorType: "User",
    iconUrl: "https://placehold.co/150x150/475569/fff?text=RS",
    maxPlayers: 12,
    currentSort: null,
    currentSortRank: null,
    baseCcu: 1200,
    trend: -12,
    noise: 220,
    lifecycle: "declining",
    tagSlugs: [
      ["genre", "rpg"],
      ["mechanic", "fight"],
      ["social", "pvp"],
    ],
  },
  {
    universeId: 900008,
    rootPlaceId: 700008,
    name: "Dress to Impress 2",
    description: "Themed fashion rounds, vote for the best fit.",
    robloxGenre: "Social",
    creatorId: 5007,
    creatorName: "RunwayRoblox",
    creatorType: "Group",
    iconUrl: "https://placehold.co/150x150/e11d48/fff?text=DTI",
    maxPlayers: 12,
    currentSort: "up-and-coming",
    currentSortRank: 5,
    baseCcu: 64000,
    trend: 410,
    noise: 3300,
    lifecycle: "growing",
    tagSlugs: [
      ["genre", "rpg"],
      ["mechanic", "build"],
      ["social", "coop"],
      ["monetization", "cosmetics"],
    ],
  },
];

// Tag vocabulary — controlled, (axis, slug) unique.
const TAGS: Array<{
  axis: (typeof schema.tagAxis.enumValues)[number];
  slug: string;
  label: string;
  description: string;
}> = [
  {
    axis: "genre",
    slug: "tycoon",
    label: "Tycoon",
    description: "Own and grow a money-generating base.",
  },
  {
    axis: "genre",
    slug: "simulator",
    label: "Simulator",
    description: "Repeat a core loop to accrue a number.",
  },
  {
    axis: "genre",
    slug: "obby",
    label: "Obby",
    description: "Skill-based platforming obstacle course.",
  },
  {
    axis: "genre",
    slug: "tower_defense",
    label: "Tower Defense",
    description: "Place units to stop waves.",
  },
  {
    axis: "genre",
    slug: "rpg",
    label: "RPG",
    description: "Character progression and combat.",
  },
  {
    axis: "mechanic",
    slug: "collect",
    label: "Collect",
    description: "Gather items/currency as the core action.",
  },
  {
    axis: "mechanic",
    slug: "fight",
    label: "Fight",
    description: "Combat against players or NPCs.",
  },
  {
    axis: "mechanic",
    slug: "build",
    label: "Build",
    description: "Construct or customize.",
  },
  {
    axis: "mechanic",
    slug: "trade",
    label: "Trade",
    description: "Exchange items between players.",
  },
  {
    axis: "mechanic",
    slug: "roll",
    label: "Roll",
    description: "RNG pulls for rewards.",
  },
  {
    axis: "progression",
    slug: "rebirth",
    label: "Rebirth",
    description: "Reset for a permanent multiplier.",
  },
  {
    axis: "progression",
    slug: "gacha",
    label: "Gacha",
    description: "Randomized unit/reward acquisition.",
  },
  {
    axis: "progression",
    slug: "collection",
    label: "Collection",
    description: "Complete an index/set.",
  },
  {
    axis: "social",
    slug: "coop",
    label: "Co-op",
    description: "Players progress together.",
  },
  {
    axis: "social",
    slug: "pvp",
    label: "PvP",
    description: "Players compete directly.",
  },
  {
    axis: "social",
    slug: "trading",
    label: "Trading",
    description: "A player-driven economy.",
  },
  {
    axis: "social",
    slug: "solo",
    label: "Solo",
    description: "Single-player-shaped experience.",
  },
  {
    axis: "monetization",
    slug: "gamepass",
    label: "Game Pass",
    description: "One-time paid unlocks.",
  },
  {
    axis: "monetization",
    slug: "gacha",
    label: "Gacha",
    description: "Paid randomized pulls.",
  },
  {
    axis: "monetization",
    slug: "ugc",
    label: "UGC",
    description: "Sells wearable UGC items.",
  },
  {
    axis: "monetization",
    slug: "cosmetics",
    label: "Cosmetics",
    description: "Sells non-power cosmetics.",
  },
];

async function main(): Promise<void> {
  // --- users (for game_notes authorship) ---
  await db
    .insert(schema.users)
    .values([
      { id: "user_operator", email: "operator@monkye.dev", name: "Operator" },
      { id: "user_collab", email: "collab@monkye.dev", name: "Collaborator" },
    ])
    .onConflictDoNothing();

  // --- creators ---
  const creatorRows = new Map<number, Seed>();
  for (const g of GAMES)
    if (!creatorRows.has(g.creatorId)) creatorRows.set(g.creatorId, g);
  await db
    .insert(schema.creators)
    .values(
      [...creatorRows.values()].map((g) => ({
        creatorId: g.creatorId,
        type: g.creatorType,
        name: g.creatorName,
        hasVerifiedBadge: g.creatorType === "Group",
        memberCount: g.creatorType === "Group" ? 40000 + g.creatorId : null,
      })),
    )
    .onConflictDoNothing();

  // --- tags ---
  await db
    .insert(schema.tags)
    .values(TAGS.map((t) => ({ ...t, createdBy: "user_operator" })))
    .onConflictDoNothing();
  const tagRows = await db.select().from(schema.tags);
  const tagId = (axis: string, slug: string): string => {
    const row = tagRows.find((r) => r.axis === axis && r.slug === slug);
    if (!row) throw new Error(`missing tag ${axis}/${slug}`);
    return row.id;
  };

  for (const g of GAMES) {
    // --- game dimension ---
    await db
      .insert(schema.games)
      .values({
        universeId: g.universeId,
        rootPlaceId: g.rootPlaceId,
        name: g.name,
        description: g.description,
        creatorType: g.creatorType,
        creatorId: g.creatorId,
        creatorName: g.creatorName,
        robloxGenre: g.robloxGenre,
        createdAt: iso(now - 400 * 24 * HOUR),
        updatedAt: iso(
          now - (g.lifecycle === "declining" ? 90 : 2) * 24 * HOUR,
        ),
        isTracked: true,
        source: "charts",
        currentSort: g.currentSort,
        currentSortRank: g.currentSortRank,
        lastSortSeen: g.currentSort ? iso(now) : null,
        iconUrl: g.iconUrl,
        maxPlayers: g.maxPlayers,
        playableDevices: ["Computer", "Phone", "Tablet"],
        supportedLanguages: ["en"],
        ageRecommendation: "All Ages",
      })
      .onConflictDoNothing();

    // --- raw metric history: hourly for 7 days ---
    const points = 24 * 7;
    const metricRows = [];
    let visits = 50_000_000 + g.baseCcu * 200;
    let favs = 800_000 + g.baseCcu * 4;
    for (let i = points; i >= 0; i--) {
      const t = now - i * HOUR;
      const drift = g.trend * (points - i);
      // gentle daily wave + noise
      const wave = Math.sin(((points - i) / 24) * Math.PI * 2) * g.noise;
      const jitter = (Math.random() - 0.5) * g.noise;
      // Floor at ~15% of base so a decline cools toward a plausible long tail
      // rather than crashing to a fake zero.
      const floor = Math.round(g.baseCcu * 0.15);
      const playing = Math.max(
        floor,
        Math.round(g.baseCcu + drift + wave + jitter),
      );
      visits += Math.round(playing * 0.6);
      favs += Math.round(playing * 0.02);
      metricRows.push({
        universeId: g.universeId,
        capturedAt: iso(t),
        playing,
        visits,
        favoritedCount: favs,
        upVotes: Math.round(favs * 1.4),
        downVotes: Math.round(favs * 0.12),
        hasVerifiedBadge: g.creatorType === "Group",
        activeEvent: g.universeId === 900006,
      });
    }
    await db
      .insert(schema.gameMetrics)
      .values(metricRows)
      .onConflictDoNothing();

    // --- latest derived stats (one row, computedAt now) ---
    const last = metricRows[metricRows.length - 1];
    const first24 = metricRows[metricRows.length - 25] ?? metricRows[0];
    if (!last || !first24) continue; // metricRows always non-empty; satisfies strict indexing
    const ccuMean = Math.round(
      metricRows.slice(-24).reduce((s, r) => s + (r.playing ?? 0), 0) / 24,
    );
    const likeRatio =
      Number(last.upVotes) / (Number(last.upVotes) + Number(last.downVotes));
    await db
      .insert(schema.gameStats)
      .values({
        universeId: g.universeId,
        computedAt: iso(now),
        trendScore: Number((g.trend / 30).toFixed(2)),
        velocity: Number(
          (((last.playing ?? 0) - (first24.playing ?? 0)) / 24).toFixed(2),
        ),
        spikeScore: Number(
          (((last.playing ?? 0) - ccuMean) / (g.noise || 1)).toFixed(3),
        ),
        lifecycle: g.lifecycle,
        ccuSlope7d: Number((g.trend / 3600).toFixed(6)),
        ccuSlope28d: Number((g.trend / 3600 / 2).toFixed(6)),
        ccuMean24h: ccuMean,
        troughPeakRatio: Number((0.35 + Math.random() * 0.4).toFixed(3)),
        likeRatio: Number(likeRatio.toFixed(4)),
        favoritesPerVisit: Number(
          (Number(last.favoritedCount) / Number(last.visits)).toFixed(6),
        ),
        daysSinceUpdate: g.lifecycle === "declining" ? 90 : 2,
        updatesPer28d: g.lifecycle === "declining" ? 0 : 6,
        genrePercentile: Number((0.4 + Math.random() * 0.55).toFixed(3)),
      })
      .onConflictDoNothing();

    // --- a couple lifecycle events ---
    await db
      .insert(schema.lifecycleEvents)
      .values([
        {
          universeId: g.universeId,
          type:
            g.lifecycle === "launching"
              ? "launch"
              : g.lifecycle === "declining"
                ? "decline"
                : "spike",
          detectedAt: iso(now - 6 * HOUR),
          magnitude: Number((g.trend / 100).toFixed(2)),
          meta: { note: "seeded" },
        },
        ...(g.currentSort
          ? [
              {
                universeId: g.universeId,
                type: "sort_appearance" as const,
                detectedAt: iso(now - 30 * HOUR),
                magnitude: g.currentSortRank,
                meta: { sort: g.currentSort },
              },
            ]
          : []),
      ])
      .onConflictDoNothing();

    // --- sort snapshots (timeline) for games currently in a sort ---
    if (g.currentSort && g.currentSortRank !== null) {
      const sortRows = [];
      for (let i = 12; i >= 0; i--) {
        sortRows.push({
          universeId: g.universeId,
          sortName: g.currentSort,
          rank: Math.max(
            1,
            g.currentSortRank + Math.round((Math.random() - 0.5) * 6),
          ),
          capturedAt: iso(now - i * 2 * HOUR),
        });
      }
      await db
        .insert(schema.sortSnapshots)
        .values(sortRows)
        .onConflictDoNothing();
    }

    // --- virtual event for the launcher ---
    if (g.universeId === 900006) {
      await db
        .insert(schema.gameEvents)
        .values({
          eventId: `evt-${g.universeId}-launch`,
          universeId: g.universeId,
          title: "Launch Week: Golden Brainrot",
          subtitle: "Limited-time UGC drop",
          tagline: "Steal the rarest one before Sunday",
          startUtc: iso(now - 24 * HOUR),
          endUtc: iso(now + 4 * 24 * HOUR),
          hostId: g.creatorId,
          hostName: g.creatorName,
          categories: ["Limited", "UGC"],
          status: "active",
          createdUtc: iso(now - 48 * HOUR),
          updatedUtc: iso(now - 24 * HOUR),
        })
        .onConflictDoNothing();
    }

    // --- monetization ---
    await db
      .insert(schema.gamePasses)
      .values([
        {
          passId: g.universeId * 10 + 1,
          universeId: g.universeId,
          name: "VIP",
          priceRobux: 499,
        },
        {
          passId: g.universeId * 10 + 2,
          universeId: g.universeId,
          name: "2x Luck",
          priceRobux: 199,
        },
      ])
      .onConflictDoNothing();
    await db
      .insert(schema.devProducts)
      .values([
        {
          productId: g.universeId * 100 + 1,
          universeId: g.universeId,
          name: "1,000 Coins",
          priceRobux: 99,
        },
        {
          productId: g.universeId * 100 + 2,
          universeId: g.universeId,
          name: "Starter Pack",
          priceRobux: 349,
        },
      ])
      .onConflictDoNothing();

    // --- tags ---
    await db
      .insert(schema.gameTags)
      .values(
        g.tagSlugs.map(([axis, slug]) => ({
          universeId: g.universeId,
          tagId: tagId(axis, slug),
          addedBy: "user_operator",
        })),
      )
      .onConflictDoNothing();
  }

  // --- game notes (shared + private) on a couple of games ---
  await db
    .insert(schema.gameNotes)
    .values([
      {
        universeId: 900006,
        authorId: "user_operator",
        body: "CCU curve is near-vertical since the UGC drop — watch for a cooldown once the limited ends.",
        visibility: "shared",
      },
      {
        universeId: 900006,
        authorId: "user_collab",
        body: "Private: our steal-mechanic prototype could ride this. Ping me before I spec it.",
        visibility: "private",
      },
      {
        universeId: 900001,
        authorId: "user_operator",
        body: "Rebirth pacing looks tuned for retention, not just spend. Good reference.",
        visibility: "shared",
      },
    ])
    .onConflictDoNothing();

  // --- off-platform demand ---
  await db
    .insert(schema.demandTerms)
    .values([
      { term: "steal a brainrot", kind: "game", universeId: 900006 },
      { term: "brainrot tycoon", kind: "game", universeId: 900001 },
      {
        term: "tower defense anime",
        kind: "theme",
        genreLabel: "Tower Defense",
      },
    ])
    .onConflictDoNothing();
  const termRows = await db.select().from(schema.demandTerms);
  for (const term of termRows) {
    const snaps = [];
    for (let i = 14; i >= 0; i--) {
      snaps.push({
        termId: term.id,
        capturedAt: iso(now - i * 24 * HOUR),
        ytVideoCount7d: 20 + Math.round(Math.random() * 60) + (14 - i) * 3,
        ytViewDelta7d: 100_000 + Math.round(Math.random() * 500_000),
        trendsScore: Math.min(
          100,
          30 + (14 - i) * 4 + Math.round(Math.random() * 10),
        ),
      });
    }
    await db.insert(schema.demandSnapshots).values(snaps).onConflictDoNothing();
  }

  const counts = await Promise.all([
    db.$count(schema.games),
    db.$count(schema.gameMetrics),
    db.$count(schema.gameStats),
    db.$count(schema.gameNotes),
    db.$count(schema.tags),
  ]);
  console.log(
    `[seed] games=${counts[0]} metrics=${counts[1]} stats=${counts[2]} notes=${counts[3]} tags=${counts[4]}`,
  );
}

try {
  await main();
} finally {
  await pool.end();
}
