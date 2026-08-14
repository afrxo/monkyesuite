import type { Board, BoardLane, Task, TaskStatus } from "@monkyesuite/shared";
import { TASK_STATUSES } from "@monkyesuite/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ScopedError } from "../components/scoped";
import { api } from "../lib/api";
import { BoardView } from "../workspace/BoardView";
import { DocsPanel } from "../workspace/DocsPanel";
import { GamesPanel } from "../workspace/GamesPanel";
import { MembersPanel } from "../workspace/MembersPanel";
import { NotesPanel } from "../workspace/NotesPanel";

export const Route = createFileRoute("/projects/$id")({
  component: WorkspacePage,
});

type Tab = "board" | "docs" | "notes" | "games" | "members";
const TABS: Tab[] = ["board", "docs", "notes", "games", "members"];

function WorkspacePage() {
  const { id } = Route.useParams();
  const [tab, setTab] = useState<Tab>("board");
  const project = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.project(id),
  });

  if (project.isError) return <ScopedError error={project.error} />;
  if (project.isPending) return <p className="text-sm text-text-5">Loading…</p>;

  const p = project.data;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text-1">{p.name}</h1>
          <p className="text-xs text-text-4">
            /{p.slug} · {p.status} · {p.counts.members} member
            {p.counts.members === 1 ? "" : "s"} · {p.counts.openTasks} open
          </p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm capitalize transition ${
              tab === t
                ? "border-neutral-100 text-text-1"
                : "border-transparent text-text-4 hover:text-text-2"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "board" ? <BoardTab projectId={id} /> : null}
      {tab === "docs" ? <DocsPanel projectId={id} /> : null}
      {tab === "notes" ? <NotesPanel projectId={id} /> : null}
      {tab === "games" ? <GamesPanel projectId={id} /> : null}
      {tab === "members" ? (
        <MembersPanel projectId={id} ownRole={p.membership.role} />
      ) : null}
    </div>
  );
}

// The board tab owns the milestone filter + create-task/create-milestone
// mutations; the pure rendering + drag wiring lives in BoardView.
function BoardTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const board = useQuery({
    queryKey: ["board", projectId],
    queryFn: () => api.board(projectId),
  });
  const [milestoneId, setMilestoneId] = useState<string | "all" | "none">(
    "all",
  );

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["board", projectId] });

  if (board.isError) return <ScopedError error={board.error} />;
  if (board.isPending)
    return <p className="text-sm text-text-5">Loading board…</p>;

  return (
    <BoardView
      projectId={projectId}
      board={board.data}
      milestoneFilter={milestoneId}
      onFilter={setMilestoneId}
      onChanged={invalidate}
    />
  );
}

export type { Board, BoardLane, Task, TaskStatus };
export { TASK_STATUSES };
