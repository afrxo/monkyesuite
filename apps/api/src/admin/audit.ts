// audit_log writes (specs/09 §9.5). Append-only by GRANT (roles.sql gives the
// app role select+insert and nothing else), so this module has no update or
// delete path by construction.
//
// The rule that makes the log trustworthy: an audit row is written in the SAME
// transaction as the effect it records. An action that succeeds without a row,
// or a row for an effect that rolled back, both defeat the point — so every
// caller passes the transaction handle that performed the effect.

import { auditLog } from "@monkyesuite/database";
import type { Context } from "hono";
import { db } from "../db.js";
import type { Tx } from "../tx.js";

export type AuditOutcome = "ok" | "error" | "denied";

export interface AuditEntry {
  actorId: string;
  action: string;
  target?: string | null;
  /**
   * Named, whitelisted fields only. NEVER a raw request body, and never a
   * secret value, password or invite token (§9.3b). Callers build this object
   * field by field for exactly that reason.
   */
  detail?: Record<string, string | number | boolean | null>;
  outcome: AuditOutcome;
  ip?: string | null;
}

/** Write an audit row inside the caller's transaction. */
export async function writeAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    target: entry.target ?? null,
    detail: entry.detail ?? {},
    outcome: entry.outcome,
    ip: entry.ip ?? null,
  });
}

/**
 * Write an audit row on its own, for events with no effect to be atomic with —
 * a denied request at the gate being the whole use case. Never throws: an
 * unwritable log must not turn a 403 into a 500, and the deny has already been
 * decided by the time we get here.
 */
export async function writeAuditDetached(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actorId: entry.actorId,
      action: entry.action,
      target: entry.target ?? null,
      detail: entry.detail ?? {},
      outcome: entry.outcome,
      ip: entry.ip ?? null,
    });
  } catch (err) {
    console.error("[admin] audit write failed:", err);
  }
}

/** Best-effort client IP from the proxy headers Railway sets. */
export function clientIp(c: Context): string | null {
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() ?? null;
  return c.req.header("x-real-ip") ?? null;
}
