import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load .env from the package dir (falls back to real env in CI / deploy).
config();

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is required (see .env.example)");
}

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  // Emit RLS policies / enableRLS() from the schema.
  entities: {
    roles: {
      // Roles are provisioned out-of-band (see drizzle/roles.sql), not by
      // drizzle-kit — keep it from trying to manage/drop them.
      provider: "",
    },
  },
  verbose: true,
  strict: true,
});
