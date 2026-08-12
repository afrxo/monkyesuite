# monkyesuite — Build Overview

Shared context for every spec in this folder. Read this first, then the per-area doc you're building. The database schema is the single source of truth and lives in `packages/database/src/schema.ts` — every doc references tables from it.

## What it is

A Roblox **trend-intelligence platform** with a small collaboration layer. It watches games that are already winning, derives where they're collectively steering (mechanics, cadence, progression), and gives a tiny team (an operator + up to two collaborators per project) a place to organize builds around what it finds.

The wedge is **signal over data**: not raw CCU, but lifecycle and trend intelligence derived from it.

## The honest constraint (shapes the whole product)

There are **no first-party games yet**, so there is **no source of truth** — retention, bounce, and spend are invisible from outside a game you own. Everything observable is a **proxy** (CCU, votes, favorites, visits, update cadence, discovery-sort rank). monkyesuite is therefore a **demand-and-direction engine**, not a retention oracle. Label every scraped signal as an estimate at the surface; never let a proxy read as ground truth.

## Architecture

- **Worker — a persistent Go service (Railway).** Runs the scraper and derive orchestration on a tiered tick loop. Go is deliberate: the fetch fan-out is concurrency-bound and a prior edge version had severe CPU load. The fix is Go for I/O concurrency **plus** Postgres for aggregation (see `02-signals.md`) — heavy math runs in the database, never in worker memory.
- **API — a TypeScript service (Railway).** The HTTP API and the authorization boundary.
- **Frontend — a TanStack Start SSR app (Cloudflare).** Talks to the API **only over HTTP**; never touches the database directly — that boundary is where authorization is enforced.
- **Database — Railway Postgres**, shared by worker and API. Schema + migrations are owned solely by `packages/database` (Drizzle); the Go worker connects via `pgx` and writes to those tables without redefining them.

The worker and API are separate Railway services sharing one Postgres. TypeScript covers the API, web, and shared packages; Go covers the worker only, with no cross-imports between them.

## Two data realms

Everything is one of two kinds:

- **Global** — scraped once, shared by everyone, no access control. Games, metrics, derived stats, discovery sorts, events, creators, monetization, tags, off-platform demand.
- **Project-scoped** — gated by project membership, enforced with Postgres row-level security. Projects, milestones, tasks, docs, notes, memberships, invites.

**One exception:** `game_notes` is global (a note follows its game across all projects) but is **user-authored**, so it carries RLS by author + visibility (shared to the team, or private to the author). It's the only global table with access control.

The single bridge between realms is `project_game` — an optional link pinning tracked games into a build project.

## Five keys

`universeId` · `userId` · `capturedAt` (the time axis) · `term` (off-platform) · a synthetic `id` for scoped rows. Consistent keying is what makes the system a set of joins rather than a pile of tables.

## Conventions (apply everywhere)

- **Raw vs derived.** `game_metrics` is an immutable landing layer — exactly what was scraped, never mutated. `game_stats` and analytical `lifecycle_events` are rebuilt *from* it and are fully replayable. A derivation bug never corrupts history; you re-derive.
- **Idempotency.** Every scheduled write is safe to re-run; natural keys (e.g. `(universeId, capturedAt)`) enforce it.
- **Proxy honesty.** Scraped numbers are estimates; show their freshness (`computedAt`).
- **The confirmation rule.** A trend is real only when it is moving across **multiple games at once AND correlating with CCU growth**. One game adding a mechanic is a choice; several rising games adding it is a direction. This rule is enforced in the derivation query, not the UI.

## The tiered tick loop (Go worker)

One timer drives all scheduled work; several docs reference these tiers:

- **every tick (5 min):** discover · snapshot · events (bucketed)
- **every 12 ticks (~hourly):** hourly rollup · cohort percentiles
- **every 288 ticks (~daily):** enrich fan-out · lift baseline · trend-drift

## The spec set

| Doc | Area | Runtime |
|---|---|---|
| `01-ingestion.md` | Scraper: discover, snapshot, events, enrich | backend worker |
| `02-signals.md` | Derived signals, lifecycle, trend-drift | backend derive |
| `03-tagging.md` | Controlled-vocabulary tagging | API + web |
| `04-offplatform-demand.md` | YouTube + Trends leading indicator | backend + API |
| `05-projects.md` | Build-project tracker: board, milestones, docs | API + web |
| `06-identity-access.md` | Auth, membership, invites, RLS model | API |
| `07-api.md` | HTTP contract + auth boundary | backend |
| `08-web.md` | Feed, discovery, game detail, workspaces | frontend |

## Build sequence

1. **01 + 02 + 08(feed, game detail)** — core tracker: discover, snapshot, carry-forward, derive, Pulse feed.
2. **01(events, enrich) + 08(monetization/events on detail)** — full scrape surface.
3. **03 + 02(trend-drift) + 08(tagging, discovery)** — queryable trend intelligence.
4. **04 + 08(demand overlay)** — the leading indicator.
5. **06 + 07(scoped) + 05 + 08(workspaces) + game notes** — auth, collaboration, per-game notes.

Each phase is shippable and single-user useful before the next; the identity/access work lands last, exactly when collaborators first matter.
