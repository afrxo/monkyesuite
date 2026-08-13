// Session resolution for scoped routes. Reads the Better Auth session from the
// request (cookie or bearer) and stashes the user id on the context. Absence is
// NOT an error here — requireUser decides per route, so a global/optional route
// can share the same middleware and still serve signed-out callers.

import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { auth } from "./auth.js";
import { unauthenticated } from "./errors.js";

export interface AppEnv {
  Variables: { userId: string | null };
}

export const resolveSession = createMiddleware<AppEnv>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set("userId", session?.user.id ?? null);
  await next();
});

// Assert an authenticated caller; throws 401 (fails closed) otherwise.
export function requireUser(c: Context<AppEnv>): string {
  const userId = c.get("userId");
  if (!userId) throw unauthenticated();
  return userId;
}
