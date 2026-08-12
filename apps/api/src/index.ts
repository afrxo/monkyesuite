// @monkyesuite/api — HTTP API + auth boundary (Railway).
// The authorization chokepoint: every scoped handler resolves membership, and
// opens each request tx with `SET LOCAL app.current_user_id`. See specs/06, 07.
// Scaffold entrypoint; handlers land per spec. Proves workspace wiring resolves.

import { createDatabase } from "@monkyesuite/database";

const url = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error("APP_DATABASE_URL (or DATABASE_URL) is required");
}

// The API connects as the restricted APP role (RLS enforced).
export const db = createDatabase(url);

console.log("[api] scaffold booted (no routes yet)");
