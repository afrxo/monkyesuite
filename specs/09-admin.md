# 09 — Admin Panel (operator surface)

Context: `00-overview.md`, `06-identity-access.md`, `01-ingestion.md`, `02-signals.md`, `docs/api-contract.md`.

New tables: `job_runs`, `job_commands`, `audit_log`. Additive columns: `users.is_admin`, `enrich_jobs.last_error` + `enrich_jobs.updated_at`. Reads `enrich_jobs`, `games`, `game_metrics`, `game_stats`, `game_tags`, `tags`, `users`, `invites`, `pg_stat_activity`.

The admin panel is the **operator's window into the worker**. The worker exposes no HTTP and never will — it is a tick loop, not a service. So every health number the panel shows is read **from Postgres**, and every action the panel takes is a **row the worker picks up on its next tick**. The database is the whole control plane.

This is the **highest-privilege surface in the system**: it reads across every realm and can trigger writes to the global scraped tables. It is therefore the one surface with no RLS backstop underneath it (global tables carry no policies), which makes its API gate load-bearing in a way no other gate is. §9.2 is the security core of this doc.

## Step 9.0 — Shape: server-rendered htmx off `apps/api`

- Mounted at **`/admin`** on `apps/api` — **outside `/v1`**, outside the JSON contract in `docs/api-contract.md`. No route in this doc appears there, and no response uses the JSON error envelope.
- Responses are **`text/html; charset=utf-8`**, server-rendered. Interaction is **htmx** — `hx-get` for panel refresh, `hx-post` for actions, swapping HTML fragments. **No React, no client bundle, no build step.** The panel ships with the API.
- **DB access lives in the handler.** These handlers read Postgres directly (`packages/database`, drizzle) and render. There is no admin JSON API to consume — deliberately: an admin JSON API is a second privileged surface to secure, and the panel has exactly one consumer.
- **Same-origin only.** `/admin` is excluded from the API's CORS allowance — no browser origin may call it cross-origin. `apps/web` never links to it and never proxies it.
- Every page sends `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`.
- Two response kinds per route: a **full page** (direct navigation) and a **fragment** (htmx request, identified by the `HX-Request` header). Fragments are the same markup without the shell.

**Poll cadence.** Monitoring panels self-refresh with `hx-trigger="every 30s"`. The tick interval is 5 min (`sched.TickInterval`), so 30s is well inside the data's own resolution while keeping the panel live. Each panel polls its own fragment endpoint independently — one slow query never blocks the page.

## Step 9.1 — The `admin` role (schema change)

A **new global role**, distinct from the project realm. Project `owner` is scoped to one project and confers nothing globally; **a project owner must not reach `/admin`**, and being an admin confers no membership in any project.

**Recommendation: a boolean flag on `users`.**

```ts
// packages/database/src/schema.ts — users (Better Auth owns this table)
isAdmin: boolean("is_admin").notNull().default(false),
```

Why the flag over a `global_roles` table:

- There is exactly **one** global role and no second one in view. A `global_roles` table models a many-to-many that will hold at most one row per admin — structure without a question to answer.
- The gate runs on **every** `/admin` request. The flag rides along on the session's user row the middleware already reads; a table means a join (or a second query) on the hottest path of the most privileged surface.
- `users` carries **no RLS** by design (`schema.ts`: session lookup must succeed before user context exists, so the app role reads it unfiltered). The flag is therefore readable inside the gate without any policy dance. A new `global_roles` table would need its own grant + policy decision, and getting that wrong on the admin path is exactly the failure this design avoids.
- Better Auth owns `users` but does not own its columns — an additive nullable-with-default column is invisible to its adapter (the adapter maps by declared field name; extra columns are ignored).
- **Migration path if a second global role ever lands:** add `global_roles`, backfill one row per `is_admin = true` user, drop the flag. One migration, no data loss. Cheap enough that pre-building the table now is not justified.

**Granting admin is not a product feature.** There is no "make this user an admin" button — that would let the panel escalate its own privilege. `is_admin` is set by a **direct SQL statement against the database by the operator**, out of band. The panel displays who is an admin; it never writes the flag. Bootstrapping the first admin is the same statement.

## Step 9.2 — The admin gate

**A third auth family**, alongside the five in `docs/api-contract.md` — not a variant of `owner`, not reachable by any membership:

| Family | Requirement | 401 | 403 |
|---|---|---|---|
| **admin** | valid session **and** `users.is_admin = true` | no session / invalid session | authenticated but `is_admin = false` |

One chokepoint helper, mirroring `resolveProjectAccess` in `apps/api/src/access.ts`:

```ts
// apps/api/src/admin/gate.ts
export async function requireAdmin(c: Context<AppEnv>): Promise<string>
```

It reuses `resolveSession` / `requireUser` (`middleware.ts`) for identity, then reads `users.is_admin` for the caller. Rules:

- **Fails closed.** No session, unreadable session, missing user row, `is_admin` null/false, or *any* error resolving the flag → deny. There is no path through the helper that returns success without an affirmative `is_admin = true` read.
- It is applied as **route-group middleware on the `/admin` mount**, not per handler. A new admin route is gated by existing; forgetting to add the check is not possible.
- **No RLS backstop exists here.** The panel reads global tables, which carry no policies. Unlike every scoped route, a bug in this gate is not caught by the database. That is why the gate is middleware on the mount and why every action re-asserts admin before writing (§9.4).

**401 / 403 behaviour** (HTML, not the JSON envelope):

- **401** — no valid session.
  - Full page → `302` to `/admin/login`, a minimal server-rendered form posting to the Better Auth sign-in endpoint. Same session, same cookie as the rest of the API; no separate admin credential exists.
  - htmx fragment → **`401`** with header `HX-Redirect: /admin/login` (an inline swap of a login form into a monitoring panel would be a confusing target for credential entry).
- **403** — authenticated, not an admin. A bare HTML `403` page: *"Not authorized."* **No detail, no navigation, no hint that a panel exists.** Identical for a project owner, a member, and a signed-in stranger.
- **`/admin/login` is the only ungated route** under the mount, and it renders the same form whether or not the visitor is an admin — signing in as a non-admin lands on the 403 page.
- Every 403 is written to `audit_log` (§9.5) as a `denied` outcome. Repeated denials for one user are the signal that matters.

## Step 9.3 — Credentials: two different things

The panel touches two categories that share a word and share nothing else. Keep them apart.

### 9.3a — App identity (the panel may create these)

Accounts and project access inside monkyesuite. **Reuse what exists — do not reinvent:**

- **Create user** — call the **Better Auth server API** (`apps/api/src/auth.ts`) to create the account, exactly as the public sign-up path does. Same password hashing, same `accounts` row, same validation. The panel is a different *caller*, never a different *mechanism*. The created user is **never** an admin (§9.1).
- **Send project invite** — reuse the **existing invite flow** (`06-identity-access.md §6.3`): a `pending` invite with a token and `expiresAt`, delivered by email, accepted into a `membership`. The **two-collaborator cap still applies** and is enforced by the same code the owner-gated route uses; the panel gets no exemption.

**RLS note (important).** `invites` is project-scoped: its insert policy requires the caller to be the project's owner. An admin is *not* a member, so a plain insert under `app.current_user_id` correctly resolves zero rows. Two ways not to fix this: weakening the invite policy, or fabricating a membership row for the admin. Both are wrong — they'd blur the realms.

Resolution: a **SECURITY DEFINER function in `packages/database/functions.sql`** (alongside `is_project_member` / `is_project_owner`):

```sql
admin_create_invite(project_id uuid, email text, role text, invited_by text) returns uuid
```

It runs as the table owner, so it bypasses the policy, and it **enforces the collaborator cap internally** (raising on breach) so the cap cannot be routed around. The API calls it **only after `requireAdmin`**, and the surrounding TS reuses the shared invite-creation logic (token generation, expiry, email) from the owner-gated path. The RLS policies stay exactly as they are.

### 9.3b — Operational secrets (the panel never touches the values)

The YouTube API key, the service database credentials, the rotunnel base URL, and anything else of that kind.

> **Hard rule: the panel never stores, renders, logs, echoes, or accepts a secret value. Not masked, not partially masked, not behind a reveal control, not in an edit field. These values live in Railway environment variables and nowhere else. There is no code path in `/admin` that reads a secret's value into a response body.**

The panel shows a **status table only**, derived without reading any value:

| Column | Source |
|---|---|
| name | a static registry of expected env keys (`YOUTUBE_API_KEY`, `ROTUNNEL_BASE_URL`, …) |
| configured | `process.env[key]` is a non-empty string — a **boolean**, never the value |
| last used | most recent `job_runs` row for the job that consumes it, and whether it succeeded |
| consumer | which job uses it (`demand`, `enrich`, …) |

Rotating a secret is a Railway operation followed by a service restart. The panel's job is to answer *"is it set, and is it working?"* — nothing more. A key that is configured but whose consumer job has been failing all day is exactly the state this table exists to surface.

## Step 9.4 — Monitoring panels

All panels read Postgres. The worker is observed through the rows it leaves behind, never queried directly. Each panel is one fragment endpoint under `/admin/panels/…`.

### 9.4.1 — Snapshot freshness (the primary data-quality signal)

**Per tick: real rows vs carried-forward rows.** Carry-forward (`01-ingestion.md §1.2`) is a correctness mechanism — velocity reads 0 instead of a fake spike. But a *rising* carry-forward rate means the snapshot is silently degrading: metrics still land, the feed still renders, and the numbers are stale. Nothing else in the system surfaces that, which is why this panel leads.

Source: `job_runs` rows where `job = 'snapshot'`, `metrics->>'tracked' | 'real' | 'carried'`.

Display: a sparkline of `carried / tracked` over the last ~288 ticks (24h), plus the current tick's raw counts.

**Visual alert** on a spike — thresholds as displayed bands, not stored config:

- `< 5%` — normal (a handful of private/deleted games per tick).
- `5–20%` — **warn** (amber): partial batches, 429s, or an enrich drain leaking into the critical budget.
- `> 20%`, **or** the rate more than tripling against its own trailing-24h mean — **alert** (red), with the last snapshot `job_runs.error` shown inline.
- `= 100%` — the snapshot job is running but fetching nothing. Loudest state on the page.

### 9.4.2 — Enrich queue

Source: `enrich_jobs` (§9.6 adds `last_error`, `updated_at`).

- **Depth** — `status = 'pending'` and `run_after <= now()` (due) vs scheduled ahead.
- **In-flight** — `status = 'running'`, with the **age of the oldest** such row. A `running` row older than a tick is a crashed claim, not work in progress — flag it.
- **Failed / dead-letter** — `status = 'failed'` (retry budget exhausted, `01-ingestion.md §1.4`), with `attempts` and `last_error`.
- **Per-kind breakdown** — grouped by `kind` (`universe` | `creator`), since the two fail for different reasons: `universe` failures point at rotunnel, `creator` failures at the Groups/Studio endpoints.
- **Action: requeue dead-letter** (§9.5).

### 9.4.3 — Limiter: two-tier budget under load

The two-tier budget (`01-ingestion.md §1.0`, §1.5) is the structural guarantee that a daily enrich drain cannot starve a snapshot. This panel is where that guarantee is **verified holding under load** rather than assumed.

Live limiter state is in-process Go memory (`roblox.Client.limiter`) and the panel cannot reach it. So the worker **records consumption per job run**, and the panel splits by tier via the job → tier mapping — `discover` · `snapshot` · `events` draw from **critical (40/10s)**, `enrich` draws from **enrich (20/10s)**:

| Metric | Source |
|---|---|
| calls issued, per tier | sum of `job_runs.metrics->>'callsIssued'` grouped by tier |
| calls **skipped** on a closed gate, per tier | sum of `metrics->>'callsSkipped'` — a token wasn't immediately available, so the call was dropped (`§1.0`: skip, never block) |
| skip rate per tier | skipped / (issued + skipped) |
| aggregate rate | both tiers summed against the 60 req/10s politeness ceiling |

**The reading that matters:** enrich skips rising while critical skips stay near zero is the design working — the drain saturates its own pool and the tick keeps its full budget. **Critical skips rising during an enrich drain means the pools are sharing tokens** — the exact failure §1.5 exists to prevent, and a bug in the client, not a capacity problem. Call that out in the panel copy.

### 9.4.4 — Derive health

Derive is orchestration in Go, computation in Postgres (`02-signals.md`). Both halves are observed here.

- **Last successful derive tick** — most recent `job_runs` where `job = 'derive'` and `status = 'ok'`, with age. Derive runs every tick, after snapshot; an age over ~2 ticks is a problem.
- **Rows written** — `job_runs.rows_written` (`game_stats` rows upserted), trended. A derive that succeeds while writing zero rows is a silent failure and reads differently from a crash.
- **Duration** — `job_runs.duration_ms`. Derive duration creeping toward the 5-min tick interval is the early warning that the SQL is outgrowing the cadence.
- **Postgres load during derive** — read **live** from `pg_stat_activity`: active backends, longest-running query age, and whether any statement is currently `active` for the derive queries. No new table; this is a point-in-time read at panel load. (`pg_stat_statements` gives per-statement totals if the extension is available on the Railway instance — treat as optional and degrade to `pg_stat_activity` alone.)

### 9.4.5 — Gated-endpoint failure rates

The rotunnel proxy (gamepasses, dev products) and the Studio/Groups endpoints are gated by Roblox and reached third-party. They fail; that is expected and enrichment fails soft (`01-ingestion.md §1.4`). **A steady failure rate is normal and not actionable. A rising one is the signal** — it means an endpoint changed shape or the proxy died, and monetization data is quietly going stale.

Source: `job_runs.metrics->'endpoints'` — a per-run `{ "<group>": { "ok": n, "fail": n, "skipped": n } }` map, groups being `rotunnel-passes`, `rotunnel-products`, `studio-games`, `groups-meta`, `explore`, `games`, `votes`, `virtual-events`, `thumbnails`, `place-details`.

Display: failure rate per group over 24h and 7d **side by side**, sorted by the delta. The 7d column is the baseline that makes the 24h column readable; a group at a steady 40% is fine, a group that went 2% → 40% is the alert.

### 9.4.6 — Trend-drift: is the confirmation rule firing?

The confirmation rule (`00-overview.md`, `02-signals.md §2.3`) is the product's central claim: nothing is a trend unless it moves across multiple games **and** correlates with CCU growth. It is enforced in SQL and produces **no table** — `trendDriftJob` runs the query and logs the count (`apps/worker/internal/jobs/derive.go`). Tagging (`03-tagging.md`) is what feeds it, so until tags existed the rule had nothing to confirm. This panel answers whether it is firing **now**.

Two reads:

- **Live** — run the §2.3 query read-only at panel load, at `TrendDriftMinRising` (currently 3) and also at thresholds 1 and 2. Show `rising_carriers` / `total_carriers` per `(axis, slug)`.
  - Rows at threshold 1–2 but **none** at 3 → the rule is working and the corpus is too thin. Not a bug.
  - **Zero rows at every threshold** → tags aren't being applied, or `game_stats.lifecycle` isn't classifying anything as `growing`/`launching`. Show the tag-coverage count (`count(distinct universe_id)` in `game_tags` vs tracked games) beside it so the two causes are distinguishable at a glance.
- **Trend over time** — daily confirmed-tag count from `job_runs` (`job = 'trend-drift'`, `metrics->>'confirmed'`), so a rule that stops firing is visible as a cliff rather than an absence.

### 9.4.7 — Job run history

Last N runs per job — `discover` · `snapshot` · `events` · `enrich` · `derive` · `trend-drift` · `demand` — with **tick, started, duration, status, rows written, error**. Filterable by job and status; failures-only is one click. This is the panel that turns "something is wrong" into "which job, when, and what did it say."

Sourced entirely from `job_runs` (§9.6).

## Step 9.5 — Actions (admin-gated, audited)

Every action is an `hx-post`, re-asserts `requireAdmin` inside the handler (belt and braces over the mount middleware), validates its body with **Zod** (`07-api.md §7.4`), **writes an `audit_log` row in the same transaction as its effect**, and swaps back the affected panel fragment.

Two destructive actions (**purge**, **remove game**) require a typed confirmation in the form body — the string must match the target identifier. htmx `hx-confirm` is a convenience, not the control.

| Action | Route | Effect | Audit action |
|---|---|---|---|
| **Trigger scrape / derive tick** | `POST /admin/actions/run-job` | insert a `job_commands` row (`kind = 'run_job'`, `job = <name>`); the worker claims it on its next tick | `job.trigger` |
| **Requeue dead-letter** | `POST /admin/actions/enrich/requeue` | `enrich_jobs` rows `status='failed'` → `status='pending'`, `attempts=0`, `run_after=now()` — by id, or all of one `kind` | `enrich.requeue` |
| **Purge dead-letter** | `POST /admin/actions/enrich/purge` | delete `status='failed'` rows (by id or kind) | `enrich.purge` |
| **Add game to tracked set** | `POST /admin/actions/games/track` | upsert `games` (manual seed, `ON CONFLICT (universe_id) DO NOTHING`), mark tracked | `game.track` |
| **Remove game from tracked set** | `POST /admin/actions/games/untrack` | clear the tracked flag — **never deletes `game_metrics`** | `game.untrack` |
| **Create user** | `POST /admin/actions/users/create` | Better Auth server API (§9.3a) | `user.create` |
| **Send invite** | `POST /admin/actions/invites/create` | `admin_create_invite(...)` + existing invite email (§9.3a) | `invite.create` |

**Notes that are rules, not preferences:**

- **Manual trigger is a request, not an execution.** The worker owns the tick loop; the panel cannot run a job. It inserts a command row and the worker picks it up — at most one tick (5 min) later. The UI says *queued*, shows the command's `status`, and resolves to the resulting `job_runs` row. Anything else would need worker HTTP, which does not exist and should not.
- **Idempotency holds.** Every scheduled write is safe to re-run (`CLAUDE.md`), so a manual trigger is safe by construction — natural keys make a duplicate tick a no-op. A pending command for the same job is **not** enqueued twice.
- **Untrack never deletes raw.** `game_metrics` is an immutable landing layer. Untracking stops future collection; history stays and stays re-derivable. There is no panel action that deletes from `game_metrics`, and none should be added.
- **Purge is bounded.** It deletes only `status = 'failed'` rows from a work queue — never scraped data.

## Step 9.6 — Telemetry gap (required additions)

**Confirmed gap.** The prompt assumes a `job_runs` telemetry table. **It does not exist.** `packages/database/src/schema.ts` has `enrich_jobs` (the enrich work queue) and nothing else job-related; worker telemetry today is `slog` output (`sched.go` logs `job failed`; jobs log their own counts), which is unqueryable from the API and lost on restart. **Panels 9.4.1 and 9.4.3–9.4.7 cannot be built without it.**

Three new tables and two additive columns. All are **global** (worker-owned, no RLS), and all must be added to `packages/database/drizzle/roles.sql` per-table grants in the same migration (`CLAUDE.md`: a migration that adds a table must add it to `roles.sql`).

### `job_runs` — one row per job execution

```
id           uuid pk default random
job          text not null        -- discover|snapshot|events|enrich|derive|trend-drift|demand
tick         bigint not null      -- the loop's tick counter
tier         text not null        -- critical|enrich  (limiter pool the job draws from)
started_at   timestamptz not null
finished_at  timestamptz
duration_ms  integer
status       text not null        -- ok|error|skipped
rows_written integer not null default 0
error        text                 -- the failure, when status='error'
metrics      jsonb not null default '{}'
```

Indexes: `(job, started_at desc)` for per-job history; `(started_at desc)` for the cross-job feed.

**Retention:** prune rows older than **14 days** on the daily tier — bounded at roughly 288 ticks × 4 every-tick jobs × 14 days ≈ 16k rows, small enough that the jsonb aggregation in 9.4.5 stays cheap without a rollup table.

**The `metrics` contract per job** — this is the part the panels depend on, so it is specified, not free-form:

| job | required keys |
|---|---|
| all | `callsIssued`, `callsSkipped`, `endpoints: { "<group>": { ok, fail, skipped } }` |
| `snapshot` | `tracked`, `real`, `carried` — **9.4.1 depends entirely on these** |
| `discover` | `sortsOk`, `sortsFailed`, `gamesSeen`, `newGames` |
| `events` | `bucket`, `gamesPolled`, `eventsUpserted` |
| `enrich` | `claimed`, `done`, `failed`, per-`kind` counts |
| `derive` | `statsRows`, `lifecycleEvents` |
| `trend-drift` | `confirmed`, `minRising` |
| `demand` | `terms`, `ytQuotaUsed` |

Writing the row is the scheduler's job, not each job's: `sched.Loop.runAll` already wraps every `Job.Run` and catches its error — it stamps start/finish/status/error there, and the `Job` interface gains a way to hand back its counters and `rowsWritten`. One write site, uniform for every job, impossible to forget in a new one.

> **The enrich exception (as built).** Enrich is two phases with different lifetimes: a fast enqueue inside the tick, and a **detached drain** that runs long after the tick returned (`01-ingestion.md §1.4`). One row cannot honestly describe both — it would either attribute the drain's minutes to the tick or lose the drain's call counters, which are the *only* source of enrich-tier consumption for §9.4.3. So the drain records its own row under the job name **`enrich-drain`** (tier `enrich`), carrying the real `claimed`/`done`/`failed` and per-kind splits; the `enrich` row carries those keys at zero plus `enqueuedUniverses`/`enqueuedCreators`. Panels reading enrich queue outcomes should read `enrich-drain`.
>
> **Gated failures do not dead-letter.** Enrichment fails soft by design — a rotunnel outage logs and returns, so the job completes and `enrich_jobs` never dead-letters. Verified: with every gated endpoint unreachable, the drain reported `done: 15, failed: 0` while `endpoints` recorded the failures. §9.4.2's dead-letter panel therefore stays empty during an upstream outage, and **§9.4.5 is the panel that shows it** — which is exactly the division of labour those two panels were specified for.

### `job_commands` — the panel → worker channel

```
id            uuid pk default random
kind          text not null        -- run_job
job           text not null        -- which job to run
status        text not null default 'pending'  -- pending|claimed|done|failed
requested_by  text not null references users(id)
requested_at  timestamptz not null default now()
claimed_at    timestamptz
finished_at   timestamptz
error         text
```

Index `(status, requested_at)` for the claim query. The worker drains pending commands **at the top of each tick** with `SELECT … FOR UPDATE SKIP LOCKED` — the same claim pattern as `enrich_jobs` (`01-ingestion.md §1.4`), no new machinery. A command runs the named job **out of cadence**, then marks itself `done`/`failed`. Commands are the only path the panel has into the worker; keep the `kind` vocabulary closed and small.

### `audit_log` — who did what, when

```
id          uuid pk default random
actor_id    text not null references users(id)
action      text not null        -- job.trigger|enrich.requeue|…|admin.denied
target      text                 -- the affected id: universeId, job name, email, …
detail      jsonb not null default '{}'   -- request params, never a secret value
outcome     text not null        -- ok|error|denied
ip          text
created_at  timestamptz not null default now()
```

Index `(created_at desc)` and `(actor_id, created_at desc)`.

- Written **in the same transaction as the effect** — an action that succeeds without an audit row, or an audit row for an effect that rolled back, both defeat the point.
- Also written for **every 403 at the gate** (`action='admin.denied'`, `outcome='denied'`) — attempted access is the entry worth having.
- **`detail` never contains a secret value** (§9.3b) and never a password or invite token. Enforced by only ever writing named, whitelisted fields into it — never a raw request body.
- **Append-only.** No panel route updates or deletes from `audit_log`. It is readable at `/admin/audit`, paged, filterable by actor and action.

### Additive columns

- **`enrich_jobs.last_error text`** — 9.4.2 shows *why* a job dead-lettered. Today `enrich_jobs` records `attempts` but not the failure, so a dead-letter row is unactionable.
- **`enrich_jobs.updated_at timestamptz not null default now()`** — the age of a `running` claim (a crashed claim vs live work) is not derivable from the current columns.
- **`users.is_admin boolean not null default false`** (§9.1).

### `roles.sql` grants

- **Global block** (both roles): `job_runs`, `job_commands` — the worker writes both, the API reads them and inserts commands.
- **App role only:** `audit_log` (`select`, `insert` — no `update`/`delete`, so append-only is a grant, not a convention). The worker never writes audit rows; it has no actor.

## Acceptance

- A signed-in **project owner** who is not an admin gets a bare `403` at `/admin` — no panel, no hint, and an `admin.denied` audit row.
- A signed-out visitor gets `/admin/login` (full page) or `HX-Redirect` (fragment), never a panel fragment.
- No response body, log line, or `audit_log.detail` under `/admin` contains a secret value; the credentials panel renders booleans and timestamps only.
- Creating a user or invite from the panel goes through Better Auth and the existing invite flow; the two-collaborator cap still rejects the third.
- No RLS policy is weakened and no membership row is fabricated to make the admin invite action work.
- Snapshot freshness shows real-vs-carried per tick and turns red when the carry-forward rate spikes against its own trailing baseline.
- The limiter panel distinguishes enrich-tier skips (expected under drain) from critical-tier skips (a bug), verifying the two-tier reservation holds under load.
- Every write action produces exactly one `audit_log` row in the same transaction as its effect; a rolled-back action leaves none.
- A manual trigger enqueues a `job_commands` row and resolves to a `job_runs` row within one tick; triggering twice does not duplicate data (idempotency).
- Untracking a game deletes no `game_metrics` rows.
- The panel reads worker health **only** from Postgres — no code path calls the worker over HTTP.
```