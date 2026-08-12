# monkyesuite — Product Requirements Document

**Status:** draft v1
**Owner:** you (+ ≤2 collaborators)
**Last updated:** 2026-08-12

---

## 1. What this is

monkyesuite is a **Roblox trend-intelligence platform** with a collaboration layer bolted on top. It watches the games that are already winning, reads where they are collectively steering — mechanics, cadence, progression — and lets a tiny team organize bets around what it finds.

It is the successor to Trend Lens, rebuilt lighter and re-hosted so each half runs on a runtime that fits its shape.

The wedge is unchanged: **signal over data.** Anyone can show a CCU number. The product's job is to turn public shadows into *direction* — what's heating, what's cooling, and what design pattern is spreading across the winners before it's obvious.

## 2. Why it exists / the honest constraint

We do not operate any Roblox games yet. That single fact defines the product's current scope:

- We have **no source of truth** — no retention, no bounce, no spend, because those are only visible from inside a game we own.
- Everything observable is a **proxy**: CCU, votes, favorites, visits, update cadence, event flags.
- Therefore monkyesuite is a **demand-and-direction engine**, not a retention oracle. It forecasts what's rising and where design is heading. It cannot yet prove what *retains* — that gap is exactly what a first launched game would close.

The product is built so that the day a game does launch, the proxy models have been pressure-tested against their own dated predictions and are trustworthy enough to grade real telemetry against.

## 3. Users & scale

- **Primary:** the operator (you) — a market scout hunting directional trends to inform which games to build.
- **Secondary:** up to two invited collaborators per project, tagging games and organizing work.
- **Scale:** tiny and trusted. Bounded game set (charts + manual adds), three humans. This scale is a feature — it rules out heavy infrastructure and rules in a few disciplines (controlled vocabulary, membership gating) that only matter once more than one person writes data.

Explicit non-audience: public sign-ups, large teams, external customers. No feature should be justified by "it scales." It doesn't need to.

## 4. Goals & non-goals

**Goals**
- Track a curated set of Roblox games with 5-minute-resolution snapshots.
- Derive lifecycle + trend signals (velocity, spike, trend score, stage) from raw metrics.
- Let the team tag games on independent axes with a controlled vocabulary.
- Detect **directional trends** — a tag/mechanic spreading across multiple *rising* games.
- Fold in off-platform demand (YouTube, Google Trends) as a leading indicator.
- Provide project workspaces where the team pins games, writes tasks and notes, and records dated calls.
- Keep the whole thing lightweight, cheap to run, and operable by one person.

**Non-goals (now)**
- First-party game telemetry (no games yet).
- Opportunity-scoring / greenlight automation (that's the selection loop's *future* form).
- Public multi-tenant SaaS, billing, roles beyond owner/member.
- Real-time collaboration, mobile apps, notifications infra.
- TikTok ingestion (no viable free API — manual or skip).

## 5. Core concepts

**The two data realms.** Everything is either *global* (scraped once, shared, no access control) or *project-scoped* (gated by membership). Games, metrics, signals, tags, demand — global. Projects, tasks, notes, invites, memberships — scoped. The single bridge between them is `project_game`.

**The five keys.** `universeId`, `userId`, `capturedAt` (the time axis), `term` (off-platform), and a synthetic id for scoped rows. Consistent keying is what makes the system a set of joins rather than a pile of tables.

**Raw vs derived.** `game_metrics` is an immutable landing layer — exactly what was scraped, never mutated. `game_stats` and `lifecycle_events` are rebuilt *from* it. A derivation bug never corrupts history; you re-derive.

**The confirmation rule.** A trend is real only when it is **moving across multiple games at once AND correlating with CCU growth.** One game adding pets is a choice; five rising games adding pets is a direction. Every flagged trend is checked against this bar. This rule is the product's spine — it's what keeps it from chasing noise.

**The open loop.** With no games of our own, the selection loop runs open: it makes dated calls and grades them against what the shadows did next. That self-grading is the only flywheel available pre-launch, and it's what earns the model's trust over time.

## 6. Architecture at a glance

Three deployables, split by workload shape:

- **Worker — a persistent Go service (Railway).** Runs the tiered-cron **scraper** and orchestrates the **derive** pipeline. Go is deliberate: the scrape fan-out is I/O-concurrency-bound and an earlier edge version carried severe CPU load. The fix is Go for concurrent fetching plus **Postgres for aggregation** — window-function math runs in the database, never in worker memory.
- **API — a TypeScript service (Railway).** The HTTP layer and authorization boundary.
- **Frontend — TanStack Start SSR (Cloudflare).** Calls the Railway API over HTTP; never touches the database directly.

Alongside them, **Railway Postgres** is the single source of truth, shared by worker and API, with row-level security on scoped tables. Schema and migrations are owned solely by `packages/database` (Drizzle); the Go worker connects via `pgx` and writes the existing tables without redefining them.

The frontend crosses an HTTP boundary into the API (it does not read the database), and **that boundary is where the project-membership check lives** — enforced once, backstopped by Postgres RLS.

The worker and API are **separate Railway services** (a Go worker and a TS API can't share a process) pointing at the same Postgres. The old edge-specific machinery (KV, queues, edge rate limiter) is gone: the limiter is `x/time/rate` in the worker, the enrich queue is a Postgres work table, and hot-read caching is a short-TTL in-process cache in the API.

**Language line:** TypeScript for the API, web, and shared packages; **Go for the worker only**, with no cross-imports between them — they share only the database.

## 7. Realm map

The project decomposes into eight realms. Each gets its own spec.

| # | Realm | Job | Runtime |
|---|-------|-----|---------|
| R1 | **Ingestion & Scheduling** | Discover games, snapshot metrics on the tiered cron, stay a well-behaved rate-limited client | Railway (worker) |
| R2 | **Signals & Intelligence** | Derive velocity/spike/trend/lifecycle; detect trend-drift via the confirmation rule | Railway (derive) |
| R3 | **Tagging** | Controlled-vocabulary tagging on independent axes; multi-writer discipline | API + Web |
| R4 | **Off-platform Demand** | YouTube + Trends ingestion, term↔game/theme mapping, "heating not yet reflected" flag | Railway + API |
| R5 | **Projects & Collaboration** | Build-project tracker: board, milestones, tasks, docs, notes; optional `project_game` link | API + Web |
| R6 | **Identity & Access** | Auth, membership, invites, the RLS/membership enforcement model | API |
| R7 | **API** | The HTTP contract between frontend and data; the auth boundary | Railway |
| R8 | **Web / Frontend** | Pulse feed, discovery views, tagging UI, project workspaces | Cloudflare |

Data & storage (the schema) is foundational and already specified in `schema.ts`; each realm spec references the tables it owns.

## 8. Functional requirements (summary)

Detailed requirements live in the per-realm specs. Top-level musts:

- **FR-1** The scraper pulls a bounded, curated game set on a 5-minute tick and writes idempotent raw snapshots.
- **FR-2** Derivation is a pure function of raw metrics and can be replayed from scratch.
- **FR-3** Tags are chosen from a fixed vocabulary per axis; free-text tagging is impossible in the UI.
- **FR-4** Trend detection surfaces only trends passing the multi-game + growth confirmation rule.
- **FR-5** Off-platform terms map to a game or a theme, and the system flags external-rising / on-platform-flat cases.
- **FR-6** A project is a team build effort with a Kanban board, milestones, docs, and notes, scoped to its members; it may optionally attach tracked games as research.
- **FR-7** Every project-scoped read/write is gated at the API and backstopped by RLS.
- **FR-8** A user can invite up to two collaborators per project by email.
- **FR-9** The team can record a dated "call" and later mark it resolved against outcome — the self-grading loop.

## 9. Success metrics

Because there's no revenue and no live game, success is measured on the *intelligence*, not the business:

- **Trend lead time** — how many days before a mechanic hits the charts did the system flag it (validated retrospectively against logged calls).
- **Call accuracy** — of dated predictions, what fraction resolved correct at check-in.
- **Coverage** — share of tracked games fully tagged across all axes.
- **Freshness** — every game snapshotted within its tier's SLA; zero silent scrape gaps.
- **Operability** — the whole thing runnable and debuggable by one person without on-call.

## 10. Phasing

- **Phase 1 — Tracker backbone.** Ingestion, derivation, Pulse feed, game detail. Reaches parity with Trend Lens on the new stack.
- **Phase 2 — Tagging + trend-drift.** Vocabulary, tagging UI, and the daily tag-drift signal that feeds discovery. This is the piece that turns the log into something queryable.
- **Phase 3 — Off-platform demand.** YouTube/Trends ingestion and the heating flag.
- **Phase 4 — Projects & collaboration.** Auth hardening, membership, invites, tasks, notes, `project_game`, dated calls.

Phases 1–3 are single-user useful; Phase 4 is where the second and third seats matter and identity/access work lands.

## 11. Risks & open questions

- **Proxy blindness.** A model calibrated only against other external signals gets good at predicting CCU and stays blind to retention. Mitigation: label every scraped signal as an estimate; never let a proxy masquerade as truth in the UI.
- **Charts endpoint fragility.** Roblox's chart/omni-recommendation format shifts and is the most likely scrape to break. Mitigation: isolate it so its failure doesn't fail the batch.
- **Tag drift across writers.** Three people free-typing tags corrupts every count. Mitigation: dropdown-from-fixed-vocabulary, enforced in the UI, vocabulary edits deliberate.
- **RLS on self-hosted Postgres.** No `auth.uid()` convenience; the app must set `app.current_user_id` per transaction. Mitigation: a single DB helper all scoped queries route through; API check is primary, RLS is backstop.
- **Open question:** does the PM need tight game-linkage, or would Linear/Notion beside the tracker suffice? The spec assumes linkage (that's the only justification for building it) — revisit if `project_game` goes unused.
- **Open question:** Go for the scrape fan-out, yes or no? Deferred until the TS scraper is measured under real load.
