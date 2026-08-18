// Right rail — persistent across board and doc states. Quick-capture at the
// top (auto-growing textarea; ⌘Enter submits). The universeId field is a
// deviation from the mockup: it's collapsed behind an "add context" affordance
// until the user opts in (prompt: simplify vs the mockup's always-visible
// input). Notes rendered reverse-chrono; any SG-### hash in the body renders
// as a mono accent-colored chip anchored to the matching card.

import type { CreateNoteInput, ProjectNote } from "@monkyesuite/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { toastError } from "../components/Toast";
import { api } from "../lib/api";
import { relTime } from "../lib/format";
import { MiniAvatar } from "./BoardView";
import { extractTaskRefs } from "./short-id";

type Props = { projectId: string; onOpenCard?: (ref: string) => void };

export function NotesRail({ projectId, onOpenCard }: Props) {
  const [tab, setTab] = useState<"notes" | "activity">("notes");
  const notes = useQuery({
    queryKey: ["project-notes", projectId],
    queryFn: () => api.projectNotes(projectId),
  });

  return (
    <aside className="col-start-3 flex flex-col overflow-hidden border-l border-border-1">
      <div className="flex border-b border-border-1 px-2">
        <Tab active={tab === "notes"} onClick={() => setTab("notes")}>
          Notes
          <span className="ml-1 font-mono text-xs text-text-disabled">
            {notes.data?.length ?? 0}
          </span>
        </Tab>
        <Tab active={tab === "activity"} onClick={() => setTab("activity")}>
          Activity
        </Tab>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {tab === "notes" ? (
          <NotesTab
            projectId={projectId}
            notes={notes.data ?? []}
            isLoading={notes.isPending}
            onOpenCard={onOpenCard}
          />
        ) : (
          <ActivityStub />
        )}
      </div>
    </aside>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px cursor-pointer border-b px-3 py-3 text-xs transition-colors ${
        active
          ? "border-text-1 text-text-1"
          : "border-transparent text-text-3 hover:text-text-1"
      }`}
    >
      {children}
    </button>
  );
}

function NotesTab({
  projectId,
  notes,
  isLoading,
  onOpenCard,
}: {
  projectId: string;
  notes: ProjectNote[];
  isLoading: boolean;
  onOpenCard?: (ref: string) => void;
}) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["project-notes", projectId] });

  const create = useMutation({
    mutationFn: (input: CreateNoteInput) =>
      api.createProjectNote(projectId, input),
    onSuccess: invalidate,
    onError: (err) => toastError(err),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.deleteProjectNote(id),
    onSuccess: invalidate,
    onError: (err) => toastError(err),
  });

  return (
    <>
      <QuickCapture
        onSubmit={(input) => create.mutate(input)}
        pending={create.isPending}
      />
      {isLoading ? (
        <p className="text-xs text-text-disabled">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="text-xs text-text-disabled">No notes yet.</p>
      ) : (
        <ul className="flex flex-col">
          {notes.map((n) => (
            <NoteItem
              key={n.id}
              note={n}
              onDelete={() => del.mutate(n.id)}
              onOpenCard={onOpenCard}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function QuickCapture({
  onSubmit,
  pending,
}: {
  onSubmit: (input: CreateNoteInput) => void;
  pending: boolean;
}) {
  const [body, setBody] = useState("");
  const [universe, setUniverse] = useState("");
  const [showContext, setShowContext] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: body is the trigger; ref is stable
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(36, el.scrollHeight)}px`;
  }, [body]);

  const submit = () => {
    if (!body.trim()) return;
    const uid = universe.trim() ? Number(universe.trim()) : undefined;
    onSubmit({
      body: body.trim(),
      universeId: uid && Number.isInteger(uid) && uid > 0 ? uid : undefined,
    });
    setBody("");
    setUniverse("");
    setShowContext(false);
  };

  return (
    <div className="mb-4 rounded-md border border-border-1 bg-surface-1 p-3">
      <textarea
        ref={ref}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Quick observation, dated call, or reminder…"
        className="min-h-10 w-full resize-none bg-transparent text-sm text-text-1 outline-none placeholder:text-text-disabled"
      />
      <div className="mt-2 flex items-center gap-2 border-t border-border-1 pt-2">
        {showContext ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: focus what user opened
            autoFocus
            value={universe}
            onChange={(e) => setUniverse(e.target.value)}
            placeholder="Universe ID"
            inputMode="numeric"
            className="flex-1 bg-transparent font-mono text-[10px] text-text-3 outline-none placeholder:text-text-disabled"
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowContext(true)}
            className="flex-1 text-left font-mono text-[10px] text-text-disabled hover:text-text-3"
          >
            + Add context
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-900 hover:bg-white disabled:opacity-50 transition-colors"
        >
          Pin
        </button>
      </div>
    </div>
  );
}

function NoteItem({
  note,
  onDelete,
  onOpenCard,
}: {
  note: ProjectNote;
  onDelete: () => void;
  onOpenCard?: (ref: string) => void;
}) {
  const refs = extractTaskRefs(note.body ?? "");
  return (
    <li className="border-b border-border-1 py-3 last:border-b-0">
      <div className="mb-1.5 flex items-baseline gap-2">
        {note.title ? (
          <span className="text-sm font-medium text-text-1">{note.title}</span>
        ) : null}
        <span className="ml-auto font-mono text-xs text-text-disabled">
          {relTime(note.createdAt)}
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="grid h-5 w-5 place-items-center rounded text-text-disabled hover:text-rose-300 transition-colors"
          title="Delete note"
        >
          <Icon name="x" size={11} />
        </button>
      </div>
      {note.author ? (
        <div
          className="mb-1 flex items-center gap-1.5 text-[11px] text-text-disabled"
          title={note.author.email}
        >
          <MiniAvatar name={note.author.name ?? note.author.email} />
          <span>{note.author.name ?? note.author.email.split("@")[0]}</span>
        </div>
      ) : null}
      {note.body ? (
        <p className="whitespace-pre-wrap text-sm leading-[1.5] text-text-3">
          {note.body}
        </p>
      ) : null}
      {refs.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-2">
          {refs.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                onOpenCard?.(r);
                // Delay so a doc→board switch has time to mount the anchor.
                requestAnimationFrame(() => {
                  const tick = (n: number) => {
                    const el = document.getElementById(`card-${r}`);
                    if (el) {
                      el.scrollIntoView({
                        behavior: "smooth",
                        block: "center",
                      });
                      el.classList.add("ring-1", "ring-accent-warm");
                      setTimeout(
                        () => el.classList.remove("ring-1", "ring-accent-warm"),
                        1200,
                      );
                    } else if (n > 0) {
                      setTimeout(() => tick(n - 1), 60);
                    }
                  };
                  tick(10);
                });
              }}
              className="ws-note-link"
            >
              → {r}
            </button>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function ActivityStub() {
  return (
    <p className="text-xs text-text-disabled">Activity feed coming soon.</p>
  );
}
