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
  Task,
  TaskStatus,
} from "@monkyesuite/shared";
import { useMutation } from "@tanstack/react-query";
import {
  type DragEvent,
  type FormEvent,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { api } from "../lib/api";
import { shortTaskId } from "./short-id";
import { TAG_CHIP, tagFromTitle } from "./tag";

const VISIBLE_LANES: TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "review",
];
// Archived lane is opt-in — appended when the header toggle is on. Done lives
// in the schema but has no dedicated column yet; treat as archived-adjacent.
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

export const BoardView = forwardRef<BoardViewHandle, Props>(function BoardView(
  { projectId, projectSlug, board, milestoneFilter, onChanged, onOpenCard },
  ref,
) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [view, setView] = useState<"board" | "list" | "timeline">("board");
  const [query, setQuery] = useState("");
  const [addingIn, setAddingIn] = useState<TaskStatus | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

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
      <div className="flex items-center gap-3 border-b border-border-1 bg-surface-0 px-4 py-2.5">
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
          className={`rounded border px-2.5 py-1 text-[11px] transition ${
            showArchived
              ? "border-border-2 bg-white/[0.05] text-text-1"
              : "border-border-2 text-text-3 hover:text-text-1"
          }`}
          title="Toggle archived lane"
        >
          Archived
          <span className="ml-1.5 font-mono text-[10px] text-text-disabled">
            {archivedCount}
          </span>
        </button>
        <label className="hidden w-52 items-center gap-2 rounded border border-border-1 bg-surface-1 px-2 py-1 text-[11px] text-text-3 sm:flex">
          <span className="text-text-disabled">⌕</span>
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Filter cards…"
            className="flex-1 bg-transparent text-[11px] text-text-1 outline-none placeholder:text-text-disabled"
          />
          <span className="rounded border border-border-1 px-1.5 py-px font-mono text-[10px] text-text-disabled">
            ⌘K
          </span>
        </label>
      </div>

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
      className={`rounded px-2.5 py-1 text-xs transition ${
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
      className={`flex min-h-0 flex-col bg-[#0c0c0c] ${
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
      <div className="flex items-center gap-2 border-b border-border-1 px-3.5 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">
          {LANE_LABEL[status]}
        </span>
        <span className="font-mono text-[10px] text-text-disabled">
          {count}
        </span>
        <button
          type="button"
          onClick={onAdd}
          aria-label={`Add card to ${LANE_LABEL[status]}`}
          className="ml-auto cursor-pointer text-sm leading-none text-text-disabled hover:text-text-1"
        >
          +
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-2">
        {children}
      </div>
    </div>
  );
}

function Card({
  task,
  projectSlug,
  milestoneName,
  onDragStart,
  onDropBefore,
  onChanged,
  onOpen,
}: {
  task: Task;
  projectSlug: string;
  milestoneName: string | null;
  onDragStart: () => void;
  onDropBefore: () => void;
  onChanged: () => void;
  onOpen?: () => void;
}) {
  const draggedRef = useRef(false);
  const tag = tagFromTitle(task.title);
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
        // Reset next tick so the trailing click after a drag is still suppressed.
        setTimeout(() => {
          draggedRef.current = false;
        }, 0);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onClick={(e) => {
        if (draggedRef.current) return;
        // Ignore clicks on nested interactive elements (card menu, etc.)
        const target = e.target as HTMLElement;
        if (target.closest("button")) return;
        onOpen?.();
      }}
      className="group relative cursor-pointer rounded-[5px] border border-border-1 bg-surface-1 p-2.5 text-xs leading-[1.4] hover:border-border-2 hover:bg-white/[0.03] active:cursor-grabbing"
    >
      <div className="mb-1.5 pr-5 text-text-1">{task.title}</div>
      <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-text-disabled">
        <span>{id}</span>
        {tag ? (
          <span
            className={`rounded-[8px] px-1.5 py-px text-[9px] tracking-[0.04em] ${TAG_CHIP[tag]}`}
          >
            {tag}
          </span>
        ) : null}
        {milestoneName ? (
          <span
            title={`Milestone: ${milestoneName}`}
            className="rounded-[8px] bg-accent-warm-soft px-1.5 py-px text-[9px] tracking-[0.04em] text-accent-warm"
          >
            {milestoneName}
          </span>
        ) : null}
        {task.assignee ? (
          <span className="ml-auto flex">
            <MiniAvatar name={task.assignee.name ?? task.assignee.email} />
          </span>
        ) : null}
      </div>
      <CardMenu task={task} onChanged={onChanged} />
    </div>
  );
}

function CardMenu({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const archive = useMutation({
    mutationFn: () => api.moveTask(task.id, { status: "archived" }),
    onSettled: () => {
      setOpen(false);
      onChanged();
    },
  });
  const restore = useMutation({
    mutationFn: () => api.moveTask(task.id, { status: "backlog" }),
    onSettled: () => {
      setOpen(false);
      onChanged();
    },
  });
  const del = useMutation({
    mutationFn: () => api.deleteTask(task.id),
    onSettled: () => {
      setOpen(false);
      onChanged();
    },
  });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isArchived = task.status === "archived";

  return (
    <div ref={wrapRef} className="absolute right-1 top-1">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="Card actions"
        className={`grid h-5 w-5 place-items-center rounded text-text-disabled transition ${
          open
            ? "bg-white/[0.06] text-text-1 opacity-100"
            : "opacity-0 hover:bg-white/[0.06] hover:text-text-1 group-hover:opacity-100 focus:opacity-100"
        }`}
      >
        ⋯
      </button>
      {open ? (
        <div className="absolute right-0 top-6 z-10 w-36 overflow-hidden rounded-md border border-border-1 bg-surface-1 py-1 shadow-lg">
          {isArchived ? (
            <MenuItem onClick={() => restore.mutate()}>
              Restore to Backlog
            </MenuItem>
          ) : (
            <MenuItem onClick={() => archive.mutate()}>Archive</MenuItem>
          )}
          <MenuItem
            danger
            onClick={() => {
              if (confirm(`Delete card “${task.title}”? This can't be undone.`))
                del.mutate();
            }}
          >
            Delete
          </MenuItem>
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`block w-full px-3 py-1.5 text-left text-[11px] hover:bg-white/[0.05] ${
        danger ? "text-destructive" : "text-text-2"
      }`}
    >
      {children}
    </button>
  );
}

function MiniAvatar({ name }: { name: string }) {
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
      className="grid h-4 w-4 place-items-center rounded-full border-[1.5px] border-surface-0 bg-gradient-to-br from-[#3a2a1a] to-accent-warm text-[8px] font-semibold text-[#1a1000]"
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
        className="cursor-pointer px-2.5 py-1.5 text-left text-[11px] text-text-disabled hover:text-text-3"
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
        className="w-full rounded border border-dashed border-border-1 bg-transparent px-2 py-1.5 text-xs text-text-1 outline-none focus:border-text-5"
      />
    </form>
  );
}
