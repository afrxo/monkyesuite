// List data pipeline: flatten the board's lanes into top-level tasks, filter
// (shared predicate + archived), group by milestone in Sidebar order, and sort
// within each group. Pure + memoized — no fetching; the board query is the
// single source (shared cache with Board).

import type { Board, Milestone, Task, TaskStatus } from "@monkyesuite/shared";
import { TASK_STATUSES } from "@monkyesuite/shared";
import { useMemo } from "react";
import { matchesTaskFilter, type TaskFilter } from "../taskFilter";

export type GroupBy = "milestone" | "none";
// null = default order (status rank, then orderKey). A column sort is tri-state:
// asc → desc → back to null.
export type SortColumn =
  | "status"
  | "title"
  | "tags"
  | "assignees"
  | "date"
  | "signals";
export type SortDir = "asc" | "desc";
export type Sort = { column: SortColumn; dir: SortDir } | null;

export type ListGroup = {
  key: string; // milestoneId, "none" (no milestone), or "all" (flat)
  milestone: Milestone | null;
  label: string;
  parents: Task[]; // ordered top-level tasks (subtasks live on task.subtasks)
  doneCount: number; // top-level tasks with status "done"
  totalCount: number; // top-level tasks in group
  targetDate: string | null;
};

// Canonical status order (enum order) → rank. Drives default sort so a group
// reads as its own mini-pipeline, matching Board's left-to-right lane order.
const STATUS_RANK: Record<TaskStatus, number> = TASK_STATUSES.reduce(
  (acc, s, i) => {
    acc[s] = i;
    return acc;
  },
  {} as Record<TaskStatus, number>,
);

const signalWeight = (t: Task): number => {
  const c = t.counts;
  const subs = t.subtasks?.length ?? 0;
  return (
    subs +
    (c ? c.comments + c.attachments + c.checklistTotal : 0) +
    (t.coverUrl ? 1 : 0)
  );
};

// Compare within a group. Default (sort null) is status rank then orderKey; a
// column sort applies its comparator then falls back to the default ordering so
// ties stay stable and pipeline-ordered.
function comparator(sort: Sort): (a: Task, b: Task) => number {
  const byDefault = (a: Task, b: Task): number =>
    STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
    (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0);
  if (!sort) return byDefault;
  const sign = sort.dir === "asc" ? 1 : -1;
  const primary = (a: Task, b: Task): number => {
    switch (sort.column) {
      case "status":
        return STATUS_RANK[a.status] - STATUS_RANK[b.status];
      case "title":
        return a.title.localeCompare(b.title);
      case "tags":
        return (a.tags?.length ?? 0) - (b.tags?.length ?? 0);
      case "assignees":
        return (a.assignees?.length ?? 0) - (b.assignees?.length ?? 0);
      case "date": {
        // Nulls always sort last regardless of direction.
        const av = a.dueAt ? Date.parse(a.dueAt) : null;
        const bv = b.dueAt ? Date.parse(b.dueAt) : null;
        if (av === null && bv === null) return 0;
        if (av === null) return sign; // push to end
        if (bv === null) return -sign;
        return av - bv;
      }
      case "signals":
        return signalWeight(a) - signalWeight(b);
    }
  };
  return (a, b) => sign * primary(a, b) || byDefault(a, b);
}

export type UseListRowsArgs = {
  board: Board;
  filter: TaskFilter;
  projectSlug: string;
  showArchived: boolean;
  groupBy: GroupBy;
  sort: Sort;
};

export type UseListRowsResult = {
  groups: ListGroup[];
  totalShown: number; // total parent rows across all groups (for empty states)
};

export function useListRows({
  board,
  filter,
  projectSlug,
  showArchived,
  groupBy,
  sort,
}: UseListRowsArgs): UseListRowsResult {
  // `filter` is memoized by the caller, so it's a stable dependency.
  return useMemo(() => {
    // Flatten: board.lanes carry only top-level tasks (subtasks are nested on
    // each parent's `.subtasks`). Filter parents by the shared predicate +
    // archived visibility.
    const keepStatus = (s: TaskStatus): boolean =>
      showArchived || s !== "archived";
    const parents: Task[] = [];
    for (const lane of board.lanes) {
      for (const t of lane.tasks) {
        if (!keepStatus(t.status)) continue;
        if (!matchesTaskFilter(t, filter, projectSlug)) continue;
        // Subtasks always ride under their parent (even if their own milestone
        // differs) — only archived visibility is applied to them.
        const subtasks = keepStatus("archived")
          ? t.subtasks
          : (t.subtasks ?? []).filter((s) => s.status !== "archived");
        parents.push({ ...t, subtasks });
      }
    }

    const cmp = comparator(sort);

    if (groupBy === "none") {
      const ordered = [...parents].sort(cmp);
      const group: ListGroup = {
        key: "all",
        milestone: null,
        label: "All tasks",
        parents: ordered,
        doneCount: ordered.filter((t) => t.status === "done").length,
        totalCount: ordered.length,
        targetDate: null,
      };
      return { groups: [group], totalShown: ordered.length };
    }

    // Group by milestone, in board.milestones order (== Sidebar order, both
    // orderKey asc). Empty milestone groups are kept when no filter is active;
    // the caller (isFilterActive) decides — here we always build them and the
    // component hides empties under an active filter.
    const byMilestone = new Map<string, Task[]>();
    for (const t of parents) {
      const k = t.milestoneId ?? "none";
      const list = byMilestone.get(k) ?? [];
      list.push(t);
      byMilestone.set(k, list);
    }

    const groups: ListGroup[] = [];
    const build = (
      key: string,
      milestone: Milestone | null,
      label: string,
    ): ListGroup => {
      const list = (byMilestone.get(key) ?? []).sort(cmp);
      return {
        key,
        milestone,
        label,
        parents: list,
        doneCount: list.filter((t) => t.status === "done").length,
        totalCount: list.length,
        targetDate: milestone?.targetDate ?? null,
      };
    };
    for (const m of board.milestones) {
      groups.push(build(m.id, m, m.name));
    }
    // "No milestone" always last.
    groups.push(build("none", null, "No milestone"));

    return { groups, totalShown: parents.length };
  }, [board, filter, projectSlug, showArchived, groupBy, sort]);
}
