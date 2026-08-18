// Card-tag routes (per-project label vocabulary + task junction). Distinct from
// tags.ts, which handles the GLOBAL 5-axis game vocabulary. Everything here is
// project-scoped: membership resolves through resolveProjectAccess /
// resolveItemAccess inside a withUser tx, RLS is the backstop.

import { projectTags, taskTags } from "@monkyesuite/database";
import {
  applyTaskTagSchema,
  createProjectTagSchema,
  patchProjectTagSchema,
  type ProjectTag,
  uuidSchema,
} from "@monkyesuite/shared";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { resolveItemAccess, resolveProjectAccess } from "./access.js";
import {
  conflict,
  isUniqueViolation,
  notFound,
  validationError,
} from "./errors.js";
import { type AppEnv, requireUser } from "./middleware.js";
import { isoReq } from "./serialize.js";
import { withUser } from "./tx.js";

const mapTag = (r: typeof projectTags.$inferSelect): ProjectTag => ({
  id: r.id,
  projectId: r.projectId,
  name: r.name,
  color: r.color,
  createdAt: isoReq(r.createdAt),
  updatedAt: isoReq(r.updatedAt),
});

export function projectTagRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get("/projects/:id/tags", async (c) => {
    const userId = requireUser(c);
    const projectId = uuidSchema.parse(c.req.param("id"));
    const rows = await withUser(userId, async (tx) => {
      await resolveProjectAccess(tx, projectId, userId);
      return tx
        .select()
        .from(projectTags)
        .where(eq(projectTags.projectId, projectId))
        .orderBy(asc(projectTags.name));
    });
    return c.json(rows.map(mapTag));
  });

  r.post("/projects/:id/tags", async (c) => {
    const userId = requireUser(c);
    const projectId = uuidSchema.parse(c.req.param("id"));
    const body = createProjectTagSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid tag.");
    const created = await withUser(userId, async (tx): Promise<ProjectTag> => {
      await resolveProjectAccess(tx, projectId, userId);
      let row: typeof projectTags.$inferSelect | undefined;
      try {
        [row] = await tx
          .insert(projectTags)
          .values({
            projectId,
            name: body.data.name,
            color: body.data.color ?? null,
            createdBy: userId,
          })
          .returning();
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw conflict("A tag with that name already exists.");
        }
        throw err;
      }
      if (!row) throw notFound("Tag creation failed.");
      return mapTag(row);
    });
    return c.json(created, 201);
  });

  r.patch("/project-tags/:id", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = patchProjectTagSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid update.");
    const d = body.data;
    const updated = await withUser(userId, async (tx): Promise<ProjectTag> => {
      await resolveItemAccess(tx, "projectTag", id, userId);
      let row: typeof projectTags.$inferSelect | undefined;
      try {
        [row] = await tx
          .update(projectTags)
          .set({
            ...(d.name !== undefined ? { name: d.name } : {}),
            ...(d.color !== undefined ? { color: d.color } : {}),
            updatedAt: new Date(),
          })
          .where(eq(projectTags.id, id))
          .returning();
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw conflict("A tag with that name already exists.");
        }
        throw err;
      }
      if (!row) throw notFound("No such tag.");
      return mapTag(row);
    });
    return c.json(updated);
  });

  r.delete("/project-tags/:id", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    await withUser(userId, async (tx) => {
      await resolveItemAccess(tx, "projectTag", id, userId);
      // task_tags rows cascade on the FK; no manual cleanup needed.
      await tx.delete(projectTags).where(eq(projectTags.id, id));
    });
    return c.body(null, 204);
  });

  // Apply an existing project tag to a card.
  r.post("/tasks/:id/tags", async (c) => {
    const userId = requireUser(c);
    const taskId = uuidSchema.parse(c.req.param("id"));
    const body = applyTaskTagSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid tag application.");
    const { tagId } = body.data;
    const applied = await withUser(userId, async (tx): Promise<ProjectTag> => {
      const { projectId } = await resolveItemAccess(tx, "task", taskId, userId);
      // Tag must live in the same project as the task — cross-project apply is
      // caught by RLS (the tag isn't visible), but we short-circuit with a
      // clean 404 rather than a unique-violation-style error.
      const [tag] = await tx
        .select()
        .from(projectTags)
        .where(
          and(
            eq(projectTags.id, tagId),
            eq(projectTags.projectId, projectId),
          ),
        )
        .limit(1);
      if (!tag) throw notFound("Unknown tag.");
      try {
        await tx.insert(taskTags).values({
          taskId,
          tagId,
          projectId,
          addedBy: userId,
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw conflict("Tag already applied to this card.");
        }
        throw err;
      }
      return mapTag(tag);
    });
    return c.json(applied, 201);
  });

  r.delete("/tasks/:id/tags/:tagId", async (c) => {
    const userId = requireUser(c);
    const taskId = uuidSchema.parse(c.req.param("id"));
    const tagId = uuidSchema.parse(c.req.param("tagId"));
    await withUser(userId, async (tx) => {
      await resolveItemAccess(tx, "task", taskId, userId);
      const deleted = await tx
        .delete(taskTags)
        .where(and(eq(taskTags.taskId, taskId), eq(taskTags.tagId, tagId)))
        .returning({ tagId: taskTags.tagId });
      if (deleted.length === 0) throw notFound("No such tag application.");
    });
    return c.body(null, 204);
  });

  return r;
}
