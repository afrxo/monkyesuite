// Session resolution. Reads the Better Auth session from the request (cookie
// or bearer) and stashes the user id on the context. Absence is NOT an error
// here — requireUser decides per route. The suite is closed (specs/06 §6.6):
// every /v1 and /admin route requires a session in the end, but resolving it
// here (rather than throwing) keeps this middleware shared and side-effect-free.
//
// A DISABLED user's session is treated as absent, everywhere a session is
// read — this is the belt-and-braces half of revocation (specs/06 §6.6). The
// primary kill is that revoking deletes the user's `sessions` rows outright,
// so Better Auth's own lookup already fails; this closes the gap in case a
// session row somehow survives, and fails closed like every other check here.

import { users } from "@monkyesuite/database";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { auth } from "./auth.js";
import { db } from "./db.js";
import { unauthenticated } from "./errors.js";

export interface AppEnv {
  Variables: { userId: string | null };
}

export const resolveSession = createMiddleware<AppEnv>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const rawUserId = session?.user.id ?? null;
  c.set("userId", rawUserId ? await activeUserId(rawUserId) : null);
  await next();
});

// Returns the id back iff the user exists and is not disabled; null otherwise
// (fails closed — an unreadable or missing row is treated as no session).
async function activeUserId(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ disabled: users.disabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row && !row.disabled ? userId : null;
}

// Assert an authenticated caller; throws 401 (fails closed) otherwise.
export function requireUser(c: Context<AppEnv>): string {
  const userId = c.get("userId");
  if (!userId) throw unauthenticated();
  return userId;
}
