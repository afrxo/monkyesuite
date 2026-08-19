// Timeline view — the third renderer over the board payload (Board answers
// "what state", List answers "is it finishable", Timeline answers "does the
// schedule fit the dates we promised"). Milestones are the spine, dated tasks
// are bars/markers, undated tasks are the tray. Rendered inside BoardView
// under its shared toolbar, so tag/search/archived filters behave identically
// across all three views.
//
// All layout math is integer day indices (lib/day.ts) — `new Date(iso)`
// parsing appears nowhere in this feature.

import type { Board, Milestone, Task } from "@monkyesuite/shared";
import { useQueryClient } from "@tanstack/react-query";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../../lib/api";
import { dayIndexToIso, dayToUtcDate, todayIndex } from "../../lib/day";
import { DatePicker } from "../DatePicker";
import { hexAlpha } from "../milestone-color";
import { isFilterActive, type TaskFilter } from "../taskFilter";
import { BAR_H, MONTH_ABBR, ROW_MS, ROW_TASK } from "./geometry";
import { MilestoneTrack } from "./MilestoneTrack";
import { TaskBar } from "./TaskBar";
import { TimelineAxis } from "./TimelineAxis";
import { TimelineOverlay } from "./TimelineOverlay";
import { tagDotColor } from "./tag-dot";
import { UnscheduledTray } from "./UnscheduledTray";
import { type DragCommit, useTimelineDrag } from "./useBarDrag";
import {
  type TimelineGroup,
  type TimelineTaskRow,
  useTimelineModel,
} from "./useTimelineModel";
import {
  GUTTER_W,
  loadPrefs,
  savePrefs,
  useTimelineScale,
  ZOOM_ORDER,
  type ZoomKey,
} from "./useTimelineScale";

const ZOOM_LABEL: Record<ZoomKey, string> = {
  quarter: "Quarters",
  month: "Months",
  week: "Weeks",
  day: "Days",
};

// 3-day default span for a freshly scheduled task — a 1px bar can't be grabbed.
const DEFAULT_SPAN = 2;

// Lane group key → milestoneId patch value. undefined = untouched, null =
// clear ("No milestone" row).
const groupKeyToMilestone = (key: string | null): string | null | undefined =>
  key === null ? undefined : key === "none" ? null : key;

type Props = {
  board: Board;
  projectId: string;
  projectSlug: string;
  milestoneFilter: string;
  tagFilter: Set<string>;
  query: string;
  showArchived: boolean;
  onOpenCard: (taskId: string) => void;
  onClearFilters: () => void;
};

type SchedulePatch = {
  startDay: number | null;
  dueDay: number | null;
  /** undefined = leave milestone untouched; null = clear it */
  milestoneId?: string | null;
};

export function TimelineView({
  board,
  projectId,
  projectSlug,
  milestoneFilter,
  tagFilter,
  query,
  showArchived,
  onOpenCard,
  onClearFilters,
}: Props) {
  const qc = useQueryClient();
  const filter: TaskFilter = useMemo(
    () => ({ milestoneFilter, tagFilter, query }),
    [milestoneFilter, tagFilter, query],
  );

  const model = useTimelineModel({ board, filter, projectSlug, showArchived });
  const scale = useTimelineScale({
    projectId,
    originDay: model.originDay,
    endDay: model.endDay,
    todayDay: model.todayDay,
  });
  const { x, dayWidth, canvasWidth } = scale;

  /* ------------------------- view preferences ---------------------------- */

  const [trayOpen, setTrayOpen] = useState(() => loadPrefs(projectId).trayOpen);
  // Milestone collapse. Completed groups auto-collapse on first load; the
  // user's explicit choice (either direction) persists per project.
  const [userCollapsed, setUserCollapsed] = useState<Set<string>>(
    () => new Set(loadPrefs(projectId).collapsedMilestoneIds),
  );
  const [userExpanded, setUserExpanded] = useState<Set<string>>(
    () => new Set(loadPrefs(projectId).expandedMilestoneIds),
  );
  useEffect(() => {
    setTrayOpen(loadPrefs(projectId).trayOpen);
    setUserCollapsed(new Set(loadPrefs(projectId).collapsedMilestoneIds));
    setUserExpanded(new Set(loadPrefs(projectId).expandedMilestoneIds));
  }, [projectId]);
  useEffect(() => {
    savePrefs(projectId, {
      zoom: scale.zoom,
      trayOpen,
      collapsedMilestoneIds: [...userCollapsed],
      expandedMilestoneIds: [...userExpanded],
    });
  }, [projectId, scale.zoom, trayOpen, userCollapsed, userExpanded]);

  const isCollapsed = (g: TimelineGroup): boolean =>
    userCollapsed.has(g.key) || (g.complete && !userExpanded.has(g.key));
  const toggleCollapse = (g: TimelineGroup) => {
    const collapsed = isCollapsed(g);
    setUserCollapsed((prev) => {
      const n = new Set(prev);
      if (collapsed) n.delete(g.key);
      else if (!g.complete) n.add(g.key);
      return n;
    });
    setUserExpanded((prev) => {
      if (!g.complete) return prev;
      const n = new Set(prev);
      if (collapsed) n.add(g.key);
      else n.delete(g.key);
      return n;
    });
  };

  /* --------------------------- write pipeline ---------------------------- */

  // Optimistic + debounced task writes. Apply locally on drop; the PATCH is
  // coalesced so a drag ending within 400ms of the previous one on the same
  // task replaces the pending request. On failure roll back to the pre-drag
  // geometry and surface the error inline on the row.
  const [rowErrors, setRowErrors] = useState<Map<string, string>>(
    () => new Map(),
  );
  const errorTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const sendTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const preDrag = useRef(
    new Map<
      string,
      {
        startAt: string | null;
        dueAt: string | null;
        milestoneId: string | null;
      }
    >(),
  );

  const showRowError = useCallback((taskId: string, message: string) => {
    setRowErrors((prev) => new Map(prev).set(taskId, message));
    const timers = errorTimers.current;
    const old = timers.get(taskId);
    if (old) clearTimeout(old);
    timers.set(
      taskId,
      setTimeout(() => {
        setRowErrors((prev) => {
          const n = new Map(prev);
          n.delete(taskId);
          return n;
        });
        timers.delete(taskId);
      }, 4000),
    );
  }, []);

  const mutateBoardTask = useCallback(
    (taskId: string, fn: (t: Task) => Task) => {
      qc.setQueryData<Board>(["board", projectId], (old) =>
        old
          ? {
              ...old,
              lanes: old.lanes.map((lane) => ({
                ...lane,
                tasks: lane.tasks.map((t) => (t.id === taskId ? fn(t) : t)),
              })),
            }
          : old,
      );
    },
    [qc, projectId],
  );

  const commitSchedule = useCallback(
    (task: Task, patch: SchedulePatch) => {
      const startAt =
        patch.startDay === null ? null : dayIndexToIso(patch.startDay);
      const dueAt = patch.dueDay === null ? null : dayIndexToIso(patch.dueDay);
      const milestoneId =
        patch.milestoneId === undefined ? undefined : patch.milestoneId;

      if (!preDrag.current.has(task.id)) {
        preDrag.current.set(task.id, {
          startAt: task.startAt,
          dueAt: task.dueAt,
          milestoneId: task.milestoneId,
        });
      }
      mutateBoardTask(task.id, (t) => ({
        ...t,
        startAt,
        dueAt,
        ...(milestoneId !== undefined ? { milestoneId } : {}),
      }));

      const timers = sendTimers.current;
      const old = timers.get(task.id);
      if (old) clearTimeout(old);
      timers.set(
        task.id,
        setTimeout(async () => {
          timers.delete(task.id);
          try {
            await api.patchTask(task.id, {
              startAt,
              dueAt,
              ...(milestoneId !== undefined ? { milestoneId } : {}),
            });
            preDrag.current.delete(task.id);
            qc.invalidateQueries({ queryKey: ["board", projectId] });
          } catch (err) {
            const orig = preDrag.current.get(task.id);
            preDrag.current.delete(task.id);
            if (orig) mutateBoardTask(task.id, (t) => ({ ...t, ...orig }));
            showRowError(
              task.id,
              err instanceof Error ? err.message : "Save failed",
            );
          }
        }, 400),
      );
    },
    [mutateBoardTask, projectId, qc, showRowError],
  );

  const commitTarget = useCallback(
    async (milestoneId: string, day: number | null) => {
      const iso = day === null ? null : dayIndexToIso(day);
      const snapshot = qc.getQueryData<Board>(["board", projectId]);
      qc.setQueryData<Board>(["board", projectId], (old) =>
        old
          ? {
              ...old,
              milestones: old.milestones.map(
                (m): Milestone =>
                  m.id === milestoneId ? { ...m, targetDate: iso } : m,
              ),
            }
          : old,
      );
      try {
        await api.patchMilestone(milestoneId, { targetDate: iso });
        qc.invalidateQueries({ queryKey: ["board", projectId] });
      } catch {
        if (snapshot) qc.setQueryData(["board", projectId], snapshot);
      }
    },
    [qc, projectId],
  );

  const taskById = useCallback(
    (id: string): Task | null => {
      for (const lane of board.lanes)
        for (const t of lane.tasks) if (t.id === id) return t;
      return null;
    },
    [board],
  );

  /* ------------------------------- drag ----------------------------------- */

  const onDragCommit = useCallback(
    (c: DragCommit) => {
      const { spec, dayDelta, targetGroupKey, pointerDay } = c;
      if (spec.kind === "diamond") {
        if (dayDelta !== 0)
          void commitTarget(spec.milestoneId, spec.targetDay + dayDelta);
        return;
      }
      const task = taskById(spec.taskId);
      if (!task) return;
      if (spec.kind === "tray") {
        if (targetGroupKey === null || pointerDay === null) return;
        const milestone = groupKeyToMilestone(targetGroupKey);
        commitSchedule(task, {
          startDay: pointerDay,
          dueDay: pointerDay + DEFAULT_SPAN,
          ...(milestone !== undefined && milestone !== task.milestoneId
            ? { milestoneId: milestone }
            : {}),
        });
        return;
      }
      const crossGroup =
        targetGroupKey !== null && targetGroupKey !== spec.groupKey
          ? groupKeyToMilestone(targetGroupKey)
          : undefined;
      if (dayDelta === 0 && crossGroup === undefined) return;
      switch (spec.kind) {
        case "move":
        case "marker":
          commitSchedule(task, {
            startDay: spec.startDay === null ? null : spec.startDay + dayDelta,
            dueDay: spec.dueDay + dayDelta,
            ...(crossGroup !== undefined ? { milestoneId: crossGroup } : {}),
          });
          return;
        case "resize-due":
          commitSchedule(task, {
            startDay: spec.startDay,
            dueDay: Math.max(spec.startDay, spec.dueDay + dayDelta),
          });
          return;
        case "resize-start":
          commitSchedule(task, {
            startDay: Math.min(spec.dueDay, spec.startDay + dayDelta),
            dueDay: spec.dueDay,
          });
          return;
      }
    },
    [commitSchedule, commitTarget, taskById],
  );

  const { live, startDrag, justDragged } = useTimelineDrag({
    dayWidth,
    originDay: model.originDay,
    onCommit: onDragCommit,
  });

  /* ----------------------------- keyboard --------------------------------- */

  const onNudge = useCallback(
    (row: TimelineTaskRow, edit: "move" | "due" | "start", delta: number) => {
      const { task, startDay, dueDay } = row;
      if (edit === "move" || startDay === null) {
        commitSchedule(task, {
          startDay: startDay === null ? null : startDay + delta,
          dueDay: dueDay + delta,
        });
      } else if (edit === "due") {
        commitSchedule(task, {
          startDay,
          dueDay: Math.max(startDay, dueDay + delta),
        });
      } else {
        commitSchedule(task, {
          startDay: Math.min(dueDay, startDay + delta),
          dueDay,
        });
      }
    },
    [commitSchedule],
  );

  const onClearDates = useCallback(
    (taskId: string) => {
      const task = taskById(taskId);
      if (task) commitSchedule(task, { startDay: null, dueDay: null });
    },
    [commitSchedule, taskById],
  );

  const gridRef = useRef<HTMLDivElement>(null);
  const onFocusMove = useCallback((el: HTMLElement, dir: -1 | 1) => {
    const root = gridRef.current;
    if (!root) return;
    const bars = [...root.querySelectorAll<HTMLElement>("[data-tl-bar]")];
    const i = bars.indexOf(el);
    const next = bars[i + dir];
    next?.focus();
  }, []);

  const onContainerKey = useCallback(
    (e: React.KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && t.dataset.tlBar) return; // bar handled it
      if (e.key === "[") {
        e.preventDefault();
        scale.zoomStep(-1);
      } else if (e.key === "]") {
        e.preventDefault();
        scale.zoomStep(1);
      } else if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        scale.scrollToToday();
      }
    },
    [scale],
  );

  /* ------------------------------ render ---------------------------------- */

  const filterActive = isFilterActive(filter);
  const visibleGroups = filterActive
    ? model.groups.filter(
        (g) => g.rows.length > 0 || g.unscheduledCount > 0 || g.dimmed,
      )
    : model.groups;

  const trayDragging = live?.engaged && live.spec.kind === "tray" ? live : null;
  const reassignTarget =
    live?.engaged &&
    (live.spec.kind === "move" ||
      live.spec.kind === "marker" ||
      live.spec.kind === "tray")
      ? live.targetGroupKey
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#0c0c0c]">
      {/* Timeline-specific chrome: zoom presets + Today / Fit */}
      <div className="flex items-center gap-2 border-b border-border-1 bg-surface-0 px-4 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
          Zoom
        </span>
        <div className="flex gap-0.5">
          {ZOOM_ORDER.map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => scale.setZoom(z)}
              className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                scale.zoom === z
                  ? "bg-white/[0.06] text-text-1"
                  : "text-text-3 hover:text-text-1"
              }`}
            >
              {ZOOM_LABEL[z]}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => scale.scrollToToday()}
          className="rounded border border-border-2 px-2 py-0.5 text-[11px] text-text-3 hover:text-text-1"
          title="Scroll to today (T)"
        >
          Today
        </button>
        <button
          type="button"
          onClick={scale.fit}
          className="rounded border border-border-2 px-2 py-0.5 text-[11px] text-text-3 hover:text-text-1"
          title="Fit the whole range"
        >
          Fit
        </button>
      </div>

      {/* biome-ignore lint/a11y/noStaticElementInteractions: canvas-level shortcuts */}
      <div
        ref={scale.scrollRef}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: intentional focus zone
        tabIndex={0}
        onKeyDown={onContainerKey}
        className="ws-scroll relative min-h-0 flex-1 overflow-auto outline-none"
      >
        {/* biome-ignore lint/a11y/useSemanticElements: a timeline canvas is a grid, not a table */}
        <div
          ref={gridRef}
          role="grid"
          aria-label="Project timeline"
          className="relative grid text-[12px]"
          style={{ gridTemplateColumns: `${GUTTER_W}px ${canvasWidth}px` }}
        >
          <TimelineOverlay
            originDay={model.originDay}
            endDay={model.endDay}
            todayDay={model.todayDay}
            zoom={scale.zoom}
            x={x}
            gutterWidth={GUTTER_W}
            canvasWidth={canvasWidth}
          />

          {/* axis */}
          <div
            className="sticky left-0 top-0 z-[5] flex items-end border-b border-border-2 border-r border-r-border-1 bg-surface-0 px-3 pb-[7px]"
            style={{ height: 52 }}
          >
            <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-text-disabled">
              Milestone / Task
            </span>
          </div>
          <TimelineAxis
            originDay={model.originDay}
            endDay={model.endDay}
            todayDay={model.todayDay}
            zoom={scale.zoom}
            x={x}
            dayWidth={dayWidth}
          />

          {model.totalTasks === 0 ? (
            <CanvasNote text="Add a task on the board to see it here." />
          ) : model.visibleScheduled === 0 && !filterActive ? (
            <CanvasNote text="Drag a task onto the timeline to schedule it." />
          ) : null}

          {visibleGroups.map((g) => {
            const collapsed = isCollapsed(g);
            return (
              <Fragment key={g.key}>
                {/* milestone row */}
                <div className="contents" data-tl-grouprow={g.key}>
                  <div
                    className="sticky left-0 z-[3] flex items-center gap-[7px] overflow-hidden border-b border-r border-border-1 bg-surface-0 px-3"
                    style={{ height: ROW_MS }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleCollapse(g)}
                      aria-label={collapsed ? "Expand group" : "Collapse group"}
                      className="w-[11px] shrink-0 text-[9px] text-text-3"
                    >
                      {collapsed ? "▸" : "▾"}
                    </button>
                    <span
                      className="h-[7px] w-[7px] shrink-0 rounded-full"
                      style={{ background: g.colorHex }}
                    />
                    <span className="truncate text-[12px] font-medium text-text-1">
                      {g.milestone ? g.milestone.name : "No milestone"}
                    </span>
                    <GroupMeta group={g} collapsed={collapsed} />
                    {g.milestone && g.targetDay === null ? (
                      <span className="shrink-0">
                        <DatePicker
                          value={null}
                          title="Set target date"
                          onChange={(iso) => {
                            const m = g.milestone;
                            if (m)
                              void api
                                .patchMilestone(m.id, { targetDate: iso })
                                .then(() =>
                                  qc.invalidateQueries({
                                    queryKey: ["board", projectId],
                                  }),
                                );
                          }}
                        />
                      </span>
                    ) : null}
                  </div>
                  <div
                    data-tl-lane
                    data-tl-group={g.key}
                    className="relative z-[2] border-b border-border-1"
                    style={{
                      height: ROW_MS,
                      background:
                        reassignTarget === g.key
                          ? "rgba(255,255,255,.03)"
                          : undefined,
                    }}
                  >
                    <MilestoneTrack
                      group={g}
                      x={x}
                      dayWidth={dayWidth}
                      editable
                      dragLive={live}
                      startDrag={startDrag}
                    />
                    {trayDragging &&
                    reassignTarget === g.key &&
                    live?.pointerDay != null ? (
                      <DropPreview
                        x={x}
                        day={live.pointerDay}
                        dayWidth={dayWidth}
                        rowH={ROW_MS}
                      />
                    ) : null}
                  </div>
                </div>

                {collapsed
                  ? null
                  : g.rows.length === 0
                    ? (g.unscheduledCount > 0 || g.dimmed) && (
                        <Fragment>
                          <div
                            className="sticky left-0 z-[3] flex items-center border-b border-r border-border-1 bg-surface-0 px-3"
                            style={{ height: ROW_TASK }}
                          >
                            <span className="ml-auto font-mono text-[10px] text-text-disabled">
                              {g.dimmed
                                ? "filtered out"
                                : `${g.unscheduledCount} unscheduled`}
                            </span>
                          </div>
                          <div
                            data-tl-lane
                            data-tl-group={g.key}
                            className="relative z-[2] border-b border-border-1"
                            style={{
                              height: ROW_TASK,
                              background:
                                reassignTarget === g.key
                                  ? "rgba(255,255,255,.03)"
                                  : undefined,
                            }}
                          >
                            {trayDragging &&
                            reassignTarget === g.key &&
                            live?.pointerDay != null ? (
                              <DropPreview
                                x={x}
                                day={live.pointerDay}
                                dayWidth={dayWidth}
                                rowH={ROW_TASK}
                              />
                            ) : null}
                          </div>
                        </Fragment>
                      )
                    : g.rows.map((row) => (
                        <Fragment key={row.task.id}>
                          <div
                            className="sticky left-0 z-[3] flex items-center gap-[6px] overflow-hidden border-b border-r border-border-1 bg-surface-0 px-3 pl-[26px]"
                            style={{ height: ROW_TASK }}
                          >
                            <span
                              className="h-[6px] w-[6px] shrink-0 rounded-full"
                              style={{ background: hexAlpha(g.colorHex, 0.75) }}
                            />
                            <span
                              className={`truncate text-[12px] ${
                                row.task.status === "done"
                                  ? "text-text-3"
                                  : "text-text-1"
                              }`}
                            >
                              {row.task.title}
                            </span>
                            <span className="ml-auto flex shrink-0 gap-[3px]">
                              {(row.task.tags ?? []).slice(0, 4).map((tg) => (
                                <span
                                  key={tg.id}
                                  className="h-[5px] w-[5px] rounded-full"
                                  style={{ background: tagDotColor(tg) }}
                                  title={tg.name}
                                />
                              ))}
                            </span>
                            {row.task.counts &&
                            row.task.counts.checklistTotal > 0 ? (
                              <span className="shrink-0 font-mono text-[10px] text-text-disabled">
                                {row.task.counts.checklistDone}/
                                {row.task.counts.checklistTotal}
                              </span>
                            ) : null}
                            {(row.task.subtasks ?? []).length > 0 ? (
                              <span className="shrink-0 font-mono text-[10px] text-text-disabled">
                                ▸ {(row.task.subtasks ?? []).length}
                              </span>
                            ) : null}
                          </div>
                          <div
                            data-tl-lane
                            data-tl-group={g.key}
                            className="relative z-[2] overflow-hidden border-b border-border-1"
                            style={{
                              height: ROW_TASK,
                              background:
                                reassignTarget === g.key
                                  ? "rgba(255,255,255,.03)"
                                  : undefined,
                            }}
                          >
                            <TaskBar
                              row={row}
                              colorHex={g.colorHex}
                              groupKey={g.key}
                              x={x}
                              dayWidth={dayWidth}
                              todayDay={model.todayDay}
                              editable={row.task.status !== "archived"}
                              error={rowErrors.get(row.task.id) ?? null}
                              dragLive={live}
                              justDragged={justDragged}
                              startDrag={startDrag}
                              onOpen={onOpenCard}
                              onNudge={onNudge}
                              onClear={onClearDates}
                              onFocusMove={onFocusMove}
                              onZoomKey={scale.zoomStep}
                              onToday={() => scale.scrollToToday()}
                            />
                            {trayDragging &&
                            reassignTarget === g.key &&
                            live?.pointerDay != null ? (
                              <DropPreview
                                x={x}
                                day={live.pointerDay}
                                dayWidth={dayWidth}
                                rowH={ROW_TASK}
                              />
                            ) : null}
                          </div>
                        </Fragment>
                      ))}
              </Fragment>
            );
          })}
        </div>
      </div>

      <UnscheduledTray
        tasks={model.unscheduled}
        open={trayOpen}
        onToggle={() => setTrayOpen((v) => !v)}
        editable
        dragLive={live}
        startDrag={startDrag}
        onScheduleToday={(t) => {
          const today = todayIndex();
          commitSchedule(t, { startDay: today, dueDay: today + DEFAULT_SPAN });
        }}
      />

      {/* tray-chip drag ghost follows the pointer */}
      {trayDragging && trayDragging.spec.kind === "tray" ? (
        <div
          className="pointer-events-none fixed z-50 flex items-center gap-[7px] rounded-md border border-border-2 bg-surface-1 px-2 py-1 shadow-lg"
          style={{
            left: trayDragging.pointerX + 10,
            top: trayDragging.pointerY + 8,
          }}
        >
          <span
            className="h-[7px] w-[7px] rounded-full"
            style={{ background: trayDragging.spec.colorHex }}
          />
          <span className="max-w-[220px] truncate text-[11px] text-text-1">
            {trayDragging.spec.title}
          </span>
        </div>
      ) : null}

      {filterActive &&
      model.visibleScheduled === 0 &&
      model.unscheduled.length === 0 ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 grid place-items-center">
          <div className="pointer-events-auto grid place-items-center rounded-md border border-border-1 bg-surface-0 px-5 py-4 text-center">
            <p className="text-sm text-text-3">Nothing matches the filter.</p>
            <button
              type="button"
              onClick={onClearFilters}
              className="mt-2 rounded border border-border-2 px-2.5 py-1 text-xs text-text-3 hover:text-text-1"
            >
              Clear filters
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GroupMeta({
  group,
  collapsed,
}: {
  group: TimelineGroup;
  collapsed: boolean;
}) {
  const parts: string[] = [];
  if (group.total > 0) {
    parts.push(
      collapsed && group.complete
        ? `${group.total} task${group.total === 1 ? "" : "s"} · done`
        : `${group.done}/${group.total}`,
    );
  }
  if (group.targetDay !== null) {
    const t = dayToUtcDate(group.targetDay);
    parts.push(`${MONTH_ABBR[t.getUTCMonth()]} ${t.getUTCDate()}`);
  }
  const over =
    group.slipEnd !== null && group.targetDay !== null
      ? group.slipEnd - group.targetDay
      : null;
  return (
    <span className="ml-auto shrink-0 whitespace-nowrap pl-2 font-mono text-[10px] text-text-disabled">
      {parts.join(" · ")}
      {over !== null ? (
        <span style={{ color: "var(--destructive)" }}> · {over}d over</span>
      ) : null}
    </span>
  );
}

// Phantom 3-day bar under the pointer while a tray chip hovers a lane.
function DropPreview({
  x,
  day,
  dayWidth,
  rowH,
}: {
  x: (day: number) => number;
  day: number;
  dayWidth: number;
  rowH: number;
}) {
  return (
    <div
      className="pointer-events-none absolute rounded-[5px] border border-dashed"
      style={{
        left: x(day),
        width: (DEFAULT_SPAN + 1) * dayWidth,
        height: BAR_H,
        top: (rowH - BAR_H) / 2,
        borderColor: "var(--accent-warm)",
        background: "rgba(255,255,255,.04)",
      }}
    />
  );
}

function CanvasNote({ text }: { text: string }) {
  return (
    <>
      <div className="sticky left-0 z-[3] border-b border-r border-border-1 bg-surface-0" />
      <div className="relative z-[2] border-b border-border-1 py-3 pl-4">
        <span className="text-[12px] text-text-disabled">{text}</span>
      </div>
    </>
  );
}
