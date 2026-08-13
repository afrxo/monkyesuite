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
import { db } from "./db.js";

const webOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((s) => s.trim());

export const auth = betterAuth({
  baseURL: process.env.API_BASE_URL ?? "http://localhost:8787",
  basePath: "/v1/auth",
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-only-secret-change-me-please",
  trustedOrigins: webOrigins,
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
});
