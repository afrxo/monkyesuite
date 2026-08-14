// Panel fragments (specs/09 §9.4). Each panel is its own endpoint and refreshes
// itself every 30s, so one slow query degrades one panel instead of the page.
// 30s is well inside the worker's 5-minute tick, which is the real resolution
// of every number here.

import { ago, html, pct, type Raw, stamp } from "./html.js";
import {
  auditTail,
  type Band,
  carryBand,
  carryRate,
  deriveHealth,
  endpointRates,
  enrichQueue,
  JOB_NAMES,
  jobRuns,
  listUsers,
  recentCommands,
  type SnapshotTick,
  secretStatuses,
  skipRate,
  snapshotTicks,
  TICK_MS,
  tierUsage,
  trendDrift,
} from "./queries.js";

const cls = (b: Band): string =>
  b === "bad" ? "bad" : b === "warn" ? "warn" : "ok";
const n = (v: number): string => v.toLocaleString("en-US");

/* ------------------------- 9.4.1 snapshot freshness ----------------------- */

export async function snapshotPanel(): Promise<Raw> {
  const ticks = await snapshotTicks(288);
  if (ticks.length === 0) {
    return html`<p class="dim">No snapshot runs recorded yet.</p>`;
  }
  const current = ticks[0] as SnapshotTick;
  const trailing = ticks.slice(1);
  const trailingMean =
    trailing.length > 0
      ? trailing.reduce((a, t) => a + carryRate(t), 0) / trailing.length
      : 0;
  const rate = carryRate(current);
  const band = carryBand(rate, trailingMean);
  const total = rate === 1 && current.tracked > 0;

  // Oldest → newest, so the sparkline reads left to right like time does.
  const bars = [...ticks].reverse().map((t) => {
    const r = carryRate(t);
    return html`<i class="${cls(carryBand(r, trailingMean))}"
      style="height:${Math.max(2, Math.round(r * 100))}%"
      title="tick ${t.tick} · ${pct(r)} carried"></i>`;
  });

  return html`
<p class="note">Carry-forward is correct behaviour — a gap reads as flat, not as
a fabricated spike. A <em>rising</em> rate is the signal: metrics still land,
and every one of them is stale.</p>
<div class="big ${cls(band)}">${pct(rate)} carried</div>
<div class="dim">tick ${current.tick} · ${n(current.real)} real / ${n(current.carried)} carried
of ${n(current.tracked)} tracked · ${ago(current.startedAt)}</div>
${
  total
    ? html`<p class="bad">TOTAL CARRY-FORWARD — the snapshot job is running and
fetching nothing. Every tracked game is frozen at its last value.</p>`
    : null
}
<div class="spark">${bars}</div>
<div class="dim">trailing ${trailing.length}-tick mean ${pct(trailingMean)} ·
bands: &lt;5% ok · 5–20% warn · &gt;20% or &gt;3× trailing mean alert</div>
${
  current.error ? html`<p class="err">last error: ${current.error}</p>` : null
}`;
}

/* ---------------------------- 9.4.2 enrich queue -------------------------- */

export async function enrichPanel(): Promise<Raw> {
  const q = await enrichQueue();
  const kinds = [...new Set(q.byStatus.map((r) => r.kind))].sort();
  const statuses = ["pending", "running", "done", "failed"];
  const cell = (status: string, kind: string): number =>
    q.byStatus.find((r) => r.status === status && r.kind === kind)?.n ?? 0;

  return html`
<p class="note">An empty dead-letter list does <strong>not</strong> mean the
gated endpoints are healthy. Enrichment fails soft: a rotunnel outage logs and
returns, the job completes, and nothing ever dead-letters. Read the
gated-endpoint panel for upstream health — this one shows queue mechanics.</p>
<table>
<tr><th>kind</th>${statuses.map((s) => html`<th class="num">${s}</th>`)}</tr>
${kinds.map(
  (kind) =>
    html`<tr><td>${kind}</td>${statuses.map(
      (s) =>
        html`<td class="num ${s === "failed" && cell(s, kind) > 0 ? "bad" : ""}">${n(
          cell(s, kind),
        )}</td>`,
    )}</tr>`,
)}
</table>
<p class="dim">due now ${n(q.dueNow)} · scheduled ahead ${n(q.scheduled)} ·
in-flight ${n(q.running)}${
    q.oldestRunningSec !== null ? html` (oldest ${q.oldestRunningSec}s)` : null
  }</p>
${
  q.stuckRunning > 0
    ? html`<p class="bad">${n(q.stuckRunning)} claim(s) running longer than a
tick — a crashed worker, not work in progress.</p>`
    : null
}
${
  q.failed.length > 0
    ? html`<div class="scroll"><table>
<tr><th>kind</th><th class="num">target</th><th class="num">tries</th><th>last error</th><th></th></tr>
${q.failed.map(
  (f) => html`<tr>
  <td>${f.kind}</td><td class="num">${f.targetId}</td><td class="num">${f.attempts}</td>
  <td class="err">${f.lastError ?? "—"}</td>
  <td><form hx-post="/admin/actions/enrich/requeue" hx-target="#enrich-flash">
    <input type="hidden" name="id" value="${f.id}">
    <button type="submit">requeue</button></form></td>
</tr>`,
)}
</table></div>`
    : html`<p class="dim">No dead-letter rows.</p>`
}
<form hx-post="/admin/actions/enrich/requeue" hx-target="#enrich-flash">
  <select name="kind"><option value="">all kinds</option>
    ${kinds.map((k) => html`<option value="${k}">${k}</option>`)}</select>
  <button type="submit">requeue dead-letter</button>
</form>
<form hx-post="/admin/actions/enrich/purge" hx-target="#enrich-flash"
      hx-confirm="Purge dead-letter rows?">
  <input name="confirm" placeholder="type PURGE" size="10" required>
  <button type="submit" class="danger">purge</button>
</form>
<div id="enrich-flash" class="flash"></div>`;
}

/* --------------------------- 9.4.3 limiter tiers -------------------------- */

export async function limiterPanel(): Promise<Raw> {
  const tiers = await tierUsage();
  const critical = tiers.find((t) => t.tier === "critical");
  const enrich = tiers.find((t) => t.tier === "enrich");
  const criticalSkips = critical ? skipRate(critical) : 0;
  const enrichSkips = enrich ? skipRate(enrich) : 0;
  const criticalStarved = criticalSkips > 0.05;

  return html`
<p class="note">Enrich draws from its own 20 req/10s pool, the critical path
from its own 40 — the tiers share no tokens. Enrich figures come from the
detached <code>enrich-drain</code> run, which is where the gated calls are
actually spent.</p>
<table>
<tr><th>tier</th><th class="num">issued</th><th class="num">skipped</th><th class="num">skip rate</th><th class="num">runs</th></tr>
${tiers.map(
  (t) => html`<tr>
  <td>${t.tier}</td><td class="num">${n(t.issued)}</td>
  <td class="num">${n(t.skipped)}</td>
  <td class="num ${t.tier === "critical" && skipRate(t) > 0.05 ? "bad" : ""}">${pct(
    skipRate(t),
  )}</td>
  <td class="num">${n(t.runs)}</td></tr>`,
)}
</table>
${
  criticalStarved
    ? html`<p class="bad">Critical-tier skips at ${pct(criticalSkips)}. If a
drain is running, the pools are sharing tokens — that is a bug in the client,
not a capacity problem: the reservation exists precisely so the tick keeps its
full budget while enrich saturates its own.</p>`
    : html`<p class="ok">Reservation holding: critical skips ${pct(
        criticalSkips,
      )}, enrich skips ${pct(enrichSkips)}. Enrich skips rising while critical
stays near zero is the design working.</p>`
}
<p class="dim">last 24h · aggregate ceiling to Roblox 60 req/10s (40 critical + 20 enrich)</p>`;
}

/* --------------------------- 9.4.4 derive health -------------------------- */

export async function derivePanel(): Promise<Raw> {
  const d = await deriveHealth();
  const ageMs = d.lastOkAt ? Date.now() - new Date(d.lastOkAt).getTime() : null;
  const stale = ageMs === null || ageMs > 2 * TICK_MS;
  const slow = d.maxDurationMs > TICK_MS * 0.5;

  return html`
<div class="big ${stale ? "bad" : "ok"}">${d.lastOkAt ? ago(d.lastOkAt) : "never"}</div>
<div class="dim">last successful derive${
    d.lastOkTick !== null ? html` · tick ${d.lastOkTick}` : null
  } · ${d.lastRowsWritten ?? 0} rows written</div>
${stale ? html`<p class="bad">Over two ticks since a successful derive.</p>` : null}
<table>
<tr><th>window</th><th class="num">value</th></tr>
<tr><td>max duration (last ${d.recent.length} runs)</td>
    <td class="num ${slow ? "warn" : ""}">${n(d.maxDurationMs)} ms / ${n(TICK_MS)} ms tick</td></tr>
<tr><td>runs writing zero rows</td>
    <td class="num ${d.zeroRowRuns > 0 ? "warn" : ""}">${n(d.zeroRowRuns)}</td></tr>
</table>
${
  slow
    ? html`<p class="warn">Derive duration is creeping toward the tick interval
— the SQL is outgrowing the cadence.</p>`
    : null
}
<p class="note">A derive that succeeds while writing zero rows is the silent
failure; it looks identical to a healthy one until it is counted.</p>
${
  d.pg
    ? html`<p class="dim">postgres now: ${d.pg.active} active · ${d.pg.idleInTx}
idle-in-tx · ${d.pg.total} backends${
        d.pg.longestActiveSec !== null
          ? html` · longest active ${d.pg.longestActiveSec}s`
          : null
      }</p>`
    : html`<p class="warn">Live Postgres load unavailable — the app role lacks
<code>pg_monitor</code>, so other roles' backends (derive runs as the service
role) are invisible. Grant it via roles.sql; until then this panel reports
job_runs timings only, rather than a convincing zero.</p>`
}`;
}

/* ----------------------- 9.4.5 gated-endpoint failures -------------------- */

export async function endpointsPanel(): Promise<Raw> {
  const rows = await endpointRates();
  if (rows.length === 0) {
    return html`<p class="dim">No endpoint telemetry in the last 7 days.</p>`;
  }
  const band = (r: (typeof rows)[number]): string => {
    if (r.delta > 0.2) return "bad";
    if (r.delta > 0.05) return "warn";
    return "";
  };
  return html`
<p class="note">Steady is fine — gated endpoints (rotunnel, Studio/Groups) fail
routinely and enrichment fails soft. The 7d column is what makes the 24h column
readable: 40% steady is normal, 2% → 40% is the alert. Sorted by that delta.</p>
<div class="scroll"><table>
<tr><th>group</th><th class="num">24h fail</th><th class="num">7d fail</th>
<th class="num">delta</th><th class="num">calls 24h</th><th class="num">skipped</th></tr>
${rows.map(
  (r) => html`<tr class="${band(r)}">
  <td>${r.group}</td>
  <td class="num">${pct(r.rate24)}</td>
  <td class="num dim">${pct(r.rate7d)}</td>
  <td class="num ${band(r)}">${r.delta >= 0 ? "+" : ""}${pct(r.delta)}</td>
  <td class="num">${n(r.ok24 + r.fail24)}</td>
  <td class="num">${n(r.skipped24)}</td></tr>`,
)}
</table></div>`;
}

/* ----------------------------- 9.4.6 trend-drift -------------------------- */

export async function driftPanel(): Promise<Raw> {
  const d = await trendDrift();
  const at = (t: number) =>
    d.atThreshold.find((x) => x.threshold === t)?.rows ?? [];
  const confirmed = at(3);
  const anyAtAll = d.atThreshold.some((x) => x.rows.length > 0);

  return html`
<p class="note">The confirmation rule is enforced in SQL, not the UI: a tag is a
direction only when carried by multiple games that are also growing. It
persists nothing, so this runs the §2.3 query live.</p>
<table>
<tr><th>threshold</th><th class="num">tags clearing</th></tr>
${d.atThreshold.map(
  (x) => html`<tr><td>≥ ${x.threshold} rising carriers${
    x.threshold === 3 ? html` <span class="dim">(production)</span>` : null
  }</td>
  <td class="num ${x.threshold === 3 && x.rows.length > 0 ? "ok" : ""}">${n(
    x.rows.length,
  )}</td></tr>`,
)}
</table>
<p class="dim">tag coverage: ${n(d.taggedGames)} of ${n(d.trackedGames)} tracked
games tagged · ${n(d.vocabularyTags)} vocabulary tags</p>
${
  !anyAtAll
    ? html`<p class="warn">Nothing clears even one rising carrier. Either no
games are tagged, or no game_stats row classifies as growing/launching — the
coverage line above tells the two apart.</p>`
    : confirmed.length === 0
      ? html`<p class="dim">Clears at 1–2 but not at 3: the rule is working and
the corpus is thin. Not a bug.</p>`
      : html`<table>
<tr><th>axis</th><th>slug</th><th class="num">rising</th><th class="num">total</th></tr>
${confirmed.map(
  (r) => html`<tr><td>${r.axis}</td><td>${r.slug}</td>
  <td class="num ok">${r.risingCarriers}</td><td class="num">${r.totalCarriers}</td></tr>`,
)}
</table>`
}
${
  d.history.length > 0
    ? html`<p class="dim">daily confirmed: ${d.history
        .map((h) => `${stamp(h.day).slice(5, 10)}=${h.confirmed}`)
        .join(" · ")}</p>`
    : null
}`;
}

/* --------------------------- 9.4.7 job run history ------------------------ */

export async function jobsPanel(opts: {
  job?: string;
  failuresOnly?: boolean;
}): Promise<Raw> {
  const [runs, commands] = await Promise.all([
    jobRuns({ job: opts.job, failuresOnly: opts.failuresOnly, limit: 40 }),
    recentCommands(),
  ]);
  const q = (o: { job?: string; failuresOnly?: boolean }): string => {
    const p = new URLSearchParams();
    if (o.job) p.set("job", o.job);
    if (o.failuresOnly) p.set("failures", "1");
    const s = p.toString();
    return `/admin/panels/jobs${s ? `?${s}` : ""}`;
  };

  return html`
<form hx-post="/admin/actions/run-job" hx-target="#jobs-flash">
  <select name="job">${JOB_NAMES.filter((j) => j !== "enrich-drain").map(
    (j) => html`<option value="${j}">${j}</option>`,
  )}</select>
  <button type="submit">queue manual run</button>
</form>
<div id="jobs-flash" class="flash"></div>
<p class="dim">A trigger is a request, not an execution: the worker owns the
loop and claims the command on its next tick (≤5 min), then it appears below.</p>
${
  commands.length > 0
    ? html`<table>
<tr><th>command</th><th>status</th><th>requested</th><th>error</th></tr>
${commands.map(
  (cmd) => html`<tr><td>${cmd.job}</td>
  <td class="${cmd.status === "failed" ? "bad" : cmd.status === "done" ? "ok" : "warn"}">${
    cmd.status === "pending" ? "queued" : cmd.status
  }</td>
  <td class="dim">${ago(cmd.requestedAt)}</td>
  <td class="err">${cmd.error ?? ""}</td></tr>`,
)}
</table>`
    : null
}
<p class="dim">filter:
<a href="${q({})}" hx-get="${q({})}" hx-target="#panel-jobs">all</a> ·
<a href="${q({ failuresOnly: true })}" hx-get="${q({
    failuresOnly: true,
  })}" hx-target="#panel-jobs">failures only</a>
${JOB_NAMES.map(
  (j) =>
    html` · <a href="${q({ job: j })}" hx-get="${q({
      job: j,
    })}" hx-target="#panel-jobs">${j}</a>`,
)}</p>
<div class="scroll"><table>
<tr><th>job</th><th class="num">tick</th><th>started</th><th class="num">ms</th>
<th>status</th><th class="num">rows</th><th>error</th></tr>
${runs.map(
  (r) => html`<tr>
  <td>${r.job}</td><td class="num">${r.tick}</td>
  <td class="dim">${stamp(r.startedAt)}</td>
  <td class="num">${r.durationMs === null ? "—" : n(r.durationMs)}</td>
  <td class="${r.status === "error" ? "bad" : r.status === "skipped" ? "warn" : "ok"}">${r.status}</td>
  <td class="num">${n(r.rowsWritten)}</td>
  <td class="err">${r.error ?? ""}</td></tr>`,
)}
</table></div>`;
}

/* ------------------------- 9.3b operational secrets ----------------------- */

export async function secretsPanel(): Promise<Raw> {
  const rows = await secretStatuses();
  return html`
<p class="note">Configured-or-not and last-used only. No secret VALUE is read,
rendered, masked or logged anywhere under /admin — those live in Railway env
and nowhere else. Rotation is a Railway operation plus a restart.</p>
<table>
<tr><th>name</th><th>configured</th><th>consumer</th><th>last used</th></tr>
${rows.map(
  (r) => html`<tr>
  <td>${r.name}</td>
  <td class="${r.configured ? "ok" : "bad"}">${r.configured ? "yes" : "no"}</td>
  <td class="dim">${r.consumer}</td>
  <td class="dim">${ago(r.lastUsedAt)}${
    r.lastStatus ? html` (${r.lastStatus})` : null
  }</td></tr>`,
)}
</table>`;
}

/* ------------------------------ identity + audit -------------------------- */

export function identityPanel(flash?: Raw): Raw {
  return html`
<p class="note">The suite is closed: this panel is the ONLY way a new account
comes into existence — there is no public sign-up. Account creation goes
through the same Better Auth server API the (now-removed) public path used —
a different caller, never a different mechanism. A user created here is never
an admin: <code>is_admin</code> is set out of band by SQL, so the panel cannot
escalate its own privilege. Adding a collaborator to a project is a direct
write against an EXISTING account by email — there is no invite/token step
(specs/06 §6.3).</p>
<form hx-post="/admin/actions/users/create" hx-target="#panel-identity-flash">
  <input name="email" type="text" placeholder="username" required>
  <input name="name" placeholder="name">
  <input name="password" type="password" placeholder="temp password" required minlength="8">
  <button type="submit">create user</button>
</form>
<form hx-post="/admin/actions/members/add" hx-target="#panel-identity-flash">
  <input name="projectId" placeholder="project uuid" size="24" required>
  <input name="email" type="text" placeholder="existing user's username" required>
  <select name="role"><option value="member">member</option><option value="owner">owner</option></select>
  <button type="submit">add to project</button>
</form>
<div id="panel-identity-flash" class="flash">${flash ?? null}</div>`;
}

/** 9.3a — revoke, with the last-admin guard enforced server-side (actions.ts),
 * not just by this list. Typed confirmation (the target's own email) is
 * required in the form body — hx-confirm is a convenience, not the control. */
export async function usersPanel(): Promise<Raw> {
  const rows = await listUsers();
  return html`
<table>
<tr><th>username</th><th>name</th><th>admin</th><th>status</th><th>created</th><th></th></tr>
${rows.map((u) => {
  const statusCell = u.disabled
    ? html`<span class="bad">revoked</span>`
    : html`<span class="ok">active</span>`;
  const action = u.disabled
    ? html`<span class="dim">—</span>`
    : html`<form hx-post="/admin/actions/users/revoke" hx-target="#panel-identity-flash"
             hx-confirm="Revoke ${u.email}? Their session dies immediately and sign-in is refused.">
        <input type="hidden" name="email" value="${u.email}">
        <input name="confirm" placeholder="type username to confirm" size="20" required>
        <button type="submit">revoke</button>
      </form>`;
  return html`<tr>
  <td>${u.email}</td>
  <td class="dim">${u.name ?? ""}</td>
  <td>${u.isAdmin ? "yes" : ""}</td>
  <td>${statusCell}</td>
  <td class="dim">${stamp(u.createdAt)}</td>
  <td>${action}</td></tr>`;
})}
</table>`;
}

export function gamesPanel(flash?: Raw): Raw {
  return html`
<p class="note">Untracking stops future collection only. Nothing under /admin
deletes from <code>game_metrics</code> — it is an immutable landing layer, and
history stays re-derivable.</p>
<form hx-post="/admin/actions/games/track" hx-target="#panel-games-flash">
  <input name="universeId" placeholder="universeId" size="14" required>
  <input name="name" placeholder="name (optional)">
  <button type="submit">track</button>
</form>
<form hx-post="/admin/actions/games/untrack" hx-target="#panel-games-flash"
      hx-confirm="Stop tracking this game?">
  <input name="universeId" placeholder="universeId" size="14" required>
  <input name="confirm" placeholder="repeat universeId" size="14" required>
  <button type="submit" class="danger">untrack</button>
</form>
<div id="panel-games-flash" class="flash">${flash ?? null}</div>`;
}

export async function auditPanel(): Promise<Raw> {
  const rows = await auditTail(40);
  if (rows.length === 0) return html`<p class="dim">No audit entries yet.</p>`;
  return html`<div class="scroll"><table>
<tr><th>when</th><th>actor</th><th>action</th><th>target</th><th>outcome</th><th>ip</th></tr>
${rows.map(
  (r) => html`<tr>
  <td class="dim">${stamp(r.createdAt)}</td>
  <td>${r.actorEmail ?? r.actorId}</td>
  <td>${r.action}</td>
  <td class="dim">${r.target ?? "—"}</td>
  <td class="${r.outcome === "ok" ? "ok" : r.outcome === "denied" ? "warn" : "bad"}">${r.outcome}</td>
  <td class="dim">${r.ip ?? "—"}</td></tr>`,
)}
</table></div>`;
}
