// Better Auth — owns sign-in/sign-up and sessions (specs/06 §6.1). It reads and
// writes the identity tables (users/sessions/accounts/verifications), which
// carry no RLS, through the same app-role db handle. Everything else in the
// system references users.id.

import {
  accounts,
  sessions,
  users,
  verifications,
} from "@monkyesuite/database";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { eq } from "drizzle-orm";
import { db } from "./db.js";

const webOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((s) => s.trim());
const apiOrigin = process.env.API_BASE_URL ?? "http://localhost:8787";

export const auth = betterAuth({
  baseURL: apiOrigin,
  basePath: "/v1/auth",
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-only-secret-change-me-please",
  // apps/web (fetch, cross-origin) plus the API's own origin — /admin/login
  // (specs/09 §9.2) posts to this endpoint same-origin from :8787 itself, so
  // its Origin header (when the browser sends one) needs to be trusted too.
  trustedOrigins: [...webOrigins, apiOrigin],
  // apps/web (Cloudflare, monkyesuite.app) and apps/api (Railway, *.up.railway.app)
  // are on different registrable domains — every session request from the web is
  // cross-site, so the browser drops SameSite=Lax cookies (the default). None +
  // Secure lets the session cookie ride cross-site; `useSecureCookies` also
  // adds the __Secure- prefix. Http-only in dev falls back to non-secure so
  // localhost still works.
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
      partitioned: true,
    },
  },
  emailAndPassword: { enabled: true, autoSignIn: true },
  database: drizzleAdapter(db, {
    provider: "pg",
    // Map Better Auth's model names to our (plural) drizzle tables. Column JS
    // keys already match Better Auth's field names, so no field remap is needed.
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
    },
  }),
  // Closed suite (specs/06 §6.6): a revoked user must be refused a FRESH
  // sign-in, not just have their existing session die. Deleting their
  // `sessions` rows (the admin revoke action) handles the existing-session
  // half; this hook is the sign-in half — it runs before Better Auth issues a
  // new session, so a disabled user never gets one back.
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;
      const email = (ctx.body as { email?: unknown } | undefined)?.email;
      if (typeof email !== "string") return;
      const [row] = await db
        .select({ disabled: users.disabled })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (row?.disabled) {
        throw new APIError("FORBIDDEN", {
          message: "This account has been disabled.",
        });
      }
    }),
  },
});
