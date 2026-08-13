// Per-request scoped transaction (specs/06 §6.4). Opens a transaction and sets
// `app.current_user_id` LOCAL to it, so every RLS policy in schema.ts resolves
// to this user and only this user. set_config(..., true) is the parameterized
// form of SET LOCAL (SET LOCAL can't bind a value); `true` = local to the tx.
//
// A missing/empty session must never reach here — callers resolve the user id
// first (requireUser). With no setting, current_setting('app.current_user_id',
// true) is NULL and the policies fail closed.

import { sql } from "drizzle-orm";
import { db } from "./db.js";

// The transaction handle drizzle hands the callback.
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function withUser<T>(
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_user_id', ${userId}, true)`,
    );
    return fn(tx);
  });
}
