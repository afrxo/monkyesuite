// Workspace — single three-pane view (specs/05, 08-web §8.5). Board / doc
// state is a URL param (`?doc=<id>`), so the pane is linkable and back/forward
// works. The old tab-based route is gone; Members lives entirely in the topbar.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Skeleton } from "../components/Skeleton";
import { ScopedError } from "../components/scoped";
import { BlockEditor } from "../editor";
import { api } from "../lib/api";
import type { BoardViewHandle } from "../workspace/BoardView";
import { BoardView } from "../workspace/BoardView";
import { CardModal } from "../workspace/CardModal";
import { NotesRail } from "../workspace/NotesRail";
import { Sidebar } from "../workspace/Sidebar";
import { shortTaskId } from "../workspace/short-id";
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

  useEffect(() => {
    if (!project.data) return;
    document.title = `${project.data.name} — monkyesuite`;
    return () => {
      document.title = "monkyesuite — Pulse";
    };
  }, [project.data]);

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
  // The shell is static — its three-pane grid, topbar height and rail widths
  // don't depend on the response — so a cold load paints the real layout with
  // shape placeholders and swaps content in without any reflow.
  if (project.isPending || !project.data) return <WorkspaceSkeleton />;

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
  // The row itself is kept, not just the id: it seeds the card modal so it
  // opens with title/status/meta already painted (see CardModal `seed`).
  const cardTask = (() => {
    if (!activeCard || !board.data) return null;
    for (const lane of board.data.lanes) {
      for (const t of lane.tasks) {
        if (shortTaskId(project.data.slug, t.id) === activeCard) return t;
      }
    }
    return null;
  })();
  const cardTaskId = cardTask?.id ?? null;

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
          height: "calc(var(--vh) - 56px)",
          gridTemplateColumns: "260px 1fr 360px",
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
            <BlockEditor
              docId={activeDocId}
              projectId={id}
              onExit={() => setDoc(null)}
            />
          ) : board.isPending ? (
            <BoardSkeleton />
          ) : board.isError ? (
            <p className="p-6 text-sm text-rose-400">
              {(board.error as Error)?.message ?? "Failed to load board."}
            </p>
          ) : board.data ? (
            <BoardView
              ref={boardRef}
              projectId={id}
              projectSlug={project.data.slug}
              board={board.data}
              milestoneFilter={activeMilestone}
              openCardTaskId={cardTaskId}
              onChanged={invalidateBoard}
              onOpenCard={(taskId) =>
                setCard(shortTaskId(project.data.slug, taskId))
              }
            />
          ) : null}
        </main>

        {/* Right rail — desktop */}
        <div className="hidden md:contents">
          <NotesRail
            projectId={id}
            projectSlug={project.data.slug}
            onOpenCard={() => setDoc(null)}
            onOpenDoc={setDoc}
          />
        </div>
      </div>

      {cardTaskId && board.data ? (
        <CardModal
          taskId={cardTaskId}
          projectSlug={project.data.slug}
          milestones={board.data.milestones}
          seed={cardTask}
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
              <NotesRail
                projectId={id}
                projectSlug={project.data.slug}
                onOpenCard={() => setDoc(null)}
                onOpenDoc={(v) => {
                  setDoc(v);
                  setMobileSheet(null);
                }}
              />
            )}
          </MobileSheet>
        ) : null}
      </div>
    </>
  );
}

/* ------------------------------- skeletons -------------------------------- */

const SKELETON_LANES = [
  { label: "Backlog", cards: [86, 62, 74] },
  { label: "To do", cards: [70, 90] },
  { label: "In progress", cards: [64, 78, 58] },
  { label: "Review", cards: [72] },
  { label: "Done", cards: [66, 84] },
];

// Board pane placeholder — same lane grid, header height and card radius as
// the real board, so cards land in place rather than pushing the layout.
function BoardSkeleton() {
  return (
    <div className="flex flex-1 gap-3 overflow-hidden p-4">
      {SKELETON_LANES.map((lane) => (
        <div
          key={lane.label}
          className="flex w-[272px] shrink-0 flex-col gap-2"
        >
          <div className="flex items-center gap-2 px-1 py-1">
            <Skeleton w={9} h={9} round />
            <Skeleton w={74} h={10} />
          </div>
          {lane.cards.map((h) => (
            <div
              key={`${lane.label}-${h}`}
              className="rounded-md border border-border-1 bg-surface-1 p-3"
            >
              <Skeleton w={`${h}%`} h={12} />
              <div className="mt-2.5 flex items-center gap-1.5">
                <Skeleton w={38} h={9} />
                <Skeleton w={26} h={9} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Whole-workspace cold load: the grid is the real one, only the contents are
// shapes. Mirrors the topbar + 260/1fr/360 three-pane layout below.
function WorkspaceSkeleton() {
  return (
    <>
      <div className="flex h-[42px] items-center gap-3 border-b border-border-1 bg-surface-0 px-4">
        <Skeleton w={128} h={13} />
        <Skeleton w={54} h={10} />
        <div className="flex-1" />
        <Skeleton w={20} h={20} round />
        <Skeleton w={20} h={20} round />
      </div>
      <div
        className="grid overflow-hidden bg-surface-0"
        style={{
          height: "calc(var(--vh) - 56px)",
          gridTemplateColumns: "260px 1fr 360px",
        }}
      >
        <div className="hidden flex-col gap-2.5 border-r border-border-1 p-3 md:flex">
          {[64, 88, 72, 96, 58, 80, 68].map((w) => (
            <Skeleton key={`sb-${w}`} w={`${w}%`} h={11} />
          ))}
        </div>
        <main className="flex min-h-0 flex-col overflow-hidden bg-[#0c0c0c] col-span-full md:col-span-1">
          <BoardSkeleton />
        </main>
        <div className="hidden flex-col gap-3 border-l border-border-1 p-4 md:flex">
          {["a", "b", "c", "d"].map((k) => (
            <div key={`nr-${k}`} className="flex flex-col gap-2">
              <Skeleton w="52%" h={10} />
              <Skeleton w="90%" h={11} />
            </div>
          ))}
        </div>
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
