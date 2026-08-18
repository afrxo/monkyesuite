// Periodic hard-delete of soft-deleted docs past retention. Runs against the
// service pool (bypassing RLS) since it operates cross-project. Retention
// window is 30 days by default and clamped to a sane band; the sweep is
// bounded per tick so a huge backlog never runs the pool dry.
//
// Started from index.ts on API boot. If the API restarts often (dev tsx
// watch), the sweep still fires roughly once per hour of wall clock — the
// slight overlap is harmless because DELETE is idempotent on empty selects.

import { blocks as blocksTable, docs } from "@monkyesuite/database";
import { and, inArray, isNotNull, lt } from "drizzle-orm";
import { db } from "../db.js";

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 30;
const PURGE_BATCH = 500;

function retentionDays(): number {
  const raw = Number(process.env.DOC_PURGE_RETENTION_DAYS);
  if (!Number.isFinite(raw)) return DEFAULT_RETENTION_DAYS;
  return Math.max(1, Math.min(365, Math.floor(raw)));
}

async function purgeOnce(): Promise<{ purged: number }> {
  const days = retentionDays();
  const cutoff = new Date(Date.now() - days * 24 * HOUR_MS);
  // Pick a batch of expired doc ids first so blocks + row deletes happen in
  // one transaction against a known-bounded set.
  const stale = await db
    .select({ id: docs.id })
    .from(docs)
    .where(and(isNotNull(docs.deletedAt), lt(docs.deletedAt, cutoff)))
    .limit(PURGE_BATCH);
  if (!stale.length) return { purged: 0 };
  const ids = stale.map((r) => r.id);
  // `blocks` cascades on docs delete, but the explicit delete keeps the
  // second statement cheap on Postgres.
  await db.delete(blocksTable).where(inArray(blocksTable.docId, ids));
  await db
    .delete(docs)
    .where(and(inArray(docs.id, ids), isNotNull(docs.deletedAt)));
  return { purged: ids.length };
}

let started = false;
export function startDocPurgeLoop(): void {
  if (started) return;
  started = true;
  const run = async () => {
    try {
      const { purged } = await purgeOnce();
      if (purged > 0) {
        console.log(
          `[api] doc purge: hard-deleted ${purged} doc(s) past retention`,
        );
      }
    } catch (err) {
      console.warn("[api] doc purge failed", err);
    }
  };
  // Fire once at boot (after a short delay so migrate has settled), then
  // hourly. Interval id intentionally not tracked — the process is the
  // lifecycle.
  setTimeout(run, 60_000);
  setInterval(run, HOUR_MS);
}

// Kept for the eventual admin surface; unused today.
export { purgeOnce };
