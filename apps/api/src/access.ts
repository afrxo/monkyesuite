// The single authorization chokepoint (specs/06 §6.4, docs/api-contract.md
// "Auth families"). Every scoped handler resolves membership through here before
// touching data; Postgres RLS is the backstop underneath.
//
// The membership read runs INSIDE the caller's tx, so it is itself RLS-filtered:
// with app.current_user_id set, the memberOf policy returns the caller's own
// membership row iff they belong to the project. That makes this both the
// primary gate and consistent with the backstop — one source of truth.
//
// 404-vs-403: resolveProjectAccess distinguishes "exists but you're not a
// member" (403) from "no such id" (404) WITHOUT a fetch-then-filter (which RLS
// would collapse to an ambiguous empty result). It reads the target's project
// identity via SECURITY DEFINER functions that bypass RLS but expose no content.

import { memberships } from "@monkyesuite/database";
import type { MemberRole } from "@monkyesuite/shared";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db.js";
import { forbidden, notFound } from "./errors.js";
import type { Tx } from "./tx.js";

export interface Access {
  role: MemberRole;
}

// Primary gate: the caller's membership in a project, or null. RLS-filtered.
export async function getMembership(
  tx: Tx,
  projectId: string,
  userId: string,
): Promise<Access | null> {
  const [row] = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(eq(memberships.projectId, projectId), eq(memberships.userId, userId)),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Resolve access to a project, throwing the correct status:
 *  - member found            → returns their role
 *  - not a member, exists     → 403 (no existence leak — it does exist)
 *  - not a member, absent     → 404
 *  - requireOwner and not owner → 403
 */
export async function resolveProjectAccess(
  tx: Tx,
  projectId: string,
  userId: string,
  opts: { requireOwner?: boolean } = {},
): Promise<Access> {
  const access = await getMembership(tx, projectId, userId);
  if (!access) {
    throw (await projectExists(projectId))
      ? forbidden("Not a member of this project.")
      : notFound("No such project.");
  }
  if (opts.requireOwner && access.role !== "owner") {
    throw forbidden("Owner only.");
  }
  return access;
}

/* --------- SECURITY DEFINER resolvers (bypass RLS; identity only) --------- */

export async function projectExists(projectId: string): Promise<boolean> {
  const r = await db.execute<{ ok: boolean }>(
    sql`select project_exists(${projectId}) as ok`,
  );
  return r.rows[0]?.ok ?? false;
}

// Flat scoped item routes (/tasks/:id, /milestones/:id, /docs/:id,
// /project-notes/:id) resolve their owning project the same RLS-bypassing way,
// so the API can 403-vs-404 before it fetches. `kind` picks the resolver fn.
type ScopedItem = "task" | "milestone" | "doc" | "note";
const RESOLVER: Record<ScopedItem, string> = {
  task: "project_of_task",
  milestone: "project_of_milestone",
  doc: "project_of_doc",
  note: "project_of_note",
};

export async function projectOfItem(
  kind: ScopedItem,
  id: string,
): Promise<string | null> {
  const r = await db.execute<{ pid: string | null }>(
    sql`select ${sql.raw(RESOLVER[kind])}(${id}) as pid`,
  );
  return r.rows[0]?.pid ?? null;
}

// Resolve an item's project + membership in one step, throwing 404/403 exactly
// like resolveProjectAccess. Returns the resolved projectId + the caller role.
export async function resolveItemAccess(
  tx: Tx,
  kind: ScopedItem,
  id: string,
  userId: string,
  opts: { requireOwner?: boolean } = {},
): Promise<{ projectId: string; role: MemberRole }> {
  const projectId = await projectOfItem(kind, id);
  if (!projectId) throw notFound("No such item.");
  const access = await resolveProjectAccess(tx, projectId, userId, opts);
  return { projectId, role: access.role };
}
