// Panel reads (specs/09 §9.4). Every number on /admin comes from Postgres.
//
// The worker exposes no HTTP and never will — it is a tick loop, not a service.
// So its health is read from the rows it leaves behind (job_runs, enrich_jobs),
// never by calling it. Nothing in this file may ever reach for the worker.

import { sql } from "drizzle-orm";
import { db } from "../db.js";

/** The worker's base cadence (sched.TickInterval), for staleness thresholds. */
export const TICK_MS = 5 * 60 * 1000;

/* ------------------------- 9.4.1 snapshot freshness ----------------------- */

export interface SnapshotTick {
  tick: number;
  startedAt: Date;
  tracked: number;
  real: number;
  carried: number;
  status: string;
  error: string | null;
}

/** Last N snapshot runs, newest first (~288 ticks ≈ 24h). */
export async function snapshotTicks(limit = 288): Promise<SnapshotTick[]> {
  const r = await db.execute<{
    tick: string;
    started_at: Date;
    tracked: number;
    real: number;
    carried: number;
    status: string;
    error: string | null;
  }>(sql`
    select tick, started_at, status, error,
           coalesce((metrics->>'tracked')::int, 0) as tracked,
           coalesce((metrics->>'real')::int, 0)    as real,
           coalesce((metrics->>'carried')::int, 0) as carried
    from job_runs
    where job = 'snapshot'
    order by started_at desc
    limit ${limit}`);
  return r.rows.map((row) => ({
    tick: Number(row.tick),
    startedAt: row.started_at,
    tracked: row.tracked,
    real: row.real,
    carried: row.carried,
    status: row.status,
    error: row.error,
  }));
}

export type Band = "ok" | "warn" | "bad";

export const carryRate = (t: SnapshotTick): number =>
  t.tracked > 0 ? t.carried / t.tracked : 0;

/**
 * Band the carry-forward rate (§9.4.1). Carry-forward is a CORRECTNESS
 * mechanism — velocity reads 0 instead of a fabricated spike — so a low steady
 * rate is healthy. It is the RISE that means the snapshot is quietly
 * degrading while metrics still land, which nothing else in the system shows.
 */
export function carryBand(rate: number, trailingMean: number): Band {
  if (rate > 0.2) return "bad";
  if (trailingMean > 0 && rate > trailingMean * 3) return "bad";
  if (rate >= 0.05) return "warn";
  return "ok";
}

/* ---------------------------- 9.4.2 enrich queue -------------------------- */

export interface EnrichQueue {
  byStatus: { status: string; kind: string; n: number }[];
  dueNow: number;
  scheduled: number;
  running: number;
  stuckRunning: number;
  oldestRunningSec: number | null;
  failed: {
    id: string;
    kind: string;
    targetId: number;
    attempts: number;
    lastError: string | null;
    updatedAt: Date;
  }[];
  failedTotal: number;
}

export async function enrichQueue(): Promise<EnrichQueue> {
  const [counts, failed] = await Promise.all([
    db.execute<{
      status: string;
      kind: string;
      n: number;
      due: number;
      scheduled: number;
      stuck: number;
      oldest_running_sec: number | null;
    }>(sql`
      select status, kind, count(*)::int as n,
             count(*) filter (where status = 'pending' and run_after <= now())::int as due,
             count(*) filter (where status = 'pending' and run_after >  now())::int as scheduled,
             -- a 'running' claim older than one tick is a crashed worker, not
             -- work in progress: updated_at is what makes that visible.
             count(*) filter (
               where status = 'running' and updated_at < now() - interval '5 minutes')::int as stuck,
             max(extract(epoch from now() - updated_at))
               filter (where status = 'running')::int as oldest_running_sec
      from enrich_jobs
      group by status, kind
      order by status, kind`),
    db.execute<{
      id: string;
      kind: string;
      target_id: string;
      attempts: number;
      last_error: string | null;
      updated_at: Date;
    }>(sql`
      select id, kind, target_id, attempts, last_error, updated_at
      from enrich_jobs where status = 'failed'
      order by updated_at desc limit 20`),
  ]);

  const rows = counts.rows;
  const sum = (pick: (r: (typeof rows)[number]) => number): number =>
    rows.reduce((acc, r) => acc + (pick(r) ?? 0), 0);

  return {
    byStatus: rows.map((r) => ({ status: r.status, kind: r.kind, n: r.n })),
    dueNow: sum((r) => r.due),
    scheduled: sum((r) => r.scheduled),
    running: rows
      .filter((r) => r.status === "running")
      .reduce((a, r) => a + r.n, 0),
    stuckRunning: sum((r) => r.stuck),
    oldestRunningSec: rows.reduce<number | null>(
      (acc, r) =>
        r.oldest_running_sec === null
          ? acc
          : Math.max(acc ?? 0, r.oldest_running_sec),
      null,
    ),
    failed: failed.rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      targetId: Number(r.target_id),
      attempts: r.attempts,
      lastError: r.last_error,
      updatedAt: r.updated_at,
    })),
    failedTotal: rows
      .filter((r) => r.status === "failed")
      .reduce((a, r) => a + r.n, 0),
  };
}

/* --------------------------- 9.4.3 limiter tiers -------------------------- */

export interface TierUsage {
  tier: string;
  issued: number;
  skipped: number;
  runs: number;
}

/**
 * Roblox call consumption per limiter tier over the last 24h.
 *
 * The enrich tier is read from the `enrich-drain` rows, NOT the `enrich`
 * enqueue rows: the enqueue is two cheap DB writes inside the tick, while the
 * drain is detached and carries every gated call the tier actually spent.
 * Reading the enqueue row would report the enrich budget as permanently idle.
 */
export async function tierUsage(): Promise<TierUsage[]> {
  const r = await db.execute<{
    tier: string;
    issued: number;
    skipped: number;
    runs: number;
  }>(sql`
    select case when job = 'enrich-drain' then 'enrich' else 'critical' end as tier,
           coalesce(sum((metrics->>'callsIssued')::int), 0)::int  as issued,
           coalesce(sum((metrics->>'callsSkipped')::int), 0)::int as skipped,
           count(*)::int as runs
    from job_runs
    where started_at > now() - interval '24 hours'
      and job in ('discover','snapshot','events','enrich-drain')
    group by 1`);
  const byTier = new Map(r.rows.map((row) => [row.tier, row]));
  return ["critical", "enrich"].map((tier) => {
    const row = byTier.get(tier);
    return {
      tier,
      issued: row?.issued ?? 0,
      skipped: row?.skipped ?? 0,
      runs: row?.runs ?? 0,
    };
  });
}

export const skipRate = (t: TierUsage): number =>
  t.issued + t.skipped > 0 ? t.skipped / (t.issued + t.skipped) : 0;

/* --------------------------- 9.4.4 derive health -------------------------- */

export interface DeriveHealth {
  lastOkAt: Date | null;
  lastOkTick: number | null;
  lastRowsWritten: number | null;
  recent: { startedAt: Date; durationMs: number; rowsWritten: number }[];
  maxDurationMs: number;
  zeroRowRuns: number;
  pg: PgLoad | null;
}

/** Live Postgres load. Null when the app role cannot see other roles' backends. */
export interface PgLoad {
  active: number;
  idleInTx: number;
  total: number;
  longestActiveSec: number | null;
}

export async function deriveHealth(): Promise<DeriveHealth> {
  const [last, recent, pg] = await Promise.all([
    db.execute<{
      started_at: Date;
      tick: string;
      rows_written: number;
    }>(sql`
      select started_at, tick, rows_written from job_runs
      where job = 'derive' and status = 'ok'
      order by started_at desc limit 1`),
    db.execute<{
      started_at: Date;
      duration_ms: number;
      rows_written: number;
    }>(sql`
      select started_at, coalesce(duration_ms,0) as duration_ms, rows_written
      from job_runs where job = 'derive'
      order by started_at desc limit 48`),
    pgLoad(),
  ]);

  const rows = recent.rows;
  return {
    lastOkAt: last.rows[0]?.started_at ?? null,
    lastOkTick: last.rows[0] ? Number(last.rows[0].tick) : null,
    lastRowsWritten: last.rows[0]?.rows_written ?? null,
    recent: rows.map((r) => ({
      startedAt: r.started_at,
      durationMs: r.duration_ms,
      rowsWritten: r.rows_written,
    })),
    maxDurationMs: rows.reduce((a, r) => Math.max(a, r.duration_ms), 0),
    // A derive that succeeds while writing nothing is the silent failure; it
    // reads identically to a healthy one unless it is counted.
    zeroRowRuns: rows.filter((r) => r.rows_written === 0).length,
    pg,
  };
}

/**
 * Live load from pg_stat_activity. The API connects as monkye_app while derive
 * runs as monkye_service, so this needs pg_monitor (granted in roles.sql). We
 * read COUNTS AND AGES ONLY — never query text, which would put arbitrary row
 * data on the page. Returns null when the grant is absent, so the panel can say
 * "live read unavailable" instead of rendering a convincing zero.
 */
async function pgLoad(): Promise<PgLoad | null> {
  try {
    const r = await db.execute<{
      active: number;
      idle_in_tx: number;
      total: number;
      longest_active_sec: number | null;
      can_see_others: boolean;
    }>(sql`
      select count(*) filter (where state = 'active')::int              as active,
             count(*) filter (where state = 'idle in transaction')::int as idle_in_tx,
             count(*)::int                                              as total,
             max(extract(epoch from now() - query_start))
               filter (where state = 'active')::int                     as longest_active_sec,
             bool_or(usename is distinct from current_user)             as can_see_others
      from pg_stat_activity
      where datname = current_database()`);
    const row = r.rows[0];
    if (!row) return null;
    // With no pg_monitor a non-superuser still sees rows but with state NULL'd,
    // which would render as "0 active" — a lie. Treat an all-null state view as
    // "cannot read" rather than "nothing running".
    if (
      row.total > 0 &&
      row.active === 0 &&
      row.idle_in_tx === 0 &&
      !row.can_see_others
    ) {
      return null;
    }
    return {
      active: row.active,
      idleInTx: row.idle_in_tx,
      total: row.total,
      longestActiveSec: row.longest_active_sec,
    };
  } catch (err) {
    console.error("[admin] pg_stat_activity read failed:", err);
    return null;
  }
}

/* ----------------------- 9.4.5 gated-endpoint failures -------------------- */

export interface EndpointRate {
  group: string;
  ok24: number;
  fail24: number;
  skipped24: number;
  rate24: number;
  rate7d: number;
  delta: number;
}

/**
 * Failure rate per endpoint group, 24h against a 7d baseline.
 *
 * A steady rate is normal and not actionable — the gated endpoints (rotunnel,
 * Studio/Groups) fail routinely and enrichment fails soft. The 7d column is
 * what makes the 24h column readable: 40% steady is fine, 2% → 40% is the
 * alert. Sorted by that delta.
 */
export async function endpointRates(): Promise<EndpointRate[]> {
  const r = await db.execute<{
    grp: string;
    ok24: number;
    fail24: number;
    skipped24: number;
    ok7: number;
    fail7: number;
  }>(sql`
    with e as (
      select started_at, kv.key as grp,
             coalesce((kv.value->>'ok')::int, 0)      as ok,
             coalesce((kv.value->>'fail')::int, 0)    as fail,
             coalesce((kv.value->>'skipped')::int, 0) as skipped
      from job_runs, lateral jsonb_each(coalesce(metrics->'endpoints', '{}'::jsonb)) as kv
      where started_at > now() - interval '7 days'
    )
    select grp,
      coalesce(sum(ok)      filter (where started_at > now() - interval '24 hours'), 0)::int as ok24,
      coalesce(sum(fail)    filter (where started_at > now() - interval '24 hours'), 0)::int as fail24,
      coalesce(sum(skipped) filter (where started_at > now() - interval '24 hours'), 0)::int as skipped24,
      coalesce(sum(ok), 0)::int   as ok7,
      coalesce(sum(fail), 0)::int as fail7
    from e group by grp`);

  const rate = (ok: number, fail: number): number =>
    ok + fail > 0 ? fail / (ok + fail) : 0;

  return r.rows
    .map((row) => {
      const rate24 = rate(row.ok24, row.fail24);
      const rate7d = rate(row.ok7, row.fail7);
      return {
        group: row.grp,
        ok24: row.ok24,
        fail24: row.fail24,
        skipped24: row.skipped24,
        rate24,
        rate7d,
        delta: rate24 - rate7d,
      };
    })
    .sort((a, b) => b.delta - a.delta);
}

/* ----------------------------- 9.4.6 trend-drift -------------------------- */

export interface DriftRow {
  axis: string;
  slug: string;
  risingCarriers: number;
  totalCarriers: number;
}

export interface TrendDrift {
  atThreshold: { threshold: number; rows: DriftRow[] }[];
  taggedGames: number;
  trackedGames: number;
  vocabularyTags: number;
  history: { day: Date; confirmed: number; minRising: number }[];
}

/**
 * The confirmation rule, live (specs/02 §2.3) — the same query the worker runs,
 * at thresholds 1/2/3, read-only.
 *
 * Rows at 1–2 but none at 3 means the rule works and the corpus is thin (not a
 * bug). Zero rows at EVERY threshold means either nothing is tagged or nothing
 * classifies as growing/launching — which is why tag coverage sits beside it.
 */
export async function trendDrift(): Promise<TrendDrift> {
  const driftAt = async (threshold: number): Promise<DriftRow[]> => {
    const r = await db.execute<{
      axis: string;
      slug: string;
      rising_carriers: number;
      total_carriers: number;
    }>(sql`
      select t.axis, t.slug,
             count(*) filter (where s.lifecycle in ('growing','launching'))::int as rising_carriers,
             count(*)::int as total_carriers
      from game_tags gt
      join tags t on t.id = gt.tag_id
      join lateral (
        select gs.lifecycle from game_stats gs
        where gs.universe_id = gt.universe_id
        order by gs.computed_at desc limit 1
      ) s on true
      group by t.axis, t.slug
      having count(*) filter (where s.lifecycle in ('growing','launching')) >= ${threshold}
      order by rising_carriers desc, total_carriers desc
      limit 25`);
    return r.rows.map((row) => ({
      axis: row.axis,
      slug: row.slug,
      risingCarriers: row.rising_carriers,
      totalCarriers: row.total_carriers,
    }));
  };

  const [t1, t2, t3, coverage, history] = await Promise.all([
    driftAt(1),
    driftAt(2),
    driftAt(3),
    db.execute<{ tagged: number; tracked: number; vocab: number }>(sql`
      select (select count(distinct universe_id) from game_tags)::int as tagged,
             (select count(*) from games where is_tracked)::int       as tracked,
             (select count(*) from tags)::int                         as vocab`),
    db.execute<{ day: Date; confirmed: number; min_rising: number }>(sql`
      select date_trunc('day', started_at) as day,
             max((metrics->>'confirmed')::int)  as confirmed,
             max((metrics->>'minRising')::int)  as min_rising
      from job_runs
      where job = 'trend-drift' and status = 'ok'
        and started_at > now() - interval '14 days'
      group by 1 order by 1 desc`),
  ]);

  return {
    atThreshold: [
      { threshold: 1, rows: t1 },
      { threshold: 2, rows: t2 },
      { threshold: 3, rows: t3 },
    ],
    taggedGames: coverage.rows[0]?.tagged ?? 0,
    trackedGames: coverage.rows[0]?.tracked ?? 0,
    vocabularyTags: coverage.rows[0]?.vocab ?? 0,
    history: history.rows.map((r) => ({
      day: r.day,
      confirmed: r.confirmed,
      minRising: r.min_rising,
    })),
  };
}

/* --------------------------- 9.4.7 job run history ------------------------ */

export interface JobRunRow {
  job: string;
  tick: number;
  tier: string;
  startedAt: Date;
  durationMs: number | null;
  status: string;
  rowsWritten: number;
  error: string | null;
}

export const JOB_NAMES = [
  "discover",
  "snapshot",
  "events",
  "enrich",
  "enrich-drain",
  "derive",
  "trend-drift",
  "demand",
] as const;

export async function jobRuns(opts: {
  job?: string;
  failuresOnly?: boolean;
  limit?: number;
}): Promise<JobRunRow[]> {
  const limit = Math.min(opts.limit ?? 40, 200);
  const jobFilter = opts.job ? sql`and job = ${opts.job}` : sql``;
  const failFilter = opts.failuresOnly ? sql`and status = 'error'` : sql``;
  const r = await db.execute<{
    job: string;
    tick: string;
    tier: string;
    started_at: Date;
    duration_ms: number | null;
    status: string;
    rows_written: number;
    error: string | null;
  }>(sql`
    select job, tick, tier, started_at, duration_ms, status, rows_written, error
    from job_runs
    where true ${jobFilter} ${failFilter}
    order by started_at desc
    limit ${limit}`);
  return r.rows.map((row) => ({
    job: row.job,
    tick: Number(row.tick),
    tier: row.tier,
    startedAt: row.started_at,
    durationMs: row.duration_ms,
    status: row.status,
    rowsWritten: row.rows_written,
    error: row.error,
  }));
}

/* ------------------------------ pending commands -------------------------- */

export interface PendingCommand {
  id: string;
  job: string;
  status: string;
  requestedAt: Date;
  finishedAt: Date | null;
  error: string | null;
}

/** Recent manual triggers, so "queued" resolves visibly into done/failed. */
export async function recentCommands(limit = 8): Promise<PendingCommand[]> {
  const r = await db.execute<{
    id: string;
    job: string;
    status: string;
    requested_at: Date;
    finished_at: Date | null;
    error: string | null;
  }>(sql`
    select id, job, status, requested_at, finished_at, error
    from job_commands order by requested_at desc limit ${limit}`);
  return r.rows.map((row) => ({
    id: row.id,
    job: row.job,
    status: row.status,
    requestedAt: row.requested_at,
    finishedAt: row.finished_at,
    error: row.error,
  }));
}

/* --------------------------------- audit ---------------------------------- */

export interface AuditRow {
  createdAt: Date;
  actorId: string;
  actorEmail: string | null;
  action: string;
  target: string | null;
  outcome: string;
  ip: string | null;
}

export async function auditTail(limit = 40): Promise<AuditRow[]> {
  const r = await db.execute<{
    created_at: Date;
    actor_id: string;
    email: string | null;
    action: string;
    target: string | null;
    outcome: string;
    ip: string | null;
  }>(sql`
    select a.created_at, a.actor_id, u.email, a.action, a.target, a.outcome, a.ip
    from audit_log a left join users u on u.id = a.actor_id
    order by a.created_at desc limit ${limit}`);
  return r.rows.map((row) => ({
    createdAt: row.created_at,
    actorId: row.actor_id,
    actorEmail: row.email,
    action: row.action,
    target: row.target,
    outcome: row.outcome,
    ip: row.ip,
  }));
}

/* ------------------------- 9.3b operational secrets ----------------------- */

export interface SecretStatus {
  name: string;
  configured: boolean;
  consumer: string;
  lastUsedAt: Date | null;
  lastStatus: string | null;
}

/**
 * The operational-secret registry (§9.3b).
 *
 * HARD RULE: this returns `configured: boolean` and timestamps. It never reads,
 * returns, masks, or logs a secret VALUE — those live in Railway env and
 * nowhere else. `process.env[name]` is tested for non-emptiness and discarded
 * on the same line; the value never enters a variable, a template, or a log.
 */
const SECRET_REGISTRY: { name: string; consumer: string; job: string }[] = [
  { name: "YOUTUBE_API_KEY", consumer: "demand (YouTube)", job: "demand" },
  {
    name: "ROTUNNEL_BASE_URL",
    consumer: "enrich (monetization)",
    job: "enrich-drain",
  },
  { name: "DATABASE_URL", consumer: "worker (service role)", job: "snapshot" },
  { name: "APP_DATABASE_URL", consumer: "api (app role)", job: "derive" },
  { name: "BETTER_AUTH_SECRET", consumer: "api (sessions)", job: "derive" },
];

export async function secretStatuses(): Promise<SecretStatus[]> {
  const r = await db.execute<{ job: string; started_at: Date; status: string }>(
    sql`
      select distinct on (job) job, started_at, status
      from job_runs order by job, started_at desc`,
  );
  const lastByJob = new Map(r.rows.map((row) => [row.job, row]));
  return SECRET_REGISTRY.map((entry) => {
    const last = lastByJob.get(entry.job);
    return {
      name: entry.name,
      // Non-empty test only. The value is never bound to anything.
      configured: (process.env[entry.name] ?? "").trim().length > 0,
      consumer: entry.consumer,
      lastUsedAt: last?.started_at ?? null,
      lastStatus: last?.status ?? null,
    };
  });
}
