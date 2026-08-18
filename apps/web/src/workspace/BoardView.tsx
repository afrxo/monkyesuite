// Kanban board (specs/05, 08-web §8.5). Native HTML5 drag-and-drop, no lib.
// Four visible lanes match the mockup (backlog/todo/in_progress/review); done +
// archived exist in the data model but are hidden here. Cards are compact:
// title + mono short-id + tag chip + assignee avatars.
// Columns share a 1px gap on a border-colored parent so the dividers hairline
// through — no per-column borders (the mockup detail).

import type {
  Board,
  BoardLane,
  CreateTaskInput,
  ProjectTag,
  Task,
  TaskStatus,
} from "@monkyesuite/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type DragEvent,
  type FormEvent,
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Icon } from "../components/Icon";
import { toastError } from "../components/Toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { api } from "../lib/api";
import { milestoneColor } from "./milestone-color";
import { shortTaskId } from "./short-id";
import { tagChipClass } from "./tag";

const VISIBLE_LANES: TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "review",
];
const LANE_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
  archived: "Archived",
};

type Drag = { taskId: string; from: TaskStatus };
type MilestoneFilter = string | "all";

export interface BoardViewHandle {
  focusQuickAdd: () => void;
  focusSearch: () => void;
}

type Props = {
  projectId: string;
  projectSlug: string;
  board: Board;
  milestoneFilter: MilestoneFilter;
  onChanged: () => void;
  onOpenCard?: (taskId: string) => void;
};

// --- optimistic helpers ---

function optimisticallyMoveTask(
  board: Board,
  taskId: string,
  newStatus: TaskStatus,
  nextId: string | null,
): Board {
  let task: Task | undefined;
  const withoutTask = board.lanes.map((lane) => {
    const found = lane.tasks.find((t) => t.id === taskId);
    if (!found) return lane;
    task = { ...found, status: newStatus };
    return { ...lane, tasks: lane.tasks.filter((t) => t.id !== taskId) };
  });
  if (!task) return board;
  return {
    ...board,
    lanes: withoutTask.map((lane) => {
      if (lane.status !== newStatus) return lane;
      const tasks = [...lane.tasks];
      if (nextId) {
        const idx = tasks.findIndex((t) => t.id === nextId);
        tasks.splice(idx === -1 ? tasks.length : idx, 0, task!);
      } else {
        tasks.push(task!);
      }
      return { ...lane, tasks };
    }),
  };
}

function optimisticallyReorderTask(
  board: Board,
  taskId: string,
  nextId: string | null,
): Board {
  return {
    ...board,
    lanes: board.lanes.map((lane) => {
      const idx = lane.tasks.findIndex((t) => t.id === taskId);
      if (idx === -1) return lane;
      const task = lane.tasks[idx];
      if (!task) return lane;
      const without = lane.tasks.filter((t) => t.id !== taskId);
      if (nextId) {
        const ni = without.findIndex((t) => t.id === nextId);
        without.splice(ni === -1 ? without.length : ni, 0, task);
      } else {
        without.push(task);
      }
      return { ...lane, tasks: without };
    }),
  };
}

export const BoardView = forwardRef<BoardViewHandle, Props>(function BoardView(
  { projectId, projectSlug, board, milestoneFilter, onChanged, onOpenCard },
  ref,
) {
  const qc = useQueryClient();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [view, setView] = useState<"board" | "list" | "timeline">("board");
  const [query, setQuery] = useState("");
  const [addingIn, setAddingIn] = useState<TaskStatus | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [tagFilter, setTagFilter] = useState<Set<string>>(() => new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  // Vocabulary + per-tag card count, computed from the board so filter chips
  // read directly from what's on screen (no second fetch needed just to list).
  const tagVocab: { tag: ProjectTag; count: number }[] = (() => {
    const by = new Map<string, { tag: ProjectTag; count: number }>();
    for (const lane of board.lanes) {
      for (const t of lane.tasks) {
        for (const tag of t.tags ?? []) {
          const prev = by.get(tag.id);
          if (prev) prev.count += 1;
          else by.set(tag.id, { tag, count: 1 });
        }
      }
    }
    return [...by.values()].sort((a, b) =>
      a.tag.name.localeCompare(b.tag.name),
    );
  })();
  const toggleTag = (id: string) =>
    setTagFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const lanes: TaskStatus[] = showArchived
    ? [...VISIBLE_LANES, "archived"]
    : VISIBLE_LANES;
  const archivedCount =
    board.lanes.find((l) => l.status === "archived")?.tasks.length ?? 0;

  useImperativeHandle(ref, () => ({
    focusQuickAdd: () => setAddingIn("backlog"),
    focusSearch: () => searchRef.current?.focus(),
  }));

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
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["board", projectId] });
      const snapshot = qc.getQueryData<Board>(["board", projectId]);
      qc.setQueryData<Board>(["board", projectId], (old) =>
        old ? optimisticallyMoveTask(old, v.taskId, v.status, v.nextId) : old,
      );
      return { snapshot };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.snapshot)
        qc.setQueryData(["board", projectId], ctx.snapshot);
      toastError(err, "Failed to move card.");
    },
    onSettled: onChanged,
  });

  const reorder = useMutation({
    mutationFn: (v: {
      taskId: string;
      prevId: string | null;
      nextId: string | null;
    }) => api.reorderTask(v.taskId, { prevId: v.prevId, nextId: v.nextId }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["board", projectId] });
      const snapshot = qc.getQueryData<Board>(["board", projectId]);
      qc.setQueryData<Board>(["board", projectId], (old) =>
        old ? optimisticallyReorderTask(old, v.taskId, v.nextId) : old,
      );
      return { snapshot };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.snapshot)
        qc.setQueryData(["board", projectId], ctx.snapshot);
      toastError(err, "Failed to reorder card.");
    },
    onSettled: onChanged,
  });

  const laneTasks = (status: TaskStatus): Task[] =>
    board.lanes.find((l: BoardLane) => l.status === status)?.tasks ?? [];

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

  const q = query.trim().toLowerCase();
  const matches = (t: Task): boolean => {
    if (milestoneFilter !== "all" && t.milestoneId !== milestoneFilter)
      return false;
    // AND semantics: a card matches only if it carries every selected tag.
    if (tagFilter.size > 0) {
      const taskTagIds = new Set((t.tags ?? []).map((tag) => tag.id));
      for (const wanted of tagFilter) {
        if (!taskTagIds.has(wanted)) return false;
      }
    }
    if (!q) return true;
    const id = shortTaskId(projectSlug, t.id).toLowerCase();
    return (
      t.title.toLowerCase().includes(q) ||
      (t.body ?? "").toLowerCase().includes(q) ||
      id.includes(q)
    );
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-border-1 bg-surface-0 px-5 py-3">
        <div className="flex gap-0.5">
          <ViewTab active={view === "board"} onClick={() => setView("board")}>
            Board
          </ViewTab>
          <ViewTab
            disabled
            title="coming soon"
            active={false}
            onClick={() => {}}
          >
            List
          </ViewTab>
          <ViewTab
            disabled
            title="coming soon"
            active={false}
            onClick={() => {}}
          >
            Timeline
          </ViewTab>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className={`rounded border px-3 py-1.5 text-xs transition-colors ${
            showArchived
              ? "border-border-2 bg-white/[0.05] text-text-1"
              : "border-border-2 text-text-3 hover:text-text-1"
          }`}
          title="Toggle archived lane"
        >
          Archived
          <span className="ml-1.5 font-mono text-[11px] text-text-disabled">
            {archivedCount}
          </span>
        </button>
        <label className="hidden w-60 items-center gap-2 rounded border border-border-1 bg-surface-1 px-2.5 py-1.5 text-xs text-text-3 sm:flex">
          <Icon name="search" size={14} className="shrink-0 text-text-disabled" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Filter cards…"
            className="flex-1 bg-transparent text-xs text-text-1 outline-none placeholder:text-text-disabled"
          />
          <span className="rounded border border-border-1 px-1.5 py-px font-mono text-[11px] text-text-disabled">
            ⌘K
          </span>
        </label>
      </div>

      {tagVocab.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border-1 bg-surface-0 px-5 py-2">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
            Tags
          </span>
          {tagVocab.map(({ tag, count }) => {
            const on = tagFilter.has(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleTag(tag.id)}
                className={`rounded-[8px] px-1.5 py-px text-[10px] tracking-[0.04em] transition-opacity ${tagChipClass(tag)} ${
                  on ? "" : "opacity-60 hover:opacity-100"
                }`}
                title={on ? `Remove filter: ${tag.name}` : `Filter: ${tag.name}`}
              >
                {tag.name}
                <span className="ml-1 font-mono text-[9px] opacity-70">
                  {count}
                </span>
              </button>
            );
          })}
          {tagFilter.size > 0 ? (
            <button
              type="button"
              onClick={() => setTagFilter(new Set())}
              className="ml-1 rounded px-1.5 py-px text-[10px] text-text-disabled hover:text-text-1"
            >
              clear
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        className="grid flex-1 min-h-0 gap-px overflow-hidden bg-border-1"
        style={{
          gridTemplateColumns: `repeat(${lanes.length}, minmax(0, 1fr))`,
        }}
      >
        {lanes.map((status) => {
          const all = laneTasks(status);
          const shown = all.filter(matches);
          return (
            <Lane
              key={status}
              status={status}
              count={shown.length}
              onAdd={() => setAddingIn(status)}
              onDropEnd={() => drop(status, null)}
            >
              {shown.map((task) => (
                <Card
                  key={task.id}
                  task={task}
                  projectId={projectId}
                  projectSlug={projectSlug}
                  milestoneName={
                    milestoneFilter === "all" && task.milestoneId
                      ? (board.milestones.find((m) => m.id === task.milestoneId)
                          ?.name ?? null)
                      : null
                  }
                  onDragStart={() => setDrag({ taskId: task.id, from: status })}
                  onDropBefore={() => drop(status, task.id)}
                  onChanged={onChanged}
                  onOpen={onOpenCard ? () => onOpenCard(task.id) : undefined}
                />
              ))}
              <NewTask
                projectId={projectId}
                status={status}
                milestoneId={milestoneFilter === "all" ? null : milestoneFilter}
                editing={addingIn === status}
                onOpen={() => setAddingIn(status)}
                onClose={() => setAddingIn(null)}
                onChanged={onChanged}
              />
            </Lane>
          );
        })}
      </div>
    </div>
  );
});

function ViewTab({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded px-3 py-1.5 text-sm transition-colors ${
        active
          ? "bg-white/[0.06] text-text-1"
          : disabled
            ? "text-text-disabled"
            : "text-text-3 hover:text-text-1"
      }`}
    >
      {children}
    </button>
  );
}

function Lane({
  status,
  count,
  onDropEnd,
  onAdd,
  children,
}: {
  status: TaskStatus;
  count: number;
  onDropEnd: () => void;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: HTML5 drag-drop lane target
    <div
      className={`flex min-h-0 flex-col bg-[#0c0c0c] transition-shadow ${
        over ? "ring-1 ring-inset ring-text-5" : ""
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
      <div className="flex items-center gap-2 border-b border-border-1 px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-[0.1em] text-text-3">
          {LANE_LABEL[status]}
        </span>
        <span className="font-mono text-[11px] text-text-disabled">
          {count}
        </span>
        <button
          type="button"
          onClick={onAdd}
          aria-label={`Add card to ${LANE_LABEL[status]}`}
          className="ml-auto grid h-5 w-5 cursor-pointer place-items-center rounded text-text-disabled hover:bg-white/[0.06] hover:text-text-1 transition-colors"
        >
          <Icon name="plus" size={13} />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2.5">
        {children}
      </div>
    </div>
  );
}

function Card({
  task,
  projectId,
  projectSlug,
  milestoneName,
  onDragStart,
  onDropBefore,
  onChanged,
  onOpen,
}: {
  task: Task;
  projectId: string;
  projectSlug: string;
  milestoneName: string | null;
  onDragStart: () => void;
  onDropBefore: () => void;
  onChanged: () => void;
  onOpen?: () => void;
}) {
  const draggedRef = useRef(false);
  const id = shortTaskId(projectSlug, task.id);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDropBefore();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: HTML5 draggable card
    <div
      id={`card-${id}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        draggedRef.current = true;
        onDragStart();
      }}
      onDragEnd={() => {
        setTimeout(() => {
          draggedRef.current = false;
        }, 0);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onClick={(e) => {
        if (draggedRef.current) return;
        const target = e.target as HTMLElement;
        if (target.closest("button")) return;
        onOpen?.();
      }}
      className="group relative cursor-pointer overflow-hidden rounded-md border border-border-1 bg-surface-1 text-sm leading-[1.4] hover:border-border-2 hover:bg-white/[0.03] active:scale-[0.99] transition-all duration-100 active:cursor-grabbing"
    >
      {task.coverUrl ? (
        <div className="h-[112px] w-full overflow-hidden bg-surface-hover">
          <img
            src={task.coverUrl}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
        </div>
      ) : null}
      <div className="p-3">
      {milestoneName && task.milestoneId ? (
        <div
          className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-disabled"
          title={`Milestone: ${milestoneName}`}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${milestoneColor(task.milestoneId).dot}`}
          />
          <span className="truncate">{milestoneName}</span>
        </div>
      ) : null}
      <div className="mb-2 pr-5 text-text-1">{task.title}</div>
      <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-text-disabled">
        {(task.tags ?? []).map((tag) => (
          <span
            key={tag.id}
            className={`rounded-[8px] px-1.5 py-px text-[10px] tracking-[0.04em] ${tagChipClass(tag)}`}
          >
            {tag.name}
          </span>
        ))}
        {(task.assignees ?? []).length > 0 ? (
          <span className="ml-auto flex -space-x-1">
            {(task.assignees ?? []).slice(0, 3).map((a) => (
              <MiniAvatar key={a.id} name={a.name ?? a.email} />
            ))}
            {(task.assignees ?? []).length > 3 ? (
              <span className="grid h-5 w-5 place-items-center rounded-full border-[1.5px] border-surface-0 bg-surface-hover text-[9px] font-semibold text-text-3">
                +{(task.assignees ?? []).length - 3}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      <CardMenu task={task} projectId={projectId} onChanged={onChanged} />
      </div>
    </div>
  );
}

function CardMenu({
  task,
  projectId,
  onChanged,
}: {
  task: Task;
  projectId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const archive = useMutation({
    mutationFn: () => api.moveTask(task.id, { status: "archived" }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["board", projectId] });
      const snapshot = qc.getQueryData<Board>(["board", projectId]);
      qc.setQueryData<Board>(["board", projectId], (old) =>
        old ? optimisticallyMoveTask(old, task.id, "archived", null) : old,
      );
      setOpen(false);
      return { snapshot };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(["board", projectId], ctx.snapshot);
      toastError(err, "Failed to archive card.");
    },
    onSettled: onChanged,
  });

  const restore = useMutation({
    mutationFn: () => api.moveTask(task.id, { status: "backlog" }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["board", projectId] });
      const snapshot = qc.getQueryData<Board>(["board", projectId]);
      qc.setQueryData<Board>(["board", projectId], (old) =>
        old ? optimisticallyMoveTask(old, task.id, "backlog", null) : old,
      );
      setOpen(false);
      return { snapshot };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(["board", projectId], ctx.snapshot);
      toastError(err, "Failed to restore card.");
    },
    onSettled: onChanged,
  });

  const del = useMutation({
    mutationFn: () => api.deleteTask(task.id),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["board", projectId] });
      const snapshot = qc.getQueryData<Board>(["board", projectId]);
      qc.setQueryData<Board>(["board", projectId], (old) => {
        if (!old) return old;
        return {
          ...old,
          lanes: old.lanes.map((lane) => ({
            ...lane,
            tasks: lane.tasks.filter((t) => t.id !== task.id),
          })),
        };
      });
      setOpen(false);
      return { snapshot };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(["board", projectId], ctx.snapshot);
      toastError(err, "Failed to delete card.");
    },
    onSettled: onChanged,
  });

  const isArchived = task.status === "archived";

  return (
    <div className="absolute right-1.5 top-1.5">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="Card actions"
            className={`grid h-6 w-6 place-items-center rounded text-text-disabled transition-colors ${
              open
                ? "bg-white/[0.06] text-text-1 opacity-100"
                : "opacity-0 hover:bg-white/[0.06] hover:text-text-1 group-hover:opacity-100 focus:opacity-100"
            }`}
          >
            <Icon name="more" size={14} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={4}
          onClick={(e) => e.stopPropagation()}
          className="w-40 overflow-hidden rounded-md border border-border-1 bg-surface-1 py-1 shadow-lg"
        >
          {isArchived ? (
            <DropdownMenuItem
              onSelect={() => restore.mutate()}
              className="block w-full px-3 py-2 text-left text-xs text-text-2 hover:bg-white/[0.05] focus:bg-white/[0.05] transition-colors"
            >
              Restore to Backlog
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={() => archive.mutate()}
              className="block w-full px-3 py-2 text-left text-xs text-text-2 hover:bg-white/[0.05] focus:bg-white/[0.05] transition-colors"
            >
              Archive
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => {
              if (confirm(`Delete card "${task.title}"? This can't be undone.`))
                del.mutate();
            }}
            className="block w-full px-3 py-2 text-left text-xs text-destructive hover:bg-white/[0.05] focus:bg-white/[0.05] transition-colors"
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function MiniAvatar({ name }: { name: string }) {
  const initials = name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toLowerCase();
  return (
    <span
      title={name}
      className="grid h-5 w-5 place-items-center rounded-full border-[1.5px] border-surface-0 bg-gradient-to-br from-[#3a2a1a] to-accent-warm text-[9px] font-semibold text-[#1a1000]"
    >
      {initials}
    </span>
  );
}

function NewTask({
  projectId,
  status,
  milestoneId,
  editing,
  onOpen,
  onClose,
  onChanged,
}: {
  projectId: string;
  status: TaskStatus;
  milestoneId: string | null;
  editing: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState("");
  const create = useMutation({
    mutationFn: (input: CreateTaskInput) => api.createTask(projectId, input),
    onSuccess: () => {
      setTitle("");
      onClose();
      onChanged();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim())
      create.mutate({
        title: title.trim(),
        status,
        ...(milestoneId ? { milestoneId } : {}),
      });
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="cursor-pointer px-3 py-2 text-left text-xs text-text-disabled hover:text-text-3 transition-colors"
      >
        + New card
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="px-1">
      <input
        // biome-ignore lint/a11y/noAutofocus: focus what user opened
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (!title.trim()) onClose();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setTitle("");
            onClose();
          }
        }}
        placeholder="Card title"
        className="w-full rounded border border-dashed border-border-1 bg-transparent px-2.5 py-2 text-sm text-text-1 outline-none focus:border-text-5"
      />
    </form>
  );
}
