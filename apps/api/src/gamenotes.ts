// Game-note WRITE routes (specs/06 §6.5, 07-api.md §7.3). game_notes is GLOBAL
// but user-authored, so access is by author + visibility (RLS), NOT project
// membership — there is no resolveProjectAccess here. Every write runs inside a
// withUser tx so the game_notes RLS policy sees app.current_user_id; the policy
// itself is the backstop that makes a note author-only.
//
// Reads live on the global surface (app.ts GET /games/:id/notes); these are the
// authoring mutations, which require a session.

import { gameNotes, users } from "@monkyesuite/database";
import {
  createGameNoteSchema,
  type GameNote,
  patchGameNoteSchema,
  universeIdSchema,
  uuidSchema,
} from "@monkyesuite/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { gameExists } from "./data.js";
import { forbidden, notFound, validationError } from "./errors.js";
import { type AppEnv, requireUser } from "./middleware.js";
import { isoReq } from "./serialize.js";
import { type Tx, withUser } from "./tx.js";

// Re-read a note joined to its author for the DTO. Runs inside the caller's tx,
// so RLS still applies (the author can always read their own row).
async function noteById(
  tx: Tx,
  id: string,
  userId: string,
): Promise<GameNote | null> {
  const [row] = await tx
    .select({
      id: gameNotes.id,
      universeId: gameNotes.universeId,
      authorId: gameNotes.authorId,
      authorName: users.name,
      body: gameNotes.body,
      visibility: gameNotes.visibility,
      createdAt: gameNotes.createdAt,
      updatedAt: gameNotes.updatedAt,
    })
    .from(gameNotes)
    .leftJoin(users, eq(users.id, gameNotes.authorId))
    .where(eq(gameNotes.id, id))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    universeId: row.universeId,
    authorId: row.authorId,
    authorName: row.authorName,
    body: row.body,
    visibility: row.visibility,
    isOwn: row.authorId === userId,
    createdAt: isoReq(row.createdAt),
    updatedAt: isoReq(row.updatedAt),
  };
}

export function gameNoteRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // Create own note on a game. visibility defaults to shared (schema + zod).
  r.post("/games/:universeId/notes", async (c) => {
    const userId = requireUser(c);
    const universeId = universeIdSchema.parse(c.req.param("universeId"));
    if (!(await gameExists(universeId))) throw notFound("Unknown game.");
    const body = createGameNoteSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid note.");
    const note = await withUser(userId, async (tx): Promise<GameNote> => {
      const [row] = await tx
        .insert(gameNotes)
        .values({
          universeId,
          authorId: userId,
          body: body.data.body,
          visibility: body.data.visibility,
        })
        .returning({ id: gameNotes.id });
      if (!row) throw notFound("Note creation failed.");
      const dto = await noteById(tx, row.id, userId);
      if (!dto) throw notFound("Note creation failed.");
      return dto;
    });
    return c.json(note, 201);
  });

  // Edit own note. RLS write policy already restricts to the author; we resolve
  // 404 (invisible/absent) vs 403 (visible but not yours) explicitly for the UI.
  r.patch("/notes/:id", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = patchGameNoteSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid update.");
    const d = body.data;
    const note = await withUser(userId, async (tx): Promise<GameNote> => {
      const existing = await noteById(tx, id, userId);
      if (!existing) throw notFound("No such note."); // RLS hid it, or absent
      if (!existing.isOwn) throw forbidden("Not your note.");
      await tx
        .update(gameNotes)
        .set({
          ...(d.body !== undefined ? { body: d.body } : {}),
          ...(d.visibility !== undefined ? { visibility: d.visibility } : {}),
          updatedAt: new Date(),
        })
        .where(eq(gameNotes.id, id));
      const dto = await noteById(tx, id, userId);
      if (!dto) throw notFound("No such note.");
      return dto;
    });
    return c.json(note);
  });

  r.delete("/notes/:id", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    await withUser(userId, async (tx) => {
      const existing = await noteById(tx, id, userId);
      if (!existing) throw notFound("No such note.");
      if (!existing.isOwn) throw forbidden("Not your note.");
      await tx.delete(gameNotes).where(eq(gameNotes.id, id));
    });
    return c.body(null, 204);
  });

  return r;
}
