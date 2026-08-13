// Scoped routes (auth required) — projects, membership, invites. Every handler
// resolves membership through resolveProjectAccess BEFORE touching data, inside
// a withUser transaction that sets app.current_user_id for the RLS backstop.
// Membership WRITES (create project's owner row, remove member, accept invite)
// go through SECURITY DEFINER functions — see functions.sql / access.ts.

import { randomUUID } from "node:crypto";
import {
  invites,
  memberships,
  projects,
  tasks,
  users,
} from "@monkyesuite/database";
import {
  createInviteSchema,
  createProjectSchema,
  type Invite,
  type Membership,
  type Project,
  type ProjectDetail,
  patchProjectSchema,
  uuidSchema,
} from "@monkyesuite/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { projectOfInvite, resolveProjectAccess } from "./access.js";
import {
  conflict,
  gone,
  isUniqueViolation,
  notFound,
  validationError,
} from "./errors.js";
import { type AppEnv, requireUser } from "./middleware.js";
import { isoReq } from "./serialize.js";
import { type Tx, withUser } from "./tx.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COLLABORATOR_CAP = 2; // at most two role='member' collaborators per project

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
      const list = await tx
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
        .where(eq(memberships.projectId, id))
        .orderBy(desc(memberships.role));
      return list.map((m) => ({
        id: m.id,
        projectId: m.projectId,
        userId: m.userId,
        role: m.role,
        createdAt: isoReq(m.createdAt),
        user: { id: m.uId, name: m.uName, email: m.uEmail },
      }));
    });
    return c.json(rows);
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

  /* --------------------------- invites ---------------------------------- */

  const mapInvite = (i: typeof invites.$inferSelect): Invite => ({
    id: i.id,
    projectId: i.projectId,
    email: i.email,
    role: i.role,
    status: i.status,
    invitedBy: i.invitedBy,
    createdAt: isoReq(i.createdAt),
    expiresAt: i.expiresAt ? isoReq(i.expiresAt) : null,
  });

  r.get("/projects/:id/invites", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const rows = await withUser(userId, async (tx) => {
      await resolveProjectAccess(tx, id, userId);
      return tx
        .select()
        .from(invites)
        .where(eq(invites.projectId, id))
        .orderBy(desc(invites.createdAt));
    });
    return c.json(rows.map(mapInvite)); // token omitted by mapInvite
  });

  r.post("/projects/:id/invites", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = createInviteSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid invite.");
    const invite = await withUser(userId, async (tx): Promise<Invite> => {
      await resolveProjectAccess(tx, id, userId, { requireOwner: true });
      // Cap: existing member collaborators + still-pending invites must stay < 2.
      const seats = await tx.execute<{ used: number }>(sql`
        select (select count(*) from memberships where project_id = ${id} and role = 'member')
             + (select count(*) from invites where project_id = ${id} and status = 'pending')
             as used`);
      if (Number(seats.rows[0]?.used ?? 0) >= COLLABORATOR_CAP) {
        throw conflict("Collaborator cap reached (two per project).");
      }
      const [row] = await tx
        .insert(invites)
        .values({
          projectId: id,
          email: body.data.email,
          role: body.data.role,
          token: randomUUID(),
          invitedBy: userId,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        })
        .returning();
      if (!row) throw notFound("Invite creation failed.");
      return mapInvite(row);
    });
    return c.json(invite, 201);
  });

  r.delete("/invites/:id", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const projectId = await projectOfInvite(id);
    if (!projectId) throw notFound("No such invite.");
    await withUser(userId, async (tx) => {
      await resolveProjectAccess(tx, projectId, userId, { requireOwner: true });
      await tx
        .update(invites)
        .set({ status: "revoked" })
        .where(eq(invites.id, id));
    });
    return c.body(null, 204);
  });

  r.post("/invites/:token/accept", async (c) => {
    const userId = requireUser(c);
    const token = c.req.param("token");
    // accept_invite is SECURITY DEFINER (the caller isn't a member yet, so RLS
    // would hide the invite). It runs the whole accept atomically.
    const res = await withUser(userId, (tx) =>
      tx.execute<{ code: string; membership_id: string | null }>(
        sql`select * from accept_invite(${token}, ${userId})`,
      ),
    );
    const row = res.rows[0];
    switch (row?.code) {
      case "expired":
        throw gone("This invite has expired.");
      case "already_member":
        throw conflict("You are already a member of this project.");
      case "cap":
        throw conflict("Collaborator cap reached (two per project).");
      case "ok":
        break;
      default:
        throw notFound("No such invite.");
    }
    const membershipId = row.membership_id;
    if (!membershipId) throw notFound("Membership not found.");
    const membership = await withUser(
      userId,
      async (tx): Promise<Membership> => {
        const [m] = await tx
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
          .where(eq(memberships.id, membershipId))
          .limit(1);
        if (!m) throw notFound("Membership not found.");
        return {
          id: m.id,
          projectId: m.projectId,
          userId: m.userId,
          role: m.role,
          createdAt: isoReq(m.createdAt),
          user: { id: m.uId, name: m.uName, email: m.uEmail },
        };
      },
    );
    return c.json(membership, 201);
  });

  return r;
}
