// One milestone group: a sticky, dense header (color dot · name · count ·
// target date · done/total progress) over its ordered rows. Collapsible.
// Subtask rows render nested under an expanded parent. In flat ("None")
// grouping the header is suppressed and rows render bare.

import { Fragment } from "react";
import { milestoneColor } from "../milestone-color";
import { ListRow } from "./ListRow";
import type { ListGroup as ListGroupData } from "./useListRows";

type Props = {
  group: ListGroupData;
  flat: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  expanded: Set<string>;
  onToggleExpand: (taskId: string) => void;
  focusedKey: string | null;
  projectSlug: string;
  registerRow: (key: string, el: HTMLElement | null) => void;
  onFocusRow: (key: string) => void;
  onOpen: (taskId: string) => void;
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function ListGroup({
  group,
  flat,
  collapsed,
  onToggleCollapse,
  expanded,
  onToggleExpand,
  focusedKey,
  projectSlug,
  registerRow,
  onFocusRow,
  onOpen,
}: Props) {
  const dot = group.milestone
    ? milestoneColor(group.milestone.id).dot
    : "bg-transparent border border-border-2";

  return (
    <div>
      {!flat ? (
        <div className="sticky top-8 z-10 flex items-center gap-2.5 border-b border-border-1 bg-surface-1 px-4 py-1.5">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand group" : "Collapse group"}
            className="grid h-4 w-4 shrink-0 place-items-center rounded text-text-disabled hover:text-text-1"
          >
            <svg
              width={10}
              height={10}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className={`transition-transform ${collapsed ? "" : "rotate-90"}`}
              aria-hidden="true"
            >
              <path d="M6 4l4 4-4 4" />
            </svg>
          </button>
          <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
          <span className="truncate text-xs font-medium text-text-1">
            {group.label}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-text-disabled">
            {group.totalCount}
          </span>
          <div className="flex-1" />
          {group.targetDate ? (
            <span className="shrink-0 text-[11px] tabular-nums text-text-3">
              {fmtDate(group.targetDate)}
            </span>
          ) : null}
          <span className="shrink-0 text-[11px] tabular-nums text-text-3">
            <span className="text-text-1">{group.doneCount}</span>
            <span className="text-text-disabled">/{group.totalCount}</span>
            <span className="ml-1 text-text-disabled">done</span>
          </span>
        </div>
      ) : null}

      {!collapsed
        ? group.parents.map((task) => {
            const subtasks = task.subtasks ?? [];
            const isOpen = expanded.has(task.id);
            return (
              <Fragment key={task.id}>
                <ListRow
                  task={task}
                  projectSlug={projectSlug}
                  depth={0}
                  focused={focusedKey === task.id}
                  hasSubtasks={subtasks.length > 0}
                  expanded={isOpen}
                  onOpen={() => onOpen(task.id)}
                  onToggleExpand={() => onToggleExpand(task.id)}
                  registerRow={(el) => registerRow(task.id, el)}
                  onFocus={() => onFocusRow(task.id)}
                />
                {isOpen
                  ? subtasks.map((sub) => (
                      <ListRow
                        key={sub.id}
                        task={sub}
                        projectSlug={projectSlug}
                        depth={1}
                        focused={focusedKey === sub.id}
                        hasSubtasks={false}
                        expanded={false}
                        onOpen={() => onOpen(sub.id)}
                        onToggleExpand={() => {}}
                        registerRow={(el) => registerRow(sub.id, el)}
                        onFocus={() => onFocusRow(sub.id)}
                      />
                    ))
                  : null}
              </Fragment>
            );
          })
        : null}
    </div>
  );
}
