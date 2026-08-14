// /admin — the operator surface (specs/09-admin.md).
//
// Mounted on apps/api but OUTSIDE /v1 and outside the JSON contract in
// docs/api-contract.md: no route here appears there, and no response uses the
// JSON error envelope. Server-rendered htmx-shaped HTML, DB access in the
// handler, no client bundle.
//
// Two rules this file exists to hold:
//   - requireAdmin is middleware on the MOUNT, so a new route is gated by
//     existing (§9.2).
//   - the sub-app has its own onError/notFound, so an admin failure never
//     escapes into the /v1 envelope (§9.0).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Hono } from "hono";
import { type AppEnv, resolveSession } from "../middleware.js";
import {
  addMemberAction,
  createUserAction,
  purgeAction,
  requeueAction,
  revokeUserAction,
  runJobAction,
  trackAction,
  untrackAction,
} from "./actions.js";
import { clientIp, writeAuditDetached } from "./audit.js";
import {
  type AdminEnv,
  AdminRejected,
  LOGIN_PATH,
  rejectionResponse,
  requireAdmin,
} from "./gate.js";
import {
  ADMIN_JS,
  ASSETS,
  AUTH_JS,
  bare,
  CSP,
  html,
  page,
  panel,
  type Raw,
  REFRESH_EVENT,
  STYLES,
} from "./html.js";
import {
  auditPanel,
  derivePanel,
  driftPanel,
  endpointsPanel,
  enrichPanel,
  gamesPanel,
  identityPanel,
  jobsPanel,
  limiterPanel,
  secretsPanel,
  snapshotPanel,
  usersPanel,
} from "./panels.js";

/** Wrap a fragment so one failing panel degrades alone (§9.0). */
async function fragment(render: () => Promise<Raw>): Promise<Raw> {
  try {
    return await render();
  } catch (err) {
    console.error("[admin] panel failed:", err);
    return html`<p class="err">panel query failed — see server logs</p>`;
  }
}

export function adminRoutes(): Hono<AdminEnv> {
  const admin = new Hono<AdminEnv>();

  // This surface is never cached, never indexed, and never framed.
  admin.use("*", async (c, next) => {
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Frame-Options", "DENY");
    c.header("Content-Security-Policy", CSP);
    await next();
  });

  // Session first, then the gate. requireAdmin skips only LOGIN_PATH.
  admin.use("*", resolveSession as unknown as typeof requireAdmin);
  admin.use("*", requireAdmin);

  // Admin failures render as HTML, never as the /v1 JSON envelope.
  admin.onError((err, c) => {
    console.error("[admin] error:", err);
    return c.html(
      bare(
        "Error",
        html`<div class="card"><h1>Something went wrong</h1></div>`,
      ),
      500,
    );
  });
  admin.notFound((c) =>
    c.html(
      bare("Not found", html`<div class="card"><h1>Not found</h1></div>`),
      404,
    ),
  );

  /* ------------------------------- assets --------------------------------- */
  // htmx is vendored (a dependency of this app) and served from THIS host, so
  // the CSP can forbid off-origin script entirely. Read once, at first use, and
  // held in memory — it is 50KB and never changes at runtime.
  let htmxSource: string | null = null;
  const htmxBytes = (): string => {
    if (htmxSource === null) {
      const resolve = createRequire(import.meta.url);
      htmxSource = readFileSync(
        resolve.resolve("htmx.org/dist/htmx.min.js"),
        "utf8",
      );
    }
    return htmxSource;
  };

  // Assets carry no data, so they opt out of the surface's no-store default.
  const asset = (path: string, type: string, body: () => string) =>
    admin.get(path, (c) => {
      c.header("Content-Type", type);
      c.header("Cache-Control", "private, max-age=600");
      return c.body(body());
    });

  asset(ASSETS.htmx.route, "text/javascript; charset=utf-8", htmxBytes);
  asset(ASSETS.js.route, "text/javascript; charset=utf-8", () => ADMIN_JS);
  asset(ASSETS.css.route, "text/css; charset=utf-8", () => STYLES);
  asset(ASSETS.authJs.route, "text/javascript; charset=utf-8", () => AUTH_JS);

  /* ------------------------------- login --------------------------------- */
  // The only ungated route. It renders the same form for everyone: signing in
  // as a non-admin lands on the 403 page, which says nothing about a panel.
  // Submits via fetch (auth.js), not a plain form nav — Better Auth's origin
  // check needs a real Origin header, which a top-level form POST doesn't
  // reliably send, and fetch also lets a success land back on /admin instead
  // of dead-ending on the raw JSON response.
  admin.get("/login", (c) =>
    c.html(
      bare(
        "Sign in",
        html`<div class="card"><h1>monkyesuite<em>admin</em></h1>
<p class="sub">Restricted control surface.</p>
<form id="login-form">
  <label for="login-email">Username</label>
  <input id="login-email" name="email" type="text" autocomplete="username" required>
  <label for="login-password">Password</label>
  <input id="login-password" name="password" type="password" autocomplete="current-password" required>
  <button type="submit">Sign in</button>
  <p id="login-err" class="err"></p>
</form></div>
<script src="${ASSETS.authJs.href}" defer></script>`,
      ),
    ),
  );

  /* -------------------------------- page --------------------------------- */
  admin.get("/", async (c) => {
    const who = c.get("adminId");
    const body = html`<main>
${panel("panel-snapshot", "snapshot freshness", "/admin/panels/snapshot")}
${panel("panel-limiter", "limiter tiers", "/admin/panels/limiter")}
${panel("panel-enrich", "enrich queue", "/admin/panels/enrich")}
${panel("panel-derive", "derive health", "/admin/panels/derive")}
${panel("panel-endpoints", "gated-endpoint failure rates", "/admin/panels/endpoints")}
${panel("panel-drift", "trend-drift (confirmation rule)", "/admin/panels/drift")}
${panel("panel-secrets", "operational secrets", "/admin/panels/secrets", { everySeconds: 120 })}
<section><h2>identity</h2>${identityPanel()}</section>
${panel("panel-users", "users", "/admin/panels/users")}
<section><h2>tracked set</h2>${gamesPanel()}</section>
${panel("panel-jobs", "job run history", "/admin/panels/jobs", { wide: true })}
${panel("panel-audit", "audit log", "/admin/panels/audit", { wide: true, everySeconds: 60 })}
</main>`;
    return c.html(page("admin", who, body));
  });

  /* ------------------------------ fragments ------------------------------- */
  // One endpoint per panel: a slow query degrades its own panel, not the page.
  const frag = (path: string, render: () => Promise<Raw>) =>
    admin.get(path, async (c) => c.html((await fragment(render)).value));

  frag("/panels/snapshot", snapshotPanel);
  frag("/panels/limiter", limiterPanel);
  frag("/panels/enrich", enrichPanel);
  frag("/panels/derive", derivePanel);
  frag("/panels/endpoints", endpointsPanel);
  frag("/panels/drift", driftPanel);
  frag("/panels/secrets", secretsPanel);
  frag("/panels/audit", auditPanel);
  frag("/panels/users", usersPanel);

  admin.get("/panels/jobs", async (c) => {
    const job = c.req.query("job");
    const failuresOnly = c.req.query("failures") === "1";
    const body = await fragment(() => jobsPanel({ job, failuresOnly }));
    return c.html(body.value);
  });

  /* ------------------------------- actions -------------------------------- */
  // Each handler re-asserts admin and writes its own audit row (§9.5).
  const action = (
    path: string,
    handler: (c: Parameters<typeof runJobAction>[0]) => Promise<Raw>,
  ) =>
    admin.post(path, async (c) => {
      let body: Raw;
      try {
        body = await handler(c);
      } catch (err) {
        // A refusal (cross-origin) is a 403, not a 500: the request was
        // understood and declined. Anything else is a genuine fault and keeps
        // falling through to onError.
        if (err instanceof AdminRejected) {
          await writeAuditDetached({
            actorId: c.get("adminId"),
            action: "admin.denied",
            target: c.req.path,
            detail: { reason: err.reason },
            outcome: "denied",
            ip: clientIp(c),
          });
          return rejectionResponse(c, err);
        }
        throw err;
      }
      // Tell the page something changed; the panels that care are listening for
      // this event (html.ts REFRESH_EVENT), so an action never has to know
      // which panels exist.
      c.header("HX-Trigger", REFRESH_EVENT);
      return c.html(body.value);
    });

  action("/actions/run-job", runJobAction);
  action("/actions/enrich/requeue", requeueAction);
  action("/actions/enrich/purge", purgeAction);
  action("/actions/games/track", trackAction);
  action("/actions/games/untrack", untrackAction);
  action("/actions/users/create", createUserAction);
  action("/actions/members/add", addMemberAction);
  action("/actions/users/revoke", revokeUserAction);

  // Catch-all, registered last. A mounted sub-app's notFound() does NOT run —
  // an unmatched path falls through to the PARENT app's handler, which answers
  // in the /v1 JSON envelope. A matching route is the only way to keep an
  // unknown /admin path inside this surface's HTML contract. (It sits behind
  // the gate like everything else, so probing it reveals nothing either.)
  admin.all("*", (c) =>
    c.html(
      bare("Not found", html`<div class="card"><h1>Not found</h1></div>`),
      404,
    ),
  );

  return admin;
}

export type { AppEnv };
export { LOGIN_PATH };
