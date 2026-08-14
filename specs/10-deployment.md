# 10 — Deployment

How monkyesuite gets from a GitHub push to running infrastructure. Both platforms
build **from the repo**: Railway and Cloudflare each hold their own GitHub
integration and deploy themselves on push to `main`. There are no CLI deploy
scripts and no artifact uploads — if a deploy needs a human to run a command, that
is a bug in this document.

Prerequisite reading: `specs/00-overview.md` (topology), `specs/06-identity-access.md`
(the two connection roles), `packages/database/src/schema.ts` (schema, and the
comments about what is set out of band).

---

## 10.1 Topology

Three deployables, one database.

| Deployable | Platform | Build | Serves |
|---|---|---|---|
| `apps/api` | Railway service **monkye-api** | `apps/api/Dockerfile` | HTTP API + `/admin`. The auth boundary. |
| `apps/worker` | Railway service **monkye-worker** | `apps/worker/Dockerfile` | Nothing. Tick loop, no HTTP. |
| `apps/web` | Cloudflare **Workers** | `vite build` + `wrangler deploy` | SSR frontend. |

Both Railway services point at the **same Railway Postgres**, on different roles:
`monkye_app` (RLS enforced) for the API, `monkye_service` (BYPASSRLS) for the
worker. `apps/web` never touches the database — it calls the API over HTTP only.

**Cloudflare Workers, not Pages.** `apps/web` is a TanStack Start SSR app. Pages'
static hosting would serve `dist/client` and drop the server build entirely,
turning every SSR route and loader into a client fetch. The Workers path keeps
SSR: `@cloudflare/vite-plugin` claims the `ssr` vite environment, and the Worker
entry is the virtual module `@tanstack/react-start/server-entry`.

---

## 10.2 CI (`.github/workflows/ci.yml`)

Triggers: push to `main`, PR to `main`. Four jobs, **no path filtering** — the
three deployables share one schema and two TS packages, so "the worker didn't
change" is not a reason to skip the Go build.

| Job | Runs |
|---|---|
| `ts-check` | `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm test` |
| `go-check` | in `apps/worker`: `go build ./...` → `go vet ./...` → `go test ./...` |
| `db-drift` | `pnpm db:generate`, then `git diff --exit-code -- packages/database/drizzle` |
| `lint` | `pnpm lint` with `NODE_OPTIONS=--max-old-space-size=4096` |

**CI never deploys.** Railway and Cloudflare react to the same push independently.
Adding a deploy step here would give one commit two deploy paths.

Three details that are easy to get wrong:

- **`ts-check` needs no Postgres.** `apps/api/src/tags.test.ts` skips itself when
  neither `APP_DATABASE_URL` nor `DATABASE_URL` is set; `admin.test.ts` sets a
  never-connected URL in `beforeAll` (the pool is lazy); the root script is
  `vitest run --passWithNoTests`.
- **`db-drift` needs a dummy `DATABASE_URL`.** `drizzle.config.ts` throws without
  one, but `generate` only diffs the snapshots in `packages/database/drizzle/meta`
   — it never connects. A changed file after `db:generate` means `schema.ts` moved
  without a committed migration.
- **`lint` is where the biome OOM fix lives.** Biome walks the whole workspace in
  one process and exhausts the default heap. The `NODE_OPTIONS` bump belongs in
  the job env, not in someone's shell profile, so CI and laptops agree.

---

## 10.3 Images

### monkye-api — `apps/api/Dockerfile`

Build context is the **repo root** (`docker build -f apps/api/Dockerfile .`),
because this is a pnpm workspace and the API imports
`@monkyesuite/{core,database,shared}` as raw TypeScript.

**There is no compile step, on purpose.** `apps/api` has no `build` script — it
runs TypeScript directly under `tsx`, and the workspace packages export
`./src/*.ts`. So the runtime image ships source plus `node_modules` **including
devDependencies**, because `tsx` *is* the runtime. What multi-stage buys here is
the filtered install (`pnpm install --frozen-lockfile --filter @monkyesuite/api...`):
`apps/web` never enters the image, and `apps/worker` is a separate Go module that
is not in the pnpm workspace at all.

Two things the image must not lose:

- **`packages/database/functions.sql` and `packages/database/drizzle/**`.**
  `migrate.ts` reads them from disk at runtime. Dropping them makes the migrate
  step a silent no-op.
- **`htmx.org` in `node_modules`.** `apps/api/src/admin/index.ts` resolves and
  reads `htmx.org/dist/htmx.min.js` on the first `/admin` request and serves it
  same-origin, because the admin CSP allows no external script host.

Exposes `8787` (`PORT` overrides; Railway injects it).

### monkye-worker — `apps/worker/Dockerfile`

`golang:1.26-alpine` builder → `CGO_ENABLED=0 go build ./cmd/worker` → **alpine**
runtime. `internal/store/sql/*.sql` are `//go:embed`-ed into the binary, so no
files are copied at runtime.

**Alpine, not scratch.** The worker's whole job is outbound HTTPS (Roblox,
rotunnel, YouTube). On `scratch` there is no CA bundle, and the failure mode is
not a startup crash — it is every job soft-failing x509 verification forever.

No `EXPOSE`, no healthcheck, no migrate step.

---

## 10.4 The migration invariant

> Migrations run in **one** place: the monkye-api container's start command.

```
pnpm --filter @monkyesuite/database db:migrate && pnpm --filter @monkyesuite/api start
```

`packages/database/src/migrate.ts` applies, in this order, in one process:

1. `functions.sql` — SECURITY DEFINER RLS predicates, applied with
   `check_function_bodies=off` so they can be created before the tables exist.
2. the drizzle migrations in `packages/database/drizzle/`.
3. `drizzle/roles.sql` — roles, the BYPASSRLS attribute, and every per-table grant.

The `&&` is load-bearing: a failed migrate means the API never starts, and the
healthcheck stays red rather than the service coming up against a half-migrated
schema. **The worker never migrates.** It assumes the schema exists — which is
why first-deploy ordering (§10.8) matters.

Because step 3 runs on **every deploy**, the explicit per-table grants re-apply
every time. Adding a table means adding it to `roles.sql`; the next deploy grants
it. Grants are never applied by hand after the first deploy.

---

## 10.5 Railway configuration

Railway resolves **one service per config file**, so the two services cannot share
a root `railway.toml`. There are two files, and the path is resolved from the repo
root — it does **not** follow the service's Root Directory.

| Service | Root Directory | Config-as-code path |
|---|---|---|
| monkye-api | `/` | `apps/api/railway.toml` |
| monkye-worker | `/` | `apps/worker/railway.toml` |

Root Directory stays `/` on both so the root lockfile and `packages/*` are in the
build context.

- **monkye-api** — `watchPatterns = ["apps/api/**", "packages/**", "pnpm-lock.yaml"]`.
  `packages/**` is there for two reasons: the API imports those packages as
  source, *and* a schema change must redeploy the API, because the API is what
  runs migrations. `healthcheckPath = "/health"` (unauthenticated, registered
  before `/v1` in `apps/api/src/app.ts`), timeout 300s so a cold first deploy can
  apply the whole migration chain before it starts listening.
- **monkye-worker** — `watchPatterns = ["apps/worker/**"]` only. **No
  `healthcheckPath`**: the worker serves no HTTP, and Railway would fail the
  deploy waiting on a port that never opens.

---

## 10.6 Environment

Variable names below are the ones the code actually reads. Do not invent aliases.

### monkye-api

| Variable | Value | Source |
|---|---|---|
| `DATABASE_URL` | Railway Postgres **superuser** DSN | injected by the Postgres plugin. Used **only** by `db:migrate`, which needs `CREATE ROLE` and `BYPASSRLS`. |
| `APP_DATABASE_URL` | `postgres://monkye_app:<pw>@…` | secret. The RLS-enforced runtime connection (`apps/api/src/db.ts`). Falls back to `DATABASE_URL` if unset — **do not rely on that in production**, it would run app traffic as superuser and silently bypass RLS. |
| `WEB_ORIGIN` | the Workers origin, comma-separated for several | scheme included, **no trailing slash**. Gates CORS on `/v1/*` only. |
| `API_BASE_URL` | the API's own public Railway URL | Better Auth `baseURL` + trusted origin (`apps/api/src/auth.ts`). |
| `BETTER_AUTH_SECRET` | random 32+ bytes | secret. The default in code is a dev placeholder — sessions are forgeable if it ships. |
| `PORT` | injected by Railway | default `8787`. |
| `NODE_ENV` | `production` | set in the image. |
| `YOUTUBE_API_KEY` | optional | **display-only here.** The API only presence-checks it for the admin secrets panel; the job itself runs in the worker. |
| `ROTUNNEL_BASE_URL` | optional | display-only, and not read by any code — see below. |

### monkye-worker

| Variable | Value | Source |
|---|---|---|
| `DATABASE_URL` | `postgres://monkye_service:<pw>@…` | secret. The BYPASSRLS service role. Unset → the worker warns and skips all DB writes; set but unreachable → exit 1. |
| `YOUTUBE_API_KEY` | real key | secret. **The worker owns the demand job** (`apps/worker/internal/jobs/demand.go`); unset → the job returns `Skipped`. |
| `WORKER_TICK_INTERVAL` | optional, a **Go duration** (`5m`, `10m`) — not seconds | default `5m` (`internal/sched/sched.go`). |
| `WORKER_HOUR_TICKS` / `WORKER_DAY_TICKS` | optional | defaults 12 / 288. |
| `TRENDS_ENABLED` | optional | only the literal string `"false"` disables the trends client. |
| `ROTUNNEL_BASE_URL` | optional | see below. |

**`ROTUNNEL_BASE_URL` is not wired.** `apps/worker/internal/roblox/enrich.go`
hardcodes the rotunnel URL. The variable exists only in the API's admin secrets
registry as a presence check, so setting it makes the panel read "configured" and
changes nothing else. Either wire it in the enrich client or drop it from the
registry — until then, this is what it does.

### monkye-web (Cloudflare)

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://<api-host>/v1` — **the `/v1` suffix is required** |
| `NODE_VERSION` | `22` (vite 8 needs `^20.19 \|\| >=22.12`) |

`VITE_API_BASE_URL` is inlined at **build** time (`apps/web/src/lib/api.ts`,
`authClient.ts`). Changing it needs a rebuild, not a redeploy.

---

## 10.7 Provisioning (out of band, once)

Get a psql session against the Railway database with either:

```bash
railway connect Postgres
```

or the connection string from the Postgres service's **Variables / Connect** tab.
Railway's managed Postgres provisions a superuser-equivalent role by default.

Most of what looks like provisioning is **already automatic**: `roles.sql` runs as
the last step of `db:migrate` on every deploy, and it creates `monkye_app` and
`monkye_service` (guarded by `pg_roles` existence checks), sets
`ALTER ROLE monkye_service BYPASSRLS`, and grants `pg_monitor` to `monkye_app`.
None of that is ever run by hand.

What genuinely needs a human, in order:

**1. Confirm the migrate connection is superuser — before the first deploy.**

```sql
SELECT rolsuper FROM pg_roles WHERE rolname = current_user;
```

Note the deliberate asymmetry in `roles.sql`: the `pg_monitor` grant is wrapped in
an exception handler and degrades to a warning, but
`alter role monkye_service bypassrls` is **unguarded**. A non-superuser DSN fails
the migration and the API does not start. That is the correct failure: a service
role that silently lacks BYPASSRLS would have its global writes RLS-filtered, and
the scraper would look like it was simply finding nothing.

**2. Rotate both role passwords — after the first deploy.**

`roles.sql` creates the roles with the literal passwords `app_pw` / `service_pw`.
They are development defaults and must not survive first contact with production:

```sql
ALTER ROLE monkye_app     PASSWORD '<generated>';
ALTER ROLE monkye_service PASSWORD '<generated>';
```

Then put those into `APP_DATABASE_URL` (API) and `DATABASE_URL` (worker).
Re-running `roles.sql` does **not** reset them: creation is existence-guarded, and
the `alter role` lines only touch the BYPASSRLS attribute.

**3. Verify the grants landed.**

```sql
SELECT rolbypassrls FROM pg_roles WHERE rolname = 'monkye_service';  -- must be t
SELECT pg_has_role('monkye_app', 'pg_monitor', 'member');            -- t, or the
-- derive-health panel degrades to job_runs only (it says so in the UI)
```

**4. Set the first admin — after that account's first sign-in.**

```sql
UPDATE users SET is_admin = true WHERE email = '<your email>';
```

`users.is_admin` is set out of band by SQL only; no code path writes it
(`packages/database/src/schema.ts`). The suite is closed — there is no public
sign-up — so the account must be created by an existing admin, except for the
very first one, which is created by sign-in and then promoted here.

---

## 10.8 Cloudflare Workers (apps/web)

Connect the GitHub repo in the Cloudflare dashboard (**Workers → Builds**) and set:

| Setting | Value |
|---|---|
| Root directory | `/` (monorepo root, so the pnpm workspace resolves) |
| Build command | `pnpm --filter @monkyesuite/web build` |
| Deploy command | `pnpm --filter @monkyesuite/web exec wrangler deploy` |
| Build variables | `NODE_VERSION=22`, `VITE_API_BASE_URL=https://<api-host>/v1` |

Repo-side config, already committed:

- `apps/web/vite.config.ts` — `cloudflare({ viteEnvironment: { name: "ssr" } })`
  listed **before** `tanstackStart()`. Plugin order is not cosmetic; the
  Cloudflare plugin has to claim the `ssr` environment first.
- `apps/web/wrangler.jsonc` — `main: "@tanstack/react-start/server-entry"` (a
  virtual module, **not** a file path), `compatibility_flags: ["nodejs_compat"]`,
  `observability` on.

Build output is `apps/web/dist/client` (assets, wired to the Worker by the plugin)
and `apps/web/dist/server`. It is **not** `.output/` — that was the old
Start/Nitro layout.

### CORS is a deploy invariant

- `WEB_ORIGIN` on the API allows the Workers origin for `/v1/*`. Exact match:
  scheme included, no trailing slash.
- **`/admin` has no CORS allowance at all, and never gets one.** It is same-origin
  only — served from the API host, with `assertSameOrigin` on every
  state-changing route (`apps/api/src/admin/gate.ts`) and a CSP that permits no
  external script host. Adding the Workers URL to any admin allowance would make
  every admin mutation reachable cross-origin from the public frontend. It is not
  a convenience toggle.

---

## 10.9 Known failure modes

**`BYPASSRLS` cannot be granted → the migration aborts and the API never starts.**
The provisioning role is not superuser. Use the superuser connection string from
the Railway Postgres dashboard as monkye-api's `DATABASE_URL` (migration
connection only — application traffic runs on `APP_DATABASE_URL` as `monkye_app`).
Verify with `SELECT rolbypassrls FROM pg_roles WHERE rolname='monkye_service';`.
Never use the superuser DSN for `APP_DATABASE_URL`: superusers bypass RLS, which
would quietly disable the entire scoped-access backstop.

**The worker starts before the first migration finishes.** Railway has no native
start-ordering between services in a project. On the **first** deploy, deploy
monkye-api alone, wait for `/health` green and the migrate log, then deploy
monkye-worker. Subsequent deploys are low-risk because migrations are additive,
but the invariant holds regardless: **the schema exists before the worker runs.**

**CORS blocked from the frontend.** `WEB_ORIGIN` must match the Workers origin
exactly — scheme included, no trailing slash, comma-separated for several. It
covers `/v1/*` only; a 403 from `/admin` cross-origin is correct behaviour, not a
misconfiguration.

**Build output directory wrong on Cloudflare.** It is `apps/web/dist/{client,server}`,
not `.output/`. With the Cloudflare vite plugin you do not set an output directory
by hand at all — the Worker entry is the virtual `@tanstack/react-start/server-entry`
and the plugin wires the assets. Build locally (`pnpm --filter @monkyesuite/web build`)
and look at what lands before changing any dashboard setting.

**Every API call 404s from the deployed frontend.** `VITE_API_BASE_URL` is missing
the `/v1` suffix. It is inlined at build time, so fixing the variable requires a
rebuild, not just a redeploy.

**biome OOM in CI.** `NODE_OPTIONS=--max-old-space-size=4096` on the lint job.
Related: `biome.json`'s `files.includes` does not exclude `.claude/worktrees/`, so
if that agent scratch copy is ever committed, lint doubles its work over a second
copy of the repo.

**The admin secrets panel says a key is configured but the job still skips.**
`YOUTUBE_API_KEY` must be set on **monkye-worker** — that is where the demand job
runs. Setting it only on monkye-api makes the panel green and changes nothing.

---

## 10.10 First deploy — run once, in order

- [ ] Repo connected to the Railway project; both services created with Root
      Directory `/` and their Config-as-code path set (§10.5)
- [ ] Repo connected to Cloudflare Workers Builds (build + deploy commands,
      `NODE_VERSION=22`)
- [ ] CI green on `main` — all four jobs, including lint
- [ ] Confirm the migrate DSN is superuser (`SELECT rolsuper …`)
- [ ] Deploy **monkye-api** → `/health` green, and the deploy log shows
      functions → schema → roles applied clean
- [ ] Verify `rolbypassrls = t` and the `pg_monitor` membership
- [ ] Rotate both role passwords; set `APP_DATABASE_URL` (API) and `DATABASE_URL`
      (worker) to the rotated DSNs
- [ ] Deploy **monkye-worker** → `job_runs` rows appearing (there is no worker
      health endpoint; the rows *are* the health signal)
- [ ] Set the first admin (`UPDATE users SET is_admin = true …`)
- [ ] Deploy **apps/web** → `VITE_API_BASE_URL` set with the `/v1` suffix, and
      `WEB_ORIGIN` on the API matching the Workers origin exactly
- [ ] Smoke test:
      signed-out → sign-in only ·
      admin → `/admin` on the **API** host ·
      feed → live signals ·
      trend-drift panel → non-zero confirmed tags

## 10.11 Every subsequent deploy — automatic on push to `main`

- [ ] CI green before merging to `main`
- [ ] monkye-api deploys (watch: `apps/api/**`, `packages/**`) — the migration
      runs in its start command
- [ ] monkye-worker deploys (watch: `apps/worker/**`)
- [ ] apps/web deploys on Cloudflare
- [ ] Smoke test: feed loads with non-null signals · admin panels healthy ·
      recent `job_runs` rows `status = ok`
