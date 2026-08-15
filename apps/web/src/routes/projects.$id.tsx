// Workspace — single three-pane view (specs/05, 08-web §8.5). Board / doc
// state is a URL param (`?doc=<id>`), so the pane is linkable and back/forward
// works. The old tab-based route is gone; Members lives entirely in the topbar.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ScopedError } from "../components/scoped";
import { api } from "../lib/api";
import type { BoardViewHandle } from "../workspace/BoardView";
import { BoardView } from "../workspace/BoardView";
import { CardModal } from "../workspace/CardModal";
import { DocEditor } from "../workspace/DocEditor";
import { NotesRail } from "../workspace/NotesRail";
import { shortTaskId } from "../workspace/short-id";
import { Sidebar } from "../workspace/Sidebar";
import { Topbar } from "../workspace/Topbar";

type Search = { doc?: string; milestone?: string; card?: string };

export const Route = createFileRoute("/projects/$id")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    doc: typeof s.doc === "string" ? s.doc : undefined,
    milestone: typeof s.milestone === "string" ? s.milestone : undefined,
    card: typeof s.card === "string" ? s.card : undefined,
  }),
  component: WorkspacePage,
});

function WorkspacePage() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const project = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.project(id),
  });
  const members = useQuery({
    queryKey: ["members", id],
    queryFn: () => api.members(id),
  });
  const board = useQuery({
    queryKey: ["board", id],
    queryFn: () => api.board(id),
  });
  const qc = useQueryClient();
  const invalidateBoard = () =>
    qc.invalidateQueries({ queryKey: ["board", id] });

  const boardRef = useRef<BoardViewHandle>(null);
  const [mobileSheet, setMobileSheet] = useState<"left" | "right" | null>(null);

  // Kbd shortcuts (N / ⌘K). ⌘P is stubbed on the doc header.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField =
        !!t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable);
      if (e.key === "n" && !inField && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        boardRef.current?.focusQuickAdd();
      }
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        boardRef.current?.focusSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (project.isError) return <ScopedError error={project.error} />;
  if (project.isPending || !project.data)
    return <p className="p-6 text-sm text-text-5">Loading…</p>;

  const activeDocId = search.doc ?? null;
  const activeMilestone = search.milestone ?? "all";
  const activeCard = search.card ?? null;
  const setDoc = (docId: string | null) =>
    navigate({ search: (s) => ({ ...s, doc: docId ?? undefined }) });
  const setMilestone = (m: string | "all") =>
    navigate({
      search: (s) => ({ ...s, milestone: m === "all" ? undefined : m }),
    });
  const setCard = (cardShortId: string | null) =>
    navigate({
      search: (s) => ({ ...s, card: cardShortId ?? undefined }),
    });

  // Resolve short id like "SG-010" back to a task uuid by scanning the board
  // that's already loaded. If unresolved, keep the modal closed rather than
  // fetching by short id — the short id isn't unique per project either.
  const cardTaskId = (() => {
    if (!activeCard || !board.data) return null;
    for (const lane of board.data.lanes) {
      for (const t of lane.tasks) {
        if (shortTaskId(project.data.slug, t.id) === activeCard) return t.id;
      }
    }
    return null;
  })();

  const activeMilestoneName =
    activeMilestone === "all"
      ? null
      : (board.data?.milestones.find((m) => m.id === activeMilestone)?.name ??
        null);

  const createDoc = async () => {
    const doc = await api.createDoc(id, { title: "Untitled" });
    qc.invalidateQueries({ queryKey: ["docs", id] });
    setDoc(doc.id);
  };

  return (
    <>
      <Topbar
        project={project.data}
        members={members.data ?? []}
        activeMilestoneName={activeMilestoneName}
        onQuickAdd={() => {
          setDoc(null);
          setTimeout(() => boardRef.current?.focusQuickAdd(), 0);
        }}
      />
      <div
        data-card-modal-open={cardTaskId ? "true" : undefined}
        className="grid overflow-hidden bg-surface-0 text-text-2"
        style={{
          // Fill viewport below the 56px sticky AppHeader.
          height: "calc(100vh - 56px)",
          gridTemplateColumns: "220px 1fr 320px",
        }}
      >
        {/* Left rail — desktop */}
        <div className="hidden md:contents">
          <Sidebar
            projectId={id}
            activeDocId={activeDocId}
            activeMilestone={activeMilestone}
            onSelectDoc={setDoc}
            onSelectMilestone={setMilestone}
            onCreateDoc={createDoc}
          />
        </div>

        <main className="flex min-h-0 flex-col overflow-hidden bg-[#0c0c0c] col-span-full md:col-span-1">
        <MobileBar
          onOpenLeft={() => setMobileSheet("left")}
          onOpenRight={() => setMobileSheet("right")}
        />
        {activeDocId ? (
          <DocEditor
            docId={activeDocId}
            projectId={id}
            onExit={() => setDoc(null)}
          />
        ) : board.isPending ? (
          <p className="p-6 text-sm text-text-5">Loading board…</p>
        ) : board.data ? (
          <BoardView
            ref={boardRef}
            projectId={id}
            projectSlug={project.data.slug}
            board={board.data}
            milestoneFilter={activeMilestone}
            onChanged={invalidateBoard}
            onOpenCard={(taskId) =>
              setCard(shortTaskId(project.data.slug, taskId))
            }
          />
        ) : null}
      </main>

      {/* Right rail — desktop */}
      <div className="hidden md:contents">
        <NotesRail projectId={id} onOpenCard={() => setDoc(null)} />
      </div>

      </div>

      {cardTaskId && board.data ? (
        <CardModal
          taskId={cardTaskId}
          projectSlug={project.data.slug}
          milestones={board.data.milestones}
          onClose={() => {
            setCard(null);
            invalidateBoard();
          }}
        />
      ) : null}

      <div>
      {/* Mobile slide-over sheets */}
      {mobileSheet ? (
        <MobileSheet side={mobileSheet} onClose={() => setMobileSheet(null)}>
          {mobileSheet === "left" ? (
            <Sidebar
              projectId={id}
              activeDocId={activeDocId}
              activeMilestone={activeMilestone}
              onSelectDoc={(v) => {
                setDoc(v);
                setMobileSheet(null);
              }}
              onSelectMilestone={(m) => {
                setMilestone(m);
                setMobileSheet(null);
              }}
              onCreateDoc={async () => {
                await createDoc();
                setMobileSheet(null);
              }}
            />
          ) : (
            <NotesRail projectId={id} onOpenCard={() => setDoc(null)} />
          )}
        </MobileSheet>
      ) : null}
      </div>
    </>
  );
}

function MobileBar({
  onOpenLeft,
  onOpenRight,
}: {
  onOpenLeft: () => void;
  onOpenRight: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border-1 bg-surface-0 px-3 py-1.5 md:hidden">
      <button
        type="button"
        onClick={onOpenLeft}
        className="rounded border border-border-2 px-2 py-0.5 text-[11px] text-text-3"
        aria-label="Open sidebar"
      >
        ☰
      </button>
      <button
        type="button"
        onClick={onOpenRight}
        className="rounded border border-border-2 px-2 py-0.5 text-[11px] text-text-3"
        aria-label="Open notes"
      >
        Notes
      </button>
    </div>
  );
}

function MobileSheet({
  side,
  onClose,
  children,
}: {
  side: "left" | "right";
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 bg-black/60 md:hidden">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div
        className={`absolute top-0 h-full w-[280px] overflow-y-auto bg-surface-0 ${
          side === "left"
            ? "left-0 border-r border-border-1"
            : "right-0 w-[320px] border-l border-border-1"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
