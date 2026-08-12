// @monkyesuite/database — Drizzle client + schema re-export.
// SINGLE SOURCE OF TRUTH for the DB. Consumed by apps/api (and web via API only).
// The Go worker connects with pgx and does NOT import this package.

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export * from "./schema.js";
export { schema };

export type Database = ReturnType<typeof createDatabase>;

/**
 * Build a Drizzle client over a pg Pool.
 *
 * Pass the connection string for the role you want:
 *   - the restricted APP role (RLS enforced) for the API, or
 *   - the SERVICE role (RLS bypass) for maintenance jobs.
 * The API sets `app.current_user_id` per request transaction; see specs/06.
 */
export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString });
  return drizzle(pool, { schema });
}
