// Scoped workspace routes (specs/05 §5.4–5.5, 07-api.md) — docs (long-form
// markdown), notes (short pins, optionally game-linked), and pinned tracker
// games. Same discipline as the board: membership resolved before any data
// touch, inside a withUser tx. Project-note item routes live under
// /project-notes/:id to stay clear of the GLOBAL game-note route /notes/:id.

import { docs, games, notes, projectGame } from "@monkyesuite/database";
import {
  createDocSchema,
  createNoteSchema,
  createProjectGameSchema,
  type Doc,
  type ProjectGame,
  type ProjectNote,
  patchDocSchema,
  patchNoteSchema,
  universeIdSchema,
  uuidSchema,
} from "@monkyesuite/shared";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { resolveItemAccess, resolveProjectAccess } from "./access.js";
import { notFound, validationError } from "./errors.js";
import { type AppEnv, requireUser } from "./middleware.js";
import { isoReq } from "./serialize.js";
import { withUser } from "./tx.js";

const mapDoc = (d: typeof docs.$inferSelect): Doc => ({
  id: d.id,
  projectId: d.projectId,
  title: d.title,
  body: d.body,
  createdBy: d.createdBy,
  createdAt: isoReq(d.createdAt),
  updatedAt: isoReq(d.updatedAt),
});

type NoteRow = typeof notes.$inferSelect;
function mapNote(
  n: NoteRow,
  game: { name: string; iconUrl: string | null } | null,
): ProjectNote {
  return {
    id: n.id,
    projectId: n.projectId,
    title: n.title,
    body: n.body,
    universeId: n.universeId,
    game:
      n.universeId && game
        ? { universeId: n.universeId, name: game.name, iconUrl: game.iconUrl }
        : null,
    createdBy: n.createdBy,
    createdAt: isoReq(n.createdAt),
    updatedAt: isoReq(n.updatedAt),
  };
}

export function workspaceRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  /* -------------------------------- docs -------------------------------- */

  r.get("/projects/:id/docs", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const rows = await withUser(userId, async (tx) => {
      await resolveProjectAccess(tx, id, userId);
      return tx
        .select()
        .from(docs)
        .where(eq(docs.projectId, id))
        .orderBy(desc(docs.updatedAt));
    });
    return c.json(rows.map(mapDoc));
  });

  r.post("/projects/:id/docs", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = createDocSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid doc.");
    const doc = await withUser(userId, async (tx): Promise<Doc> => {
      await resolveProjectAccess(tx, id, userId);
      const [row] = await tx
        .insert(docs)
        .values({
          projectId: id,
          title: body.data.title,
          body: body.data.body ?? null,
          createdBy: userId,
        })
        .returning();
      if (!row) throw notFound("Doc creation failed.");
      return mapDoc(row);
    });
    return c.json(doc, 201);
  });

  r.get("/docs/:id", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const doc = await withUser(userId, async (tx): Promise<Doc> => {
      await resolveItemAccess(tx, "doc", id, userId);
      const [row] = await tx
        .select()
        .from(docs)
        .where(eq(docs.id, id))
        .limit(1);
      if (!row) throw notFound("No such doc.");
      return mapDoc(row);
    });
    return c.json(doc);
  });

  r.patch("/docs/:id", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = patchDocSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw validationError("Invalid update.");
    const d = body.data;
    const doc = await withUser(userId, async (tx): Promise<Doc> => {
      await resolveItemAccess(tx, "doc", id, userId);
      const [row] = await tx
        .update(docs)
        .set({
          ...(d.title !== undefined ? { title: d.title } : {}),
          ...(d.body !== undefined ? { body: d.body } : {}),
          updatedAt: new Date(),
        })
        .where(eq(docs.id, id))
        .returning();
      if (!row) throw notFound("No such doc.");
      return mapDoc(row);
    });
    return c.json(doc);
  });

  r.delete("/docs/:id", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    await withUser(userId, async (tx) => {
      await resolveItemAccess(tx, "doc", id, userId);
      await tx.delete(docs).where(eq(docs.id, id));
    });
    return c.body(null, 204);
  });

  /* ------------------------------ notes --------------------------------- */

  r.get("/projects/:id/notes", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const rows = await withUser(userId, async (tx) => {
      await resolveProjectAccess(tx, id, userId);
      return tx
        .select({ note: notes, gameName: games.name, gameIcon: games.iconUrl })
        .from(notes)
        .leftJoin(games, eq(games.universeId, notes.universeId))
        .where(eq(notes.projectId, id))
        .orderBy(desc(notes.createdAt));
    });
    return c.json(
      rows.map((row) =>
        mapNote(
          row.note,
          row.gameName ? { name: row.gameName, iconUrl: row.gameIcon } : null,
        ),
      ),
    );
  });

  r.post("/projects/:id/notes", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = createNoteSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid note.");
    const note = await withUser(userId, async (tx): Promise<ProjectNote> => {
      await resolveProjectAccess(tx, id, userId);
      const [row] = await tx
        .insert(notes)
        .values({
          projectId: id,
          title: body.data.title ?? null,
          body: body.data.body ?? null,
          universeId: body.data.universeId ?? null,
          createdBy: userId,
        })
        .returning();
      if (!row) throw notFound("Note creation failed.");
      const game = row.universeId ? await gameRef(tx, row.universeId) : null;
      return mapNote(row, game);
    });
    return c.json(note, 201);
  });

  r.patch("/project-notes/:id", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = patchNoteSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid update.");
    const d = body.data;
    const note = await withUser(userId, async (tx): Promise<ProjectNote> => {
      await resolveItemAccess(tx, "note", id, userId);
      const [row] = await tx
        .update(notes)
        .set({
          ...(d.title !== undefined ? { title: d.title } : {}),
          ...(d.body !== undefined ? { body: d.body } : {}),
          ...(d.universeId !== undefined ? { universeId: d.universeId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(notes.id, id))
        .returning();
      if (!row) throw notFound("No such note.");
      const game = row.universeId ? await gameRef(tx, row.universeId) : null;
      return mapNote(row, game);
    });
    return c.json(note);
  });

  r.delete("/project-notes/:id", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    await withUser(userId, async (tx) => {
      await resolveItemAccess(tx, "note", id, userId);
      await tx.delete(notes).where(eq(notes.id, id));
    });
    return c.body(null, 204);
  });

  /* ------------------------- pinned tracker games ----------------------- */

  r.get("/projects/:id/games", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const rows = await withUser(userId, async (tx) => {
      await resolveProjectAccess(tx, id, userId);
      return tx
        .select({
          projectId: projectGame.projectId,
          universeId: projectGame.universeId,
          note: projectGame.note,
          addedBy: projectGame.addedBy,
          addedAt: projectGame.addedAt,
          name: games.name,
          iconUrl: games.iconUrl,
        })
        .from(projectGame)
        .innerJoin(games, eq(games.universeId, projectGame.universeId))
        .where(eq(projectGame.projectId, id))
        .orderBy(desc(projectGame.addedAt));
    });
    const mapped: ProjectGame[] = rows.map((g) => ({
      projectId: g.projectId,
      universeId: g.universeId,
      name: g.name,
      iconUrl: g.iconUrl,
      note: g.note,
      addedBy: g.addedBy,
      addedAt: isoReq(g.addedAt),
    }));
    return c.json(mapped);
  });

  r.post("/projects/:id/games", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = createProjectGameSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid link.");
    const link = await withUser(userId, async (tx): Promise<ProjectGame> => {
      await resolveProjectAccess(tx, id, userId);
      // The linked game must be tracked (global realm); otherwise the FK would
      // fail with an opaque error. Check first for a clean 404.
      const ref = await gameRef(tx, body.data.universeId);
      if (!ref) throw notFound("Unknown game.");
      const [row] = await tx
        .insert(projectGame)
        .values({
          projectId: id,
          universeId: body.data.universeId,
          note: body.data.note ?? null,
          addedBy: userId,
        })
        .onConflictDoUpdate({
          target: [projectGame.projectId, projectGame.universeId],
          set: { note: body.data.note ?? null },
        })
        .returning();
      if (!row) throw notFound("Link failed.");
      return {
        projectId: row.projectId,
        universeId: row.universeId,
        name: ref.name,
        iconUrl: ref.iconUrl,
        note: row.note,
        addedBy: row.addedBy,
        addedAt: isoReq(row.addedAt),
      };
    });
    return c.json(link, 201);
  });

  r.delete("/projects/:id/games/:universeId", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const universeId = universeIdSchema.parse(c.req.param("universeId"));
    await withUser(userId, async (tx) => {
      await resolveProjectAccess(tx, id, userId);
      await tx
        .delete(projectGame)
        .where(
          and(
            eq(projectGame.projectId, id),
            eq(projectGame.universeId, universeId),
          ),
        );
    });
    return c.body(null, 204);
  });

  return r;
}

/* ------------------------------- helpers ---------------------------------- */

async function gameRef(
  tx: Parameters<Parameters<typeof withUser<unknown>>[1]>[0],
  universeId: number,
): Promise<{ name: string; iconUrl: string | null } | null> {
  const [row] = await tx
    .select({ name: games.name, iconUrl: games.iconUrl })
    .from(games)
    .where(eq(games.universeId, universeId))
    .limit(1);
  return row ?? null;
}
