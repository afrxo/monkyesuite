// Card detail modal (specs/05 card modal). Single-column body with a compact
// metadata strip, interleaved comments+activity feed, and modal-scoped
// keyboard shortcuts. Every field is inline-editable and autosaves; opens on
// `?card=<shortId>`.

import type {
  LinkedNote,
  Milestone,
  ProjectTag,
  Task,
  TaskActivityEvent,
  TaskAttachment,
  TaskChecklistItem,
  TaskComment,
  TaskDetail,
  TaskStatus,
} from "@monkyesuite/shared";
import { TASK_STATUSES } from "@monkyesuite/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { marked } from "marked";
import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "../components/Icon";
import { copyLink } from "../lib/clipboard";
import { api } from "../lib/api";
import { toastError } from "../components/Toast";
import { useSession } from "../lib/auth";
import { relTime } from "../lib/format";
import { DatePicker } from "./DatePicker";
import { AttachmentViewer } from "./AttachmentViewer";
import { shortTaskId } from "./short-id";
import { tagChipClass } from "./tag";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover";
import { Checkbox } from "../components/ui/checkbox";

marked.use({ gfm: true, breaks: true, async: false });

const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
  archived: "Archived",
};

// Statuses the picker offers — archived lives behind its own action.
const STATUS_CHOICES: TaskStatus[] = TASK_STATUSES.filter(
  (s) => s !== "archived",
);

type Props = {
  taskId: string;
  projectSlug: string;
  milestones: Milestone[];
  onClose: () => void;
};

export function CardModal({ taskId, projectSlug, milestones, onClose }: Props) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ["card-detail", taskId],
    queryFn: () => api.cardDetail(taskId),
  });
  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["card-detail", taskId] });
  }, [qc, taskId]);
  const invalidateBoard = useCallback(
    (projectId: string) => {
      qc.invalidateQueries({ queryKey: ["board", projectId] });
    },
    [qc],
  );

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [archiveConfirming, setArchiveConfirming] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const archiveResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shortId = useMemo(
    () => shortTaskId(projectSlug, taskId),
    [projectSlug, taskId],
  );

  const task = detail.data?.task ?? null;
  const projectId = task?.projectId ?? null;

  const archive = useMutation({
    mutationFn: () => api.moveTask(taskId, { status: "archived" }),
    onSuccess: () => {
      if (projectId) invalidateBoard(projectId);
      invalidate();
      onClose();
    },
    onError: (err) => toastError(err, "Failed to archive card."),
  });

  const del = useMutation({
    mutationFn: () => api.deleteTask(taskId),
    onSuccess: () => {
      if (projectId) invalidateBoard(projectId);
      qc.removeQueries({ queryKey: ["card-detail", taskId] });
      onClose();
    },
    onError: (err) => toastError(err, "Failed to delete card."),
  });

  const armArchive = useCallback(() => {
    if (archiveConfirming) {
      if (archiveResetTimer.current) clearTimeout(archiveResetTimer.current);
      archiveResetTimer.current = null;
      archive.mutate();
      return;
    }
    setArchiveConfirming(true);
    if (archiveResetTimer.current) clearTimeout(archiveResetTimer.current);
    archiveResetTimer.current = setTimeout(
      () => setArchiveConfirming(false),
      3000,
    );
  }, [archive, archiveConfirming]);

  useEffect(
    () => () => {
      if (archiveResetTimer.current) clearTimeout(archiveResetTimer.current);
    },
    [],
  );

  const focusComposer = useCallback(() => {
    const el = composerRef.current;
    if (!el) return;
    el.focus();
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  // Modal-scoped shortcuts. Typing inputs suppress everything except esc/⌘↵.
  useEffect(() => {
    if (viewerIndex !== null) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      const meta = e.metaKey || e.ctrlKey;
      if (e.key === "Escape") return; // Dialog handles it.
      if (meta && e.key === "Enter") return; // per-field handlers own submit.
      if (typing) return;
      if (deleteConfirming) return;
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        setStatusOpen(true);
      } else if (e.key === "x" || e.key === "X") {
        e.preventDefault();
        armArchive();
      } else if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        focusComposer();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [viewerIndex, deleteConfirming, armArchive, focusComposer]);

  return (
    <>
      <Dialog
        open
        onOpenChange={(o) => {
          if (!o && viewerIndex === null) onClose();
        }}
      >
        <DialogContent
          showCloseButton={false}
          onEscapeKeyDown={(e) => {
            if (viewerIndex !== null) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (viewerIndex !== null) e.preventDefault();
          }}
          className="flex w-full max-w-[720px] flex-col gap-0 overflow-hidden rounded-lg border border-border-2 bg-surface-0 p-0 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] sm:max-w-[720px]"
          style={{
            maxHeight: "88vh",
            animation: "cardModalPop 160ms cubic-bezier(0.2,0.9,0.3,1.2)",
          }}
        >
          <DialogTitle className="sr-only">Card details</DialogTitle>
          <Header
            shortId={shortId}
            task={task}
            onClose={onClose}
            statusOpen={statusOpen}
            onStatusOpenChange={setStatusOpen}
            onStatusChange={(s) => {
              if (!task || s === task.status) return;
              api
                .moveTask(taskId, { status: s })
                .then(() => {
                  invalidate();
                  if (projectId) invalidateBoard(projectId);
                })
                .catch((err) => toastError(err, "Failed to change status."));
            }}
            archiveConfirming={archiveConfirming}
            onArchive={armArchive}
            archivePending={archive.isPending}
            onDelete={() => setDeleteConfirming(true)}
          />

          <div className="ws-scroll flex-1 overflow-y-auto">
            {detail.data && task ? (
              <>
                <MetaStrip
                  detail={detail.data}
                  milestones={milestones}
                  invalidate={invalidate}
                />
                <div className="mx-auto max-w-[672px] px-8 pb-10 pt-3">
                  <TitleField task={task} onSaved={invalidate} />
                  <DescriptionField task={task} onSaved={invalidate} />
                  <ChecklistSection
                    taskId={taskId}
                    items={detail.data.checklistItems}
                    onChanged={invalidate}
                  />
                  <AttachmentsSection
                    taskId={taskId}
                    attachments={detail.data.attachments}
                    onOpenViewer={setViewerIndex}
                    onChanged={invalidate}
                  />
                  <ActivityFeed
                    taskId={taskId}
                    comments={detail.data.comments}
                    activity={detail.data.activity}
                    onChanged={invalidate}
                    composerRef={composerRef}
                  />
                </div>
              </>
            ) : (
              <p className="px-8 py-6 text-xs text-text-disabled">Loading…</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {viewerIndex !== null && detail.data ? (
        <AttachmentViewer
          attachments={detail.data.attachments}
          index={viewerIndex}
          onIndex={setViewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}

      <Dialog
        open={deleteConfirming}
        onOpenChange={(o) => {
          if (!o) setDeleteConfirming(false);
        }}
      >
        <DialogContent className="max-w-sm sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete card?</DialogTitle>
          </DialogHeader>
          <p className="text-[12px] text-text-3">
            This deletes the card and everything on it. Cannot be undone.
          </p>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setDeleteConfirming(false)}
              className="rounded-[3px] px-2.5 py-[3px] text-[11px] font-medium text-text-3 hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => del.mutate()}
              disabled={del.isPending}
              className="rounded-[3px] bg-destructive px-2.5 py-[3px] text-[11px] font-medium text-white disabled:opacity-60"
            >
              {del.isPending ? "Deleting…" : "Delete"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ---------------------------------- header --------------------------------- */

function Header({
  shortId,
  task,
  onClose,
  statusOpen,
  onStatusOpenChange,
  onStatusChange,
  archiveConfirming,
  onArchive,
  archivePending,
  onDelete,
}: {
  shortId: string;
  task: Task | null;
  onClose: () => void;
  statusOpen: boolean;
  onStatusOpenChange: (o: boolean) => void;
  onStatusChange: (s: TaskStatus) => void;
  archiveConfirming: boolean;
  onArchive: () => void;
  archivePending: boolean;
  onDelete: () => void;
}) {
  const copyCardLink = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("card", shortId);
    copyLink(url.toString());
  };
  const status = task?.status ?? "todo";
  return (
    <div className="sticky top-0 z-10 border-b border-border-1 bg-surface-0/95 px-4 py-2 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={copyCardLink}
          title="Copy link to card"
          className="rounded-[3px] px-1.5 py-0.5 font-mono text-[11px] text-text-disabled hover:bg-surface-hover hover:text-text-3"
        >
          {shortId}
        </button>
        <span className="text-[11px] text-text-disabled">·</span>
        <Popover open={statusOpen} onOpenChange={onStatusOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-[3px] bg-surface-hover px-2 py-[3px] font-mono text-[11px] text-text-1 hover:bg-white/[0.08]"
              title="Change status (s)"
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: statusDot(status) }}
              />
              {STATUS_LABEL[status]}
              <Icon
                name="chevron-down"
                size={9}
                className="text-text-disabled"
              />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={6}
            className="w-44 overflow-hidden rounded-md border border-border-1 bg-surface-1 p-0 py-1 text-text-1 shadow-xl"
          >
            {STATUS_CHOICES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  onStatusChange(s);
                  onStatusOpenChange(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-white/[0.05] ${
                  status === s ? "text-text-1" : "text-text-3"
                }`}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: statusDot(s) }}
                />
                {STATUS_LABEL[s]}
                {status === s ? (
                  <span className="ml-auto">
                    <Icon
                      name="check"
                      size={10}
                      className="text-text-disabled"
                    />
                  </span>
                ) : null}
              </button>
            ))}
          </PopoverContent>
        </Popover>
        <div className="flex-1" />
        <span className="hidden font-mono text-[10px] text-text-disabled lg:inline">
          s status · x archive · c comment
        </span>
        <button
          type="button"
          onClick={onArchive}
          disabled={archivePending}
          title={archiveConfirming ? "Click again to confirm" : "Archive (x)"}
          aria-label="Archive card"
          className={`flex h-6 items-center gap-1 rounded-[3px] px-1.5 text-[11px] transition-colors ${
            archiveConfirming
              ? "bg-amber-500/15 text-amber-200"
              : "text-text-disabled hover:bg-surface-hover hover:text-text-1"
          }`}
        >
          <Icon name="archive" size={13} />
          {archiveConfirming ? (
            <span className="font-mono text-[10px]">confirm?</span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={onDelete}
          title="Delete"
          aria-label="Delete card"
          className="grid h-6 w-6 place-items-center rounded-[3px] text-text-disabled transition-colors hover:bg-destructive/15 hover:text-rose-300"
        >
          <Icon name="trash" size={13} />
        </button>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close card"
          className="flex items-center gap-1 rounded-[3px] px-1.5 py-1 text-text-disabled hover:bg-surface-hover hover:text-text-1"
        >
          <Icon name="x" size={12} />
          <span className="rounded-[3px] border border-border-1 px-1 py-px font-mono text-[10px] text-text-disabled">
            Esc
          </span>
        </button>
      </div>
    </div>
  );
}

function statusDot(s: TaskStatus): string {
  switch (s) {
    case "done":
      return "#4ade80";
    case "review":
      return "#a78bfa";
    case "in_progress":
      return "var(--accent-warm)";
    case "todo":
      return "#60a5fa";
    case "archived":
      return "var(--text-disabled)";
    default:
      return "var(--text-disabled)";
  }
}

/* -------------------------------- meta strip ------------------------------- */

function MetaStrip({
  detail,
  milestones,
  invalidate,
}: {
  detail: TaskDetail;
  milestones: Milestone[];
  invalidate: () => void;
}) {
  const t = detail.task;
  const setMilestone = useMutation({
    mutationFn: (id: string | null) =>
      api.patchTask(t.id, { milestoneId: id }),
    onSuccess: invalidate,
    onError: (err) => toastError(err),
  });
  const setDue = useMutation({
    mutationFn: (iso: string | null) => api.patchTask(t.id, { dueAt: iso }),
    onSuccess: invalidate,
    onError: (err) => toastError(err),
  });
  const setAssignees = useMutation({
    mutationFn: (uids: string[]) =>
      api.patchTask(t.id, { assigneeIds: uids }),
    onSuccess: invalidate,
    onError: (err) => toastError(err),
  });

  const linkedCount = detail.linkedNotes.length;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-1 bg-surface-0 px-8 py-2 text-[12px]">
      <MilestonePicker
        milestones={milestones}
        value={t.milestoneId ?? null}
        onChange={(id) => setMilestone.mutate(id)}
        pending={setMilestone.isPending}
      />
      <span className="text-text-disabled">·</span>
      <AssigneePicker
        projectId={t.projectId}
        value={(t.assignees ?? []).map((a) => a.id)}
        current={t.assignees ?? []}
        onChange={(uids) => setAssignees.mutate(uids)}
        pending={setAssignees.isPending}
      />
      <span className="text-text-disabled">·</span>
      <TagsPicker task={t} onChanged={invalidate} />
      <span className="text-text-disabled">·</span>
      <DatePicker value={t.dueAt} onChange={(v) => setDue.mutate(v)} />
      {linkedCount > 0 ? (
        <>
          <span className="text-text-disabled">·</span>
          <LinkedNotesChip notes={detail.linkedNotes} />
        </>
      ) : null}
    </div>
  );
}


function LinkedNotesChip({ notes }: { notes: LinkedNote[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded bg-surface-hover px-1.5 py-0.5 text-[11px] text-text-3 hover:bg-white/[0.08]"
          title={`${notes.length} linked note${notes.length === 1 ? "" : "s"}`}
        >
          <Icon name="link" size={11} />
          <span className="font-mono">{notes.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-72 overflow-hidden rounded-md border border-border-1 bg-surface-1 p-0 py-1 text-text-1 shadow-xl"
      >
        {notes.map((n) => (
          <LinkedNoteRow key={n.id} note={n} />
        ))}
      </PopoverContent>
    </Popover>
  );
}

function LinkedNoteRow({ note }: { note: LinkedNote }) {
  return (
    <div className="px-3 py-2 hover:bg-white/[0.05]">
      {note.title ? (
        <div className="mb-0.5 text-[11px] font-medium text-text-1">
          {note.title}
        </div>
      ) : null}
      {note.body ? (
        <div className="line-clamp-2 text-[11px] leading-[1.4] text-text-3">
          {note.body}
        </div>
      ) : null}
      <div className="mt-1 font-mono text-[9px] text-text-disabled">
        {relTime(note.updatedAt)}
      </div>
    </div>
  );
}

/* --------------------------------- title ---------------------------------- */

function TitleField({
  task,
  onSaved,
}: {
  task: Task;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(task.title);
  useEffect(() => setValue(task.title), [task.title]);
  const save = useMutation({
    mutationFn: (v: string) => api.patchTask(task.id, { title: v }),
    onSuccess: onSaved,
    onError: (err) => toastError(err),
  });
  const commit = () => {
    const v = value.trim();
    if (v && v !== task.title) save.mutate(v);
    else setValue(task.title);
  };
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="mb-4 -mx-1.5 w-[calc(100%+12px)] rounded bg-transparent px-1.5 py-1 text-[24px] font-semibold leading-[1.25] tracking-[-0.015em] text-text-1 outline-none hover:bg-surface-hover focus:bg-surface-hover focus:shadow-[inset_0_0_0_1px_var(--border-2)]"
    />
  );
}

/* ------------------------------- description ------------------------------ */

type SlashItem = {
  label: string;
  hint: string;
  insert: string;
  caretOffset?: number;
  kw: string[];
};

const SLASH_ITEMS: SlashItem[] = [
  { label: "Heading 1", hint: "h1", insert: "# ", kw: ["h1", "heading"] },
  { label: "Heading 2", hint: "h2", insert: "## ", kw: ["h2", "heading"] },
  { label: "Heading 3", hint: "h3", insert: "### ", kw: ["h3", "heading"] },
  {
    label: "Bulleted list",
    hint: "ul",
    insert: "- ",
    kw: ["bullet", "list", "ul"],
  },
  {
    label: "Numbered list",
    hint: "ol",
    insert: "1. ",
    kw: ["numbered", "list", "ol"],
  },
  {
    label: "Todo",
    hint: "todo",
    insert: "- [ ] ",
    kw: ["todo", "task", "check"],
  },
  { label: "Quote", hint: "quote", insert: "> ", kw: ["quote", "blockquote"] },
  {
    label: "Code block",
    hint: "code",
    insert: "```\n\n```\n",
    caretOffset: -5,
    kw: ["code", "snippet"],
  },
  { label: "Divider", hint: "hr", insert: "\n---\n", kw: ["divider", "hr"] },
  {
    label: "Link",
    hint: "link",
    insert: "[](url)",
    caretOffset: -6,
    kw: ["link", "url"],
  },
];

type SlashState = { start: number; query: string };

function detectSlash(value: string, caret: number): SlashState | null {
  const before = value.slice(0, caret);
  const nlIdx = before.lastIndexOf("\n");
  const line = before.slice(nlIdx + 1);
  const m = /(?:^|(?<=\s))\/([\w-]{0,20})$/.exec(line);
  if (!m) return null;
  return {
    start: nlIdx + 1 + (m.index ?? 0),
    query: m[1] ?? "",
  };
}

function DescriptionField({
  task,
  onSaved,
}: {
  task: Task;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(task.body ?? "");
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [slashIdx, setSlashIdx] = useState(0);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => setValue(task.body ?? ""), [task.body]);

  const save = useMutation({
    mutationFn: (v: string) => api.patchTask(task.id, { body: v || null }),
    onSuccess: () => {
      onSaved();
      setSavedFlash(true);
      setEditing(false);
    },
    onError: (err) => toastError(err),
  });

  useEffect(() => {
    if (!savedFlash) return;
    const t = setTimeout(() => setSavedFlash(false), 1500);
    return () => clearTimeout(t);
  }, [savedFlash]);

  const dirty = value !== (task.body ?? "");

  const doSave = () => {
    if (!dirty) {
      setEditing(false);
      return;
    }
    save.mutate(value);
  };
  const doCancel = () => {
    setValue(task.body ?? "");
    setSlash(null);
    setEditing(false);
  };

  const rendered = useMemo(() => {
    const src = task.body?.trim() ? task.body : "*Add a description…*";
    return marked.parse(src) as string;
  }, [task.body]);

  const filteredSlash = useMemo(() => {
    if (!slash) return [];
    const q = slash.query.toLowerCase();
    if (!q) return SLASH_ITEMS;
    return SLASH_ITEMS.filter(
      (it) =>
        it.label.toLowerCase().includes(q) ||
        it.hint.includes(q) ||
        it.kw.some((k) => k.startsWith(q)),
    );
  }, [slash]);

  useEffect(() => {
    setSlashIdx(0);
  }, [slash]);

  const runDetect = () => {
    const ta = taRef.current;
    if (!ta) return;
    setSlash(detectSlash(ta.value, ta.selectionStart));
  };

  const applyItem = (it: SlashItem) => {
    const ta = taRef.current;
    if (!ta || !slash) return;
    const caret = ta.selectionStart;
    const next =
      value.slice(0, slash.start) + it.insert + value.slice(caret);
    const newCaret = slash.start + it.insert.length + (it.caretOffset ?? 0);
    setValue(next);
    setSlash(null);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newCaret, newCaret);
    });
  };

  return (
    <section className="mb-8">
      {editing ? (
        <div className="relative">
          <textarea
            ref={taRef}
            // biome-ignore lint/a11y/noAutofocus: focus what user opened
            autoFocus
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              queueMicrotask(runDetect);
            }}
            onSelect={runDetect}
            onKeyDown={(e) => {
              if (slash && filteredSlash.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSlashIdx((i) => (i + 1) % filteredSlash.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSlashIdx(
                    (i) => (i - 1 + filteredSlash.length) % filteredSlash.length,
                  );
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  const pick = filteredSlash[slashIdx] ?? filteredSlash[0];
                  if (pick) applyItem(pick);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setSlash(null);
                  return;
                }
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                doSave();
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                doCancel();
              }
            }}
            className="min-h-40 w-full resize-y bg-transparent text-[14px] leading-[1.7] text-text-2 outline-none placeholder:text-text-disabled"
            placeholder="Add a description…  press / for commands"
          />
          <div className="mt-2 flex items-center gap-2">
            <span className="flex-1 font-mono text-[10px] text-text-disabled">
              {save.isPending ? (
                <span className="text-text-3">saving…</span>
              ) : dirty ? (
                <span className="text-amber-300/80">unsaved changes</span>
              ) : savedFlash ? (
                <span className="text-emerald-400/80">saved</span>
              ) : (
                <>
                  <Kbd>⌘↵</Kbd> save · <Kbd>esc</Kbd> cancel
                </>
              )}
            </span>
            <button
              type="button"
              onClick={doCancel}
              disabled={save.isPending}
              className="rounded-[3px] px-2.5 py-[3px] text-[11px] font-medium text-text-3 hover:bg-surface-hover disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={doSave}
              disabled={save.isPending || !dirty}
              className="rounded-[3px] bg-text-1 px-2.5 py-[3px] text-[11px] font-medium text-surface-0 disabled:opacity-50"
            >
              {save.isPending ? "Saving…" : "Save"}
            </button>
          </div>
          {slash && filteredSlash.length > 0 ? (
            <div className="absolute left-0 top-full z-20 mt-1 w-60 overflow-hidden rounded-md border border-border-1 bg-surface-1 py-1 text-text-1 shadow-xl">
              {filteredSlash.map((it, i) => (
                <button
                  key={it.hint}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyItem(it);
                  }}
                  onMouseEnter={() => setSlashIdx(i)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors ${
                    i === slashIdx
                      ? "bg-white/[0.06] text-text-1"
                      : "text-text-3 hover:bg-white/[0.04]"
                  }`}
                >
                  <span className="flex-1">{it.label}</span>
                  <span className="font-mono text-[10px] text-text-disabled">
                    /{it.hint}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        // biome-ignore lint/a11y/noStaticElementInteractions: markdown block, click to edit
        <div
          onClick={() => setEditing(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setEditing(true);
          }}
          role="button"
          tabIndex={0}
          className="card-desc min-h-12 cursor-text text-[14px] leading-[1.7] text-text-2"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: same-origin markdown, XSS via marked hardened elsewhere in project
          dangerouslySetInnerHTML={{ __html: rendered }}
        />
      )}
    </section>
  );
}

/* -------------------------------- checklist -------------------------------- */

function ChecklistSection({
  taskId,
  items,
  onChanged,
}: {
  taskId: string;
  items: TaskChecklistItem[];
  onChanged: () => void;
}) {
  const done = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const [adding, setAdding] = useState(false);

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
        <span>Checklist</span>
        <span className="font-mono normal-case tracking-normal">
          {done}/{total}
        </span>
        <div className="ml-2 h-[3px] flex-1 overflow-hidden rounded-[1px] bg-border-1">
          <div
            className="h-full transition-[width]"
            style={{ width: `${pct}%`, background: "var(--accent-warm)" }}
          />
        </div>
      </div>
      {items.map((item) => (
        <ChecklistRow key={item.id} item={item} onChanged={onChanged} />
      ))}
      {adding || items.length === 0 ? (
        <AddChecklistRow
          taskId={taskId}
          onDone={() => {
            setAdding(false);
            onChanged();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="-mx-2 mt-1 flex w-[calc(100%+16px)] cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-[12px] text-text-disabled hover:text-text-3"
        >
          <span className="grid h-3.5 w-3.5 place-items-center rounded-[3px] border border-dashed border-border-2 text-[10px]">
            +
          </span>
          add item
        </button>
      )}
    </section>
  );
}

function ChecklistRow({
  item,
  onChanged,
}: {
  item: TaskChecklistItem;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(item.text);
  useEffect(() => setValue(item.text), [item.text]);
  const toggle = useMutation({
    mutationFn: () => api.patchChecklistItem(item.id, { done: !item.done }),
    onSuccess: onChanged,
    onError: (err) => toastError(err),
  });
  const rename = useMutation({
    mutationFn: (v: string) => api.patchChecklistItem(item.id, { text: v }),
    onSuccess: onChanged,
    onError: (err) => toastError(err),
  });
  const del = useMutation({
    mutationFn: () => api.deleteChecklistItem(item.id),
    onSuccess: onChanged,
    onError: (err) => toastError(err),
  });
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: row layout with two actionable areas (checkbox + text)
    <div
      className="group -mx-2 flex items-center gap-2.5 rounded px-2 py-1.5 hover:bg-surface-hover"
      onDoubleClick={() => setEditing(true)}
    >
      <Checkbox
        checked={item.done}
        onCheckedChange={() => toggle.mutate()}
        aria-label={item.done ? "Mark incomplete" : "Mark complete"}
        className="size-3.5 h-3.5 w-3.5 flex-shrink-0 rounded-[3px] border border-border-2 shadow-none transition-none data-[state=checked]:border-transparent data-[state=checked]:bg-transparent data-[state=checked]:text-[#1a1000] [&_svg]:size-2.5"
        style={{
          background: item.done ? "var(--accent-warm)" : "transparent",
          borderColor: item.done ? "var(--accent-warm)" : "var(--border-2)",
        }}
      />
      {editing ? (
        <input
          // biome-ignore lint/a11y/noAutofocus: focus what user opened
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            const v = value.trim();
            if (v && v !== item.text) rename.mutate(v);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === "Escape") {
              setValue(item.text);
              setEditing(false);
            }
          }}
          className="flex-1 bg-transparent text-[12px] text-text-1 outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={`flex-1 text-left text-[12px] ${
            item.done ? "text-text-disabled line-through" : "text-text-1"
          }`}
        >
          {item.text}
        </button>
      )}
      <button
        type="button"
        onClick={() => del.mutate()}
        aria-label="Delete item"
        className="grid h-4 w-4 place-items-center rounded opacity-0 transition group-hover:opacity-100 text-text-disabled hover:text-destructive"
      >
        <Icon name="x" size={10} />
      </button>
    </div>
  );
}

function AddChecklistRow({
  taskId,
  onDone,
  onCancel,
}: {
  taskId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const create = useMutation({
    mutationFn: (text: string) => api.createChecklistItem(taskId, { text }),
    onSuccess: () => {
      setValue("");
      onDone();
    },
    onError: (err) => toastError(err),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim();
        if (v) create.mutate(v);
      }}
      className="-mx-2 mt-1 px-2"
    >
      <input
        // biome-ignore lint/a11y/noAutofocus: focus what user opened
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (!value.trim()) onCancel();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setValue("");
            onCancel();
          }
        }}
        placeholder="Add item"
        className="w-full rounded border border-dashed border-border-2 bg-transparent px-2 py-1 text-[12px] text-text-1 outline-none focus:border-text-5"
      />
    </form>
  );
}

/* ------------------------------- attachments ------------------------------- */

function AttachmentsSection({
  taskId,
  attachments,
  onOpenViewer,
  onChanged,
}: {
  taskId: string;
  attachments: TaskAttachment[];
  onOpenViewer: (i: number) => void;
  onChanged: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: async (file: File): Promise<void> => {
      const ticket = await api.requestAttachmentUpload(taskId, {
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });
      const put = await fetch(ticket.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!put.ok) throw new Error(`Upload failed: ${put.status}`);
      await api.confirmAttachment(taskId, {
        attachmentId: ticket.attachmentId,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });
    },
    onSuccess: onChanged,
    onError: (err) =>
      toastError(err, "Upload failed. Check your connection and try again."),
  });

  const setCover = useMutation({
    mutationFn: (id: string | null) =>
      api.patchTask(taskId, { coverAttachmentId: id }),
    onSuccess: onChanged,
    onError: (err) => toastError(err),
  });

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload.mutate(file);
    e.target.value = "";
  };

  if (attachments.length === 0 && !upload.isPending) {
    return (
      <section className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
          <span>Attachments</span>
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="grid h-20 w-20 cursor-pointer place-items-center rounded-[5px] border border-dashed border-border-2 text-[10px] text-text-disabled hover:border-[#3a3a3a] hover:text-text-3"
        >
          + drop
        </button>
        <input ref={fileRef} type="file" className="hidden" onChange={onPick} />
      </section>
    );
  }

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
        <span>Attachments</span>
        <span className="font-mono normal-case tracking-normal">
          {attachments.length}
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,80px)] gap-2">
        {attachments.map((a, i) => (
          <div key={a.id} className="group/att relative h-20 w-20">
            <button
              type="button"
              onClick={() => onOpenViewer(i)}
              title={a.fileName}
              className="grid h-full w-full place-items-center overflow-hidden rounded-[5px] border border-border-1 bg-surface-1 hover:border-border-2 hover:bg-white/[0.03]"
            >
              <AttachmentTile attachment={a} />
            </button>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 truncate rounded-b-[5px] bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-3 text-[9px] text-white/90">
              {a.fileName}
            </div>
            {a.mimeType.startsWith("image/") ? (
              <button
                type="button"
                onClick={() => setCover.mutate(a.id)}
                title="Set as card cover"
                className="absolute right-1 top-1 hidden rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white/80 hover:bg-black/80 group-hover/att:flex"
              >
                cover
              </button>
            ) : null}
          </div>
        ))}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="grid h-20 w-20 cursor-pointer place-items-center rounded-[5px] border border-dashed border-border-2 text-[10px] text-text-disabled hover:border-[#3a3a3a] hover:text-text-3"
          disabled={upload.isPending}
        >
          {upload.isPending ? "…" : "+ drop"}
        </button>
        <input ref={fileRef} type="file" className="hidden" onChange={onPick} />
      </div>
    </section>
  );
}

function AttachmentTile({ attachment }: { attachment: TaskAttachment }) {
  const badge = mimeBadge(attachment.mimeType, attachment.fileName);
  if (attachment.thumbnailUrl) {
    return (
      <div className="relative h-full w-full">
        <img
          src={attachment.thumbnailUrl}
          alt=""
          className="h-full w-full object-cover"
        />
        {attachment.mimeType.startsWith("video/") ? (
          <span className="absolute inset-0 grid place-items-center text-[14px] text-white/90">
            ▶
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <span className="font-mono text-[11px] font-semibold text-text-3">
      {badge}
    </span>
  );
}

/* ---------------------------- merged feed --------------------------------- */

type FeedItem =
  | { kind: "comment"; at: string; data: TaskComment }
  | { kind: "event"; at: string; data: TaskActivityEvent };

function ActivityFeed({
  taskId,
  comments,
  activity,
  onChanged,
  composerRef,
}: {
  taskId: string;
  comments: TaskComment[];
  activity: TaskActivityEvent[];
  onChanged: () => void;
  composerRef: React.MutableRefObject<HTMLTextAreaElement | null>;
}) {
  const items = useMemo<FeedItem[]>(() => {
    const merged: FeedItem[] = [
      ...comments.map<FeedItem>((c) => ({
        kind: "comment",
        at: c.createdAt,
        data: c,
      })),
      // "comment" events duplicate the comment itself; drop them so we don't
      // render "commented" muted line next to the comment block.
      ...activity
        .filter((e) => e.kind !== "comment")
        .map<FeedItem>((e) => ({ kind: "event", at: e.createdAt, data: e })),
    ];
    merged.sort((a, b) => (a.at < b.at ? 1 : -1));
    return merged;
  }, [comments, activity]);

  return (
    <section>
      <Composer taskId={taskId} onSent={onChanged} composerRef={composerRef} />
      <div className="mt-4 flex flex-col">
        {items.map((it) =>
          it.kind === "comment" ? (
            <CommentRow
              key={`c-${it.data.id}`}
              comment={it.data}
              onChanged={onChanged}
            />
          ) : (
            <EventRow key={`e-${it.data.id}`} event={it.data} />
          ),
        )}
      </div>
    </section>
  );
}

function Composer({
  taskId,
  onSent,
  composerRef,
}: {
  taskId: string;
  onSent: () => void;
  composerRef: React.MutableRefObject<HTMLTextAreaElement | null>;
}) {
  const [body, setBody] = useState("");
  const send = useMutation({
    mutationFn: (b: string) => api.createComment(taskId, { body: b }),
    onSuccess: () => {
      setBody("");
      onSent();
    },
    onError: (err) => toastError(err),
  });
  const submit = () => {
    const v = body.trim();
    if (v) send.mutate(v);
  };
  return (
    <div className="rounded-[5px] border border-border-1 bg-surface-1 px-2.5 py-2">
      <textarea
        ref={composerRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Write a comment…"
        className="min-h-8 w-full resize-none bg-transparent text-[12px] text-text-1 outline-none placeholder:text-text-disabled"
      />
      <div className="mt-1.5 flex items-center gap-2 border-t border-border-1 pt-1.5">
        <span className="flex-1 font-mono text-[10px] text-text-disabled">
          markdown ok · <Kbd>⌘↵</Kbd> to send
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={send.isPending || !body.trim()}
          className="rounded-[3px] bg-text-1 px-2.5 py-[3px] text-[11px] font-medium text-surface-0 disabled:opacity-50"
        >
          {send.isPending ? "Sending…" : "Comment"}
        </button>
      </div>
    </div>
  );
}

function EventRow({ event }: { event: TaskActivityEvent }) {
  return (
    <div className="flex gap-2 py-1 text-[11px] text-text-3">
      <span className="flex-shrink-0 pt-px font-mono text-[10px] text-text-disabled">
        {relTime(event.createdAt)}
      </span>
      <span className="min-w-0">
        <span className="text-text-2">
          {event.actor?.name ?? event.actor?.email ?? "someone"}
        </span>{" "}
        {activityText(event.kind, event.payload)}
      </span>
    </div>
  );
}

function CommentRow({
  comment,
  onChanged,
}: {
  comment: TaskComment;
  onChanged: () => void;
}) {
  const initials = initialsOf(
    comment.author?.name ?? comment.author?.email ?? "?",
  );
  const html = useMemo(
    () => marked.parse(comment.body) as string,
    [comment.body],
  );
  const { user } = useSession();
  const canDelete = !!user && user.id === comment.authorId;
  const [confirming, setConfirming] = useState(false);
  const del = useMutation({
    mutationFn: () => api.deleteComment(comment.id),
    onSuccess: onChanged,
    onError: (err) => toastError(err),
  });
  return (
    <div className="group flex gap-2.5 py-2.5">
      <span className="grid h-[22px] w-[22px] flex-shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#3a2a1a] to-accent-warm text-[10px] font-semibold text-[#1a1000]">
        {initials}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-baseline gap-2">
          <span className="text-[12px] font-medium text-text-1">
            {comment.author?.name ?? comment.author?.email ?? "unknown"}
          </span>
          <span className="font-mono text-[10px] text-text-disabled">
            {relTime(comment.createdAt)}
          </span>
          {canDelete ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={del.isPending}
              className="ml-auto grid h-5 w-5 place-items-center rounded text-text-disabled opacity-0 transition-colors group-hover:opacity-100 hover:bg-destructive/15 hover:text-rose-300"
              title="Delete comment"
            >
              <Icon name="trash" size={11} />
            </button>
          ) : null}
        </div>
        <div
          className="text-[12px] leading-[1.55] text-text-3"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: same-origin markdown
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="max-w-sm sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete comment?</DialogTitle>
          </DialogHeader>
          <p className="text-[12px] text-text-3">
            This action cannot be undone.
          </p>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-[3px] px-2.5 py-[3px] text-[11px] font-medium text-text-3 hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                del.mutate();
                setConfirming(false);
              }}
              className="rounded-[3px] bg-destructive px-2.5 py-[3px] text-[11px] font-medium text-white"
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function activityText(
  kind: TaskDetail["activity"][number]["kind"],
  payload: Record<string, unknown>,
): string {
  switch (kind) {
    case "create":
      return "created card";
    case "status_change":
      return `moved to ${String(payload.to ?? "?")}`;
    case "title_change":
      return "renamed card";
    case "assignee_change": {
      const added = Array.isArray(payload.added) ? payload.added.length : 0;
      const removed = Array.isArray(payload.removed)
        ? payload.removed.length
        : 0;
      if (added && removed) return `updated assignees (+${added}, -${removed})`;
      if (added) return `added ${added} assignee${added === 1 ? "" : "s"}`;
      if (removed) return `removed ${removed} assignee${removed === 1 ? "" : "s"}`;
      return "changed assignees";
    }
    case "comment":
      return "commented";
    case "attachment":
      return `attached ${String(payload.fileName ?? "a file")}`;
    case "checklist_add":
      return `added item “${String(payload.text ?? "").slice(0, 40)}”`;
    case "checklist_complete":
      return `completed “${String(payload.text ?? "").slice(0, 40)}”`;
  }
}

/* --------------------------------- pickers -------------------------------- */

function MilestonePicker({
  milestones,
  value,
  onChange,
  pending,
}: {
  milestones: Milestone[];
  value: string | null;
  onChange: (id: string | null) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = milestones.find((m) => m.id === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={pending}
          title="Milestone"
          className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[12px] transition-colors hover:bg-surface-hover disabled:opacity-50 ${
            selected ? "text-text-1" : "text-text-3"
          }`}
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: selected ? "var(--accent-warm)" : "var(--text-disabled)" }}
          />
          {selected ? selected.name : "no milestone"}
          <Icon name="chevron-down" size={9} className="text-text-disabled" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-52 overflow-hidden rounded-md border border-border-1 bg-surface-1 p-0 py-1 text-text-1 shadow-xl"
      >
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-white/[0.05] ${
            value === null ? "text-text-1" : "text-text-3"
          }`}
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-transparent" />
          — none —
          {value === null ? (
            <span className="ml-auto">
              <Icon name="check" size={10} className="text-text-disabled" />
            </span>
          ) : null}
        </button>
        {milestones.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              onChange(m.id);
              setOpen(false);
            }}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-white/[0.05] ${
              value === m.id ? "text-text-1" : "text-text-3"
            }`}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-warm" />
            <span className="truncate">{m.name}</span>
            {value === m.id ? (
              <span className="ml-auto">
                <Icon name="check" size={10} className="text-text-disabled" />
              </span>
            ) : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function AssigneePicker({
  projectId,
  value,
  current,
  onChange,
  pending,
}: {
  projectId: string;
  value: string[];
  current: { id: string; name: string | null; email: string }[];
  onChange: (uids: string[]) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const members = useQuery({
    queryKey: ["members", projectId],
    queryFn: () => api.members(projectId),
    enabled: open,
  });

  const selected = new Set(value);
  const toggle = (uid: string) => {
    const next = new Set(selected);
    if (next.has(uid)) next.delete(uid);
    else next.add(uid);
    onChange([...next]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-1">
        {current.length > 0 ? (
          <div className="flex -space-x-1.5">
            {current.slice(0, 3).map((a) => (
              <span
                key={a.id}
                title={a.name ?? a.email}
                className="grid h-5 w-5 place-items-center rounded-full border border-surface-0 bg-gradient-to-br from-[#3a2a1a] to-accent-warm text-[9px] font-semibold text-[#1a1000]"
              >
                {initialsOf(a.name ?? a.email)}
              </span>
            ))}
            {current.length > 3 ? (
              <span className="grid h-5 min-w-5 place-items-center rounded-full border border-surface-0 bg-surface-hover px-1 text-[9px] font-medium text-text-3">
                +{current.length - 3}
              </span>
            ) : null}
          </div>
        ) : null}
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={pending}
            title="Assignees"
            className="rounded px-1.5 py-0.5 text-[11px] text-text-3 hover:bg-surface-hover disabled:opacity-50"
          >
            {current.length === 0 ? "+ assign" : "+"}
          </button>
        </PopoverTrigger>
      </div>

      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-56 overflow-hidden rounded-md border border-border-1 bg-surface-1 p-0 py-1 text-text-1 shadow-xl"
      >
        {members.isPending ? (
          <div className="px-3 py-2 text-[11px] text-text-disabled">
            Loading…
          </div>
        ) : (
          members.data?.map((m) => (
            <button
              key={m.userId}
              type="button"
              onClick={() => toggle(m.userId)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-white/[0.05] ${
                selected.has(m.userId) ? "text-text-1" : "text-text-3"
              }`}
            >
              <span className="truncate">{m.user.name ?? m.user.email}</span>
              {selected.has(m.userId) ? (
                <span className="ml-auto">
                  <Icon
                    name="check"
                    size={10}
                    className="text-text-disabled"
                  />
                </span>
              ) : null}
            </button>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}

/* --------------------------------- tags ---------------------------------- */

function TagsPicker({
  task,
  onChanged,
}: {
  task: Task;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<ProjectTag | null>(null);
  const vocab = useQuery({
    queryKey: ["project-tags", task.projectId],
    queryFn: () => api.projectTags(task.projectId),
  });

  const invalidateAll = () => {
    onChanged();
    qc.invalidateQueries({ queryKey: ["project-tags", task.projectId] });
    qc.invalidateQueries({ queryKey: ["board", task.projectId] });
  };

  const apply = useMutation({
    mutationFn: (tagId: string) => api.applyTaskTag(task.id, tagId),
    onSuccess: invalidateAll,
    onError: (err) => toastError(err),
  });
  const remove = useMutation({
    mutationFn: (tagId: string) => api.removeTaskTag(task.id, tagId),
    onSuccess: invalidateAll,
    onError: (err) => toastError(err),
  });
  const create = useMutation({
    mutationFn: (name: string) =>
      api.createProjectTag(task.projectId, { name }),
    onSuccess: async (tag) => {
      setQ("");
      apply.mutate(tag.id);
    },
    onError: (err) => toastError(err),
  });
  const rename = useMutation({
    mutationFn: (v: { id: string; name: string }) =>
      api.patchProjectTag(v.id, { name: v.name }),
    onSuccess: invalidateAll,
    onError: (err) => toastError(err),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.deleteProjectTag(id),
    onSuccess: invalidateAll,
    onError: (err) => toastError(err),
  });

  const applied = new Set((task.tags ?? []).map((t) => t.id));
  const query = q.trim();
  const matches = (vocab.data ?? []).filter((t) =>
    query ? t.name.toLowerCase().includes(query.toLowerCase()) : true,
  );
  const exact = matches.find(
    (t) => t.name.toLowerCase() === query.toLowerCase(),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex flex-wrap items-center gap-1">
        {(task.tags ?? []).map((tag) => (
          <span
            key={tag.id}
            className={`inline-flex items-center gap-1 rounded-[8px] px-1.5 py-px text-[10px] tracking-[0.04em] ${tagChipClass(tag)}`}
          >
            {tag.name}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove.mutate(tag.id);
              }}
              className="opacity-60 hover:opacity-100"
              aria-label={`Remove ${tag.name}`}
            >
              <Icon name="x" size={9} />
            </button>
          </span>
        ))}
        <PopoverTrigger asChild>
          <button
            type="button"
            title="Tags"
            className="rounded px-1.5 py-0.5 text-[11px] text-text-3 hover:bg-surface-hover"
          >
            {(task.tags ?? []).length === 0 ? "+ tag" : "+"}
          </button>
        </PopoverTrigger>
      </div>

      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-64 overflow-hidden rounded-md border border-border-1 bg-surface-1 p-0 text-text-1 shadow-xl"
      >
        <input
          // biome-ignore lint/a11y/noAutofocus: focus what user opened
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query && !exact) {
              e.preventDefault();
              create.mutate(query);
            }
          }}
          placeholder="Find or create…"
          className="w-full border-b border-border-1 bg-transparent px-3 py-2 text-[12px] text-text-1 outline-none placeholder:text-text-disabled"
        />
        <div className="max-h-64 overflow-y-auto py-1">
          {vocab.isPending ? (
            <div className="px-3 py-2 text-[11px] text-text-disabled">
              Loading…
            </div>
          ) : matches.length === 0 && !query ? (
            <div className="px-3 py-2 text-[11px] text-text-disabled">
              No tags yet. Type to create one.
            </div>
          ) : (
            matches.map((tag) => (
              <TagsRow
                key={tag.id}
                tag={tag}
                applied={applied.has(tag.id)}
                onToggle={() => {
                  if (applied.has(tag.id)) remove.mutate(tag.id);
                  else apply.mutate(tag.id);
                }}
                onRename={(name) => rename.mutate({ id: tag.id, name })}
                onDelete={() => setConfirmDelete(tag)}
              />
            ))
          )}
          {query && !exact ? (
            <button
              type="button"
              onClick={() => create.mutate(query)}
              className="flex w-full items-center gap-2 border-t border-border-1 px-3 py-2 text-left text-[12px] text-text-3 hover:bg-white/[0.05]"
            >
              <Icon name="plus" size={10} />
              Create “{query}”
            </button>
          ) : null}
        </div>
      </PopoverContent>

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmDelete(null);
        }}
      >
        <DialogContent className="max-w-sm sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete tag?</DialogTitle>
          </DialogHeader>
          <p className="text-[12px] text-text-3">
            {confirmDelete
              ? `Delete "${confirmDelete.name}"? It will be removed from every card in this project.`
              : null}
          </p>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setConfirmDelete(null)}
              className="rounded-[3px] px-2.5 py-[3px] text-[11px] font-medium text-text-3 hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirmDelete) {
                  del.mutate(confirmDelete.id);
                  setConfirmDelete(null);
                }
              }}
              className="rounded-[3px] bg-destructive px-2.5 py-[3px] text-[11px] font-medium text-white"
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Popover>
  );
}

function TagsRow({
  tag,
  applied,
  onToggle,
  onRename,
  onDelete,
}: {
  tag: ProjectTag;
  applied: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(tag.name);
  useEffect(() => setValue(tag.name), [tag.name]);

  if (editing) {
    return (
      <div className="flex items-center gap-1 px-2 py-1.5">
        <input
          // biome-ignore lint/a11y/noAutofocus: focus what user opened
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            const v = value.trim();
            if (v && v !== tag.name) onRename(v);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === "Escape") {
              setValue(tag.name);
              setEditing(false);
            }
          }}
          className="flex-1 rounded border border-border-2 bg-transparent px-1.5 py-0.5 text-[12px] text-text-1 outline-none"
        />
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: row layout with two actionable areas
    <div
      className="group flex items-center gap-2 px-2 py-1"
      onDoubleClick={() => setEditing(true)}
    >
      <button
        type="button"
        onClick={onToggle}
        className={`flex flex-1 items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-white/[0.05] ${
          applied ? "text-text-1" : "text-text-3"
        }`}
        title="Click to toggle · double-click to rename"
      >
        <span
          className={`inline-flex rounded-[8px] px-1.5 py-px text-[10px] tracking-[0.04em] ${tagChipClass(tag)}`}
        >
          {tag.name}
        </span>
        {applied ? (
          <span className="ml-auto">
            <Icon name="check" size={10} className="text-text-disabled" />
          </span>
        ) : null}
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${tag.name}`}
        className="grid h-5 w-5 place-items-center rounded text-text-disabled opacity-0 transition-colors group-hover:opacity-100 hover:text-rose-300"
        title="Delete"
      >
        <Icon name="trash" size={11} />
      </button>
    </div>
  );
}

/* --------------------------------- helpers -------------------------------- */

function Kbd({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-[3px] border border-border-1 px-1 py-px font-mono text-[10px] text-text-disabled">
      {children}
    </span>
  );
}

function mimeBadge(mime: string, name: string): string {
  const ext = name.includes(".") ? name.split(".").pop() ?? "" : "";
  if (ext) return ext.slice(0, 4).toUpperCase();
  if (mime.startsWith("image/")) return "IMG";
  if (mime.startsWith("video/")) return "VID";
  if (mime.startsWith("audio/")) return "AUD";
  if (mime === "application/pdf") return "PDF";
  return "FILE";
}

function initialsOf(s: string): string {
  return (
    s
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toLowerCase() ?? "")
      .join("") || "?"
  );
}
