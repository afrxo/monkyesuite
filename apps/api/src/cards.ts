// Card-detail routes (specs/05 card modal) — comments, checklist items,
// attachments, activity feed, linked notes. Same discipline as board.ts: every
// handler resolves membership via resolveItemAccess("task", …) before touching
// data, inside a withUser tx. RLS is the backstop.

import { generateKeyBetween } from "@monkyesuite/core";
import {
  notes,
  projects,
  tasks,
  taskActivity,
  taskAttachments,
  taskChecklistItems,
  taskComments,
  users,
} from "@monkyesuite/database";
import {
  attachmentConfirmSchema,
  attachmentUploadRequestSchema,
  createChecklistItemSchema,
  createCommentSchema,
  patchChecklistItemSchema,
  patchCommentSchema,
  type AttachmentUploadTicket,
  type AttachmentViewTicket,
  type LinkedNote,
  type TaskActivityEvent,
  type TaskActivityKind,
  type TaskAttachment,
  type TaskChecklistItem,
  type TaskComment,
  type TaskDetail,
  uuidSchema,
} from "@monkyesuite/shared";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { resolveItemAccess } from "./access.js";
import { assigneesByTask, tagsByTask } from "./board.js";
import { forbidden, notFound, validationError } from "./errors.js";
import { toDisplayUsername } from "./identity.js";
import { type AppEnv, requireUser } from "./middleware.js";
import {
  buildAttachmentKey,
  deleteObject,
  presignGetUrl,
  presignPutUrl,
  thumbnailUrlFor,
} from "./r2.js";
import { iso, isoReq } from "./serialize.js";
import { type Tx, withUser } from "./tx.js";

/* ------------------------------- mappers ---------------------------------- */

type CommentRow = typeof taskComments.$inferSelect;
type CommentJoin = {
  comment: CommentRow;
  authorName: string | null;
  authorEmail: string | null;
};

function mapComment(row: CommentJoin): TaskComment {
  const c = row.comment;
  return {
    id: c.id,
    taskId: c.taskId,
    authorId: c.authorId,
    author: row.authorEmail
      ? {
          id: c.authorId,
          name: row.authorName,
          email: toDisplayUsername(row.authorEmail),
        }
      : null,
    body: c.body,
    createdAt: isoReq(c.createdAt),
    updatedAt: isoReq(c.updatedAt),
  };
}

const mapChecklist = (
  r: typeof taskChecklistItems.$inferSelect,
): TaskChecklistItem => ({
  id: r.id,
  taskId: r.taskId,
  text: r.text,
  done: r.done,
  orderKey: r.orderKey,
  createdAt: isoReq(r.createdAt),
});

const mapAttachment = (
  r: typeof taskAttachments.$inferSelect,
): TaskAttachment => ({
  id: r.id,
  taskId: r.taskId,
  uploadedBy: r.uploadedBy,
  fileName: r.fileName,
  mimeType: r.mimeType,
  sizeBytes: r.sizeBytes,
  thumbnailUrl: thumbnailUrlFor(r.mimeType, r.r2Key),
  createdAt: isoReq(r.createdAt),
});

type ActivityRow = typeof taskActivity.$inferSelect;
type ActivityJoin = {
  activity: ActivityRow;
  actorName: string | null;
  actorEmail: string | null;
};

function mapActivity(row: ActivityJoin): TaskActivityEvent {
  const a = row.activity;
  return {
    id: a.id,
    taskId: a.taskId,
    actorId: a.actorId,
    actor: row.actorEmail
      ? {
          id: a.actorId,
          name: row.actorName,
          email: toDisplayUsername(row.actorEmail),
        }
      : null,
    kind: a.kind,
    payload:
      (a.payload as Record<string, unknown> | null | undefined) ?? {},
    createdAt: isoReq(a.createdAt),
  };
}

/* --------------------------- activity logging ----------------------------- */

export async function logActivity(
  tx: Tx,
  input: {
    taskId: string;
    projectId: string;
    actorId: string;
    kind: TaskActivityKind;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(taskActivity).values({
    taskId: input.taskId,
    projectId: input.projectId,
    actorId: input.actorId,
    kind: input.kind,
    payload: input.payload ?? {},
  });
}

/* ------------------------------ helpers ----------------------------------- */

async function loadTaskProject(
  tx: Tx,
  taskId: string,
): Promise<{ projectId: string; slug: string } | null> {
  const [row] = await tx
    .select({ projectId: tasks.projectId, slug: projects.slug })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.id, taskId))
    .limit(1);
  return row ?? null;
}

// Mirror of apps/web/src/workspace/short-id.ts — kept here so the API can
// compute the same string the client renders on the card. Any drift here is a
// bug in linked-notes results.
function shortTaskId(projectSlug: string, taskId: string): string {
  const prefix = projectSlug
    .replace(/[^a-z]/gi, "")
    .slice(0, 2)
    .toUpperCase();
  const hex = taskId.replace(/-/g, "").slice(0, 3).toUpperCase();
  return `${prefix || "PR"}-${hex}`;
}

async function orderKeyAtEnd(tx: Tx, taskId: string): Promise<string> {
  const [row] = await tx
    .select({
      maxKey: sql<string | null>`max(${taskChecklistItems.orderKey})`,
    })
    .from(taskChecklistItems)
    .where(eq(taskChecklistItems.taskId, taskId));
  return generateKeyBetween(row?.maxKey ?? null, null);
}

async function keyBetween(
  tx: Tx,
  taskId: string,
  prevId: string | null | undefined,
  nextId: string | null | undefined,
): Promise<string> {
  const lookup = async (id: string): Promise<string> => {
    const [row] = await tx
      .select({ orderKey: taskChecklistItems.orderKey })
      .from(taskChecklistItems)
      .where(
        and(
          eq(taskChecklistItems.id, id),
          eq(taskChecklistItems.taskId, taskId),
        ),
      )
      .limit(1);
    if (!row) throw validationError("Neighbour not in this list.");
    return row.orderKey;
  };
  const prev = prevId ? await lookup(prevId) : null;
  const next = nextId ? await lookup(nextId) : null;
  try {
    return generateKeyBetween(prev, next);
  } catch {
    throw validationError("Inconsistent order.");
  }
}

async function commentTaskId(tx: Tx, id: string): Promise<string | null> {
  const [row] = await tx
    .select({ taskId: taskComments.taskId })
    .from(taskComments)
    .where(eq(taskComments.id, id))
    .limit(1);
  return row?.taskId ?? null;
}

async function checklistTaskId(tx: Tx, id: string): Promise<string | null> {
  const [row] = await tx
    .select({ taskId: taskChecklistItems.taskId })
    .from(taskChecklistItems)
    .where(eq(taskChecklistItems.id, id))
    .limit(1);
  return row?.taskId ?? null;
}

async function attachmentRow(
  tx: Tx,
  id: string,
): Promise<typeof taskAttachments.$inferSelect | null> {
  const [row] = await tx
    .select()
    .from(taskAttachments)
    .where(eq(taskAttachments.id, id))
    .limit(1);
  return row ?? null;
}

/* ------------------------------- routes ----------------------------------- */

export function cardRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // Bundled detail — one round-trip when the modal opens.
  r.get("/tasks/:id/detail", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const detail = await withUser(userId, async (tx): Promise<TaskDetail> => {
      const { projectId } = await resolveItemAccess(tx, "task", id, userId);

      const [taskRow] = await tx
        .select()
        .from(tasks)
        .where(eq(tasks.id, id))
        .limit(1);
      if (!taskRow) throw notFound("No such task.");

      const proj = await loadTaskProject(tx, id);
      if (!proj) throw notFound("No such task.");

      const [
        commentRows,
        checklistRows,
        attachmentRows,
        activityRows,
        linkedNoteRows,
      ] = await Promise.all([
        tx
          .select({
            comment: taskComments,
            authorName: users.name,
            authorEmail: users.email,
          })
          .from(taskComments)
          .leftJoin(users, eq(users.id, taskComments.authorId))
          .where(eq(taskComments.taskId, id))
          .orderBy(desc(taskComments.createdAt)),
        tx
          .select()
          .from(taskChecklistItems)
          .where(eq(taskChecklistItems.taskId, id))
          .orderBy(asc(taskChecklistItems.orderKey)),
        tx
          .select()
          .from(taskAttachments)
          .where(eq(taskAttachments.taskId, id))
          .orderBy(desc(taskAttachments.createdAt)),
        tx
          .select({
            activity: taskActivity,
            actorName: users.name,
            actorEmail: users.email,
          })
          .from(taskActivity)
          .leftJoin(users, eq(users.id, taskActivity.actorId))
          .where(eq(taskActivity.taskId, id))
          .orderBy(desc(taskActivity.createdAt))
          .limit(50),
        // Notes in the same project whose body mentions this card's short id.
        tx
          .select({
            id: notes.id,
            title: notes.title,
            body: notes.body,
            createdAt: notes.createdAt,
            updatedAt: notes.updatedAt,
          })
          .from(notes)
          .where(
            and(
              eq(notes.projectId, projectId),
              sql`${notes.body} ~* ${`\\y${escapeRegex(shortTaskId(proj.slug, id))}\\y`}`,
            ),
          )
          .orderBy(desc(notes.updatedAt)),
      ]);

      const linkedNotes: LinkedNote[] = linkedNoteRows.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        createdAt: isoReq(n.createdAt),
        updatedAt: isoReq(n.updatedAt),
      }));

      return {
        task: {
          id: taskRow.id,
          projectId: taskRow.projectId,
          milestoneId: taskRow.milestoneId,
          parentTaskId: taskRow.parentTaskId,
          title: taskRow.title,
          body: taskRow.body,
          status: taskRow.status,
          priority: taskRow.priority,
          orderKey: taskRow.orderKey,
          assignees:
            (await assigneesByTask(tx, [taskRow.id])).get(taskRow.id) ?? [],
          universeId: taskRow.universeId,
          game: null,
          createdBy: taskRow.createdBy,
          createdAt: isoReq(taskRow.createdAt),
          updatedAt: isoReq(taskRow.updatedAt),
          dueAt: iso(taskRow.dueAt),
          coverUrl: null,
          tags: (await tagsByTask(tx, [taskRow.id])).get(taskRow.id) ?? [],
          subtasks: [],
        },
        comments: commentRows.map(mapComment),
        checklistItems: checklistRows.map(mapChecklist),
        attachments: attachmentRows.map(mapAttachment),
        activity: activityRows.map(mapActivity),
        linkedNotes,
      };
    });
    return c.json(detail);
  });

  // Dedicated linked-notes endpoint (per plan) — same computation as bundled.
  r.get("/tasks/:id/linked-notes", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const list = await withUser(userId, async (tx): Promise<LinkedNote[]> => {
      const { projectId } = await resolveItemAccess(tx, "task", id, userId);
      const proj = await loadTaskProject(tx, id);
      if (!proj) throw notFound("No such task.");
      const rows = await tx
        .select({
          id: notes.id,
          title: notes.title,
          body: notes.body,
          createdAt: notes.createdAt,
          updatedAt: notes.updatedAt,
        })
        .from(notes)
        .where(
          and(
            eq(notes.projectId, projectId),
            sql`${notes.body} ~* ${`\\y${escapeRegex(shortTaskId(proj.slug, id))}\\y`}`,
          ),
        )
        .orderBy(desc(notes.updatedAt));
      return rows.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        createdAt: isoReq(n.createdAt),
        updatedAt: isoReq(n.updatedAt),
      }));
    });
    return c.json(list);
  });

  /* ---------------------------- comments -------------------------------- */

  r.post("/tasks/:id/comments", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = createCommentSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid comment.");
    const created = await withUser(
      userId,
      async (tx): Promise<TaskComment> => {
        const { projectId } = await resolveItemAccess(tx, "task", id, userId);
        const [row] = await tx
          .insert(taskComments)
          .values({
            taskId: id,
            projectId,
            authorId: userId,
            body: body.data.body,
          })
          .returning();
        if (!row) throw notFound("Comment creation failed.");
        await logActivity(tx, {
          taskId: id,
          projectId,
          actorId: userId,
          kind: "comment",
          payload: { commentId: row.id },
        });
        const [author] = await tx
          .select({ name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        return mapComment({
          comment: row,
          authorName: author?.name ?? null,
          authorEmail: author?.email ?? null,
        });
      },
    );
    return c.json(created, 201);
  });

  r.patch("/comments/:id", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = patchCommentSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid update.");
    const updated = await withUser(
      userId,
      async (tx): Promise<TaskComment> => {
        const taskId = await commentTaskId(tx, id);
        if (!taskId) throw notFound("No such comment.");
        await resolveItemAccess(tx, "task", taskId, userId);
        const [existing] = await tx
          .select()
          .from(taskComments)
          .where(eq(taskComments.id, id))
          .limit(1);
        if (!existing) throw notFound("No such comment.");
        if (existing.authorId !== userId) throw forbidden("Author only.");
        const [row] = await tx
          .update(taskComments)
          .set({ body: body.data.body, updatedAt: new Date() })
          .where(eq(taskComments.id, id))
          .returning();
        if (!row) throw notFound("No such comment.");
        const [author] = await tx
          .select({ name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, row.authorId))
          .limit(1);
        return mapComment({
          comment: row,
          authorName: author?.name ?? null,
          authorEmail: author?.email ?? null,
        });
      },
    );
    return c.json(updated);
  });

  r.delete("/comments/:id", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    await withUser(userId, async (tx) => {
      const taskId = await commentTaskId(tx, id);
      if (!taskId) throw notFound("No such comment.");
      await resolveItemAccess(tx, "task", taskId, userId);
      const [existing] = await tx
        .select({ authorId: taskComments.authorId })
        .from(taskComments)
        .where(eq(taskComments.id, id))
        .limit(1);
      if (!existing) throw notFound("No such comment.");
      if (existing.authorId !== userId) throw forbidden("Author only.");
      await tx.delete(taskComments).where(eq(taskComments.id, id));
    });
    return c.body(null, 204);
  });

  /* --------------------------- checklist items -------------------------- */

  r.post("/tasks/:id/checklist", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = createChecklistItemSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid item.");
    const created = await withUser(
      userId,
      async (tx): Promise<TaskChecklistItem> => {
        const { projectId } = await resolveItemAccess(tx, "task", id, userId);
        const orderKey =
          body.data.prevId !== undefined || body.data.nextId !== undefined
            ? await keyBetween(tx, id, body.data.prevId, body.data.nextId)
            : await orderKeyAtEnd(tx, id);
        const [row] = await tx
          .insert(taskChecklistItems)
          .values({
            taskId: id,
            projectId,
            text: body.data.text,
            orderKey,
            createdBy: userId,
          })
          .returning();
        if (!row) throw notFound("Item creation failed.");
        await logActivity(tx, {
          taskId: id,
          projectId,
          actorId: userId,
          kind: "checklist_add",
          payload: { itemId: row.id, text: row.text },
        });
        return mapChecklist(row);
      },
    );
    return c.json(created, 201);
  });

  r.patch("/checklist/:id", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = patchChecklistItemSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid update.");
    const d = body.data;
    const updated = await withUser(
      userId,
      async (tx): Promise<TaskChecklistItem> => {
        const taskId = await checklistTaskId(tx, id);
        if (!taskId) throw notFound("No such item.");
        const { projectId } = await resolveItemAccess(
          tx,
          "task",
          taskId,
          userId,
        );
        const [existing] = await tx
          .select()
          .from(taskChecklistItems)
          .where(eq(taskChecklistItems.id, id))
          .limit(1);
        if (!existing) throw notFound("No such item.");
        const patch: Partial<typeof taskChecklistItems.$inferInsert> = {};
        if (d.text !== undefined) patch.text = d.text;
        if (d.done !== undefined) patch.done = d.done;
        if (d.prevId !== undefined || d.nextId !== undefined) {
          patch.orderKey = await keyBetween(tx, taskId, d.prevId, d.nextId);
        }
        const [row] = await tx
          .update(taskChecklistItems)
          .set(patch)
          .where(eq(taskChecklistItems.id, id))
          .returning();
        if (!row) throw notFound("No such item.");
        // Log a completion transition (false → true) as its own event so the
        // activity feed reads meaningfully; the reverse is silent.
        if (d.done === true && !existing.done) {
          await logActivity(tx, {
            taskId,
            projectId,
            actorId: userId,
            kind: "checklist_complete",
            payload: { itemId: row.id, text: row.text },
          });
        }
        return mapChecklist(row);
      },
    );
    return c.json(updated);
  });

  r.delete("/checklist/:id", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    await withUser(userId, async (tx) => {
      const taskId = await checklistTaskId(tx, id);
      if (!taskId) throw notFound("No such item.");
      await resolveItemAccess(tx, "task", taskId, userId);
      await tx.delete(taskChecklistItems).where(eq(taskChecklistItems.id, id));
    });
    return c.body(null, 204);
  });

  /* ---------------------------- attachments ----------------------------- */

  // Presigned PUT + attachment id; client uploads to R2 directly, then confirms.
  r.post("/tasks/:id/attachments/upload-url", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = attachmentUploadRequestSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid upload request.");
    await withUser(userId, async (tx) => {
      await resolveItemAccess(tx, "task", id, userId);
    });
    const attachmentId = randomUUID();
    const key = buildAttachmentKey(id, attachmentId, body.data.fileName);
    const put = await presignPutUrl(key, body.data.mimeType);
    const ticket: AttachmentUploadTicket = {
      attachmentId,
      uploadUrl: put.url,
      r2Key: key,
      expiresInSeconds: put.expiresInSeconds,
    };
    return c.json(ticket);
  });

  // Client posts back after PUT succeeds; write the DB row.
  r.post("/tasks/:id/attachments/confirm", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const parsed = attachmentConfirmSchema.merge(
      attachmentUploadRequestSchema,
    ).safeParse(body);
    if (!parsed.success) throw validationError("Invalid confirm.");
    const created = await withUser(
      userId,
      async (tx): Promise<TaskAttachment> => {
        const { projectId } = await resolveItemAccess(tx, "task", id, userId);
        const key = buildAttachmentKey(
          id,
          parsed.data.attachmentId,
          parsed.data.fileName,
        );
        const [row] = await tx
          .insert(taskAttachments)
          .values({
            id: parsed.data.attachmentId,
            taskId: id,
            projectId,
            uploadedBy: userId,
            fileName: parsed.data.fileName,
            mimeType: parsed.data.mimeType,
            sizeBytes: parsed.data.sizeBytes,
            r2Key: key,
          })
          .returning();
        if (!row) throw notFound("Confirm failed.");
        await logActivity(tx, {
          taskId: id,
          projectId,
          actorId: userId,
          kind: "attachment",
          payload: {
            attachmentId: row.id,
            fileName: row.fileName,
          },
        });
        return mapAttachment(row);
      },
    );
    return c.json(created, 201);
  });

  r.get("/attachments/:id/url", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const row = await withUser(userId, async (tx) => {
      const a = await attachmentRow(tx, id);
      if (!a) throw notFound("No such attachment.");
      await resolveItemAccess(tx, "task", a.taskId, userId);
      return a;
    });
    const ticket = await presignGetUrl(row.r2Key);
    const view: AttachmentViewTicket = {
      url: ticket.url,
      expiresInSeconds: ticket.expiresInSeconds,
    };
    return c.json(view);
  });

  r.delete("/attachments/:id", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const row = await withUser(userId, async (tx) => {
      const a = await attachmentRow(tx, id);
      if (!a) throw notFound("No such attachment.");
      await resolveItemAccess(tx, "task", a.taskId, userId);
      await tx.delete(taskAttachments).where(eq(taskAttachments.id, id));
      return a;
    });
    // Best-effort R2 delete — the DB row is the source of truth for what a
    // user sees; a lingering object is a cleanup job, not a failure to surface.
    try {
      await deleteObject(row.r2Key);
    } catch (err) {
      console.warn("[cards] r2 delete failed", err);
    }
    return c.body(null, 204);
  });

  return r;
}

// Escape a string so it can be safely embedded into a Postgres ~* regex.
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
