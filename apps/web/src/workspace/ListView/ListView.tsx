// List view — a dense, read-only, scannable table of every task in a project,
// grouped by milestone. Board answers "what state is everything in"; List
// answers "is this milestone finishable, and what's blocking it." Rows don't
// edit in place: a click/Enter opens the shared CardModal (via onOpenCard →
// URL ?card). Shares the Board query cache, so a CardModal mutation reflects
// here with no manual refetch. Rendered inside BoardView under its shared
// toolbar (view tabs + tag/search/archived chrome); this file adds only the
// List-specific group-by toggle and sortable column headers.

import type { Board } from "@monkyesuite/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { isFilterActive, type TaskFilter } from "../taskFilter";
import { ListGroup } from "./ListGroup";
import { LIST_GRID_COLS } from "./ListRow";
import { type FlatRow, useListKeyboard } from "./useListKeyboard";
import {
  type GroupBy,
  type Sort,
  type SortColumn,
  useListRows,
} from "./useListRows";

type Props = {
  board: Board;
  projectId: string;
  projectSlug: string;
  milestoneFilter: string;
  tagFilter: Set<string>;
  query: string;
  showArchived: boolean;
  openCardTaskId: string | null;
  onOpenCard: (taskId: string) => void;
  onClearFilters: () => void;
};

const COLLAPSE_KEY = (projectId: string) =>
  `monkye:list:collapsed:${projectId}`;

const COLUMNS: { key: SortColumn; label: string; align?: "end" }[] = [
  { key: "status", label: "Status" },
  { key: "title", label: "Title" },
  { key: "tags", label: "Tags" },
  { key: "assignees", label: "Who" },
  { key: "date", label: "Due" },
  { key: "signals", label: "Progress", align: "end" },
];

function loadCollapsed(projectId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSE_KEY(projectId));
    if (!raw) return new Set();
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr)
      ? new Set(arr.filter((x): x is string => typeof x === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

export function ListView({
  board,
  projectId,
  projectSlug,
  milestoneFilter,
  tagFilter,
  query,
  showArchived,
  openCardTaskId,
  onOpenCard,
  onClearFilters,
}: Props) {
  const [groupBy, setGroupBy] = useState<GroupBy>("milestone");
  const [sort, setSort] = useState<Sort>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    loadCollapsed(projectId),
  );
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Reload collapse state when the project changes.
  useEffect(() => {
    setCollapsed(loadCollapsed(projectId));
    setExpanded(new Set());
  }, [projectId]);

  // Persist collapse state per project.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        COLLAPSE_KEY(projectId),
        JSON.stringify([...collapsed]),
      );
    } catch {
      /* storage full / unavailable — non-fatal, collapse just won't persist */
    }
  }, [projectId, collapsed]);

  const filter: TaskFilter = useMemo(
    () => ({ milestoneFilter, tagFilter, query }),
    [milestoneFilter, tagFilter, query],
  );
  const filterActive = isFilterActive(filter);

  const { groups, totalShown } = useListRows({
    board,
    filter,
    projectSlug,
    showArchived,
    groupBy,
    sort,
  });

  // Under an active filter, drop groups that ended up empty (an empty milestone
  // is signal only when nothing is narrowing the view).
  const visibleGroups = useMemo(
    () => (filterActive ? groups.filter((g) => g.totalCount > 0) : groups),
    [groups, filterActive],
  );

  // Flat, ordered list of currently-focusable rows for keyboard nav — collapsed
  // groups and collapsed subtasks are excluded.
  const flatRows = useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    for (const g of visibleGroups) {
      if (collapsed.has(g.key)) continue;
      for (const p of g.parents) {
        const subs = p.subtasks ?? [];
        out.push({
          key: p.id,
          taskId: p.id,
          isParent: true,
          hasSubtasks: subs.length > 0,
          expanded: expanded.has(p.id),
        });
        if (expanded.has(p.id)) {
          for (const s of subs)
            out.push({
              key: s.id,
              taskId: s.id,
              isParent: false,
              hasSubtasks: false,
              expanded: false,
            });
        }
      }
    }
    return out;
  }, [visibleGroups, collapsed, expanded]);

  const toggleExpandId = (taskId: string, next?: boolean) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      const want = next ?? !n.has(taskId);
      if (want) n.add(taskId);
      else n.delete(taskId);
      return n;
    });

  const { focusedKey, registerRow, focusRow, onKeyDown } = useListKeyboard({
    rows: flatRows,
    openCardTaskId,
    onOpen: onOpenCard,
    onExpand: (taskId, next) => toggleExpandId(taskId, next),
  });

  const toggleCollapse = (key: string) =>
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const cycleSort = (col: SortColumn) =>
    setSort((prev) => {
      if (!prev || prev.column !== col) return { column: col, dir: "asc" };
      if (prev.dir === "asc") return { column: col, dir: "desc" };
      return null;
    });

  const gridRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-1 min-h-0 flex-col bg-[#0c0c0c]">
      {/* List-specific control: group-by toggle */}
      <div className="flex items-center gap-2 border-b border-border-1 bg-surface-0 px-4 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
          Group
        </span>
        <div className="flex gap-0.5">
          {(["milestone", "none"] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGroupBy(g)}
              className={`rounded px-2 py-0.5 text-[11px] capitalize transition-colors ${
                groupBy === g
                  ? "bg-white/[0.06] text-text-1"
                  : "text-text-3 hover:text-text-1"
              }`}
            >
              {g === "none" ? "None" : "Milestone"}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {sort ? (
          <button
            type="button"
            onClick={() => setSort(null)}
            className="text-[11px] text-text-disabled hover:text-text-1"
            title="Reset to default order"
          >
            reset sort
          </button>
        ) : null}
      </div>

      {/* Scroll area = the list: a single roving-tabindex focus zone; arrows
          move focus onto child rows, so the container owns tabIndex + keydown. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: keydown delegates to rows */}
      <div
        ref={gridRef}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: intentional focus zone
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="ws-scroll min-h-0 flex-1 overflow-y-auto outline-none"
      >
        {/* Column header (sortable) */}
        <div
          className="sticky top-0 z-20 grid h-8 items-center gap-3 border-b border-border-1 bg-surface-0 px-4"
          style={{ gridTemplateColumns: LIST_GRID_COLS }}
        >
          {COLUMNS.map((col) => {
            const active = sort?.column === col.key;
            return (
              <button
                key={col.key}
                type="button"
                onClick={() => cycleSort(col.key)}
                className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${
                  col.align === "end" ? "justify-end" : ""
                } ${active ? "text-text-1" : "text-text-disabled hover:text-text-3"}`}
                title={`Sort by ${col.label}`}
              >
                <span>{col.label}</span>
                {active ? (
                  <span aria-hidden="true">
                    {sort?.dir === "asc" ? "↑" : "↓"}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {totalShown === 0 ? (
          <EmptyState
            filterActive={filterActive}
            milestoneFilter={milestoneFilter}
            hasTagFilter={tagFilter.size > 0}
            query={query}
            onClear={onClearFilters}
          />
        ) : (
          visibleGroups.map((g) => (
            <ListGroup
              key={g.key}
              group={g}
              flat={groupBy === "none"}
              collapsed={collapsed.has(g.key)}
              onToggleCollapse={() => toggleCollapse(g.key)}
              expanded={expanded}
              onToggleExpand={(taskId) => toggleExpandId(taskId)}
              focusedKey={focusedKey}
              projectSlug={projectSlug}
              registerRow={registerRow}
              onFocusRow={focusRow}
              onOpen={onOpenCard}
            />
          ))
        )}
      </div>
    </div>
  );
}

function EmptyState({
  filterActive,
  milestoneFilter,
  hasTagFilter,
  query,
  onClear,
}: {
  filterActive: boolean;
  milestoneFilter: string;
  hasTagFilter: boolean;
  query: string;
  onClear: () => void;
}) {
  if (!filterActive) {
    return (
      <div className="grid place-items-center px-6 py-16 text-center">
        <p className="text-sm text-text-3">No tasks yet.</p>
        <p className="mt-1 text-xs text-text-disabled">
          Add one from the board.
        </p>
      </div>
    );
  }
  const bits: string[] = [];
  if (milestoneFilter !== "all") bits.push("milestone");
  if (hasTagFilter) bits.push("tags");
  if (query.trim()) bits.push(`“${query.trim()}”`);
  return (
    <div className="grid place-items-center px-6 py-16 text-center">
      <p className="text-sm text-text-3">
        Nothing matches {bits.join(" + ") || "the active filter"}.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-2 rounded border border-border-2 px-2.5 py-1 text-xs text-text-3 hover:text-text-1"
      >
        Clear filters
      </button>
    </div>
  );
}
