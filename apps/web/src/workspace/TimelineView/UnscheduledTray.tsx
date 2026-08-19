// The Unscheduled tray — a persistent bottom drawer holding every task with
// no due date, in board-backlog reading order. Dragging a chip onto a lane is
// the primary scheduling gesture (and the only way startAt is ever written);
// double-click schedules starting today. If most of the project lives here on
// first open, that is the view doing its job.

import type { Task } from "@monkyesuite/shared";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "../../components/Icon";
import { hexAlpha, milestoneColor, NO_MILESTONE_HEX } from "../milestone-color";
import { tagDotColor } from "./tag-dot";
import type { DragLive, DragSpec } from "./useBarDrag";

export function UnscheduledTray({
  tasks,
  open,
  onToggle,
  editable,
  dragLive,
  startDrag,
  onScheduleToday,
}: {
  tasks: Task[];
  open: boolean;
  onToggle: () => void;
  editable: boolean;
  dragLive: DragLive | null;
  startDrag: (e: ReactPointerEvent, spec: DragSpec) => void;
  onScheduleToday: (task: Task) => void;
}) {
  return (
    <div className="border-t border-border-2 bg-surface-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-2 text-left"
      >
        <Icon
          name="chevron-down"
          size={10}
          className={`text-text-disabled transition-transform ${open ? "" : "-rotate-90"}`}
        />
        <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-text-3">
          Unscheduled
        </span>
        <span className="font-mono text-[10px] text-text-disabled">
          {tasks.length}
        </span>
        <span className="ml-auto font-mono text-[10px] text-text-disabled">
          {tasks.length > 0 ? "drag onto a lane to schedule" : ""}
        </span>
      </button>
      {open ? (
        <div
          className="flex max-h-[96px] flex-wrap gap-[7px] overflow-y-auto px-4 pb-3"
          data-tl-tray
        >
          {tasks.length === 0 ? (
            <span className="py-1 text-[11px] text-text-disabled">
              Everything’s scheduled.
            </span>
          ) : (
            tasks.map((t) => {
              const hex = t.milestoneId
                ? milestoneColor(t.milestoneId).hex
                : NO_MILESTONE_HEX;
              const dragging =
                dragLive?.engaged &&
                dragLive.spec.kind === "tray" &&
                dragLive.spec.taskId === t.id;
              const counts = t.counts;
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: pointer-drag chip; double-click covered by keyboard on the bar it becomes
                <div
                  key={t.id}
                  className="flex touch-none select-none items-center gap-[7px] rounded-md border border-border-1 bg-surface-1 px-2 py-1"
                  style={{
                    cursor: editable ? "grab" : "default",
                    opacity: dragging ? 0.4 : 1,
                  }}
                  title={
                    editable
                      ? "Drag onto the timeline to schedule · double-click to start today"
                      : t.title
                  }
                  onPointerDown={
                    editable
                      ? (e) =>
                          startDrag(e, {
                            kind: "tray",
                            taskId: t.id,
                            title: t.title,
                            colorHex: hex,
                          })
                      : undefined
                  }
                  onDoubleClick={
                    editable ? () => onScheduleToday(t) : undefined
                  }
                >
                  <span
                    className="h-[7px] w-[7px] shrink-0 rounded-full"
                    style={{ background: hexAlpha(hex, 0.9) }}
                  />
                  <span className="max-w-[220px] truncate text-[11px] text-text-1">
                    {t.title}
                  </span>
                  <span className="flex gap-[3px]">
                    {(t.tags ?? []).slice(0, 4).map((g) => (
                      <span
                        key={g.id}
                        className="h-[5px] w-[5px] rounded-full"
                        style={{ background: tagDotColor(g) }}
                      />
                    ))}
                  </span>
                  {counts && counts.checklistTotal > 0 ? (
                    <span className="font-mono text-[10px] text-text-disabled">
                      {counts.checklistDone}/{counts.checklistTotal}
                    </span>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
