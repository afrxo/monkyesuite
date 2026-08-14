// Admin write actions (specs/09 §9.5).
//
// Every action: re-asserts admin, rejects cross-origin, validates with Zod,
// performs its effect and writes EXACTLY ONE audit_log row in the SAME
// transaction, then swaps a fragment back. If the effect rolls back, the audit
// row rolls back with it — the log describes what happened, never what was
// attempted-and-lost.

import { enrichJobs, games, jobCommands, sessions, users } from "@monkyesuite/database";
import { and, eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";
import { auth } from "../auth.js";
import { db } from "../db.js";
import { type AuditEntry, clientIp, writeAudit } from "./audit.js";
import { type AdminEnv, assertAdmin, assertSameOrigin } from "./gate.js";
import { html, type Raw } from "./html.js";

/** Jobs an operator may trigger. `enrich-drain` is not one: it is spawned by
 * the enrich job itself, never scheduled. */
const TRIGGERABLE = [
  "discover",
  "snapshot",
  "events",
  "enrich",
  "derive",
  "trend-drift",
  "demand",
] as const;

export const runJobSchema = z.object({ job: z.enum(TRIGGERABLE) });
export const requeueSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(["universe", "creator"]).optional().or(z.literal("")),
});
export const purgeSchema = z.object({
  confirm: z.literal("PURGE"),
  kind: z.enum(["universe", "creator"]).optional().or(z.literal("")),
});
export const trackSchema = z.object({
  universeId: z.coerce.number().int().positive(),
  name: z.string().trim().max(200).optional(),
});
// The typed confirmation must match the target id itself — a destructive action
// should require naming what it destroys, not just clicking past a dialog.
export const untrackSchema = z
  .object({
    universeId: z.coerce.number().int().positive(),
    confirm: z.string(),
  })
  .refine((v) => v.confirm.trim() === String(v.universeId), {
    message: "Confirmation must repeat the universeId.",
    path: ["confirm"],
  });
export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().max(120).optional(),
  password: z.string().min(8).max(200),
});
export const addMemberSchema = z.object({
  projectId: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(["owner", "member"]).default("member"),
});
export const revokeUserSchema = z
  .object({
    email: z.string().email(),
    confirm: z.string(),
  })
  .refine((v) => v.confirm.trim() === v.email, {
    message: "Confirmation must repeat the user's email.",
    path: ["confirm"],
  });

const ok = (msg: string): Raw => html`<span class="ok">${msg}</span>`;
const bad = (msg: string): Raw => html`<span class="bad">${msg}</span>`;

/** Parse a form body, turning a Zod failure into a rendered message. */
async function form<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; message: string }> {
  const body = Object.fromEntries((await c.req.formData()).entries());
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      message: `${issue?.path.join(".") ?? "input"}: ${issue?.message ?? "invalid"}`,
    };
  }
  return { ok: true, data: parsed.data };
}

/** Run an effect + its audit row in one transaction. */
async function audited<T>(
  entry: Omit<AuditEntry, "outcome">,
  effect: (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const result = await effect(tx);
    await writeAudit(tx, { ...entry, outcome: "ok" });
    return result;
  });
}

/* ------------------------------- run-job ---------------------------------- */

export async function runJobAction(c: Context<AdminEnv>): Promise<Raw> {
  const adminId = assertAdmin(c);
  assertSameOrigin(c);
  const parsed = await form(c, runJobSchema);
  if (!parsed.ok) return bad(parsed.message);
  const { job } = parsed.data;

  // Not an execution — a request. The worker owns the loop; it claims this on
  // its next tick. Idempotency (natural keys) makes an extra run a no-op, but a
  // second PENDING command for the same job is pure noise, so it is refused.
  const existing = await db
    .select({ id: jobCommands.id })
    .from(jobCommands)
    .where(and(eq(jobCommands.job, job), eq(jobCommands.status, "pending")))
    .limit(1);
  if (existing.length > 0) {
    return bad(`${job} already queued — waiting for the worker's next tick.`);
  }

  await audited(
    {
      actorId: adminId,
      action: "job.trigger",
      target: job,
      detail: { job },
      ip: clientIp(c),
    },
    async (tx) => {
      await tx
        .insert(jobCommands)
        .values({ kind: "run_job", job, requestedBy: adminId });
    },
  );
  return ok(`${job} queued — the worker runs it on its next tick (≤5 min).`);
}

/* ---------------------------- enrich requeue ------------------------------ */

export async function requeueAction(c: Context<AdminEnv>): Promise<Raw> {
  const adminId = assertAdmin(c);
  assertSameOrigin(c);
  const parsed = await form(c, requeueSchema);
  if (!parsed.ok) return bad(parsed.message);
  const { id, kind } = parsed.data;

  const where = id
    ? and(eq(enrichJobs.id, id), eq(enrichJobs.status, "failed"))
    : kind
      ? and(eq(enrichJobs.kind, kind), eq(enrichJobs.status, "failed"))
      : eq(enrichJobs.status, "failed");

  const n = await audited(
    {
      actorId: adminId,
      action: "enrich.requeue",
      target: id ?? kind ?? "all",
      detail: { byId: Boolean(id), kind: kind || "all" },
      ip: clientIp(c),
    },
    async (tx) => {
      const rows = await tx
        .update(enrichJobs)
        .set({
          status: "pending",
          attempts: 0,
          runAfter: new Date(),
          lastError: null,
          updatedAt: new Date(),
        })
        .where(where)
        .returning({ id: enrichJobs.id });
      return rows.length;
    },
  );
  return ok(`requeued ${n} dead-letter job(s)`);
}

/* ----------------------------- enrich purge ------------------------------- */

export async function purgeAction(c: Context<AdminEnv>): Promise<Raw> {
  const adminId = assertAdmin(c);
  assertSameOrigin(c);
  const parsed = await form(c, purgeSchema);
  if (!parsed.ok) return bad("type PURGE to confirm");
  const { kind } = parsed.data;

  const where = kind
    ? and(eq(enrichJobs.kind, kind), eq(enrichJobs.status, "failed"))
    : eq(enrichJobs.status, "failed");

  const n = await audited(
    {
      actorId: adminId,
      action: "enrich.purge",
      target: kind || "all",
      detail: { kind: kind || "all" },
      ip: clientIp(c),
    },
    // Bounded by construction: only status='failed' rows of a work queue.
    // No scraped data is reachable from here.
    async (tx) => {
      const rows = await tx
        .delete(enrichJobs)
        .where(where)
        .returning({ id: enrichJobs.id });
      return rows.length;
    },
  );
  return ok(`purged ${n} dead-letter job(s)`);
}

/* ------------------------------ game track -------------------------------- */

export async function trackAction(c: Context<AdminEnv>): Promise<Raw> {
  const adminId = assertAdmin(c);
  assertSameOrigin(c);
  const parsed = await form(c, trackSchema);
  if (!parsed.ok) return bad(parsed.message);
  const { universeId, name } = parsed.data;

  const created = await audited(
    {
      actorId: adminId,
      action: "game.track",
      target: String(universeId),
      detail: { universeId, seeded: Boolean(name) },
      ip: clientIp(c),
    },
    async (tx) => {
      const rows = await tx
        .insert(games)
        .values({
          universeId,
          name: name && name.length > 0 ? name : `universe ${universeId}`,
          isTracked: true,
        })
        .onConflictDoUpdate({
          target: games.universeId,
          set: { isTracked: true },
        })
        .returning({ universeId: games.universeId });
      return rows.length > 0;
    },
  );
  return created
    ? ok(`tracking ${universeId}`)
    : bad(`could not track ${universeId}`);
}

/* ----------------------------- game untrack ------------------------------- */

export async function untrackAction(c: Context<AdminEnv>): Promise<Raw> {
  const adminId = assertAdmin(c);
  assertSameOrigin(c);
  const parsed = await form(c, untrackSchema);
  if (!parsed.ok) return bad(parsed.message);
  const { universeId } = parsed.data;

  const n = await audited(
    {
      actorId: adminId,
      action: "game.untrack",
      target: String(universeId),
      detail: { universeId },
      ip: clientIp(c),
    },
    // Clears the flag only. game_metrics is an immutable landing layer: history
    // stays, and stays re-derivable. There is deliberately no delete here.
    async (tx) => {
      const rows = await tx
        .update(games)
        .set({ isTracked: false })
        .where(eq(games.universeId, universeId))
        .returning({ universeId: games.universeId });
      return rows.length;
    },
  );
  return n > 0
    ? ok(`stopped tracking ${universeId} (metrics history retained)`)
    : bad(`no such game ${universeId}`);
}

/* ------------------------------ create user ------------------------------- */

export async function createUserAction(c: Context<AdminEnv>): Promise<Raw> {
  const adminId = assertAdmin(c);
  assertSameOrigin(c);
  const parsed = await form(c, createUserSchema);
  if (!parsed.ok) return bad(parsed.message);
  const { email, name, password } = parsed.data;

  // Better Auth's own server API — same hashing, same accounts row, same
  // validation as public sign-up. A different caller, never a different
  // mechanism. The password is passed straight through and never logged or
  // audited (§9.3b: detail carries named fields only).
  let userId: string;
  try {
    const created = await auth.api.signUpEmail({
      body: { email, password, name: name && name.length > 0 ? name : email },
    });
    userId = created.user.id;
  } catch (err) {
    console.error("[admin] user create failed");
    return bad(
      err instanceof Error && /exist/i.test(err.message)
        ? "an account with that email already exists"
        : "could not create user",
    );
  }

  // The account is never an admin: is_admin is set out of band by SQL only.
  await db.transaction(async (tx) => {
    await writeAudit(tx, {
      actorId: adminId,
      action: "user.create",
      target: email,
      detail: { email, userId, isAdmin: false },
      outcome: "ok",
      ip: clientIp(c),
    });
  });
  return ok(`created ${email} (not an admin)`);
}

/* ----------------------------- add member ---------------------------------- */

export async function addMemberAction(c: Context<AdminEnv>): Promise<Raw> {
  const adminId = assertAdmin(c);
  assertSameOrigin(c);
  const parsed = await form(c, addMemberSchema);
  if (!parsed.ok) return bad(parsed.message);
  const { projectId, email, role } = parsed.data;

  // The privileged insert lives in admin_add_member (functions.sql): the admin
  // confers no project membership, so it can't go through the owner-gated
  // path. The function enforces the two-collaborator cap internally, so this
  // path cannot route around the rule the owner path obeys — and no policy is
  // weakened, no membership fabricated. Closed suite: there is no invite/token
  // step here — the target must already have an account (specs/06 §6.3).
  const result = await db.transaction(async (tx) => {
    const r = await tx.execute<{ code: string; membership_id: string | null }>(sql`
      select code, membership_id from admin_add_member(
        ${projectId}::uuid, ${email}, ${role}, ${adminId})`);
    const code = r.rows[0]?.code ?? "error";
    await writeAudit(tx, {
      actorId: adminId,
      action: "member.add",
      target: email,
      detail: { projectId, email, role, result: code },
      outcome: code === "ok" ? "ok" : "error",
      ip: clientIp(c),
    });
    return code;
  });

  if (result === "cap") {
    return bad("collaborator cap reached (two per project)");
  }
  if (result === "no_project") return bad("no such project");
  if (result === "no_user") return bad("no user with that email");
  if (result === "already_member") return bad("already a member of that project");
  if (result !== "ok") return bad("add member failed");
  return ok(`added ${email} to the project`);
}

/* ----------------------------- revoke user --------------------------------- */

export async function revokeUserAction(c: Context<AdminEnv>): Promise<Raw> {
  const adminId = assertAdmin(c);
  assertSameOrigin(c);
  const parsed = await form(c, revokeUserSchema);
  if (!parsed.ok) return bad(parsed.message);
  const { email } = parsed.data;

  const result = await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: users.id, isAdmin: users.isAdmin, disabled: users.disabled })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!target) return "no_user" as const;
    if (target.disabled) return "already_disabled" as const;

    // The last admin cannot revoke themselves into a locked-out system — this
    // is the one guard that must hold regardless of who clicks the button.
    if (target.isAdmin) {
      const [row] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.isAdmin, true), eq(users.disabled, false)));
      if ((row?.n ?? 0) <= 1) return "last_admin" as const;
    }

    await tx.update(users).set({ disabled: true }).where(eq(users.id, target.id));
    // Kill the existing session NOW, not just future sign-in (specs/06 §6.6).
    await tx.delete(sessions).where(eq(sessions.userId, target.id));
    await writeAudit(tx, {
      actorId: adminId,
      action: "user.revoke",
      target: email,
      detail: { email, wasAdmin: target.isAdmin },
      outcome: "ok",
      ip: clientIp(c),
    });
    return "ok" as const;
  });

  if (result === "no_user") return bad("no user with that email");
  if (result === "already_disabled") return bad("that user is already revoked");
  if (result === "last_admin") {
    return bad("cannot revoke the last admin — create another admin first");
  }
  return ok(`revoked ${email} — existing session killed, sign-in refused`);
}

/** Exported so the panel's job picker and the validator share one list. */
export const TRIGGERABLE_JOBS = TRIGGERABLE;
