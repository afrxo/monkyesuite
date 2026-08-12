// db:migrate orchestration.
//
// Three ordered steps against DATABASE_URL (the admin/owner role):
//   1. functions.sql — RLS membership predicates, idempotent. Runs BEFORE the
//      schema migrations because migration 0001 rewrites policies to call them.
//   2. drizzle migrations — the generated schema (drizzle/*.sql).
//   3. roles.sql — explicit, per-table grants + role setup, idempotent. Runs
//      AFTER, when every table and function exists. Re-run automatically here so
//      a migration that adds a table never leaves its grants forgotten.
//
// functions.sql and roles.sql are deliberately outside the drizzle migration
// set (drizzle-kit manages neither functions nor grants); running them from
// here keeps them version-controlled and always applied.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

config();

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is required (see .env.example)");
}

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pool = new Pool({ connectionString: url });

async function runSqlFile(relPath: string): Promise<void> {
  const sql = readFileSync(join(pkgRoot, relPath), "utf8");
  await pool.query(sql);
}

async function main(): Promise<void> {
  // 1. functions first (fresh-DB ordering; idempotent on re-run).
  await runSqlFile("functions.sql");
  console.log("[migrate] functions.sql applied");

  // 2. schema migrations.
  await migrate(drizzle(pool), { migrationsFolder: join(pkgRoot, "drizzle") });
  console.log("[migrate] schema migrations applied");

  // 3. grants + roles (needs tables + functions present).
  await runSqlFile("drizzle/roles.sql");
  console.log("[migrate] roles.sql applied");
}

try {
  await main();
} finally {
  await pool.end();
}
