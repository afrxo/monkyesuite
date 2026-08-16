// Card detail modal (specs/05 card modal). Overlay + two-column layout.
// Opens when `?card=<shortId>` is in the workspace route search params.
// Every field is inline-editable, autosaves on blur/toggle, and updates the
// bundled ["card-detail", taskId] query on success.
//
// Renders the AttachmentViewer as a modal-over-modal when the user clicks a
// grid tile; keyboard nav (arrows, esc) is scoped to whichever level is
// topmost.

import type {
  LinkedNote,
  Milestone,
  Task,
  TaskAttachment,
  TaskChecklistItem,
  TaskComment,
  TaskDetail,
  TaskStatus,
} from "@monkyesuite/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { marked } from "marked";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "../components/Icon";
import { copyLink } from "../lib/clipboard";
import { api } from "../lib/api";
import { toastError } from "../components/Toast";
import { relTime } from "../lib/format";
import { AttachmentViewer } from "./AttachmentViewer";
import { shortTaskId } from "./short-id";

marked.use({ gfm: true, breaks: true, async: false });

const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
  archived: "Archived",
};

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
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["card-detail", taskId] });

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  // Esc closes modal when viewer isn't up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent | globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && viewerIndex === null) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, viewerIndex]);

  const shortId = useMemo(
    () => shortTaskId(projectSlug, taskId),
    [projectSlug, taskId],
  );

  const backdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      onClick={backdropClick}
      onKeyDown={() => {}}
      role="presentation"
      className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-10"
      style={{ animation: "cardOverlayFade 120ms ease-out" }}
    >
      <div
        className="grid w-full max-w-[920px] overflow-hidden rounded-lg border border-border-2 bg-surface-0 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
        style={{
          maxHeight: "88vh",
          gridTemplateColumns: "1fr 280px",
          gridTemplateRows: "auto 1fr",
          animation: "cardModalPop 160ms cubic-bezier(0.2,0.9,0.3,1.2)",
        }}
      >
        <Header
          shortId={shortId}
          task={detail.data?.task ?? null}
          onClose={onClose}
          taskId={taskId}
        />
        <div className="min-w-0 overflow-y-auto border-r border-border-1 px-7 py-6">
          {detail.data ? (
            <MainColumn
              taskId={taskId}
              detail={detail.data}
              onOpenViewer={setViewerIndex}
              invalidate={invalidate}
            />
          ) : (
            <p className="text-xs text-text-disabled">Loading…</p>
          )}
        </div>
        <aside className="flex flex-col gap-5 overflow-y-auto px-4 py-5">
          {detail.data ? (
            <SideColumn
              taskId={taskId}
              detail={detail.data}
              milestones={milestones}
              invalidate={invalidate}
            />
          ) : null}
        </aside>
      </div>

      {viewerIndex !== null && detail.data ? (
        <AttachmentViewer
          attachments={detail.data.attachments}
          index={viewerIndex}
          onIndex={setViewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}
    </div>
  );
}

/* ---------------------------------- header --------------------------------- */

function Header({
  shortId,
  task,
  onClose,
  taskId,
}: {
  shortId: string;
  task: Task | null;
  onClose: () => void;
  taskId: string;
}) {
  const copyCardLink = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("card", shortId);
    copyLink(url.toString());
  };
  const status = task?.status ?? "todo";
  return (
    <div className="col-span-2 flex items-center gap-2.5 border-b border-border-1 px-3.5 py-2.5">
      <button
        type="button"
        onClick={copyCardLink}
        title="Copy link to card"
        className="rounded-[3px] px-1.5 py-0.5 font-mono text-[11px] text-text-disabled hover:bg-surface-hover hover:text-text-3"
      >
        {shortId}
      </button>
      <span className="text-[11px] text-text-disabled">·</span>
      <span
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-[3px] bg-surface-hover px-2 py-[3px] font-mono text-[11px] text-text-1 hover:bg-white/[0.08]"
        title="Status (view only in this pass)"
      >
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--accent-warm)" }}
        />
        {STATUS_LABEL[status]}
        <Icon name="chevron-down" size={9} className="text-text-disabled" />
      </span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={copyCardLink}
        title="Copy link"
        aria-label={`Copy link to ${shortId}`}
        className="grid h-6 w-6 place-items-center rounded-[3px] text-text-disabled hover:bg-surface-hover hover:text-text-1"
      >
        <Icon name="link" size={13} />
      </button>
      <button
        type="button"
        title="More"
        aria-label={`More actions for ${taskId}`}
        className="grid h-6 w-6 place-items-center rounded-[3px] text-text-disabled hover:bg-surface-hover hover:text-text-1"
      >
        <Icon name="more" size={14} />
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
  );
}

/* -------------------------------- main col --------------------------------- */

function MainColumn({
  taskId,
  detail,
  onOpenViewer,
  invalidate,
}: {
  taskId: string;
  detail: TaskDetail;
  onOpenViewer: (i: number) => void;
  invalidate: () => void;
}) {
  return (
    <>
      <TitleField task={detail.task} onSaved={invalidate} />
      <DescriptionField task={detail.task} onSaved={invalidate} />
      <ChecklistSection
        taskId={taskId}
        items={detail.checklistItems}
        onChanged={invalidate}
      />
      <AttachmentsSection
        taskId={taskId}
        attachments={detail.attachments}
        onOpenViewer={onOpenViewer}
        onChanged={invalidate}
      />
      <CommentsSection
        taskId={taskId}
        comments={detail.comments}
        onChanged={invalidate}
      />
    </>
  );
}

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
      className="mb-5 -mx-1.5 w-[calc(100%+12px)] rounded bg-transparent px-1.5 py-0.5 text-[22px] font-semibold leading-[1.3] tracking-[-0.015em] text-text-1 outline-none hover:bg-surface-hover focus:bg-surface-hover focus:shadow-[inset_0_0_0_1px_var(--border-2)]"
    />
  );
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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setValue(task.body ?? ""), [task.body]);

  const save = useMutation({
    mutationFn: (v: string) => api.patchTask(task.id, { body: v || null }),
    onSuccess: onSaved,
    onError: (err) => toastError(err),
  });

  const scheduleSave = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (v !== (task.body ?? "")) save.mutate(v);
    }, 1000);
  };

  const commit = () => {
    if (timer.current) clearTimeout(timer.current);
    if (value !== (task.body ?? "")) save.mutate(value);
    setEditing(false);
  };

  const rendered = useMemo(() => {
    const src = task.body?.trim() ? task.body : "*No description yet.*";
    return marked.parse(src) as string;
  }, [task.body]);

  return (
    <Section title="Description">
      {editing ? (
        <textarea
          // biome-ignore lint/a11y/noAutofocus: focus what user opened
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            scheduleSave(e.target.value);
          }}
          onBlur={commit}
          className="min-h-24 w-full resize-y rounded-md bg-surface-hover px-2.5 py-2 text-[13px] leading-[1.6] text-text-2 outline-none shadow-[inset_0_0_0_1px_var(--border-2)]"
        />
      ) : (
        // biome-ignore lint/a11y/noStaticElementInteractions: markdown block, click to edit
        <div
          onClick={() => setEditing(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setEditing(true);
          }}
          role="button"
          tabIndex={0}
          className="prose-invert -mx-2.5 min-h-10 cursor-text rounded-md px-2.5 py-2 text-[13px] leading-[1.6] text-text-3 hover:bg-surface-hover"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: same-origin markdown, XSS via marked hardened elsewhere in project
          dangerouslySetInnerHTML={{ __html: rendered }}
        />
      )}
    </Section>
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
    <Section
      title="Checklist"
      count={`${done} / ${total}`}
      action={
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="cursor-pointer text-sm leading-none text-text-disabled hover:text-text-1"
          aria-label="Add checklist item"
        >
          +
        </button>
      }
    >
      <div className="mb-2.5 flex items-center gap-2.5 font-mono text-[10px] text-text-disabled">
        <span>{pct}%</span>
        <div className="h-[2px] flex-1 overflow-hidden rounded-[1px] bg-border-1">
          <div
            className="h-full"
            style={{ width: `${pct}%`, background: "var(--accent-warm)" }}
          />
        </div>
      </div>
      {items.map((item) => (
        <ChecklistRow
          key={item.id}
          taskId={taskId}
          item={item}
          onChanged={onChanged}
        />
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
    </Section>
  );
}

function ChecklistRow({
  taskId,
  item,
  onChanged,
}: {
  taskId: string;
  item: TaskChecklistItem;
  onChanged: () => void;
}) {
  void taskId;
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
      <button
        type="button"
        onClick={() => toggle.mutate()}
        aria-label={item.done ? "Mark incomplete" : "Mark complete"}
        className="grid h-3.5 w-3.5 flex-shrink-0 place-items-center rounded-[3px] border border-border-2 text-[10px]"
        style={{
          background: item.done ? "var(--accent-warm)" : "transparent",
          borderColor: item.done ? "var(--accent-warm)" : "var(--border-2)",
          color: item.done ? "#1a1000" : "transparent",
        }}
      >
        <Icon name="check" size={9} />
      </button>
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

  return (
    <Section title="Attachments" count={String(attachments.length)}>
      <div className="grid grid-cols-3 gap-2">
        {attachments.map((a, i) => (
          <div key={a.id} className="group/att relative">
            <button
              type="button"
              onClick={() => onOpenViewer(i)}
              className="flex w-full items-center gap-2.5 rounded-[5px] border border-border-1 bg-surface-1 p-2.5 text-left hover:border-border-2 hover:bg-white/[0.03]"
            >
              <AttachmentTile attachment={a} />
              <div className="min-w-0">
                <div className="truncate text-[11px] text-text-1">
                  {a.fileName}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-text-disabled">
                  {fmtSize(a.sizeBytes)}
                </div>
              </div>
            </button>
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
          className="grid min-h-[52px] cursor-pointer place-items-center rounded-[5px] border border-dashed border-border-2 bg-transparent text-[11px] text-text-disabled hover:border-[#3a3a3a] hover:text-text-3"
          disabled={upload.isPending}
        >
          {upload.isPending ? "uploading…" : "+ drop or click"}
        </button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={onPick}
        />
      </div>
    </Section>
  );
}

function AttachmentTile({ attachment }: { attachment: TaskAttachment }) {
  const badge = mimeBadge(attachment.mimeType, attachment.fileName);
  if (attachment.thumbnailUrl) {
    return (
      <div className="relative h-7 w-7 flex-shrink-0 overflow-hidden rounded bg-surface-hover">
        <img
          src={attachment.thumbnailUrl}
          alt=""
          className="h-full w-full object-cover"
        />
        {attachment.mimeType.startsWith("video/") ? (
          <span className="absolute inset-0 grid place-items-center text-[10px] text-white/90">
            ▶
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <div className="grid h-7 w-7 flex-shrink-0 place-items-center rounded bg-surface-hover font-mono text-[10px] font-semibold text-text-3">
      {badge}
    </div>
  );
}

/* -------------------------------- comments -------------------------------- */

function CommentsSection({
  taskId,
  comments,
  onChanged,
}: {
  taskId: string;
  comments: TaskComment[];
  onChanged: () => void;
}) {
  const [body, setBody] = useState("");
  const send = useMutation({
    mutationFn: (b: string) => api.createComment(taskId, { body: b }),
    onSuccess: () => {
      setBody("");
      onChanged();
    },
    onError: (err) => toastError(err),
  });
  const submit = () => {
    const v = body.trim();
    if (v) send.mutate(v);
  };
  return (
    <Section title="Comments" count={String(comments.length)}>
      <div className="mb-3.5 rounded-[5px] border border-border-1 bg-surface-1 px-2.5 py-2">
        <textarea
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
      <div className="flex flex-col">
        {comments.map((c) => (
          <CommentRow key={c.id} comment={c} />
        ))}
      </div>
    </Section>
  );
}

function CommentRow({ comment }: { comment: TaskComment }) {
  const initials = initialsOf(
    comment.author?.name ?? comment.author?.email ?? "?",
  );
  const html = useMemo(
    () => marked.parse(comment.body) as string,
    [comment.body],
  );
  return (
    <div className="flex gap-2.5 py-2">
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
        </div>
        <div
          className="text-[12px] leading-[1.55] text-text-3"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: same-origin markdown
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}

/* --------------------------------- side col -------------------------------- */

function SideColumn({
  taskId,
  detail,
  milestones,
  invalidate,
}: {
  taskId: string;
  detail: TaskDetail;
  milestones: Milestone[];
  invalidate: () => void;
}) {
  void taskId;
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

  return (
    <>
      <Prop label="Milestone">
        <MilestonePicker
          milestones={milestones}
          value={t.milestoneId ?? null}
          onChange={(id) => setMilestone.mutate(id)}
          pending={setMilestone.isPending}
        />
      </Prop>

      <Prop label="Assignee">
        <span className="text-[12px] text-text-3">
          {t.assignee?.name ?? t.assignee?.email ?? "unassigned"}
        </span>
      </Prop>

      <Prop label="Due date">
        <input
          type="date"
          value={t.dueAt ? t.dueAt.slice(0, 10) : ""}
          onChange={(e) => {
            const v = e.target.value;
            setDue.mutate(v ? new Date(`${v}T00:00:00Z`).toISOString() : null);
          }}
          className="cursor-pointer rounded bg-transparent px-1.5 py-0.5 font-mono text-[11px] text-text-1 outline-none hover:bg-surface-hover"
        />
        {t.dueAt ? (
          <span className="font-mono text-[10px] text-text-disabled">
            · {relTime(t.dueAt)}
          </span>
        ) : null}
      </Prop>

      <Prop
        label={
          <>
            Linked notes{" "}
            <span className="font-mono text-[10px] text-text-disabled">
              {detail.linkedNotes.length}
            </span>
          </>
        }
      >
        <div className="flex flex-col">
          {detail.linkedNotes.length === 0 ? (
            <span className="text-[11px] text-text-disabled">— none —</span>
          ) : (
            detail.linkedNotes.map((n) => <LinkedNoteRow key={n.id} note={n} />)
          )}
        </div>
      </Prop>

      <Prop label="Activity">
        <ActivityFeed detail={detail} />
      </Prop>
    </>
  );
}

function LinkedNoteRow({ note }: { note: LinkedNote }) {
  return (
    <div className="-mx-2.5 rounded px-2.5 py-2 hover:bg-surface-hover">
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

function ActivityFeed({ detail }: { detail: TaskDetail }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? detail.activity : detail.activity.slice(0, 5);
  return (
    <div className="flex flex-col gap-1">
      {shown.map((e) => (
        <div key={e.id} className="flex gap-2 py-1 text-[11px] text-text-3">
          <span className="flex-shrink-0 pt-px font-mono text-[10px] text-text-disabled">
            {relTime(e.createdAt)}
          </span>
          <span className="min-w-0">
            <strong className="font-medium text-text-1">
              {e.actor?.name ?? e.actor?.email ?? "someone"}
            </strong>{" "}
            {activityText(e.kind, e.payload)}
          </span>
        </div>
      ))}
      {!showAll && detail.activity.length > 5 ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-1 self-start text-[10px] text-text-disabled hover:text-text-3"
        >
          show all
        </button>
      ) : null}
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
    case "assignee_change":
      return "changed assignee";
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

/* --------------------------------- helpers -------------------------------- */

function Section({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-2.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
        <span>{title}</span>
        {count ? (
          <span className="font-mono text-[10px] normal-case tracking-normal text-text-disabled">
            {count}
          </span>
        ) : null}
        {action ? <span className="ml-auto">{action}</span> : null}
      </div>
      {children}
    </section>
  );
}

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
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = milestones.find((m) => m.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) =>
      e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[12px] transition-colors hover:bg-surface-hover disabled:opacity-50 ${
          selected ? "text-text-1" : "text-text-3"
        }`}
      >
        {selected ? (
          <>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-warm" />
            {selected.name}
          </>
        ) : (
          "— none —"
        )}
        <Icon name="chevron-down" size={9} className="ml-0.5 text-text-disabled" />
      </button>

      {open ? (
        <div className="absolute left-0 top-[calc(100%+4px)] z-30 w-52 overflow-hidden rounded-md border border-border-1 bg-surface-1 py-1 shadow-xl">
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
            <span className="text-[9px] text-text-disabled opacity-0">●</span>
            — none —
            {value === null ? (
              <span className="ml-auto"><Icon name="check" size={10} className="text-text-disabled" /></span>
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
                <span className="ml-auto"><Icon name="check" size={10} className="text-text-disabled" /></span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Prop({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
        {label}
      </div>
      <div className="-mx-2 flex items-center gap-1.5 rounded px-2 py-1 text-[12px] text-text-1">
        {children}
      </div>
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-[3px] border border-border-1 px-1 py-px font-mono text-[10px] text-text-disabled">
      {children}
    </span>
  );
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
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
