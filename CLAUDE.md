# CLAUDE.md

Persistent context for Claude Code working in this repo. Read this first, every session. Feature detail lives in `specs/` (start with `specs/00-overview.md`); the database schema is the source of truth in `packages/database/src/schema.ts`. This file is the *how we build* — conventions, layout, deploy targets — not the *what*.

## What this is

**monkyesuite** — a Roblox trend-intelligence platform with a small collaboration layer. It scrapes public Roblox data, derives lifecycle + trend signals, and gives a tiny team (an operator + up to two collaborators per project) a place to organize builds around what it finds. Wedge: **signal over data**.

There are **no first-party games yet**, so there is no ground-truth retention data — everything observable is a proxy (CCU, votes, favorites, visits, sort rank). Treat scraped signals as **estimates** and label them as such at every surface. Never let a proxy read as fact.

## Monorepo layout

pnpm workspace, no Turbo. Two deploy targets: **frontend → Cloudflare**, **everything else → Railway**.

```
monkyesuite/
├── apps/
│   ├── worker/          # Railway — Go scraper + derive orchestration (the tiered tick loop)
│   ├── api/             # Railway — TS HTTP API; the auth boundary
│   └── web/             # Cloudflare — TanStack Start SSR frontend
├── packages/            # TypeScript only — consumed by api + web, NOT by the Go worker
│   ├── database/        # Drizzle schema + migrations — SINGLE SOURCE OF TRUTH for the DB
│   ├── core/            # shared TS domain logic: fractional-index ordering, shared helpers
│   └── shared/          # shared TS types, Zod schemas, constants (API/web only)
├── specs/               # feature specs (00-overview + per-area docs)
├── CLAUDE.md            # this file
└── pnpm-workspace.yaml
```

`apps/worker` is a **Go** module with its own `go.mod`; it lives in the same repo for colocation but is not part of the pnpm workspace and does not import any TS package. The pnpm workspace covers `apps/api`, `apps/web`, and `packages/*`.

## Two Railway services + Cloudflare

Three deployables, three build pipelines:

- **`apps/worker` → Railway service (Go).** Persistent process running the tiered tick loop. Owns all scraping and derive orchestration.
- **`apps/api` → Railway service (TS).** The HTTP API and auth boundary.
- **`apps/web` → Cloudflare.** Stateless SSR; calls the Railway API over HTTP only.

The worker and API are **separate services** (they were never going to share a process once the worker became Go) pointing at the **same Railway Postgres**.

## Language & stack

- **`apps/worker` — Go.** The scraper is Go, deliberately. The previous edge version had severe CPU load; the fix is a persistent process where the concurrent fetch fan-out runs on goroutines and the heavy aggregation runs in Postgres, not in app memory. Stack: goroutine worker pool, `golang.org/x/time/rate` (limiter), `context` (timeouts/cancellation), `errgroup` (fan-out/fan-in), `pgx` (Postgres).
- **`apps/api`, `apps/web`, `packages/*` — TypeScript**, strict mode: no `any`, no `as` casts. Fix types properly.
- **DB is shared, schema is owned by one place.** `packages/database` (Drizzle) is the **single source of truth** for schema + migrations; migrations are always generated and applied from there. The Go worker does **not** redefine the schema — it connects with `pgx` and writes to the existing tables, trusting them. Never hand-edit the DB.
- **Validation:** Zod at the API boundary (TS); typed structs + explicit decode at the worker boundary (Go). Parse Roblox responses, don't trust them.
- **Frontend:** TanStack Start (React, SSR) + TanStack Query + Tailwind + shadcn/ui.
- **Auth:** Better Auth.
- **The Go/Postgres split is the whole CPU strategy.** Go handles I/O concurrency (fetching); Postgres handles aggregation (window functions in `02-signals.md`). Do **not** pull derive math back into worker memory — that just relocates the CPU problem instead of solving it.

## The two data realms (non-negotiable)

Every table is one of:

- **Global** — scraped, shared, no access control. `games`, `game_metrics`, `game_stats`, `sort_snapshots`, `game_events`, `creators`, `game_passes`, `dev_products`, `creator_portfolio`, `tags`, `game_tags`, `demand_*`, `lifecycle_events`.
- **Project-scoped** — RLS-gated by membership. `projects`, `milestones`, `tasks`, `docs`, `notes`, `memberships`, `invites`, `project_game`.
- **One exception** — `game_notes` is global but user-authored, so it has RLS by author + visibility.

Do not blur these. A scoped table without a `project_id` and an RLS policy is a bug.

## Access enforcement (get this right)

Project scoping is enforced **twice**:

1. **API (primary):** every scoped handler resolves membership through one shared helper before touching data.
2. **Postgres RLS (backstop):** the API runs `SET LOCAL app.current_user_id = '<uuid>'` inside each request transaction; policies read `current_setting('app.current_user_id', true)`.

Connection roles:
- **API** → restricted role, RLS enforced, sets `app.current_user_id` per request.
- **worker** (scraper/derive/enrich) → **service role that bypasses RLS** (it only writes global tables; it must never be filtered). Grant scoped tables to the app role only.

A missing `app.current_user_id` must **fail closed** (zero rows), never open.

### Provisioning (Railway)

- **`BYPASSRLS` requires a superuser to set.** The service role's whole security model is that it bypasses RLS. Postgres only lets a **superuser** grant the `BYPASSRLS` attribute (`ALTER ROLE monkye_service BYPASSRLS`). When provisioning Railway Postgres, run role setup as the instance's superuser/owner — if the provisioning role isn't superuser, `BYPASSRLS` silently can't be granted and the worker's global writes start getting RLS-filtered. Verify with `SELECT rolbypassrls FROM pg_roles WHERE rolname='monkye_service'` (must be `t`).
- **Roles + grants live in `packages/database/drizzle/roles.sql`**, applied automatically as the final step of `pnpm db:migrate` (after the schema migrations). Grants are **explicit per table** (no `GRANT … ON ALL TABLES`) so the global/scoped split is auditable; a migration that adds a table must add it to `roles.sql`.
- **RLS predicate functions live in `packages/database/functions.sql`** (SECURITY DEFINER `is_project_member` / `is_project_owner`), applied by `db:migrate` **before** the schema migrations. They are kept out of the generated migrations on purpose — drizzle-kit doesn't manage functions, so burying them in a generated file would let a future `db:generate` drop them and silently break RLS.

## Core conventions

- **Raw vs derived.** `game_metrics` is an immutable landing layer — never mutate it. `game_stats` and analytical `lifecycle_events` are pure functions of raw, rebuilt from scratch and idempotent on their natural key. A derive bug is fixed by re-deriving, never by patching raw.
- **Idempotency.** Every scheduled write is safe to re-run; natural keys enforce it (`game_metrics` on `(universeId, capturedAt)`, etc.).
- **The confirmation rule.** A trend is real only when it moves across **multiple games AND correlates with CCU growth**. Enforce it in the derivation query, not the UI.
- **Fractional-index ordering.** Board card order is a text `orderKey`; a reorder rewrites one row, computed server-side from named neighbours. Never renumber a whole lane.
- **Five keys** carry the system: `universeId`, `userId`, `capturedAt`, `term`, and scoped-row `id`. Key consistently.

## Roblox scraping rules

- All Roblox endpoints are public/unofficial; **send no auth token**; fail soft on every call.
- Every outbound call goes through the worker's Go Roblox client: rate-limit first (`x/time/rate`, **60 req / 10s**, over-limit → skip, return no result), `User-Agent: monkyesuite-worker/1.0`, `context` timeout + backoff-with-jitter, structured log per call. Fan-out is a bounded goroutine pool with `errgroup`.
- **Sort rank is data** — persist it, don't just discover with it.
- **Carry-forward:** if a game is missing from a snapshot tick, re-insert its last metric at the current timestamp so velocity reads 0, not a fake spike.
- Isolate the discover/sorts scrape so its failure never fails snapshot.

## Commands (fill in as scaffolded)

```
# TS workspace (api, web, packages)
pnpm install
pnpm db:generate        # drizzle-kit generate (from packages/database)
pnpm db:migrate         # apply migrations
pnpm --filter api dev
pnpm --filter web dev
pnpm test               # Vitest
pnpm typecheck
pnpm lint

# Go worker (separate module, own toolchain)
cd apps/worker
go run ./cmd/worker     # run the tick loop locally
go test ./...
go vet ./...
```

Migrations are owned by `packages/database` and run **before** the worker starts against a fresh DB. The worker assumes the schema already exists.

## Guardrails for Claude Code

- **Never** connect `apps/web` to the database. Frontend talks to the API only.
- **Never** weaken RLS or add a scoped table without a membership policy.
- **Never** mutate `game_metrics` or make a derived value depend on another derived value.
- **Never** allow free-text tags — validate against the vocabulary at the API.
- Prefer editing existing packages over adding new ones; ask before introducing a new top-level dependency.
- The **worker is Go, the API and web are TS** — don't try to unify them or make the Go worker import TS packages. They share only the database.
- Keep the CPU strategy intact: I/O concurrency in Go, aggregation in Postgres. Don't compute signals over big in-memory arrays in the worker.
- Keep changes scoped to one area (`specs/` doc) at a time; match the build sequence in `specs/00-overview.md`.
