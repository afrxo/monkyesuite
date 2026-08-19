// Timeline data pipeline: board payload in, row model out. Pure + memoized —
// every derived-date rule (track spans, slip, range snapping) lives here, not
// in components. All dates are integer day indices (lib/day.ts); the only
// ISO-string handling is the conversion at this boundary.
//
// Three tiers (specs/05 timeline): milestones are the spine (tracks derived
// from targetDate + neighbours — display-only, never persisted), dated tasks
// are bars/markers, undated tasks are the Unscheduled tray.

import type { Board, Milestone, Task } from "@monkyesuite/shared";
import { useMemo } from "react";
import { mondayOf, sundayOf, toDayIndex, todayIndex } from "../../lib/day";
import { milestoneColor, NO_MILESTONE_HEX } from "../milestone-color";
import { matchesTaskFilter, type TaskFilter } from "../taskFilter";

export type TimelineTaskRow = {
  task: Task;
  startDay: number | null; // null → marker (deadline without span)
  dueDay: number; // rows exist only for dated tasks
  late: boolean; // dueDay < today && status !== done (archived excluded)
  blocker: boolean; // carries the `blocker` tag
};

export type TimelineGroup = {
  key: string; // milestoneId or "none"
  milestone: Milestone | null;
  colorHex: string;
  targetDay: number | null;
  // Derived track span — display only, never written back. `dashed` marks the
  // no-targetDate variant (spans the contained tasks' extent).
  trackStart: number | null;
  trackEnd: number | null;
  dashed: boolean;
  slipEnd: number | null; // max contained dueDay when it overruns the target
  done: number;
  total: number; // top-level, non-archived
  complete: boolean; // done === total && total > 0 → auto-collapse
  rows: TimelineTaskRow[]; // scheduled + visible, sorted ascending
  unscheduledCount: number; // visible tray-state tasks in this group
  dimmed: boolean; // tasks exist but the filter hides all of them
};

export type TimelineModel = {
  groups: TimelineGroup[];
  unscheduled: Task[]; // tray, milestone order then task orderKey
  originDay: number;
  endDay: number;
  todayDay: number;
  totalTasks: number; // top-level non-archived tasks in the project
  visibleScheduled: number; // rows across all groups after filtering
};

const MIN_RANGE_DAYS = 8 * 7;

export type TimelineModelArgs = {
  board: Board;
  filter: TaskFilter;
  projectSlug: string;
  showArchived: boolean;
  /** injectable for tests; defaults to the user's local calendar day */
  today?: number;
};

export function useTimelineModel(args: TimelineModelArgs): TimelineModel {
  const { board, filter, projectSlug, showArchived } = args;
  return useMemo(
    () => buildTimelineModel({ board, filter, projectSlug, showArchived }),
    [board, filter, projectSlug, showArchived],
  );
}

// Pure: payload in, row model out. Kept hook-free so it unit-tests directly.
export function buildTimelineModel({
  board,
  filter,
  projectSlug,
  showArchived,
  today = todayIndex(),
}: TimelineModelArgs): TimelineModel {
  // Top-level tasks; archived only when toggled on.
  const all: Task[] = [];
  for (const lane of board.lanes) {
    for (const t of lane.tasks) {
      if (t.status === "archived" && !showArchived) continue;
      all.push(t);
    }
  }
  const visible = all.filter((t) => matchesTaskFilter(t, filter, projectSlug));

  // Range: every known date + today, snapped to whole weeks with margin.
  // Built from ALL tasks (not the filtered set) so filtering doesn't make
  // the canvas jump.
  const days: number[] = [today];
  for (const t of all) {
    if (t.dueAt) days.push(toDayIndex(t.dueAt));
    if (t.startAt) days.push(toDayIndex(t.startAt));
  }
  for (const m of board.milestones) {
    if (m.targetDate) days.push(toDayIndex(m.targetDate));
  }
  const originDay = mondayOf(Math.min(...days)) - 7;
  let endDay = sundayOf(Math.max(...days)) + 14;
  if (endDay - originDay + 1 < MIN_RANGE_DAYS) {
    endDay = originDay + MIN_RANGE_DAYS - 1;
  }

  const byMilestone = (list: Task[]): Map<string, Task[]> => {
    const map = new Map<string, Task[]>();
    for (const t of list) {
      const k = t.milestoneId ?? "none";
      const arr = map.get(k) ?? [];
      arr.push(t);
      map.set(k, arr);
    }
    return map;
  };
  const allBy = byMilestone(all);
  const visBy = byMilestone(visible);

  const toRow = (t: Task, dueAt: string): TimelineTaskRow => {
    const dueDay = toDayIndex(dueAt);
    return {
      task: t,
      startDay: t.startAt ? toDayIndex(t.startAt) : null,
      dueDay,
      late: dueDay < today && t.status !== "done" && t.status !== "archived",
      blocker: (t.tags ?? []).some((tag) => tag.name === "blocker"),
    };
  };

  const buildGroup = (
    key: string,
    milestone: Milestone | null,
    prevTargetDay: number | null,
  ): TimelineGroup => {
    const mine = allBy.get(key) ?? [];
    const vis = visBy.get(key) ?? [];
    const rows = vis
      .flatMap((t) => (t.dueAt ? [toRow(t, t.dueAt)] : []))
      .sort((a, b) => (a.startDay ?? a.dueDay) - (b.startDay ?? b.dueDay));
    const unscheduledCount = vis.filter((t) => !t.dueAt).length;

    const done = mine.filter((t) => t.status === "done").length;
    const total = mine.filter((t) => t.status !== "archived").length;
    const targetDay = milestone?.targetDate
      ? toDayIndex(milestone.targetDate)
      : null;

    // Slip reads the data, not the filter: a hidden late task still overruns.
    const allDue = mine.flatMap((t) =>
      t.dueAt && t.status !== "archived" ? [toDayIndex(t.dueAt)] : [],
    );
    const maxDue = allDue.length ? Math.max(...allDue) : null;
    const slipEnd =
      targetDay !== null && maxDue !== null && maxDue > targetDay
        ? maxDue
        : null;

    let trackStart: number | null = null;
    let trackEnd: number | null = null;
    let dashed = false;
    if (milestone && targetDay !== null) {
      let start = prevTargetDay !== null ? prevTargetDay + 1 : targetDay - 21;
      // Extend backwards if contained work starts earlier; never invert.
      const starts = mine.flatMap((t) =>
        t.startAt ? [toDayIndex(t.startAt)] : [],
      );
      if (starts.length) start = Math.min(start, ...starts);
      trackStart = Math.min(start, targetDay);
      trackEnd = targetDay;
    } else if (milestone) {
      // No target date: dashed track over the contained tasks' extent.
      const ext = mine.flatMap((t) =>
        t.dueAt && t.status !== "archived"
          ? [toDayIndex(t.dueAt), ...(t.startAt ? [toDayIndex(t.startAt)] : [])]
          : [],
      );
      if (ext.length) {
        trackStart = Math.min(...ext);
        trackEnd = Math.max(...ext);
        dashed = true;
      }
    }

    return {
      key,
      milestone,
      colorHex: milestone ? milestoneColor(milestone.id).hex : NO_MILESTONE_HEX,
      targetDay,
      trackStart,
      trackEnd,
      dashed,
      slipEnd,
      done,
      total,
      complete: total > 0 && done === total,
      rows,
      unscheduledCount,
      dimmed: mine.length > 0 && rows.length === 0 && unscheduledCount === 0,
    };
  };

  const groups: TimelineGroup[] = [];
  let prevTargetDay: number | null = null;
  for (const m of board.milestones) {
    const g = buildGroup(m.id, m, prevTargetDay);
    groups.push(g);
    if (g.targetDay !== null) prevTargetDay = g.targetDay;
  }
  // Trailing "No milestone" group — only when it has anything to say.
  const noneAll = allBy.get("none") ?? [];
  if (noneAll.length > 0) {
    groups.push(buildGroup("none", null, null));
  }

  // Tray: undated visible tasks, milestone order then orderKey — same
  // reading order as the board's backlog.
  const milestoneRank = new Map<string, number>(
    board.milestones.map((m, i) => [m.id, i]),
  );
  const unscheduled = visible
    .filter((t) => !t.dueAt && t.status !== "archived")
    .sort((a, b) => {
      const ra = a.milestoneId
        ? (milestoneRank.get(a.milestoneId) ?? 999)
        : 1000;
      const rb = b.milestoneId
        ? (milestoneRank.get(b.milestoneId) ?? 999)
        : 1000;
      return (
        ra - rb ||
        (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0)
      );
    });

  // Slip hatches may extend past the snapped end — keep them on canvas.
  for (const g of groups) {
    if (g.slipEnd !== null && g.slipEnd + 14 > endDay)
      endDay = sundayOf(g.slipEnd) + 14;
  }

  return {
    groups,
    unscheduled,
    originDay,
    endDay,
    todayDay: today,
    totalTasks: all.filter((t) => t.status !== "archived").length,
    visibleScheduled: groups.reduce((n, g) => n + g.rows.length, 0),
  };
}
