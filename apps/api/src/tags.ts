// Tagging writes (specs/03-tagging.md, docs/api-contract.md "Tagging writes").
// game_tags is GLOBAL, not project-scoped — auth family is authenticated, not
// member; there is no resolveProjectAccess here. Two distinct writes, kept
// separate on purpose (03-tagging.md §3.2 "the multi-writer discipline"):
//   POST /tags                        — add a NEW vocabulary term (writes `tags`)
//   POST /games/:universeId/tags      — APPLY an existing term (writes `game_tags`)
//   DELETE /games/:universeId/tags/:id — remove an application
// Free-text is impossible at either step: axis is restricted to the five-axis
// enum (422 on anything else — the canonical rejection), and applying a tag
// takes a tagId that must already exist in `tags`, never a label string.

import { gameTags, tags } from "@monkyesuite/database";
import {
  applyTagSchema,
  createTagSchema,
  type Tag,
  universeIdSchema,
  uuidSchema,
} from "@monkyesuite/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { ZodType } from "zod";
import { gameExists } from "./data.js";
import { db } from "./db.js";
import {
  conflict,
  isUniqueViolation,
  notFound,
  validationError,
} from "./errors.js";
import { type AppEnv, requireUser } from "./middleware.js";

// Parse a path param through a Zod schema, turning a malformed value into the
// 422 envelope rather than an uncaught ZodError (which would otherwise fall
// through to the generic 503 in errors.ts — not a route the caller can retry
// their way out of).
function parseParam<T>(schema: ZodType<T>, raw: string): T {
  const r = schema.safeParse(raw);
  if (!r.success) {
    throw validationError(r.error.issues[0]?.message ?? "Invalid input.");
  }
  return r.data;
}

const mapTag = (t: typeof tags.$inferSelect): Tag => ({
  id: t.id,
  axis: t.axis,
  slug: t.slug,
  label: t.label,
  description: t.description,
});

export function tagRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // Add a new vocabulary term — a deliberate, separate act from applying one
  // (03-tagging.md §3.2). Uniqueness on (axis, slug) blocks "pets"/"Pets" drift.
  r.post("/tags", async (c) => {
    const userId = requireUser(c);
    const body = createTagSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) {
      // A body whose axis isn't one of the five enum values lands here — the
      // canonical 422 free-text rejection (03-tagging.md, 07-api.md §7.4).
      throw validationError(body.error.issues[0]?.message ?? "Invalid tag.");
    }
    let row: typeof tags.$inferSelect | undefined;
    try {
      [row] = await db
        .insert(tags)
        .values({ ...body.data, createdBy: userId })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict("That (axis, slug) already exists.");
      }
      throw err;
    }
    if (!row) throw notFound("Tag creation failed.");
    return c.json(mapTag(row), 201);
  });

  // Apply an existing vocabulary term to a game. tagId must reference a real
  // `tags` row — there is no free-text path here at all.
  r.post("/games/:universeId/tags", async (c) => {
    const userId = requireUser(c);
    const universeId = parseParam(universeIdSchema, c.req.param("universeId"));
    if (!(await gameExists(universeId))) throw notFound("Unknown game.");
    const body = applyTagSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw validationError("Invalid tag application.");
    const { tagId } = body.data;

    const [tag] = await db
      .select()
      .from(tags)
      .where(eq(tags.id, tagId))
      .limit(1);
    if (!tag) throw notFound("Unknown tag.");

    try {
      await db.insert(gameTags).values({ universeId, tagId, addedBy: userId });
    } catch (err) {
      if (isUniqueViolation(err))
        throw conflict("Tag already applied to this game.");
      throw err;
    }
    return c.json(mapTag(tag), 201);
  });

  r.delete("/games/:universeId/tags/:tagId", async (c) => {
    requireUser(c);
    const universeId = parseParam(universeIdSchema, c.req.param("universeId"));
    const tagId = parseParam(uuidSchema, c.req.param("tagId"));
    const deleted = await db
      .delete(gameTags)
      .where(
        and(eq(gameTags.universeId, universeId), eq(gameTags.tagId, tagId)),
      )
      .returning({ tagId: gameTags.tagId });
    if (deleted.length === 0) throw notFound("No such tag application.");
    return c.body(null, 204);
  });

  return r;
}
