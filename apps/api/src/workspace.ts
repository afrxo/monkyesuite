// Scoped workspace routes (specs/05 §5.4–5.5, 07-api.md) — docs (long-form
// markdown), notes (short pins, optionally game-linked), and pinned tracker
// games. Same discipline as the board: membership resolved before any data
// touch, inside a withUser tx. Project-note item routes live under
// /project-notes/:id to stay clear of the GLOBAL game-note route /notes/:id.

import { generateKeyBetween } from "@monkyesuite/core";
import {
  blocks as blocksTable,
  docFolders,
  docs,
  games,
  notes,
  projectGame,
  users,
} from "@monkyesuite/database";
import {
  type Block,
  type BlockInput,
  createDocFolderSchema,
  createDocSchema,
  createNoteSchema,
  createProjectGameSchema,
  deleteBlocksSchema,
  type Doc,
  type DocBlocks,
  type DocFolder,
  patchDocFolderSchema,
  patchDocMetaSchema,
  patchDocSchema,
  patchNoteSchema,
  type ProjectGame,
  type ProjectNote,
  type TextBlockContent,
  universeIdSchema,
  upsertBlocksSchema,
  uuidSchema,
} from "@monkyesuite/shared";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { resolveItemAccess, resolveProjectAccess } from "./access.js";
import { markdownToBlocks } from "./blocks/markdownToBlocks.js";
import { reAnchorNotesForBlocks } from "./blocks/reAnchor.js";
import { conflict, notFound, validationError } from "./errors.js";
import { type AppEnv, requireUser } from "./middleware.js";
import { buildDocMediaKey, presignPutUrl, publicUrlFor } from "./r2.js";
import { isoReq } from "./serialize.js";
import { type Tx, withUser } from "./tx.js";

const IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

const mapBlock = (b: typeof blocksTable.$inferSelect): Block => ({
  id: b.id,
  docId: b.docId,
  parentId: b.parentId,
  position: b.position,
  type: b.type as Block["type"],
  content: (b.content as TextBlockContent | Record<string, unknown>) ?? {},
  props: (b.props as Record<string, unknown>) ?? {},
  version: b.version,
  createdAt: isoReq(b.createdAt),
  updatedAt: isoReq(b.updatedAt),
});

const mapDoc = (d: typeof docs.$inferSelect): Doc => ({
  id: d.id,
  projectId: d.projectId,
  folderId: d.folderId,
  orderKey: d.orderKey,
  title: d.title,
  body: d.body,
  migratedToBlocks: d.migratedToBlocks,
  icon: d.icon,
  coverUrl: d.coverUrl,
  deletedAt: d.deletedAt ? isoReq(d.deletedAt) : null,
  createdBy: d.createdBy,
  createdAt: isoReq(d.createdAt),
  updatedAt: isoReq(d.updatedAt),
});

const mapDocFolder = (f: typeof docFolders.$inferSelect): DocFolder => ({
  id: f.id,
  projectId: f.projectId,
  name: f.name,
  orderKey: f.orderKey,
  createdBy: f.createdBy,
  createdAt: isoReq(f.createdAt),
  updatedAt: isoReq(f.updatedAt),
});

// Append key: a fractional-index key after the current max in a lane. Used for
// new docs (default lane end) and new folders.
async function appendDocKey(
  tx: Tx,
  projectId: string,
  folderId: string | null,
): Promise<string> {
  const where =
    folderId === null
      ? and(eq(docs.projectId, projectId), isNull(docs.folderId))
      : and(eq(docs.projectId, projectId), eq(docs.folderId, folderId));
  const [row] = await tx
    .select({ maxKey: sql<string | null>`max(${docs.orderKey})` })
    .from(docs)
    .where(where);
  return generateKeyBetween(row?.maxKey ?? null, null);
}

async function appendFolderKey(
  tx: Tx,
  projectId: string,
): Promise<string> {
  const [row] = await tx
    .select({ maxKey: sql<string | null>`max(${docFolders.orderKey})` })
    .from(docFolders)
    .where(eq(docFolders.projectId, projectId));
  return generateKeyBetween(row?.maxKey ?? null, null);
}

// A doc's target orderKey computed from named neighbours in a (project,folder)
// lane. Neighbour in the wrong lane → 422 (client's view is stale).
async function docKeyBetween(
  tx: Tx,
  projectId: string,
  folderId: string | null,
  prevId: string | null | undefined,
  nextId: string | null | undefined,
  movingId?: string,
): Promise<string> {
  const laneKey = async (id: string): Promise<string> => {
    const [row] = await tx
      .select({ orderKey: docs.orderKey })
      .from(docs)
      .where(
        and(
          eq(docs.id, id),
          eq(docs.projectId, projectId),
          folderId === null
            ? isNull(docs.folderId)
            : eq(docs.folderId, folderId),
        ),
      )
      .limit(1);
    if (!row) throw validationError("Neighbour not in this folder.");
    return row.orderKey;
  };
  if (prevId && prevId === movingId) throw validationError("Bad neighbour.");
  if (nextId && nextId === movingId) throw validationError("Bad neighbour.");
  const prev = prevId ? await laneKey(prevId) : null;
  const next = nextId ? await laneKey(nextId) : null;
  try {
    return generateKeyBetween(prev, next);
  } catch {
    throw validationError("Inconsistent doc order.");
  }
}

async function folderKeyBetween(
  tx: Tx,
  projectId: string,
  prevId: string | null | undefined,
  nextId: string | null | undefined,
  movingId?: string,
): Promise<string> {
  const laneKey = async (id: string): Promise<string> => {
    const [row] = await tx
      .select({ orderKey: docFolders.orderKey })
      .from(docFolders)
      .where(
        and(eq(docFolders.id, id), eq(docFolders.projectId, projectId)),
      )
      .limit(1);
    if (!row) throw validationError("Neighbour not in this project.");
    return row.orderKey;
  };
  if (prevId && prevId === movingId) throw validationError("Bad neighbour.");
  if (nextId && nextId === movingId) throw validationError("Bad neighbour.");
  const prev = prevId ? await laneKey(prevId) : null;
  const next = nextId ? await laneKey(nextId) : null;
  try {
    return generateKeyBetween(prev, next);
  } catch {
    throw validationError("Inconsistent folder order.");
  }
}

type NoteRow = typeof notes.$inferSelect;
type NoteAuthor = { id: string; name: string | null; email: string };
function mapNote(
  n: NoteRow,
  game: { name: string; iconUrl: string | null } | null,
  author: NoteAuthor | null,
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
    docId: n.docId,
    blockId: n.blockId,
    anchorStart: n.anchorStart,
    anchorEnd: n.anchorEnd,
    anchorQuote: n.anchorQuote,
    resolved: n.resolved,
    orphaned: n.orphaned,
    createdBy: n.createdBy,
    author,
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
        .where(and(eq(docs.projectId, id), isNull(docs.deletedAt)))
        .orderBy(asc(docs.orderKey));
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
      const orderKey = await appendDocKey(tx, id, null);
      const [row] = await tx
        .insert(docs)
        .values({
          projectId: id,
          title: body.data.title,
          body: body.data.body ?? null,
          orderKey,
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
      const { projectId } = await resolveItemAccess(tx, "doc", id, userId);

      // Move (folderId given) or reorder inside current folder (prevId/nextId
      // given without folderId). The client can also pass folderId ALONE — then
      // the doc lands at the end of the target folder.
      let orderKey: string | undefined;
      let folderIdSet: string | null | undefined;
      const wantMove = d.folderId !== undefined;
      const wantReorder = d.prevId !== undefined || d.nextId !== undefined;
      if (wantMove || wantReorder) {
        // Verify target folder belongs to the same project.
        if (d.folderId) {
          const [f] = await tx
            .select({ pid: docFolders.projectId })
            .from(docFolders)
            .where(eq(docFolders.id, d.folderId))
            .limit(1);
          if (!f || f.pid !== projectId)
            throw validationError("Folder not in this project.");
        }
        const targetFolder = wantMove
          ? (d.folderId ?? null)
          : ((await tx
              .select({ folderId: docs.folderId })
              .from(docs)
              .where(eq(docs.id, id))
              .limit(1))[0]?.folderId ?? null);
        if (wantReorder) {
          orderKey = await docKeyBetween(
            tx,
            projectId,
            targetFolder,
            d.prevId,
            d.nextId,
            id,
          );
        } else {
          orderKey = await appendDocKey(tx, projectId, targetFolder);
        }
        if (wantMove) folderIdSet = d.folderId ?? null;
      }

      const [row] = await tx
        .update(docs)
        .set({
          ...(d.title !== undefined ? { title: d.title } : {}),
          ...(d.body !== undefined ? { body: d.body } : {}),
          ...(folderIdSet !== undefined ? { folderId: folderIdSet } : {}),
          ...(orderKey !== undefined ? { orderKey } : {}),
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
      // Soft delete — the undo window is client-side. A separate purge job
      // (out of scope for this cut) reclaims rows past their retention.
      await tx
        .update(docs)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(docs.id, id));
    });
    return c.body(null, 204);
  });

  r.post("/docs/:id/restore", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const doc = await withUser(userId, async (tx): Promise<Doc> => {
      await resolveItemAccess(tx, "doc", id, userId);
      const [row] = await tx
        .update(docs)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(eq(docs.id, id))
        .returning();
      if (!row) throw notFound("No such doc.");
      return mapDoc(row);
    });
    return c.json(doc);
  });

  /* --------------------------- doc media uploads ------------------------- */
  // Presigned PUT for a doc cover or an inline image. Client uploads directly
  // to R2 and then persists the returned publicUrl on the doc (cover) or in
  // the image block's `url` prop. R2_PUBLIC_URL_BASE MUST be configured — the
  // block editor stores permanent URLs, not per-view presigned GETs.
  r.post("/docs/:id/uploads", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const raw = (await c.req.json().catch(() => ({}))) as {
      fileName?: unknown;
      mimeType?: unknown;
    };
    const fileName =
      typeof raw.fileName === "string" ? raw.fileName : "file";
    const mimeType =
      typeof raw.mimeType === "string" ? raw.mimeType : "";
    if (!IMAGE_MIME.has(mimeType))
      throw validationError("Unsupported image type.");
    await withUser(userId, async (tx) => {
      await resolveItemAccess(tx, "doc", id, userId);
    });
    const key = buildDocMediaKey(id, fileName);
    const url = publicUrlFor(key);
    if (!url)
      throw validationError(
        "Doc media upload requires R2_PUBLIC_URL_BASE to be configured on the API.",
      );
    const put = await presignPutUrl(key, mimeType);
    return c.json({ uploadUrl: put.url, publicUrl: url });
  });

  /* -------------------------- doc meta (icon, cover) --------------------- */

  r.patch("/docs/:id/meta", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = patchDocMetaSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid metadata.");
    const d = body.data;
    const doc = await withUser(userId, async (tx): Promise<Doc> => {
      await resolveItemAccess(tx, "doc", id, userId);
      const [row] = await tx
        .update(docs)
        .set({
          ...(d.icon !== undefined ? { icon: d.icon } : {}),
          ...(d.coverUrl !== undefined ? { coverUrl: d.coverUrl } : {}),
          updatedAt: new Date(),
        })
        .where(eq(docs.id, id))
        .returning();
      if (!row) throw notFound("No such doc.");
      return mapDoc(row);
    });
    return c.json(doc);
  });

  /* --------------------------------- blocks ------------------------------ */
  //
  // Migration-on-read: the first GET after this rollout for a legacy markdown
  // doc parses its `body` into blocks, persists them, and flips
  // `migrated_to_blocks`. The lock is a SELECT ... FOR UPDATE on the docs row
  // so two concurrent opens don't both migrate and double-insert.

  r.get("/docs/:id/blocks", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const payload = await withUser(userId, async (tx): Promise<DocBlocks> => {
      await resolveItemAccess(tx, "doc", id, userId);
      const [row] = await tx
        .select()
        .from(docs)
        .where(eq(docs.id, id))
        .for("update")
        .limit(1);
      if (!row) throw notFound("No such doc.");
      let doc = row;
      let rows = await tx
        .select()
        .from(blocksTable)
        .where(eq(blocksTable.docId, id))
        .orderBy(asc(blocksTable.position));
      if (!doc.migratedToBlocks) {
        // Fresh migration. If the doc already has blocks (partial state from a
        // prior failed run), skip the parse — keep whatever survived.
        if (rows.length === 0) {
          const parsed = markdownToBlocks(doc.body ?? "");
          // Two-pass insert so `parent_id` can reference an id from pass one.
          const ids = parsed.map(() => crypto.randomUUID());
          const insertRows = parsed.map((b, i) => {
            const uid = ids[i];
            if (!uid) throw new Error("uuid missing");
            return {
              id: uid,
              docId: id,
              parentId:
                b.parentIdx !== null ? (ids[b.parentIdx] ?? null) : null,
              position: b.position,
              type: b.type,
              content: b.content,
              props: b.props,
            };
          });
          if (insertRows.length) {
            await tx.insert(blocksTable).values(insertRows);
          }
          rows = await tx
            .select()
            .from(blocksTable)
            .where(eq(blocksTable.docId, id))
            .orderBy(asc(blocksTable.position));
        }
        const [updated] = await tx
          .update(docs)
          .set({ migratedToBlocks: true, updatedAt: new Date() })
          .where(eq(docs.id, id))
          .returning();
        if (updated) doc = updated;
      }
      return { doc: mapDoc(doc), blocks: rows.map(mapBlock) };
    });
    return c.json(payload);
  });

  // Bulk upsert. Every block in the payload MUST carry the version the client
  // last saw. If any stored block's version has moved on, reject the whole
  // batch with 409 + stale ids so the client can merge or overwrite.
  r.post("/docs/:id/blocks", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = upsertBlocksSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid blocks payload.");
    const incoming: BlockInput[] = body.data.blocks;
    if (!incoming.length) return c.json({ blocks: [] });

    const result = await withUser(userId, async (tx) => {
      await resolveItemAccess(tx, "doc", id, userId);
      const ids = incoming.map((b) => b.id);
      const existing = await tx
        .select({ id: blocksTable.id, version: blocksTable.version })
        .from(blocksTable)
        .where(
          and(eq(blocksTable.docId, id), inArray(blocksTable.id, ids)),
        );
      const stored = new Map(existing.map((r) => [r.id, r.version]));

      const stale: string[] = [];
      for (const b of incoming) {
        const cur = stored.get(b.id);
        // A new block (id not in DB) is fine as long as the client sent
        // version 0 or 1 — either way it doesn't clobber an existing row.
        if (cur !== undefined && cur !== b.version) stale.push(b.id);
      }
      if (stale.length) return { stale };

      // Reject any block whose parent_id doesn't resolve to a block in THIS
      // doc — either already present or being inserted in this batch.
      const idSet = new Set([...stored.keys(), ...ids]);
      for (const b of incoming) {
        if (b.parentId && !idSet.has(b.parentId)) {
          throw validationError(`unknown parent: ${b.parentId}`);
        }
      }

      // Upsert. On conflict bump version + timestamp; keep created_at.
      const values = incoming.map((b) => ({
        id: b.id,
        docId: id,
        parentId: b.parentId,
        position: b.position,
        type: b.type,
        content: b.content,
        props: b.props,
        version: (stored.get(b.id) ?? 0) + 1,
        updatedAt: new Date(),
      }));
      const rows = await tx
        .insert(blocksTable)
        .values(values)
        .onConflictDoUpdate({
          target: blocksTable.id,
          set: {
            parentId: sql`excluded.parent_id`,
            position: sql`excluded.position`,
            type: sql`excluded.type`,
            content: sql`excluded.content`,
            props: sql`excluded.props`,
            version: sql`${blocksTable.version} + 1`,
            updatedAt: sql`excluded.updated_at`,
          },
        })
        .returning();
      // Touch the doc so listing sort by updatedAt reflects the edit.
      await tx
        .update(docs)
        .set({ updatedAt: new Date() })
        .where(eq(docs.id, id));
      // Snap any anchored notes to the fresh block text (or mark orphaned).
      await reAnchorNotesForBlocks(
        tx,
        id,
        incoming.map((b) => b.id),
      );
      return { blocks: rows.map(mapBlock) };
    });

    if ("stale" in result) {
      // Send back the freshest server view of the whole doc's blocks so the
      // client can rebase without a second round-trip.
      const fresh = await withUser(userId, async (tx) => {
        await resolveItemAccess(tx, "doc", id, userId);
        return tx
          .select()
          .from(blocksTable)
          .where(eq(blocksTable.docId, id))
          .orderBy(asc(blocksTable.position));
      });
      c.header("Content-Type", "application/json");
      return c.json(
        {
          error: {
            code: "conflict",
            message: "Some blocks changed in another session.",
          },
          staleIds: result.stale,
          currentBlocks: fresh.map(mapBlock),
        },
        409,
      );
    }
    return c.json(result);
  });

  r.delete("/docs/:id/blocks", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = deleteBlocksSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid delete payload.");
    await withUser(userId, async (tx) => {
      await resolveItemAccess(tx, "doc", id, userId);
      await tx
        .delete(blocksTable)
        .where(
          and(
            eq(blocksTable.docId, id),
            inArray(blocksTable.id, body.data.ids),
          ),
        );
      await tx
        .update(docs)
        .set({ updatedAt: new Date() })
        .where(eq(docs.id, id));
    });
    return c.body(null, 204);
  });

  // Silence the "conflict helper unused" lint if the 409 path above ever gets
  // refactored to use it — cheap keep-alive for the import.
  void conflict;

  /* ---------------------------- doc folders ----------------------------- */

  r.get("/projects/:id/doc-folders", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const rows = await withUser(userId, async (tx) => {
      await resolveProjectAccess(tx, id, userId);
      return tx
        .select()
        .from(docFolders)
        .where(eq(docFolders.projectId, id))
        .orderBy(asc(docFolders.orderKey));
    });
    return c.json(rows.map(mapDocFolder));
  });

  r.post("/projects/:id/doc-folders", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = createDocFolderSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid folder.");
    const folder = await withUser(userId, async (tx): Promise<DocFolder> => {
      await resolveProjectAccess(tx, id, userId);
      const orderKey = await appendFolderKey(tx, id);
      const [row] = await tx
        .insert(docFolders)
        .values({
          projectId: id,
          name: body.data.name,
          orderKey,
          createdBy: userId,
        })
        .returning();
      if (!row) throw notFound("Folder creation failed.");
      return mapDocFolder(row);
    });
    return c.json(folder, 201);
  });

  r.patch("/doc-folders/:id", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = patchDocFolderSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid update.");
    const d = body.data;
    const folder = await withUser(userId, async (tx): Promise<DocFolder> => {
      const { projectId } = await resolveItemAccess(
        tx,
        "docFolder",
        id,
        userId,
      );
      let orderKey: string | undefined;
      if (d.prevId !== undefined || d.nextId !== undefined) {
        orderKey = await folderKeyBetween(
          tx,
          projectId,
          d.prevId,
          d.nextId,
          id,
        );
      }
      const [row] = await tx
        .update(docFolders)
        .set({
          ...(d.name !== undefined ? { name: d.name } : {}),
          ...(orderKey !== undefined ? { orderKey } : {}),
          updatedAt: new Date(),
        })
        .where(eq(docFolders.id, id))
        .returning();
      if (!row) throw notFound("No such folder.");
      return mapDocFolder(row);
    });
    return c.json(folder);
  });

  r.delete("/doc-folders/:id", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    await withUser(userId, async (tx) => {
      await resolveItemAccess(tx, "docFolder", id, userId);
      await tx.delete(docFolders).where(eq(docFolders.id, id));
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
        .select({
          note: notes,
          gameName: games.name,
          gameIcon: games.iconUrl,
          authorId: users.id,
          authorName: users.name,
          authorEmail: users.email,
        })
        .from(notes)
        .leftJoin(games, eq(games.universeId, notes.universeId))
        .leftJoin(users, eq(users.id, notes.createdBy))
        .where(eq(notes.projectId, id))
        .orderBy(desc(notes.createdAt));
    });
    return c.json(
      rows.map((row) =>
        mapNote(
          row.note,
          row.gameName ? { name: row.gameName, iconUrl: row.gameIcon } : null,
          row.authorId && row.authorEmail
            ? { id: row.authorId, name: row.authorName, email: row.authorEmail }
            : null,
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
      const d = body.data;
      // Anchor sanity: if any anchor field is present, docId is required. If
      // anchorStart is present, anchorEnd must be too and >= start. If blockId
      // is present, docId is required and the block must belong to that doc.
      const hasAnchorField =
        d.blockId !== undefined ||
        d.anchorStart !== undefined ||
        d.anchorEnd !== undefined ||
        d.anchorQuote !== undefined;
      if (hasAnchorField && !d.docId)
        throw validationError("Anchor requires docId.");
      if (
        (d.anchorStart !== undefined || d.anchorEnd !== undefined) &&
        (d.anchorStart === undefined ||
          d.anchorEnd === undefined ||
          d.anchorEnd < d.anchorStart)
      )
        throw validationError("Invalid anchor range.");
      if (d.docId) {
        // Verify the doc is in this project (RLS also enforces).
        const [doc] = await tx
          .select({ projectId: docs.projectId })
          .from(docs)
          .where(eq(docs.id, d.docId))
          .limit(1);
        if (!doc || doc.projectId !== id)
          throw validationError("docId not in this project.");
        if (d.blockId) {
          const [b] = await tx
            .select({ docId: blocksTable.docId })
            .from(blocksTable)
            .where(eq(blocksTable.id, d.blockId))
            .limit(1);
          if (!b || b.docId !== d.docId)
            throw validationError("blockId not in the given doc.");
        }
      }
      const [row] = await tx
        .insert(notes)
        .values({
          projectId: id,
          title: d.title ?? null,
          body: d.body ?? null,
          universeId: d.universeId ?? null,
          docId: d.docId ?? null,
          blockId: d.blockId ?? null,
          anchorStart: d.anchorStart ?? null,
          anchorEnd: d.anchorEnd ?? null,
          anchorQuote: d.anchorQuote ?? null,
          createdBy: userId,
        })
        .returning();
      if (!row) throw notFound("Note creation failed.");
      const game = row.universeId ? await gameRef(tx, row.universeId) : null;
      const author = await userRef(tx, row.createdBy);
      return mapNote(row, game, author);
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
          ...(d.resolved !== undefined ? { resolved: d.resolved } : {}),
          updatedAt: new Date(),
        })
        .where(eq(notes.id, id))
        .returning();
      if (!row) throw notFound("No such note.");
      const game = row.universeId ? await gameRef(tx, row.universeId) : null;
      const author = await userRef(tx, row.createdBy);
      return mapNote(row, game, author);
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

async function userRef(
  tx: Parameters<Parameters<typeof withUser<unknown>>[1]>[0],
  userId: string,
): Promise<{ id: string; name: string | null; email: string } | null> {
  const [row] = await tx
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}
