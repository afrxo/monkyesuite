# 01 — Ingestion & Scheduling

Context: `00-overview.md`. This is **`apps/worker`, a Go service.** Tables (owned by `packages/database`, written via `pgx`): `games`, `game_metrics`, `creators`, `sort_snapshots`, `game_events`, `game_passes`, `dev_products`, `creator_portfolio`, `lifecycle_events`, plus an `enrich_jobs` work table.

The worker is a persistent process running four jobs on the tiered tick loop. It is the only writer of the global scraped tables, and it connects to Postgres as the **service role that bypasses RLS** (it only writes global tables). All Roblox endpoints are public/unofficial; **no auth token is sent**; every call fails soft.

**Why Go:** the fetch fan-out is I/O-concurrency-bound and the previous edge version had severe CPU load. Go runs the concurrent fetching on a bounded goroutine pool; **all aggregation stays in Postgres** (`02-signals.md`). Do not compute signals over big in-memory arrays here — that relocates the CPU problem instead of solving it.

## Suggested worker layout

```
apps/worker/
├── go.mod
├── cmd/worker/main.go        # boot, config, the tick loop
└── internal/
    ├── roblox/               # the shared HTTP client (limiter, backoff, decode)
    ├── store/                # pgx queries / writers per table
    ├── jobs/                 # discover, snapshot, events, enrich
    └── sched/                # tiered tick loop, event bucketing
```

## Step 1.0 — Shared Roblox client (`internal/roblox`)

Every outbound Roblox call goes through one client:

1. **Rate limit first — a two-tier budget.** Two **independent** `golang.org/x/time/rate` limiters, one per tier:
   - **critical: 40 requests / 10s** — discover · snapshot · events draw from this pool.
   - **enrich: 20 requests / 10s** — the daily enrich drain draws from this pool.

   The pools share no tokens, so a saturated enrich drain **can never spend a critical-path token**: the every-tick jobs always have their full 40/10s, and a snapshot always completes on time even mid-drain. The **aggregate** to Roblox is bounded by the sum — burst 60, sustained **60 req/10s** — so the politeness ceiling to Roblox is preserved exactly. Each call gates on its own tier's limiter; if a token isn't immediately available, **skip and return no result** (don't block the tick waiting).

   > Independent pools are load-bearing, not cosmetic. A *single* shared 60/10s limiter with an enrich sub-cap does **not** hold: because each call skips rather than waits, a shared burst transiently drained by the drain zeroes a whole snapshot even while enrich stays within its sub-cap. Separate pools are what actually reserve the tick's budget — see §1.5.
2. **Fetch** with `User-Agent: monkyesuite-worker/1.0`, a `context.Context` deadline per request, and exponential backoff with jitter on 5xx/network errors, bounded by a per-tick retry budget.
3. **Decode** into typed structs; reject malformed payloads before they reach the store.
4. **Log** endpoint · status · latency · batch size (structured, e.g. `slog`).

**Fan-out pattern:** a bounded goroutine pool (worker-pool or `errgroup.Group` with `SetLimit`) issues batched requests concurrently under the shared limiter; results are collected and written in the calling job. This pool is the reason the service is in Go.

## Step 1.1 — Discover (every tick) — *what games exist*

**Endpoint:** `apis.roblox.com/explore-api/v1/get-sort-content?sessionId=<guid>&sortId=<cat>`

> **`sessionId` is required.** The endpoint returns **HTTP 400** (`{"errors":{"sessionId":["The SessionId field is required."]}}`) with `sortId` alone. It is a **client-generated GUID**; Roblox accepts any well-formed v4 GUID and does not tie sort ranking to it (verified: the same category returns an identical ranked set whether the `sessionId` is reused or freshly minted — it's a personalization/analytics session key, not a pagination cursor). The worker generates **one GUID at process start and reuses it for the whole run** (regenerated per run / restart). A stable per-run session is deliberate: it keeps the discovery stream coherent for Roblox-side analytics without ever masking or reordering the games we scrape.

Loop these **9 sort categories** every tick (concurrently, under the limiter):

```
top-trending, up-and-coming, top-playing-now, fun-with-friends,
top-revisited, top-earning, top-paid-access, top-rated, most-popular
```

Per game returned: `universeId`, `rootPlaceId`, `name`, `isSponsored`. **Skip sponsored games.**

Writes:
- **`games`** — upsert new games (`name`, `rootPlaceId`, `universeId`, `firstSeenAt`); `ON CONFLICT (universe_id) DO NOTHING`.
- **`games.current_sort` / `current_sort_rank`** — the **best (lowest) rank** the game holds across all 9 sorts this tick. **Clear both** when a game is in no sort this tick.
- **`sort_snapshots`** — the **top-50 per category** as `(universeId, sortName, rank, capturedAt)`. **Prune** rows older than ~24h each tick.
- **`lifecycle_events`** — `sort_appearance` on sort entry (**debounce 24h** using `games.last_sort_seen`), and `sort_exit` when a game leaves all sorts.
- **Icon** — prewarm via `thumbnails.roblox.com/v1/games/icons` (150×150); store the CDN URL in `games.icon_url`.

> **Rank is the data.** Sort position is a discovery signal in its own right — persist it, don't just use it to find games.

## Step 1.2 — Snapshot (every tick) — *live metrics time-series*

**Endpoints (issue together):**
- `games.roblox.com/v1/games?universeIds=` → `playing` (CCU), `visits`, `favoritedCount`, `genre`, `created`, `updated`, `maxPlayers`, `playableDevices`, `creator{id,name,type,hasVerifiedBadge}`
- `games.roblox.com/v1/games/votes?universeIds=` → `upVotes`, `downVotes`

**Batching:** chunk the tracked set into **50 universeIds per request**, and run **~10 requests concurrently** (goroutine pool under the limiter). Fetch the games and votes calls for a batch together.

Writes:
- **`game_metrics`** — append **every tick**: `playing`, `visits`, `favoritedCount`, `upVotes`, `downVotes`, `activeEvent`, `capturedAt`. Idempotent on `(universe_id, captured_at)` (`ON CONFLICT DO NOTHING`). Immutable raw layer — never update it.
- **`creators`** — insert newly-seen creators only (keep an in-memory `seen` set, e.g. a `map[int64]struct{}` guarded by a mutex, for the process lifetime).
- **`games`** — conditional metadata update (`genre`, `creator_id`, `created_at`, `updated_at`) **only when a value changed**.
- **Carry-forward** — if the Games API didn't return a tracked game this tick, **re-insert its last known metric at the current timestamp**. Keeps derivation clean: velocity reads **0** instead of a fabricated spike, and the UI never shows false staleness. Implement as a set difference between the tracked set and the ids returned this tick.

## Step 1.3 — Events (every tick, **bucketed**) — *in-game virtual events*

**Endpoint:** `apis.roblox.com/virtual-events/v1/universes/<id>/virtual-events`

**Bucketing:** poll a game only when `universeId % 12 == tick % 12` — each game is checked ~once per 12 ticks (~1h). Spreads load across the hour.

Per event: `id`, `title`, `subtitle`, `eventTime{startUtc,endUtc}`, `host{hostId,hostName}`, `eventCategories`, `thumbnails[].mediaId`, `createdUtc`, `updatedUtc`, `tagline`, `eventStatus`.

Writes:
- **`game_events`** — upsert the full event row.
- **`lifecycle_events`** — `update_shipped` when an event went live within the last ~1h window **and** it's the first time we've ingested it.
- **Thumbnail** — resolve `mediaId` → CDN URL via `thumbnails.roblox.com/v1/assets` (480×270); backfill stale rows.

## Step 1.4 — Enrich (every 288 ticks, ~daily) — *monetization + studio*

Fan every tracked game into the **`enrich_jobs`** work table (`id`, `kind`, `target_id`, `status`, `attempts`, `run_after`). A small pool of goroutines claims rows (`SELECT … FOR UPDATE SKIP LOCKED`), processes with **concurrency ~5** and a **retry budget of 3**, and marks exhausted rows `failed` (dead-letter) rather than retrying forever.

**`universe` job:**
- **Gamepasses** — `apis.rotunnel.com/game-passes/v1/universes/<id>/game-passes`, then per-pass price via `.../developer-products/<id>/details` → **`game_passes`** (`passId`, `name`, `priceRobux`).
- **Dev products** — `.../developerproducts?limit=100` → **`dev_products`** (`productId`, `name`, `priceRobux`).
- **Place details** — `games.roblox.com/v1/games/multiget-place-details` → `supportedLanguages`, `ageRecommendation`, `descriptors` → **`games`** columns.
- **Games API again** → `maxPlayers`, `playableDevices`, `lastUpdatedAt` → **`games`** columns.

**`creator` job:**
- **Studio games** — `games.roblox.com/v2/{groups|users}/<id>/games` (top 50 by visits, floor 10k visits, blocklist names containing `[ASSETS]` / `[TESTING]`) → **`creator_portfolio`** (may reference untracked games, so its `universeId` is not a FK).
- **Group meta** — `groups.roblox.com/v1/groups/<id>` → `memberCount`, verified badge → **`creators`**.

> Gamepass/dev-product data is gated by Roblox and reached through the third-party proxy `apis.rotunnel.com`. It's enrichment, never on the critical snapshot path — fail soft if unavailable.

## Step 1.5 — Resilience

- **Discover isolation.** The discover/sorts scrape has the most volatile response shape. Run it so a discover failure logs and yields "no new discovery this tick" **without** failing snapshot (separate goroutine, recovered panics, errors not propagated to the snapshot job).
- **429 / partial batch.** Back off within budget, then skip the id to the next tick — a gap is data, not a crash. Persist whatever decoded; log the rest.
- **Private/deleted game.** Emit a null metrics row (gap ≠ genuine zero downstream) or carry-forward per 1.2.
- **Tick safety.** A tick must never overrun into the next; guard each job with a `context` deadline shorter than the tick interval.
- **Enrich must never starve a snapshot.** The daily enrich drain is long-running and detached (§1.4); on a shared, unprioritized limiter its thousands of gated calls would consume the whole budget and force snapshot to carry every game forward — turning real CCU movement into a flat line for the duration, a daily blind spot on the load-bearing signal. The two-tier budget (§1.0) prevents this structurally: enrich draws from its **own** 20 req/10s pool while the critical path keeps its **own** 40 req/10s pool, and the two share no tokens — so a snapshot always completes on time even while a drain runs full-tilt. Carry-forward stays a genuine-gap mechanism, not a symptom of self-inflicted starvation.

## API surface (reference)

| API | Endpoint | Data |
|---|---|---|
| Explore | `explore-api/v1/get-sort-content` | discovery, sort rank |
| Games | `games.v1/games` | CCU, visits, likes, genre, creator, devices |
| Votes | `games.v1/games/votes` | up/down votes |
| Virtual Events | `virtual-events/v1/.../virtual-events` | in-game events |
| Thumbnails | `thumbnails.v1/games/icons` + `/assets` | icons, event art |
| Place Details | `games.v1/multiget-place-details` | languages, age rating, descriptors |
| Gamepasses | `rotunnel/game-passes` + prices | monetization |
| Dev Products | `rotunnel/developer-products` | monetization |
| Studio | `games.v2/{groups,users}/games` | creator portfolio |
| Groups | `groups.v1/groups` | member count |

## Acceptance

- Every tracked game is snapshotted within 5 min of each tick under normal conditions.
- Re-running a tick creates **zero** duplicate `game_metrics` rows.
- A discover/sorts outage leaves snapshot unaffected.
- Sort rank and `sort_snapshots` persist each tick; sort entry/exit emit debounced lifecycle events.
- Carry-forward prevents fabricated velocity spikes for games missing from a tick.
- Enrich runs daily without blocking ticks; monetization tables populate for tracked games.
- Worker CPU stays flat under load — aggregation is in Postgres, not in the process.
