// The Kanban board (specs/05, 08-web §8.5). Native HTML5 drag-and-drop, no lib.
// A drop computes the moved card's neighbours in the destination lane and calls
// move (cross-lane: status + orderKey) or reorder (within-lane: orderKey) — the
// server computes the fractional key, so exactly one row is written. The lane
// order shown is always the FULL lane (ordered by orderKey); the milestone
// filter only dims/hides cards, it never reorders, so neighbours stay correct.

import type {
  Board,
  CreateMilestoneInput,
  CreateTaskInput,
  Task,
  TaskPriority,
  TaskStatus,
} from "@monkyesuite/shared";
import { TASK_STATUSES } from "@monkyesuite/shared";
import { useMutation } from "@tanstack/react-query";
import { type DragEvent, type FormEvent, useState } from "react";
import { api } from "../lib/api";

const LANE_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
  archived: "Archived",
};

const PRIORITY_DOT: Record<TaskPriority, string> = {
  none: "bg-white/[0.06]",
  low: "bg-sky-500",
  medium: "bg-amber-500",
  high: "bg-orange-500",
  urgent: "bg-rose-500",
};

type MilestoneFilter = string | "all" | "none";
type Drag = { taskId: string; from: TaskStatus };

export function BoardView({
  projectId,
  board,
  milestoneFilter,
  onFilter,
  onChanged,
}: {
  projectId: string;
  board: Board;
  milestoneFilter: MilestoneFilter;
  onFilter: (v: MilestoneFilter) => void;
  onChanged: () => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);

  const move = useMutation({
    mutationFn: (v: {
      taskId: string;
      status: TaskStatus;
      prevId: string | null;
      nextId: string | null;
    }) =>
      api.moveTask(v.taskId, {
        status: v.status,
        prevId: v.prevId,
        nextId: v.nextId,
      }),
    onSettled: onChanged,
  });
  const reorder = useMutation({
    mutationFn: (v: {
      taskId: string;
      prevId: string | null;
      nextId: string | null;
    }) => api.reorderTask(v.taskId, { prevId: v.prevId, nextId: v.nextId }),
    onSettled: onChanged,
  });

  const laneTasks = (status: TaskStatus): Task[] =>
    board.lanes.find((l) => l.status === status)?.tasks ?? [];

  // Place `drag.taskId` into `status` before `beforeId` (or at the end when
  // null), computing its neighbours from the full destination lane.
  function drop(status: TaskStatus, beforeId: string | null) {
    if (!drag) return;
    const dest = laneTasks(status).filter((t) => t.id !== drag.taskId);
    const idx = beforeId
      ? dest.findIndex((t) => t.id === beforeId)
      : dest.length;
    const prevId = idx > 0 ? (dest[idx - 1]?.id ?? null) : null;
    const nextId = idx < dest.length ? (dest[idx]?.id ?? null) : null;
    if (status === drag.from) {
      reorder.mutate({ taskId: drag.taskId, prevId, nextId });
    } else {
      move.mutate({ taskId: drag.taskId, status, prevId, nextId });
    }
    setDrag(null);
  }

  const matchesFilter = (t: Task): boolean =>
    milestoneFilter === "all"
      ? true
      : milestoneFilter === "none"
        ? t.milestoneId === null
        : t.milestoneId === milestoneFilter;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-text-4">Milestone</span>
        <select
          value={milestoneFilter}
          onChange={(e) => onFilter(e.target.value as MilestoneFilter)}
          className="rounded-md border border-border-1 bg-surface-1 px-2 py-1 text-sm text-text-2"
        >
          <option value="all">All</option>
          <option value="none">No milestone</option>
          {board.milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <NewMilestone projectId={projectId} onChanged={onChanged} />
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {TASK_STATUSES.map((status) => {
          const all = laneTasks(status);
          const shown = all.filter(matchesFilter);
          return (
            <Lane
              key={status}
              status={status}
              count={shown.length}
              onDropEnd={() => drop(status, null)}
            >
              {shown.map((task) => (
                <Card
                  key={task.id}
                  task={task}
                  milestoneName={
                    board.milestones.find((m) => m.id === task.milestoneId)
                      ?.name
                  }
                  onDragStart={() => setDrag({ taskId: task.id, from: status })}
                  onDropBefore={() => drop(status, task.id)}
                  onChanged={onChanged}
                />
              ))}
              <NewTask
                projectId={projectId}
                status={status}
                onChanged={onChanged}
              />
            </Lane>
          );
        })}
      </div>
    </div>
  );
}

function Lane({
  status,
  count,
  onDropEnd,
  children,
}: {
  status: TaskStatus;
  count: number;
  onDropEnd: () => void;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: HTML5 drag-drop lane target
    <div
      className={`flex w-72 shrink-0 flex-col rounded-lg border p-2 ${
        over ? "border-text-5 bg-surface-1" : "border-border-1"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDropEnd();
      }}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-3">
          {LANE_LABEL[status]}
        </span>
        <span className="text-xs text-text-5">{count}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2">{children}</div>
    </div>
  );
}

function Card({
  task,
  milestoneName,
  onDragStart,
  onDropBefore,
  onChanged,
}: {
  task: Task;
  milestoneName: string | undefined;
  onDragStart: () => void;
  onDropBefore: () => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const del = useMutation({
    mutationFn: () => api.deleteTask(task.id),
    onSettled: onChanged,
  });

  // A drop landing on the top half of a card inserts before it; the lane's own
  // onDrop handles the tail. stopPropagation so the lane doesn't also fire.
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDropBefore();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: HTML5 draggable card
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className="cursor-grab rounded-lg border border-border-1 bg-surface-0/60 p-2.5 text-sm active:cursor-grabbing"
    >
      <div className="flex items-start gap-2">
        <span
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[task.priority]}`}
          title={`priority: ${task.priority}`}
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex-1 text-left text-text-1"
        >
          {task.title}
        </button>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-4">
        {milestoneName ? (
          <Chip className="bg-indigo-500/10 text-indigo-300">
            {milestoneName}
          </Chip>
        ) : null}
        {task.game ? (
          <Chip className="bg-white/[0.04] text-text-2">{task.game.name}</Chip>
        ) : null}
        {task.assignee ? (
          <Chip className="bg-white/[0.04] text-text-3">
            {task.assignee.name ?? task.assignee.email}
          </Chip>
        ) : null}
        {task.subtasks.length ? (
          <Chip className="bg-white/[0.04] text-text-4">
            {task.subtasks.filter((s) => s.status === "done").length}/
            {task.subtasks.length}
          </Chip>
        ) : null}
      </div>

      {open ? (
        <div className="mt-2 flex flex-col gap-2 border-t border-border-1 pt-2 pl-4">
          {task.body ? (
            <p className="whitespace-pre-wrap text-xs text-text-3">
              {task.body}
            </p>
          ) : null}
          <Subtasks task={task} onChanged={onChanged} />
          <button
            type="button"
            onClick={() => del.mutate()}
            className="w-fit text-xs text-rose-400/80 hover:text-rose-300"
          >
            Delete card
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Subtasks({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const [title, setTitle] = useState("");
  const add = useMutation({
    mutationFn: (t: string) => api.createSubtask(task.id, { title: t }),
    onSuccess: () => {
      setTitle("");
      onChanged();
    },
  });
  const toggle = useMutation({
    mutationFn: (v: { id: string; done: boolean }) =>
      api.moveTask(v.id, { status: v.done ? "done" : "todo" }),
    onSettled: onChanged,
  });

  return (
    <div className="flex flex-col gap-1">
      {task.subtasks.map((s) => (
        <label key={s.id} className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={s.status === "done"}
            onChange={(e) =>
              toggle.mutate({ id: s.id, done: e.target.checked })
            }
          />
          <span
            className={
              s.status === "done" ? "text-text-5 line-through" : "text-text-2"
            }
          >
            {s.title}
          </span>
        </label>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) add.mutate(title.trim());
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="+ subtask"
          className="w-full rounded border border-border-1 bg-surface-1 px-2 py-1 text-xs text-text-2 outline-none focus:border-text-5"
        />
      </form>
    </div>
  );
}

function NewTask({
  projectId,
  status,
  onChanged,
}: {
  projectId: string;
  status: TaskStatus;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState("");
  const create = useMutation({
    mutationFn: (input: CreateTaskInput) => api.createTask(projectId, input),
    onSuccess: () => {
      setTitle("");
      onChanged();
    },
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim()) create.mutate({ title: title.trim(), status });
  };
  return (
    <form onSubmit={onSubmit} className="mt-1">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="+ card"
        className="w-full rounded-md border border-dashed border-border-1 bg-transparent px-2 py-1.5 text-xs text-text-2 outline-none focus:border-text-5"
      />
    </form>
  );
}

function NewMilestone({
  projectId,
  onChanged,
}: {
  projectId: string;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const create = useMutation({
    mutationFn: (input: CreateMilestoneInput) =>
      api.createMilestone(projectId, input),
    onSuccess: () => {
      setName("");
      setOpen(false);
      onChanged();
    },
  });
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-auto text-xs text-text-4 hover:text-text-2"
      >
        + milestone
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) create.mutate({ name: name.trim() });
      }}
      className="ml-auto flex items-center gap-1"
    >
      <input
        // biome-ignore lint/a11y/noAutofocus: focus the field the user just opened
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Milestone name"
        className="rounded-md border border-border-1 bg-surface-1 px-2 py-1 text-xs text-text-2 outline-none focus:border-text-5"
      />
      <button type="submit" className="text-xs text-text-2 hover:text-text-1">
        add
      </button>
    </form>
  );
}

function Chip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] ${className ?? ""}`}>
      {children}
    </span>
  );
}
