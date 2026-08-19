// One scheduled task in a lane — bar when it has a span, diamond marker when
// it only has a deadline. The visual difference is load-bearing: never invent
// a span for a due-only task. Status is a fill ladder so state reads in
// monochrome; overdue is an edge cap + day counter, never a fully red bar.

import type { Task } from "@monkyesuite/shared";
import type {
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import { dayToUtcDate } from "../../lib/day";
import { hexAlpha } from "../milestone-color";
import {
  BAR_H,
  EDGE_HIT,
  MARKER,
  MIN_BAR_W,
  MONTH_ABBR,
  ROW_TASK,
} from "./geometry";
import type { DragLive, DragSpec } from "./useBarDrag";
import type { TimelineTaskRow } from "./useTimelineModel";

const fmtDay = (d: number): string => {
  const t = dayToUtcDate(d);
  return `${MONTH_ABBR[t.getUTCMonth()]} ${t.getUTCDate()}`;
};

const STATUS_LABEL: Record<Task["status"], string> = {
  backlog: "backlog",
  todo: "to do",
  in_progress: "in progress",
  review: "review",
  done: "done",
  archived: "archived",
};

type Visual = { border: string; background: string; labelColor: string };

function barVisual(status: Task["status"], hex: string): Visual {
  switch (status) {
    case "backlog":
      return {
        border: `1px dashed ${hexAlpha(hex, 0.4)}`,
        background: "transparent",
        labelColor: "var(--text-2)",
      };
    case "todo":
      return {
        border: `1px solid ${hexAlpha(hex, 0.55)}`,
        background: hexAlpha(hex, 0.08),
        labelColor: "var(--text-1)",
      };
    case "in_progress":
      return {
        border: `1px solid ${hexAlpha(hex, 0.7)}`,
        background: hexAlpha(hex, 0.22),
        labelColor: "var(--text-1)",
      };
    case "review":
      return {
        border: `1px solid ${hexAlpha(hex, 0.7)}`,
        background: hexAlpha(hex, 0.18),
        labelColor: "var(--text-1)",
      };
    default:
      return {
        border: "1px solid var(--border-1)",
        background: "rgba(255,255,255,.05)",
        labelColor: "var(--text-3)",
      };
  }
}

export function TaskBar({
  row,
  colorHex,
  groupKey,
  x,
  dayWidth,
  todayDay,
  editable,
  error,
  dragLive,
  justDragged,
  startDrag,
  onOpen,
  onNudge,
  onClear,
  onFocusMove,
  onZoomKey,
  onToday,
}: {
  row: TimelineTaskRow;
  colorHex: string;
  groupKey: string;
  x: (day: number) => number;
  dayWidth: number;
  todayDay: number;
  editable: boolean;
  error: string | null;
  dragLive: DragLive | null;
  justDragged: RefObject<boolean>;
  startDrag: (e: ReactPointerEvent, spec: DragSpec) => void;
  onOpen: (taskId: string) => void;
  onNudge: (
    row: TimelineTaskRow,
    edit: "move" | "due" | "start",
    delta: number,
  ) => void;
  onClear: (taskId: string) => void;
  onFocusMove: (el: HTMLElement, dir: -1 | 1) => void;
  onZoomKey: (delta: 1 | -1) => void;
  onToday: () => void;
}) {
  const { task } = row;
  const t = task;

  // Live drag deltas for THIS task only — the drag mutates a transform.
  const drag =
    dragLive?.engaged &&
    "taskId" in dragLive.spec &&
    dragLive.spec.taskId === t.id &&
    dragLive.spec.kind !== "tray"
      ? dragLive
      : null;
  const dd = drag?.dayDelta ?? 0;

  let startDay = row.startDay;
  let dueDay = row.dueDay;
  if (drag) {
    const kind = drag.spec.kind;
    if (kind === "move" || kind === "marker") {
      startDay = startDay === null ? null : startDay + dd;
      dueDay += dd;
    } else if (kind === "resize-due" && startDay !== null) {
      dueDay = Math.max(startDay, dueDay + dd);
    } else if (kind === "resize-start" && startDay !== null) {
      startDay = Math.min(dueDay, startDay + dd);
    }
  }

  const late = row.late;
  const visual = barVisual(t.status, colorHex);
  const counts = t.counts;
  const progress =
    counts && counts.checklistTotal > 0
      ? counts.checklistDone / counts.checklistTotal
      : null;

  const rangeText =
    startDay !== null
      ? `${fmtDay(startDay)} → ${fmtDay(dueDay)} · ${dueDay - startDay + 1}d`
      : `due ${fmtDay(dueDay)} · no start date`;
  const checkText =
    counts && counts.checklistTotal > 0
      ? `, ${counts.checklistDone} of ${counts.checklistTotal} done`
      : "";
  const tagText = (t.tags ?? []).map((g) => g.name).join(", ");
  const tooltip = `${t.title}\n${rangeText}\n${STATUS_LABEL[t.status]}${
    tagText ? `\n${tagText}` : ""
  }${checkText ? `\n${counts?.checklistDone}/${counts?.checklistTotal} checklist` : ""}`;
  const ariaLabel = `${t.title}, ${rangeText}, ${STATUS_LABEL[t.status]}${checkText}`;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowRight": {
        if (!editable) return;
        e.preventDefault();
        const delta = e.key === "ArrowLeft" ? -1 : 1;
        onNudge(row, e.shiftKey ? "due" : e.altKey ? "start" : "move", delta);
        return;
      }
      case "ArrowUp":
        e.preventDefault();
        onFocusMove(el, -1);
        return;
      case "ArrowDown":
        e.preventDefault();
        onFocusMove(el, 1);
        return;
      case "Enter":
        e.preventDefault();
        onOpen(t.id);
        return;
      case "Backspace":
      case "Delete":
        if (!editable) return;
        e.preventDefault();
        onClear(t.id);
        return;
      case "[":
        e.preventDefault();
        onZoomKey(-1);
        return;
      case "]":
        e.preventDefault();
        onZoomKey(1);
        return;
      case "t":
      case "T":
        e.preventDefault();
        onToday();
        return;
    }
  };

  const wrapOpacity = t.status === "archived" ? 0.5 : drag ? 0.9 : 1;
  const lateCounter = late ? `${todayDay - row.dueDay}d` : null;

  const shared = {
    role: "gridcell" as const,
    tabIndex: 0,
    "aria-label": ariaLabel,
    "data-tl-bar": t.id,
    title: tooltip,
    onKeyDown,
    onClick: (e: ReactMouseEvent) => {
      // A drag that engaged swallows the click; a sloppy click opens the card.
      if (drag || justDragged.current) return;
      e.stopPropagation();
      onOpen(t.id);
    },
  };

  const barWidth = startDay !== null ? (dueDay - startDay + 1) * dayWidth : 0;

  if (startDay !== null && barWidth >= MIN_BAR_W) {
    // ── bar ──
    const labelInside = barWidth > t.title.length * 6.4 + 24;
    const showEdges = editable && barWidth >= 24;
    return (
      <>
        <div
          {...shared}
          className="absolute overflow-hidden rounded-[5px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-1)]"
          style={{
            left: x(startDay),
            width: barWidth,
            height: BAR_H,
            top: (ROW_TASK - BAR_H) / 2,
            border: visual.border,
            background: visual.background,
            opacity: wrapOpacity,
            cursor: editable ? (drag ? "grabbing" : "grab") : "pointer",
          }}
          onPointerDown={
            editable
              ? (e) =>
                  startDrag(e, {
                    kind: "move",
                    taskId: t.id,
                    startDay: row.startDay,
                    dueDay: row.dueDay,
                    groupKey,
                  })
              : undefined
          }
        >
          {progress !== null && t.status === "in_progress" ? (
            <div
              className="absolute inset-y-0 left-0"
              style={{
                width: `${progress * 100}%`,
                background: hexAlpha(colorHex, 0.45),
              }}
            />
          ) : null}
          {row.blocker ? (
            // blocked work can't start → left edge
            <div
              className="absolute inset-y-0 left-0 z-[3] w-[3px]"
              style={{ background: "var(--destructive)" }}
            />
          ) : null}
          {t.status === "review" && !late ? (
            <div
              className="absolute inset-y-0 right-0 z-[3] w-[3px]"
              style={{ background: colorHex }}
            />
          ) : null}
          {late ? (
            <div
              className="absolute inset-y-0 right-0 z-[3] w-[3px]"
              style={{ background: "var(--destructive)" }}
            />
          ) : null}
          {labelInside ? (
            <span
              className="relative z-[2] block truncate px-[7px] text-[11px]"
              style={{ lineHeight: `${BAR_H - 2}px`, color: visual.labelColor }}
            >
              {t.status === "done" ? "✓ " : ""}
              {t.title}
            </span>
          ) : null}
          {showEdges ? (
            <>
              <div
                className="absolute inset-y-0 left-0 z-[4] cursor-ew-resize"
                style={{ width: EDGE_HIT }}
                onPointerDown={(e) =>
                  startDrag(e, {
                    kind: "resize-start",
                    taskId: t.id,
                    startDay: row.startDay ?? row.dueDay,
                    dueDay: row.dueDay,
                    groupKey,
                  })
                }
              />
              <div
                className="absolute inset-y-0 right-0 z-[4] cursor-ew-resize"
                style={{ width: EDGE_HIT }}
                onPointerDown={(e) =>
                  startDrag(e, {
                    kind: "resize-due",
                    taskId: t.id,
                    startDay: row.startDay ?? row.dueDay,
                    dueDay: row.dueDay,
                    groupKey,
                  })
                }
              />
            </>
          ) : null}
        </div>
        {!labelInside ? (
          <OutLabel
            leftPx={x(startDay) + barWidth + 8}
            title={t.title}
            done={t.status === "done"}
            lateCounter={lateCounter}
          />
        ) : lateCounter ? (
          <span
            className="absolute font-mono text-[10px]"
            style={{
              left: x(startDay) + barWidth + 8,
              top: ROW_TASK / 2 - 8,
              lineHeight: "16px",
              color: "var(--destructive)",
            }}
          >
            {lateCounter}
          </span>
        ) : null}
        {error ? <RowError message={error} /> : null}
      </>
    );
  }

  // ── marker: deadline without span ──
  const cx = x(dueDay) + dayWidth / 2;
  return (
    <>
      <div
        {...shared}
        className="absolute outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-1)]"
        style={{
          left: cx - MARKER / 2,
          top: (ROW_TASK - MARKER) / 2,
          width: MARKER,
          height: MARKER,
          transform: "rotate(45deg)",
          borderRadius: 2,
          border: `1.5px ${t.status === "backlog" ? "dashed" : "solid"} ${
            late ? "var(--destructive)" : hexAlpha(colorHex, 0.75)
          }`,
          background: late
            ? "rgba(240,87,111,.20)"
            : t.status === "done"
              ? colorHex
              : hexAlpha(colorHex, 0.18),
          opacity: wrapOpacity,
          cursor: editable ? (drag ? "grabbing" : "grab") : "pointer",
        }}
        onPointerDown={
          editable
            ? (e) =>
                startDrag(e, {
                  kind: "marker",
                  taskId: t.id,
                  startDay: null,
                  dueDay: row.dueDay,
                  groupKey,
                })
            : undefined
        }
      />
      <OutLabel
        leftPx={cx + MARKER / 2 + 8}
        title={t.title}
        done={t.status === "done"}
        lateCounter={lateCounter}
      />
      {error ? <RowError message={error} /> : null}
    </>
  );
}

function OutLabel({
  leftPx,
  title,
  done,
  lateCounter,
}: {
  leftPx: number;
  title: string;
  done: boolean;
  lateCounter: string | null;
}) {
  return (
    <span
      className="absolute whitespace-nowrap text-[11px]"
      style={{
        left: leftPx,
        top: ROW_TASK / 2 - 8,
        lineHeight: "16px",
        color: done ? "var(--text-3)" : "var(--text-2)",
      }}
    >
      {title}
      {lateCounter ? (
        <span
          className="ml-[7px] font-mono text-[10px]"
          style={{ color: "var(--destructive)" }}
        >
          {lateCounter} late
        </span>
      ) : null}
    </span>
  );
}

// Inline per-row error — the user needs to know WHICH bar didn't move.
function RowError({ message }: { message: string }) {
  return (
    <span
      className="absolute left-2 rounded bg-surface-1 px-1.5 text-[10px]"
      style={{
        top: ROW_TASK / 2 - 8,
        lineHeight: "16px",
        color: "var(--destructive)",
        zIndex: 5,
      }}
    >
      {message}
    </span>
  );
}
