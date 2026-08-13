// The admin gate (specs/09 §9.2) — the security core of this surface.
//
// /admin is the highest-privilege surface in the system and the ONLY one with
// no RLS backstop underneath it: it reads global tables, which carry no
// policies. Every other scoped route has the database as a second line of
// defence; here a bug in this file is the whole failure. Two consequences,
// both load-bearing:
//
//   1. The gate is middleware on the MOUNT, not a per-handler call. A new admin
//      route is gated by existing — forgetting the check is not possible.
//   2. It fails closed on every path: no session, unreadable session, missing
//      user row, is_admin null/false, or ANY error resolving the flag → deny.
//      There is no path through requireAdmin that succeeds without an
//      affirmative is_admin = true read.
//
// The admin role is GLOBAL and unrelated to project owner/member: a project
// owner is not an admin and must not reach this surface.

import { users } from "@monkyesuite/database";
import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler, Next } from "hono";
import { db } from "../db.js";
import type { AppEnv } from "../middleware.js";
import { clientIp, writeAuditDetached } from "./audit.js";
import { bare, html } from "./html.js";

export const LOGIN_PATH = "/admin/login";

/** The one ungated path under the mount (§9.2). */
const UNGATED = new Set<string>([LOGIN_PATH]);

export interface AdminEnv extends AppEnv {
  Variables: AppEnv["Variables"] & { adminId: string };
}

/** True only for an affirmative is_admin read. Any failure returns false. */
async function readIsAdmin(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.isAdmin === true;
}

/**
 * 401 — no valid session. A full page redirects to the login form; an htmx
 * fragment answers 401 + HX-Redirect instead, because swapping a login form
 * into a monitoring panel is a confusing place to ask for credentials.
 */
function denyUnauthenticated(c: Context) {
  if (c.req.header("HX-Request")) {
    c.header("HX-Redirect", LOGIN_PATH);
    return c.body(null, 401);
  }
  return c.redirect(LOGIN_PATH, 302);
}

/**
 * 403 — authenticated, not an admin. Bare page: no detail, no navigation, no
 * hint that a panel exists. Byte-identical for a project owner, a member and a
 * signed-in stranger.
 */
function denyForbidden(c: Context) {
  return c.html(
    bare(
      "Not authorized",
      html`<div class="card"><h1>Not authorized</h1></div>`,
    ),
    403,
  );
}

export const requireAdmin: MiddlewareHandler<AdminEnv> = async (
  c: Context<AdminEnv>,
  next: Next,
) => {
  if (UNGATED.has(c.req.path)) return next();

  const userId = c.get("userId");
  if (!userId) return denyUnauthenticated(c);

  let isAdmin = false;
  try {
    isAdmin = await readIsAdmin(userId);
  } catch (err) {
    // Fail closed. A database that cannot answer "is this user an admin" has
    // not answered "yes", so this is a deny — never a 500 that some upstream
    // handler might treat as retryable, and never a pass-through.
    console.error("[admin] is_admin read failed; denying:", err);
    await writeAuditDetached({
      actorId: userId,
      action: "admin.denied",
      target: c.req.path,
      detail: { reason: "flag_read_failed" },
      outcome: "denied",
      ip: clientIp(c),
    });
    return denyForbidden(c);
  }

  if (!isAdmin) {
    // Attempted access to this surface is exactly the entry worth having;
    // repeated denials for one user are the signal (§9.2).
    await writeAuditDetached({
      actorId: userId,
      action: "admin.denied",
      target: c.req.path,
      detail: { reason: "not_admin" },
      outcome: "denied",
      ip: clientIp(c),
    });
    return denyForbidden(c);
  }

  c.set("adminId", userId);
  await next();
};

/**
 * Re-assert admin inside a handler (§9.5). Belt over the mount's braces: every
 * write action calls this so a future refactor that loosens the mount cannot
 * silently open the actions.
 */
export function assertAdmin(c: Context<AdminEnv>): string {
  const adminId = c.get("adminId");
  if (!adminId) throw new Error("admin gate bypassed");
  return adminId;
}

/**
 * A rejected admin request. Carries its own status so the action wrapper can
 * answer 403 rather than letting a plain Error become a 500 — a refusal is not
 * a fault, and the difference matters when reading logs after an attack.
 */
export class AdminRejected extends Error {
  readonly status = 403;
  constructor(readonly reason: string) {
    super(`admin request rejected: ${reason}`);
    this.name = "AdminRejected";
  }
}

/**
 * Reject a cross-origin form POST. The session cookie is SameSite-protected and
 * /admin is excluded from CORS, but a same-site-lax cookie still rides along on
 * a top-level cross-site form submit — so state-changing routes check Origin
 * directly. Absent Origin (same-origin form posts in some browsers) is allowed;
 * a MISMATCHED origin never is.
 */
export function assertSameOrigin(c: Context): void {
  const origin = c.req.header("origin");
  if (!origin) return;
  const here = new URL(c.req.url).origin;
  if (origin !== here) throw new AdminRejected("cross_origin");
}

/** Render a refusal: 403, bare, no detail — the same page the gate serves. */
export function rejectionResponse(c: Context, err: AdminRejected) {
  return c.html(
    bare(
      "Not authorized",
      html`<div class="card"><h1>Not authorized</h1></div>`,
    ),
    err.status,
  );
}
