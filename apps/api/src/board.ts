// Scoped board routes (specs/05, 07-api.md §7.2) — the Kanban surface. Every
// handler resolves membership through resolveProjectAccess / resolveItemAccess
// BEFORE touching data, inside a withUser tx (RLS backstop). Ordering is a
// fractional index computed server-side from the neighbours the client names,
// so a move/reorder rewrites exactly one row and the client never sends a key.

import { generateKeyBetween } from "@monkyesuite/core";
import { games, milestones, taskAttachments, tasks, users } from "@monkyesuite/database";
import {
  type Board,
  type BoardLane,
  createMilestoneSchema,
  createSubtaskSchema,
  createTaskSchema,
  type Milestone,
  moveTaskSchema,
  patchMilestoneSchema,
  patchTaskSchema,
  reorderTaskSchema,
  TASK_STATUSES,
  type Task,
  type TaskStatus,
  uuidSchema,
} from "@monkyesuite/shared";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { resolveItemAccess, resolveProjectAccess } from "./access.js";
import { logActivity } from "./cards.js";
import { notFound, validationError } from "./errors.js";
import { coverUrlFor } from "./r2.js";
import { toDisplayUsername } from "./identity.js";
import { type AppEnv, requireUser } from "./middleware.js";
import { iso, isoReq } from "./serialize.js";
import { type Tx, withUser } from "./tx.js";

type TaskRow = typeof tasks.$inferSelect;

// The joined columns every task select needs: assignee identity + linked-game
// chip + cover attachment for board card cover images.
const taskSelect = {
  task: tasks,
  assigneeName: users.name,
  assigneeEmail: users.email,
  gameName: games.name,
  gameIcon: games.iconUrl,
  coverR2Key: taskAttachments.r2Key,
  coverMimeType: taskAttachments.mimeType,
} as const;

type TaskJoin = {
  task: TaskRow;
  assigneeName: string | null;
  assigneeEmail: string | null;
  gameName: string | null;
  gameIcon: string | null;
  coverR2Key: string | null;
  coverMimeType: string | null;
};

function mapTask(row: TaskJoin, subtasks: Task[]): Task {
  const t = row.task;
  return {
    id: t.id,
    projectId: t.projectId,
    milestoneId: t.milestoneId,
    parentTaskId: t.parentTaskId,
    title: t.title,
    body: t.body,
    status: t.status,
    priority: t.priority,
    orderKey: t.orderKey,
    assigneeId: t.assigneeId,
    assignee:
      t.assigneeId && row.assigneeEmail
        ? {
            id: t.assigneeId,
            name: row.assigneeName,
            email: toDisplayUsername(row.assigneeEmail),
          }
        : null,
    universeId: t.universeId,
    game:
      t.universeId && row.gameName
        ? {
            universeId: t.universeId,
            name: row.gameName,
            iconUrl: row.gameIcon,
          }
        : null,
    createdBy: t.createdBy,
    createdAt: isoReq(t.createdAt),
    updatedAt: isoReq(t.updatedAt),
    dueAt: iso(t.dueAt),
    coverUrl:
      row.coverR2Key && row.coverMimeType
        ? coverUrlFor(row.coverMimeType, row.coverR2Key)
        : null,
    subtasks,
  };
}

const mapMilestone = (m: typeof milestones.$inferSelect): Milestone => ({
  id: m.id,
  projectId: m.projectId,
  name: m.name,
  description: m.description,
  status: m.status,
  orderKey: m.orderKey,
  targetDate: iso(m.targetDate),
  createdBy: m.createdBy,
  createdAt: isoReq(m.createdAt),
});

// A task join by id, or null. Used after a write to return the fresh DTO.
async function taskJoinById(tx: Tx, id: string): Promise<TaskJoin | null> {
  const [row] = await tx
    .select(taskSelect)
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .leftJoin(games, eq(games.universeId, tasks.universeId))
    .leftJoin(taskAttachments, eq(taskAttachments.id, tasks.coverAttachmentId))
    .where(eq(tasks.id, id))
    .limit(1);
  return row ?? null;
}

// The orderKey for a card landing between the two neighbours the client named,
// validated to live in the given (project, status) lane. A neighbour in the
// wrong lane, or absent, is a 422 — the client's board view is stale.
async function keyBetweenNeighbours(
  tx: Tx,
  projectId: string,
  status: TaskStatus,
  prevId: string | null | undefined,
  nextId: string | null | undefined,
  movingId?: string,
): Promise<string> {
  const laneKey = async (id: string): Promise<string> => {
    const [row] = await tx
      .select({ orderKey: tasks.orderKey })
      .from(tasks)
      .where(
        and(
          eq(tasks.id, id),
          eq(tasks.projectId, projectId),
          eq(tasks.status, status),
          isNull(tasks.parentTaskId),
        ),
      )
      .limit(1);
    if (!row) throw validationError("Neighbour not in this lane.");
    return row.orderKey;
  };
  if (prevId && prevId === movingId) throw validationError("Bad neighbour.");
  if (nextId && nextId === movingId) throw validationError("Bad neighbour.");
  const prev = prevId ? await laneKey(prevId) : null;
  const next = nextId ? await laneKey(nextId) : null;
  try {
    return generateKeyBetween(prev, next);
  } catch {
    // prev >= next means the client's neighbour pair is inconsistent (stale view).
    throw validationError("Inconsistent card order.");
  }
}

// Append key: a key after the current max in a (project, status) lane. Used for
// new top-level cards (default status backlog, lane end) and for subtasks.
async function appendKey(
  tx: Tx,
  where: ReturnType<typeof and>,
): Promise<string> {
  const [row] = await tx
    .select({ maxKey: sql<string | null>`max(${tasks.orderKey})` })
    .from(tasks)
    .where(where);
  return generateKeyBetween(row?.maxKey ?? null, null);
}

export function boardRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  /* ------------------------------- board -------------------------------- */

  r.get("/projects/:id/board", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const board = await withUser(userId, async (tx): Promise<Board> => {
      await resolveProjectAccess(tx, id, userId);

      const ms = await tx
        .select()
        .from(milestones)
        .where(eq(milestones.projectId, id))
        .orderBy(asc(milestones.orderKey));

      // All cards for the project, ordered by key. Split parents vs subtasks in
      // TS (the set is one small team's board, not a cross-game aggregation).
      const rows = await tx
        .select(taskSelect)
        .from(tasks)
        .leftJoin(users, eq(users.id, tasks.assigneeId))
        .leftJoin(games, eq(games.universeId, tasks.universeId))
        .leftJoin(taskAttachments, eq(taskAttachments.id, tasks.coverAttachmentId))
        .where(eq(tasks.projectId, id))
        .orderBy(asc(tasks.orderKey));

      const childrenByParent = new Map<string, Task[]>();
      for (const row of rows) {
        if (!row.task.parentTaskId) continue;
        const list = childrenByParent.get(row.task.parentTaskId) ?? [];
        list.push(mapTask(row, []));
        childrenByParent.set(row.task.parentTaskId, list);
      }

      const lanes: BoardLane[] = TASK_STATUSES.map((status) => ({
        status,
        tasks: [],
      }));
      const laneOf = new Map(lanes.map((l) => [l.status, l]));
      for (const row of rows) {
        if (row.task.parentTaskId) continue;
        const task = mapTask(row, childrenByParent.get(row.task.id) ?? []);
        laneOf.get(task.status)?.tasks.push(task);
      }

      return { projectId: id, lanes, milestones: ms.map(mapMilestone) };
    });
    return c.json(board);
  });

  /* ------------------------------- tasks -------------------------------- */

  r.post("/projects/:id/tasks", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = createTaskSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid task.");
    const status = body.data.status ?? "backlog";
    const task = await withUser(userId, async (tx): Promise<Task> => {
      await resolveProjectAccess(tx, id, userId);
      const orderKey = await appendKey(
        tx,
        and(
          eq(tasks.projectId, id),
          eq(tasks.status, status),
          isNull(tasks.parentTaskId),
        ),
      );
      const [row] = await tx
        .insert(tasks)
        .values({
          projectId: id,
          title: body.data.title,
          body: body.data.body ?? null,
          status,
          priority: body.data.priority,
          orderKey,
          milestoneId: body.data.milestoneId ?? null,
          assigneeId: body.data.assigneeId ?? null,
          universeId: body.data.universeId ?? null,
          dueAt: body.data.dueAt ? new Date(body.data.dueAt) : null,
          createdBy: userId,
        })
        .returning({ id: tasks.id });
      if (!row) throw notFound("Task creation failed.");
      await logActivity(tx, {
        taskId: row.id,
        projectId: id,
        actorId: userId,
        kind: "create",
      });
      const join = await taskJoinById(tx, row.id);
      if (!join) throw notFound("Task creation failed.");
      return mapTask(join, []);
    });
    return c.json(task, 201);
  });

  r.post("/tasks/:id/subtasks", async (c) => {
    const userId = requireUser(c);
    const parentId = uuidSchema.parse(c.req.param("id"));
    const body = createSubtaskSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid subtask.");
    const task = await withUser(userId, async (tx): Promise<Task> => {
      const { projectId } = await resolveItemAccess(
        tx,
        "task",
        parentId,
        userId,
      );
      const [parent] = await tx
        .select({
          parentTaskId: tasks.parentTaskId,
          status: tasks.status,
          milestoneId: tasks.milestoneId,
        })
        .from(tasks)
        .where(eq(tasks.id, parentId))
        .limit(1);
      if (!parent) throw notFound("No such task.");
      // One-deep: a subtask cannot itself have children (specs/05 §5.1).
      if (parent.parentTaskId) {
        throw validationError("A subtask cannot have subtasks.");
      }
      const orderKey = await appendKey(tx, eq(tasks.parentTaskId, parentId));
      const [row] = await tx
        .insert(tasks)
        .values({
          projectId,
          parentTaskId: parentId,
          title: body.data.title,
          body: body.data.body ?? null,
          // A subtask shares its parent's lane + milestone; it isn't independently
          // placed on the board (it renders nested under the parent).
          status: parent.status,
          priority: body.data.priority,
          orderKey,
          milestoneId: parent.milestoneId,
          assigneeId: body.data.assigneeId ?? null,
          createdBy: userId,
        })
        .returning({ id: tasks.id });
      if (!row) throw notFound("Subtask creation failed.");
      const join = await taskJoinById(tx, row.id);
      if (!join) throw notFound("Subtask creation failed.");
      return mapTask(join, []);
    });
    return c.json(task, 201);
  });

  r.patch("/tasks/:id", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = patchTaskSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid update.");
    const d = body.data;
    const task = await withUser(userId, async (tx): Promise<Task> => {
      const { projectId } = await resolveItemAccess(tx, "task", id, userId);
      const [before] = await tx
        .select({ title: tasks.title, assigneeId: tasks.assigneeId })
        .from(tasks)
        .where(eq(tasks.id, id))
        .limit(1);
      await tx
        .update(tasks)
        .set({
          ...(d.title !== undefined ? { title: d.title } : {}),
          ...(d.body !== undefined ? { body: d.body } : {}),
          ...(d.priority !== undefined ? { priority: d.priority } : {}),
          ...(d.milestoneId !== undefined
            ? { milestoneId: d.milestoneId }
            : {}),
          ...(d.assigneeId !== undefined ? { assigneeId: d.assigneeId } : {}),
          ...(d.universeId !== undefined ? { universeId: d.universeId } : {}),
          ...(d.dueAt !== undefined
            ? { dueAt: d.dueAt ? new Date(d.dueAt) : null }
            : {}),
          ...(d.coverAttachmentId !== undefined
            ? { coverAttachmentId: d.coverAttachmentId }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, id));
      if (before) {
        if (d.title !== undefined && d.title !== before.title) {
          await logActivity(tx, {
            taskId: id,
            projectId,
            actorId: userId,
            kind: "title_change",
            payload: { from: before.title, to: d.title },
          });
        }
        if (
          d.assigneeId !== undefined &&
          d.assigneeId !== before.assigneeId
        ) {
          await logActivity(tx, {
            taskId: id,
            projectId,
            actorId: userId,
            kind: "assignee_change",
            payload: { from: before.assigneeId, to: d.assigneeId },
          });
        }
      }
      const join = await taskJoinById(tx, id);
      if (!join) throw notFound("No such task.");
      // Return the parent's subtasks too, so an edited parent re-renders whole.
      const kids = await subtasksOf(tx, id);
      return mapTask(join, kids);
    });
    return c.json(task);
  });

  // Cross-lane move: writes status AND a fresh orderKey for the destination lane.
  r.patch("/tasks/:id/move", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = moveTaskSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw validationError("Invalid move.");
    const { status, prevId, nextId } = body.data;
    const task = await withUser(userId, async (tx): Promise<Task> => {
      const { projectId } = await resolveItemAccess(tx, "task", id, userId);
      // Subtasks aren't board cards — they can't be moved across lanes.
      const current = await assertTopLevel(tx, id);
      const orderKey = await keyBetweenNeighbours(
        tx,
        projectId,
        status,
        prevId,
        nextId,
        id,
      );
      await tx
        .update(tasks)
        .set({ status, orderKey, updatedAt: new Date() })
        .where(eq(tasks.id, id));
      if (current.status !== status) {
        await logActivity(tx, {
          taskId: id,
          projectId,
          actorId: userId,
          kind: "status_change",
          payload: { from: current.status, to: status },
        });
      }
      const join = await taskJoinById(tx, id);
      if (!join) throw notFound("No such task.");
      return mapTask(join, await subtasksOf(tx, id));
    });
    return c.json(task);
  });

  // Within-lane reorder: writes only orderKey (status unchanged).
  r.patch("/tasks/:id/reorder", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = reorderTaskSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid reorder.");
    const { prevId, nextId } = body.data;
    const task = await withUser(userId, async (tx): Promise<Task> => {
      const { projectId } = await resolveItemAccess(tx, "task", id, userId);
      const current = await assertTopLevel(tx, id);
      const orderKey = await keyBetweenNeighbours(
        tx,
        projectId,
        current.status,
        prevId,
        nextId,
        id,
      );
      await tx
        .update(tasks)
        .set({ orderKey, updatedAt: new Date() })
        .where(eq(tasks.id, id));
      const join = await taskJoinById(tx, id);
      if (!join) throw notFound("No such task.");
      return mapTask(join, await subtasksOf(tx, id));
    });
    return c.json(task);
  });

  r.delete("/tasks/:id", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    await withUser(userId, async (tx) => {
      await resolveItemAccess(tx, "task", id, userId);
      // Subtasks cascade via the self-ref on delete? No FK cascade is declared on
      // parent_task_id, so remove children first to avoid orphaning them.
      await tx.delete(tasks).where(eq(tasks.parentTaskId, id));
      await tx.delete(tasks).where(eq(tasks.id, id));
    });
    return c.body(null, 204);
  });

  /* ----------------------------- milestones ----------------------------- */

  r.post("/projects/:id/milestones", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = createMilestoneSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid milestone.");
    const milestone = await withUser(userId, async (tx): Promise<Milestone> => {
      await resolveProjectAccess(tx, id, userId);
      const [maxRow] = await tx
        .select({ maxKey: sql<string | null>`max(${milestones.orderKey})` })
        .from(milestones)
        .where(eq(milestones.projectId, id));
      const orderKey = generateKeyBetween(maxRow?.maxKey ?? null, null);
      const [row] = await tx
        .insert(milestones)
        .values({
          projectId: id,
          name: body.data.name,
          description: body.data.description ?? null,
          status: body.data.status,
          orderKey,
          targetDate: body.data.targetDate
            ? new Date(body.data.targetDate)
            : null,
          createdBy: userId,
        })
        .returning();
      if (!row) throw notFound("Milestone creation failed.");
      return mapMilestone(row);
    });
    return c.json(milestone, 201);
  });

  r.patch("/milestones/:id", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    const body = patchMilestoneSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid update.");
    const d = body.data;
    const milestone = await withUser(userId, async (tx): Promise<Milestone> => {
      await resolveItemAccess(tx, "milestone", id, userId);
      const [row] = await tx
        .update(milestones)
        .set({
          ...(d.name !== undefined ? { name: d.name } : {}),
          ...(d.description !== undefined
            ? { description: d.description }
            : {}),
          ...(d.status !== undefined ? { status: d.status } : {}),
          ...(d.targetDate !== undefined
            ? { targetDate: d.targetDate ? new Date(d.targetDate) : null }
            : {}),
        })
        .where(eq(milestones.id, id))
        .returning();
      if (!row) throw notFound("No such milestone.");
      return mapMilestone(row);
    });
    return c.json(milestone);
  });

  // Deleting a milestone nulls its tasks' milestoneId (specs/05 §5.3) — the FK
  // `on delete set null` handles it, so the tasks survive.
  r.delete("/milestones/:id", async (c) => {
    const userId = requireUser(c);
    const id = uuidSchema.parse(c.req.param("id"));
    await withUser(userId, async (tx) => {
      await resolveItemAccess(tx, "milestone", id, userId);
      await tx.delete(milestones).where(eq(milestones.id, id));
    });
    return c.body(null, 204);
  });

  return r;
}

/* ------------------------------- helpers ---------------------------------- */

// Assert a task is a top-level board card (not a subtask); return its row.
async function assertTopLevel(
  tx: Tx,
  id: string,
): Promise<{ status: TaskStatus }> {
  const [row] = await tx
    .select({ status: tasks.status, parentTaskId: tasks.parentTaskId })
    .from(tasks)
    .where(eq(tasks.id, id))
    .limit(1);
  if (!row) throw notFound("No such task.");
  if (row.parentTaskId) throw validationError("A subtask can't be moved.");
  return { status: row.status };
}

async function subtasksOf(tx: Tx, parentId: string): Promise<Task[]> {
  const rows = await tx
    .select(taskSelect)
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .leftJoin(games, eq(games.universeId, tasks.universeId))
    .leftJoin(taskAttachments, eq(taskAttachments.id, tasks.coverAttachmentId))
    .where(eq(tasks.parentTaskId, parentId))
    .orderBy(asc(tasks.orderKey));
  return rows.map((row) => mapTask(row, []));
}
