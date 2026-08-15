// Scoped routes (auth required) — projects, membership. Every handler
// resolves membership through resolveProjectAccess BEFORE touching data, inside
// a withUser transaction that sets app.current_user_id for the RLS backstop.
// Membership WRITES (create project's owner row, remove member, add a member)
// go through SECURITY DEFINER functions — see functions.sql / access.ts.

import { memberships, projects, tasks, users } from "@monkyesuite/database";
import {
  addMemberSchema,
  createProjectSchema,
  type Membership,
  type Project,
  type ProjectDetail,
  patchProjectSchema,
  uuidSchema,
} from "@monkyesuite/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { resolveProjectAccess } from "./access.js";
import { toAuthEmail, toDisplayUsername } from "./identity.js";
import {
  conflict,
  isUniqueViolation,
  notFound,
  validationError,
} from "./errors.js";
import { type AppEnv, requireUser } from "./middleware.js";
import { isoReq } from "./serialize.js";
import { type Tx, withUser } from "./tx.js";

const mapProject = (p: typeof projects.$inferSelect): Project => ({
  id: p.id,
  name: p.name,
  slug: p.slug,
  description: p.description,
  status: p.status,
  createdBy: p.createdBy,
  createdAt: isoReq(p.createdAt),
  updatedAt: isoReq(p.updatedAt),
});

async function projectCounts(tx: Tx, projectId: string) {
  const [m] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(eq(memberships.projectId, projectId));
  const [t] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, projectId),
        sql`${tasks.status} not in ('done','archived')`,
      ),
    );
  return { members: m?.n ?? 0, openTasks: t?.n ?? 0 };
}

export function scopedRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  /* ------------------------------ projects ------------------------------ */

  r.get("/projects", async (c) => {
    const userId = requireUser(c);
    const rows = await withUser(userId, (tx) =>
      tx.select().from(projects).orderBy(desc(projects.updatedAt)),
    );
    return c.json(rows.map(mapProject));
  });

  r.post("/projects", async (c) => {
    const userId = requireUser(c);
    const body = createProjectSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid project.");
    let projectId: string;
    try {
      const res = await withUser(userId, (tx) =>
        tx.execute<{ id: string }>(
          sql`select create_project(${body.data.name}, ${body.data.slug}, ${body.data.description ?? null}, ${userId}) as id`,
        ),
      );
      const id = res.rows[0]?.id;
      if (!id) throw notFound("Project creation failed.");
      projectId = id;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("That slug is already taken.");
      throw err;
    }
    const detail = await withUser(
      userId,
      async (tx): Promise<ProjectDetail> => {
        const [p] = await tx
          .select()
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1);
        if (!p) throw notFound("No such project.");
        return {
          ...mapProject(p),
          membership: { role: "owner" },
          counts: await projectCounts(tx, projectId),
        };
      },
    );
    return c.json(detail, 201);
  });

  r.get("/projects/:id", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const detail = await withUser(
      userId,
      async (tx): Promise<ProjectDetail> => {
        const access = await resolveProjectAccess(tx, id, userId);
        const [p] = await tx
          .select()
          .from(projects)
          .where(eq(projects.id, id))
          .limit(1);
        if (!p) throw notFound("No such project.");
        return {
          ...mapProject(p),
          membership: { role: access.role },
          counts: await projectCounts(tx, id),
        };
      },
    );
    return c.json(detail);
  });

  r.patch("/projects/:id", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = patchProjectSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid update.");
    const project = await withUser(userId, async (tx): Promise<Project> => {
      await resolveProjectAccess(tx, id, userId, { requireOwner: true });
      const [p] = await tx
        .update(projects)
        .set({ ...body.data, updatedAt: new Date() })
        .where(eq(projects.id, id))
        .returning();
      if (!p) throw notFound("No such project.");
      return mapProject(p);
    });
    return c.json(project);
  });

  r.delete("/projects/:id", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    await withUser(userId, async (tx) => {
      await resolveProjectAccess(tx, id, userId, { requireOwner: true });
      await tx.delete(projects).where(eq(projects.id, id));
    });
    return c.body(null, 204);
  });

  /* --------------------------- members ---------------------------------- */

  r.get("/projects/:id/members", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const rows = await withUser(userId, async (tx): Promise<Membership[]> => {
      await resolveProjectAccess(tx, id, userId);
      return listMembers(tx, id);
    });
    return c.json(rows);
  });

  // Add an EXISTING user to a project by email — the closed suite's
  // replacement for the invite/token/expiry flow (specs/06 §6.3): everyone
  // already has an account, so this is a direct, synchronous write, not an
  // async accept step. add_member_by_email enforces the two-collaborator cap
  // internally so this path can't route around it (functions.sql).
  r.post("/projects/:id/members", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = addMemberSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid member.");
    const membership = await withUser(
      userId,
      async (tx): Promise<Membership> => {
        await resolveProjectAccess(tx, id, userId, { requireOwner: true });
        const res = await tx.execute<{
          code: string;
          membership_id: string | null;
        }>(
          sql`select code, membership_id from add_member_by_email(${id}, ${toAuthEmail(body.data.email)}, ${body.data.role})`,
        );
        const row = res.rows[0];
        switch (row?.code) {
          case "no_user":
            throw notFound("No user with that email.");
          case "already_member":
            throw conflict("Already a member of this project.");
          case "cap":
            throw conflict("Collaborator cap reached (two per project).");
          case "ok":
            break;
          default:
            throw notFound("No such project.");
        }
        const membershipId = row.membership_id;
        if (!membershipId) throw notFound("Membership not found.");
        const [m] = await listMembers(tx, id, membershipId);
        if (!m) throw notFound("Membership not found.");
        return m;
      },
    );
    return c.json(membership, 201);
  });

  r.delete("/projects/:id/members/:userId", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const target = c.req.param("userId");
    await withUser(userId, async (tx) => {
      await resolveProjectAccess(tx, id, userId, { requireOwner: true });
      const res = await tx.execute<{ ok: boolean }>(
        sql`select remove_member(${id}, ${target}) as ok`,
      );
      if (!res.rows[0]?.ok) throw notFound("No such collaborator.");
    });
    return c.body(null, 204);
  });

  return r;
}

// List a project's memberships, optionally filtered to one membership id
// (reused by POST /projects/:id/members to re-read what it just wrote).
async function listMembers(
  tx: Tx,
  projectId: string,
  onlyId?: string,
): Promise<Membership[]> {
  const rows = await tx
    .select({
      id: memberships.id,
      projectId: memberships.projectId,
      userId: memberships.userId,
      role: memberships.role,
      createdAt: memberships.createdAt,
      uId: users.id,
      uName: users.name,
      uEmail: users.email,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      onlyId
        ? and(eq(memberships.projectId, projectId), eq(memberships.id, onlyId))
        : eq(memberships.projectId, projectId),
    )
    .orderBy(desc(memberships.role));
  return rows.map((m) => ({
    id: m.id,
    projectId: m.projectId,
    userId: m.userId,
    role: m.role,
    createdAt: isoReq(m.createdAt),
    user: { id: m.uId, name: m.uName, email: toDisplayUsername(m.uEmail) },
  }));
}
