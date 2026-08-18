// Shared task-filter predicate, lifted out of BoardView so Board and List apply
// identical semantics: a card visible in one view is visible in the other. The
// milestone filter comes from the Sidebar (URL `?milestone=`); tag chips and the
// ⌘K query live in the view toolbar. Archived is handled separately (lane/row
// selection), not here.

import type { Task } from "@monkyesuite/shared";
import { shortTaskId } from "./short-id";

export type TaskFilter = {
  milestoneFilter: string; // "all" | milestoneId
  tagFilter: Set<string>;
  query: string; // raw, un-trimmed
};

export function matchesTaskFilter(
  t: Task,
  f: TaskFilter,
  projectSlug: string,
): boolean {
  if (f.milestoneFilter !== "all" && t.milestoneId !== f.milestoneFilter)
    return false;
  // AND semantics: a card matches only if it carries every selected tag.
  if (f.tagFilter.size > 0) {
    const taskTagIds = new Set((t.tags ?? []).map((tag) => tag.id));
    for (const wanted of f.tagFilter) {
      if (!taskTagIds.has(wanted)) return false;
    }
  }
  const q = f.query.trim().toLowerCase();
  if (!q) return true;
  const id = shortTaskId(projectSlug, t.id).toLowerCase();
  return (
    t.title.toLowerCase().includes(q) ||
    (t.body ?? "").toLowerCase().includes(q) ||
    id.includes(q)
  );
}

// Whether any narrowing filter is engaged. Drives List's empty-group behaviour:
// with a filter active, empty milestone groups are hidden; with none, they stay
// visible because an empty milestone is itself triage signal.
export function isFilterActive(f: TaskFilter): boolean {
  return (
    f.milestoneFilter !== "all" ||
    f.tagFilter.size > 0 ||
    f.query.trim() !== ""
  );
}
