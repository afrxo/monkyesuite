// buildTimelineModel is the pure heart of the timeline: payload in, row model
// out. These tests pin the derived-date rules — track spans, the slip hatch,
// bar-vs-marker, the range snap — since every one is invisible-until-wrong.

import type { Board, Milestone, Task, TaskStatus } from "@monkyesuite/shared";
import { describe, expect, it } from "vitest";
import { toDayIndex } from "../../lib/day";
import type { TaskFilter } from "../taskFilter";
import { buildTimelineModel } from "./useTimelineModel";

const TODAY = toDayIndex("2026-08-19");

const iso = (day: string) => `${day}T00:00:00.000Z`;

let seq = 0;
function makeTask(over: Partial<Task> & { title: string }): Task {
  seq += 1;
  return {
    id: `t-${seq}`,
    projectId: "p1",
    milestoneId: null,
    parentTaskId: null,
    body: null,
    status: "todo",
    priority: "none",
    orderKey: `a${String(seq).padStart(3, "0")}`,
    assignees: [],
    universeId: null,
    game: null,
    createdBy: "u1",
    createdAt: iso("2026-08-01"),
    updatedAt: iso("2026-08-01"),
    dueAt: null,
    startAt: null,
    coverUrl: null,
    tags: [],
    subtasks: [],
    ...over,
  };
}

function makeMilestone(over: Partial<Milestone> & { id: string }): Milestone {
  return {
    projectId: "p1",
    name: over.id,
    description: null,
    status: "planned",
    orderKey: over.id,
    targetDate: null,
    createdBy: "u1",
    createdAt: iso("2026-08-01"),
    ...over,
  };
}

function makeBoard(milestones: Milestone[], tasks: Task[]): Board {
  const statuses: TaskStatus[] = [
    "backlog",
    "todo",
    "in_progress",
    "review",
    "done",
    "archived",
  ];
  return {
    projectId: "p1",
    milestones,
    lanes: statuses.map((status) => ({
      status,
      tasks: tasks.filter((t) => t.status === status),
    })),
  };
}

const noFilter: TaskFilter = {
  milestoneFilter: "all",
  tagFilter: new Set(),
  query: "",
};

const build = (
  board: Board,
  over: Partial<Parameters<typeof buildTimelineModel>[0]> = {},
) =>
  buildTimelineModel({
    board,
    filter: noFilter,
    projectSlug: "sg",
    showArchived: false,
    today: TODAY,
    ...over,
  });

describe("buildTimelineModel", () => {
  it("renders a due-only task as a marker (startDay null), never a bar", () => {
    const board = makeBoard(
      [],
      [makeTask({ title: "due only", dueAt: iso("2026-08-25") })],
    );
    const m = build(board);
    const row = m.groups.find((g) => g.key === "none")?.rows[0];
    expect(row).toBeDefined();
    expect(row?.startDay).toBeNull();
    expect(row?.dueDay).toBe(toDayIndex("2026-08-25"));
  });

  it("computes the slip hatch when contained work is due past the target", () => {
    const ms = makeMilestone({ id: "m1", targetDate: iso("2026-09-22") });
    const board = makeBoard(
      [ms],
      [
        makeTask({
          title: "anti-cheat",
          milestoneId: "m1",
          startAt: iso("2026-09-18"),
          dueAt: iso("2026-09-29"),
        }),
      ],
    );
    const g = build(board).groups.find((x) => x.key === "m1");
    expect(g?.slipEnd).toBe(toDayIndex("2026-09-29"));
    expect(g?.targetDay).toBe(toDayIndex("2026-09-22"));
  });

  it("has no slip when everything fits inside the target", () => {
    const ms = makeMilestone({ id: "m1", targetDate: iso("2026-09-22") });
    const board = makeBoard(
      [ms],
      [
        makeTask({
          title: "fits",
          milestoneId: "m1",
          dueAt: iso("2026-09-20"),
        }),
      ],
    );
    expect(build(board).groups[0]?.slipEnd).toBeNull();
  });

  it("derives the first track's start as target − 21 days, next as prev target + 1", () => {
    const m1 = makeMilestone({ id: "m1", targetDate: iso("2026-08-28") });
    const m2 = makeMilestone({ id: "m2", targetDate: iso("2026-09-22") });
    const model = build(makeBoard([m1, m2], []));
    const [g1, g2] = model.groups;
    expect(g1?.trackStart).toBe(toDayIndex("2026-08-28") - 21);
    expect(g2?.trackStart).toBe(toDayIndex("2026-08-28") + 1);
  });

  it("extends a track backwards when contained work starts earlier", () => {
    const m1 = makeMilestone({ id: "m1", targetDate: iso("2026-08-28") });
    const board = makeBoard(
      [m1],
      [
        makeTask({
          title: "early",
          milestoneId: "m1",
          startAt: iso("2026-07-15"),
          dueAt: iso("2026-08-20"),
        }),
      ],
    );
    expect(build(board).groups[0]?.trackStart).toBe(toDayIndex("2026-07-15"));
  });

  it("gives a milestone without target a dashed track over its tasks' extent", () => {
    const m1 = makeMilestone({ id: "m1" });
    const board = makeBoard(
      [m1],
      [
        makeTask({
          title: "a",
          milestoneId: "m1",
          startAt: iso("2026-08-20"),
          dueAt: iso("2026-08-24"),
        }),
      ],
    );
    const g = build(board).groups[0];
    expect(g?.dashed).toBe(true);
    expect(g?.trackStart).toBe(toDayIndex("2026-08-20"));
    expect(g?.trackEnd).toBe(toDayIndex("2026-08-24"));
  });

  it("marks overdue only for non-done tasks", () => {
    const board = makeBoard(
      [],
      [
        makeTask({ title: "late", dueAt: iso("2026-08-14") }),
        makeTask({ title: "done", dueAt: iso("2026-08-14"), status: "done" }),
      ],
    );
    const rows = build(board).groups.find((g) => g.key === "none")?.rows ?? [];
    expect(rows.find((r) => r.task.title === "late")?.late).toBe(true);
    expect(rows.find((r) => r.task.title === "done")?.late).toBe(false);
  });

  it("keeps the range at least 8 weeks and always includes today", () => {
    const board = makeBoard(
      [],
      [makeTask({ title: "single", dueAt: iso("2026-08-19") })],
    );
    const m = build(board);
    expect(m.endDay - m.originDay + 1).toBeGreaterThanOrEqual(56);
    expect(m.originDay).toBeLessThanOrEqual(TODAY);
    expect(m.endDay).toBeGreaterThanOrEqual(TODAY);
  });

  it("extends the range for a far-future due date instead of clamping", () => {
    const board = makeBoard(
      [],
      [makeTask({ title: "far", dueAt: iso("2029-08-19") })],
    );
    expect(build(board).endDay).toBeGreaterThanOrEqual(
      toDayIndex("2029-08-19"),
    );
  });

  it("puts undated tasks in the tray, in milestone order then orderKey", () => {
    const m1 = makeMilestone({ id: "m1", orderKey: "a" });
    const m2 = makeMilestone({ id: "m2", orderKey: "b" });
    const board = makeBoard(
      [m1, m2],
      [
        makeTask({ title: "loose", orderKey: "z" }),
        makeTask({ title: "second", milestoneId: "m2", orderKey: "a" }),
        makeTask({ title: "first", milestoneId: "m1", orderKey: "b" }),
      ],
    );
    expect(build(board).unscheduled.map((t) => t.title)).toEqual([
      "first",
      "second",
      "loose",
    ]);
  });

  it("auto-flags a fully done milestone as complete", () => {
    const m1 = makeMilestone({ id: "m1", targetDate: iso("2026-07-29") });
    const board = makeBoard(
      [m1],
      [
        makeTask({ title: "d1", milestoneId: "m1", status: "done" }),
        makeTask({ title: "d2", milestoneId: "m1", status: "done" }),
      ],
    );
    expect(build(board).groups[0]?.complete).toBe(true);
  });

  it("dims a milestone whose tasks are all filtered out but keeps its track", () => {
    const m1 = makeMilestone({ id: "m1", targetDate: iso("2026-08-28") });
    const board = makeBoard(
      [m1],
      [
        makeTask({
          title: "hidden",
          milestoneId: "m1",
          dueAt: iso("2026-08-20"),
        }),
      ],
    );
    const g = build(board, {
      filter: {
        milestoneFilter: "all",
        tagFilter: new Set(),
        query: "zz-nope",
      },
    }).groups[0];
    expect(g?.dimmed).toBe(true);
    expect(g?.trackStart).not.toBeNull();
  });

  it("hides archived tasks unless the toggle is on", () => {
    const board = makeBoard(
      [],
      [
        makeTask({
          title: "arch",
          status: "archived",
          dueAt: iso("2026-08-20"),
        }),
      ],
    );
    expect(build(board).visibleScheduled).toBe(0);
    expect(build(board, { showArchived: true }).visibleScheduled).toBe(1);
  });
});
