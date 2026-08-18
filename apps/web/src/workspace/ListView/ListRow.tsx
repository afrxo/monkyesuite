// One List row — a parent task or an indented subtask. Read-only: the whole row
// is the click/Enter target that opens CardModal. Dense (~38px), hairline
// dividers, tabular-nums counts. Columns: Status · Title · Tags · Assignees ·
// Date · Signals. Subtask rows are visually recessive (muted, no cover, reduced
// signals). Nothing inside a row is independently interactive (v1).

import type { Task, TaskStatus } from "@monkyesuite/shared";
import { MiniAvatar } from "../BoardView";
import { shortTaskId } from "../short-id";
import { tagChipClass } from "../tag";

// Shared 6-column template — header and every row use it so columns line up.
export const LIST_GRID_COLS =
  "88px minmax(0,1fr) minmax(0,232px) 96px 88px minmax(0,132px)";

const STATUS_DOT: Record<TaskStatus, string> = {
  backlog: "bg-zinc-500",
  todo: "bg-sky-400",
  in_progress: "bg-amber-400",
  review: "bg-violet-400",
  done: "bg-emerald-400",
  archived: "bg-zinc-600",
};
const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Prog",
  review: "Review",
  done: "Done",
  archived: "Arch",
};

const DAY = 86_400_000;

function DateCell({ dueAt, done }: { dueAt: string | null; done: boolean }) {
  if (!dueAt)
    return <span className="text-[11px] text-text-disabled">—</span>;
  const t = Date.parse(dueAt);
  const now = Date.now();
  const overdue = !done && t < now;
  const soon = !done && !overdue && t - now < 3 * DAY;
  const label = new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return (
    <span
      className={`text-[11px] tabular-nums ${
        overdue
          ? "font-medium text-rose-400"
          : soon
            ? "text-amber-300"
            : "text-text-3"
      }`}
      title={overdue ? "Overdue" : soon ? "Due soon" : undefined}
    >
      {label}
    </span>
  );
}

// Tiny inline glyphs for the signal cluster (kept local so shared Icon.tsx is
// untouched). 12px stroke marks, muted.
function Glyph({ d, fill }: { d: string; fill?: boolean }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 16 16"
      fill={fill ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
const G_SUBTASK = "M4 3v7a2 2 0 0 0 2 2h6M4 3H3m1 0h1m7 9-2-2m2 2-2 2";
const G_CHECK = "M3 8.5 6.5 12 13 4";
const G_COMMENT = "M2 4h12v8H6l-3 2v-2H2z";
const G_ATTACH = "M12 6.5 7.5 11a2 2 0 0 1-3-3l5-5a3 3 0 0 1 4 4l-5 5";

type Signal = { key: string; glyph: React.ReactNode; text: string; title: string };

function signalsOf(task: Task, recessive: boolean): Signal[] {
  const out: Signal[] = [];
  const subs = task.subtasks ?? [];
  if (!recessive && subs.length > 0) {
    const done = subs.filter((s) => s.status === "done").length;
    out.push({
      key: "sub",
      glyph: <Glyph d={G_SUBTASK} />,
      text: `${done}/${subs.length}`,
      title: "Subtasks done",
    });
  }
  const c = task.counts;
  if (c) {
    if (c.checklistTotal > 0)
      out.push({
        key: "chk",
        glyph: <Glyph d={G_CHECK} />,
        text: `${c.checklistDone}/${c.checklistTotal}`,
        title: "Checklist done",
      });
    if (c.comments > 0)
      out.push({
        key: "cmt",
        glyph: <Glyph d={G_COMMENT} />,
        text: `${c.comments}`,
        title: "Comments",
      });
    if (c.attachments > 0)
      out.push({
        key: "att",
        glyph: <Glyph d={G_ATTACH} />,
        text: `${c.attachments}`,
        title: "Attachments",
      });
  }
  return out;
}

type Props = {
  task: Task;
  projectSlug: string;
  depth: 0 | 1;
  focused: boolean;
  hasSubtasks: boolean;
  expanded: boolean;
  onOpen: () => void;
  onToggleExpand: () => void;
  registerRow: (el: HTMLElement | null) => void;
  onFocus: () => void;
};

export function ListRow({
  task,
  projectSlug,
  depth,
  focused,
  hasSubtasks,
  expanded,
  onOpen,
  onToggleExpand,
  registerRow,
  onFocus,
}: Props) {
  const recessive = depth === 1;
  const signals = signalsOf(task, recessive);
  const tags = task.tags ?? [];
  const shownTags = tags.slice(0, 3);
  const extraTags = tags.length - shownTags.length;
  const assignees = task.assignees ?? [];
  const shownAssignees = assignees.slice(0, 3);
  const extraAssignees = assignees.length - shownAssignees.length;

  return (
    <div
      role="row"
      ref={registerRow}
      tabIndex={focused ? 0 : -1}
      onClick={onOpen}
      onFocus={onFocus}
      onKeyDown={(e) => {
        // Space also activates (Enter is handled by the grid-level handler).
        if (e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`${shortTaskId(projectSlug, task.id)} ${task.title}`}
      className={`grid min-h-[38px] cursor-pointer items-center gap-3 border-b border-border-1 px-4 text-sm outline-none transition-colors ${
        focused
          ? "bg-white/[0.04] ring-1 ring-inset ring-accent-warm/60"
          : "hover:bg-white/[0.025]"
      }`}
      style={{ gridTemplateColumns: LIST_GRID_COLS }}
    >
      {/* Status */}
      <div className="flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[task.status]}`}
        />
        <span className="truncate text-[10px] uppercase tracking-[0.06em] text-text-3">
          {STATUS_LABEL[task.status]}
        </span>
      </div>

      {/* Title */}
      <div
        className="flex min-w-0 items-center gap-1.5"
        style={{ paddingLeft: recessive ? 18 : 0 }}
      >
        {!recessive && hasSubtasks ? (
          <button
            type="button"
            // Expander is the one exception to "nothing independently clickable":
            // it changes local view state, never navigates.
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            tabIndex={-1}
            aria-label={expanded ? "Collapse subtasks" : "Expand subtasks"}
            className="grid h-4 w-4 shrink-0 place-items-center rounded text-text-disabled hover:text-text-1"
          >
            <svg
              width={10}
              height={10}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className={`transition-transform ${expanded ? "rotate-90" : ""}`}
              aria-hidden="true"
            >
              <path d="M6 4l4 4-4 4" />
            </svg>
          </button>
        ) : !recessive ? (
          <span className="w-4 shrink-0" />
        ) : null}

        {!recessive && task.coverUrl ? (
          <img
            src={task.coverUrl}
            alt=""
            className="h-6 w-6 shrink-0 rounded object-cover"
          />
        ) : null}

        <span className="shrink-0 font-mono text-[10px] text-text-disabled">
          {shortTaskId(projectSlug, task.id)}
        </span>
        <span
          className={`truncate ${
            recessive ? "text-[13px] text-text-3" : "text-text-1"
          }`}
          title={task.title}
        >
          {task.title}
        </span>
      </div>

      {/* Tags */}
      <div className="flex min-w-0 items-center gap-1 overflow-hidden">
        {shownTags.map((tag) => (
          <span
            key={tag.id}
            className={`shrink-0 rounded-[6px] px-1.5 py-px text-[10px] tracking-[0.03em] ${tagChipClass(tag)}`}
          >
            {tag.name}
          </span>
        ))}
        {extraTags > 0 ? (
          <span className="shrink-0 text-[10px] tabular-nums text-text-disabled">
            +{extraTags}
          </span>
        ) : null}
      </div>

      {/* Assignees */}
      <div className="flex items-center">
        {assignees.length === 0 ? (
          <span
            className="h-5 w-5 rounded-full border border-dashed border-border-2"
            title="Unassigned"
            aria-label="Unassigned"
          />
        ) : (
          <div className="flex items-center -space-x-1.5">
            {shownAssignees.map((a) => (
              <MiniAvatar key={a.id} name={a.name ?? a.email} />
            ))}
            {extraAssignees > 0 ? (
              <span className="grid h-5 w-5 place-items-center rounded-full border-[1.5px] border-surface-0 bg-surface-hover text-[9px] font-semibold text-text-3">
                +{extraAssignees}
              </span>
            ) : null}
          </div>
        )}
      </div>

      {/* Date */}
      <div className="flex items-center">
        <DateCell dueAt={task.dueAt} done={task.status === "done"} />
      </div>

      {/* Signals */}
      <div className="flex items-center justify-end gap-2 text-text-disabled">
        {signals.map((s) => (
          <span
            key={s.key}
            className="flex items-center gap-0.5"
            title={s.title}
          >
            {s.glyph}
            <span className="text-[10px] tabular-nums">{s.text}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
