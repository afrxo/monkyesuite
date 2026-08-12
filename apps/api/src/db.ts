// DB handle for the API. Connects as the restricted APP role (RLS enforced);
// global reads touch un-RLS'd scraped tables plus game_notes (whose RLS policy
// returns shared-only when no app.current_user_id is set — exactly the
// auth-optional behaviour the global read surface wants). See specs/06, 07.

import "dotenv/config";
import { createDatabase } from "@monkyesuite/database";

const url = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error("APP_DATABASE_URL (or DATABASE_URL) is required");
}

export const db = createDatabase(url);
