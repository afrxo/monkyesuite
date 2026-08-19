// Right rail — persistent across board and doc states. Quick-capture at the
// top is a compact BlockNote surface: live markdown shortcuts (**bold**, "- "
// lists, "# " headings, "> " quotes) and an @ menu that references docs, cards
// and linked games from the same project. On submit the editor is serialized
// to markdown; @-mentions are BN links under a `monkye:` scheme that we rewrite
// to storage tokens — docs → `[[doc:<id>]]`, games → `[[game:<universeId>]]`,
// cards → bare `SG-###`. The first game mention also populates the note's
// structured `universeId` (the old numeric "Add context" field — replaced by
// @game, since nobody remembers a universe id). Notes render reverse-chrono as
// markdown; any token surfaces as a chip below the body (docs open the doc,
// games open /games/:id, cards scroll+flash the board card).

import {
  BlockNoteSchema,
  defaultBlockSpecs,
  filterSuggestionItems,
} from "@blocknote/core";
import type {
  CreateNoteInput,
  ProjectNote,
  PulseSearchResult,
} from "@monkyesuite/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { marked } from "marked";
import { useMemo, useRef, useState } from "react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import "../editor/blocknote.css";
import { SuggestionMenuController, useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { Icon } from "../components/Icon";
import { Skeleton } from "../components/Skeleton";
import { toastError } from "../components/Toast";
import { api } from "../lib/api";
import { relTime } from "../lib/format";
import { MiniAvatar } from "./BoardView";
import { GameSearchSelect } from "./GameSearchSelect";
import {
  docRefToken,
  extractDocRefs,
  extractTaskRefs,
  replaceDocRefs,
  shortTaskId,
} from "./short-id";

type Props = {
  projectId: string;
  projectSlug: string;
  onOpenCard?: (ref: string) => void;
  onOpenDoc?: (docId: string) => void;
};

export function NotesRail({
  projectId,
  projectSlug,
  onOpenCard,
  onOpenDoc,
}: Props) {
  const [tab, setTab] = useState<"notes" | "activity">("notes");
  const notes = useQuery({
    queryKey: ["project-notes", projectId],
    queryFn: () => api.projectNotes(projectId),
  });
  const board = useQuery({
    queryKey: ["board", projectId],
    queryFn: () => api.board(projectId),
  });
  const docs = useQuery({
    queryKey: ["docs", projectId],
    queryFn: () => api.docs(projectId),
  });
  const refTitles = new Map<string, string>();
  const cardTargets: MentionTarget[] = [];
  if (board.data) {
    for (const lane of board.data.lanes) {
      for (const t of lane.tasks) {
        const short = shortTaskId(projectSlug, t.id);
        refTitles.set(short, t.title);
        cardTargets.push({ kind: "card", id: short, title: t.title });
      }
    }
  }
  const docTitles = new Map<string, string>();
  const docTargets: MentionTarget[] = [];
  for (const d of docs.data ?? []) {
    docTitles.set(d.id, d.title || "Untitled");
    docTargets.push({ kind: "doc", id: d.id, title: d.title || "Untitled" });
  }
  // Docs + cards are a fixed, local set. Games are NOT — they're searched live
  // against the global game index (same as the link-game flow), so they enter
  // the @ menu dynamically inside getItems rather than being listed here.
  const mentionTargets = [...docTargets, ...cardTargets];

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
      <div className="ws-scroll flex-1 overflow-y-auto p-4">
        {tab === "notes" ? (
          <NotesTab
            projectId={projectId}
            notes={notes.data ?? []}
            isLoading={notes.isPending}
            onOpenCard={onOpenCard}
            onOpenDoc={onOpenDoc}
            refTitles={refTitles}
            docTitles={docTitles}
            mentionTargets={mentionTargets}
          />
        ) : (
          <ActivityStub />
        )}
      </div>
    </aside>
  );
}

// A static thing the @ menu can insert: docs (uuid) and cards (SG-### short
// id). Games aren't here — they're searched live (see gameMentionItems).
type MentionTarget = {
  kind: "doc" | "card";
  id: string;
  title: string;
};

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
  onOpenDoc,
  refTitles,
  docTitles,
  mentionTargets,
}: {
  projectId: string;
  notes: ProjectNote[];
  isLoading: boolean;
  onOpenCard?: (ref: string) => void;
  onOpenDoc?: (docId: string) => void;
  refTitles: Map<string, string>;
  docTitles: Map<string, string>;
  mentionTargets: MentionTarget[];
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
        mentionTargets={mentionTargets}
      />
      {isLoading ? (
        <NotesSkeleton />
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
              onOpenDoc={onOpenDoc}
              refTitles={refTitles}
              docTitles={docTitles}
            />
          ))}
        </ul>
      )}
    </>
  );
}

// Note rows are short, stacked and uniform — a few staggered lines read as
// "notes are coming" without pretending to know how many.
function NotesSkeleton() {
  return (
    <ul className="flex flex-col gap-4 pt-1">
      {[82, 64, 91, 58].map((w) => (
        <li key={`note-${w}`} className="flex flex-col gap-2">
          <Skeleton w={`${w}%`} h={12} />
          <Skeleton w="46%" h={9} />
        </li>
      ))}
    </ul>
  );
}

// Composer schema — the subset of blocks that make sense for a short note.
// Deliberately excludes image/divider/callout/refEmbed (those belong to the
// full doc editor); this keeps the rail surface light and the markdown output
// clean.
const composerSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    quote: defaultBlockSpecs.quote,
    codeBlock: defaultBlockSpecs.codeBlock,
  },
});

// @-mentions (docs + cards) are inserted as BlockNote links under a private
// `monkye:` href scheme so they render as pills while typing and survive
// markdown serialization. On submit we rewrite those links to storage tokens.
// Games are NOT @-mentions — they attach at note level via the same game-search
// picker used to add tracked games to a project (see GameSearchSelect).
const MENTION_DOC_RE = /\[[^\]]*\]\(monkye:doc:([0-9a-f-]{36})\)/gi;
const MENTION_CARD_RE = /\[[^\]]*\]\(monkye:card:([A-Z0-9-]+)\)/gi;

function mentionsToTokens(md: string): string {
  return md
    .replace(MENTION_DOC_RE, (_m, id: string) => docRefToken(id))
    .replace(MENTION_CARD_RE, (_m, short: string) => short.toUpperCase());
}

type BNComposer = ReturnType<typeof useCreateBlockNote>;

function insertMention(editor: BNComposer, href: string, label: string) {
  editor.insertInlineContent([{ type: "link", href, content: label }, " "]);
}

function QuickCapture({
  onSubmit,
  pending,
  mentionTargets,
}: {
  onSubmit: (input: CreateNoteInput) => void;
  pending: boolean;
  mentionTargets: MentionTarget[];
}) {
  const qc = useQueryClient();
  const [empty, setEmpty] = useState(true);
  // A note carries at most one game as structured context (its universeId).
  // Attached via the game-search picker; shown as a removable chip until pinned.
  const [game, setGame] = useState<PulseSearchResult | null>(null);
  const [pickingGame, setPickingGame] = useState(false);
  const targetsRef = useRef(mentionTargets);
  targetsRef.current = mentionTargets;

  const editor = useCreateBlockNote({
    schema: composerSchema,
    initialContent: [{ type: "paragraph", content: [] }],
  });

  const isEmpty = () => {
    const doc = editor.document;
    if (doc.length !== 1) return false;
    const only = doc[0];
    const content = only?.content as { text?: string }[] | undefined;
    return (
      only?.type === "paragraph" &&
      (!content || content.every((c) => !c.text?.trim()))
    );
  };

  const submit = async () => {
    if (isEmpty()) return;
    const md = mentionsToTokens(
      (await editor.blocksToMarkdownLossy(editor.document)).trim(),
    );
    if (!md) return;
    onSubmit({ body: md, universeId: game?.id });
    editor.replaceBlocks(editor.document, [{ type: "paragraph", content: [] }]);
    editor.focus();
    setGame(null);
    setPickingGame(false);
    setEmpty(true);
  };

  const getItems = async (query: string) =>
    filterSuggestionItems(
      staticMentionItems(editor, targetsRef.current),
      query,
    );

  return (
    <div className="mb-4 rounded-md border border-border-1 bg-surface-1 transition-colors focus-within:border-border-2">
      <div
        className="ws-note-composer px-3 pt-2.5"
        // ⌘/Ctrl+Enter submits from anywhere in the editor.
        onKeyDownCapture={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <BlockNoteView
          editor={editor}
          theme="dark"
          sideMenu={false}
          formattingToolbar
          slashMenu={false}
          onChange={() => setEmpty(isEmpty())}
        >
          <SuggestionMenuController triggerCharacter="@" getItems={getItems} />
        </BlockNoteView>
      </div>

      {pickingGame ? (
        <div className="px-3 pt-1">
          <GameSearchSelect
            autoFocus
            onPick={(r) => {
              qc.setQueryData(["game-name", r.id], r.name);
              setGame(r);
              setPickingGame(false);
            }}
            onEscapeEmpty={() => setPickingGame(false)}
          />
        </div>
      ) : null}

      <div className="mt-1 flex items-center gap-2 px-3 pb-2.5">
        {game ? (
          <span className="flex min-w-0 items-center gap-1 rounded bg-surface-hover px-1.5 py-1 text-[11px] text-text-2">
            {game.thumbnail ? (
              <img
                src={game.thumbnail}
                alt=""
                className="h-3.5 w-3.5 shrink-0 rounded-sm object-cover"
              />
            ) : null}
            <span className="max-w-[120px] truncate">{game.name}</span>
            <button
              type="button"
              onClick={() => setGame(null)}
              aria-label="Remove game"
              className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded text-text-disabled hover:text-text-1"
            >
              <Icon name="x" size={9} />
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setPickingGame(true)}
            className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-text-disabled transition-colors hover:text-text-2"
            title="Attach a game as context"
          >
            <Icon name="plus" size={11} />
            Add game
          </button>
        )}
        <span className="ml-auto font-mono text-[10px] text-text-disabled">
          @ link · ⌘⏎
        </span>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={pending || empty}
          className="rounded bg-accent-warm/20 px-3 py-1 text-xs font-medium text-accent-warm transition-colors hover:bg-accent-warm/30 disabled:opacity-40 disabled:hover:bg-accent-warm/20"
        >
          Pin note
        </button>
      </div>
    </div>
  );
}

// Static @ menu items: docs then cards, each group labelled so the two realms
// read distinctly. Selecting inserts a `monkye:` link (see mentionsToTokens).
function staticMentionItems(editor: BNComposer, targets: MentionTarget[]) {
  return targets.map((t) => ({
    title: t.kind === "doc" ? t.title : `${t.id} · ${t.title}`,
    group: t.kind === "doc" ? "Docs" : "Cards",
    onItemClick: () => {
      const href =
        t.kind === "doc" ? `monkye:doc:${t.id}` : `monkye:card:${t.id}`;
      const label = t.kind === "doc" ? `@${t.title}` : `@${t.id}`;
      insertMention(editor, href, label);
    },
  }));
}

function NoteItem({
  note,
  onDelete,
  onOpenCard,
  onOpenDoc,
  refTitles,
  docTitles,
}: {
  note: ProjectNote;
  onDelete: () => void;
  onOpenCard?: (ref: string) => void;
  onOpenDoc?: (docId: string) => void;
  refTitles: Map<string, string>;
  docTitles: Map<string, string>;
}) {
  const body = note.body ?? "";
  const refs = extractTaskRefs(body);
  const docRefs = extractDocRefs(body);
  // Swap doc tokens for readable @Title before marked sees them, then render.
  const bodyHtml = useMemo(
    () =>
      body
        ? (marked.parse(
            replaceDocRefs(body, (id) => docTitles.get(id)),
            {
              gfm: true,
              breaks: true,
              async: false,
            },
          ) as string)
        : "",
    [body, docTitles],
  );
  return (
    <li className="border-b border-border-1 py-3 last:border-b-0">
      <div className="mb-1.5 flex items-center gap-2">
        {note.author ? (
          <div
            className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-disabled"
            title={note.author.email}
          >
            <MiniAvatar name={note.author.name ?? note.author.email} />
            <span className="truncate">
              {note.author.name ?? note.author.email.split("@")[0]}
            </span>
          </div>
        ) : (
          <div className="h-5 w-5" aria-hidden />
        )}
        <span className="ml-auto font-mono text-[11px] text-text-disabled">
          {relTime(note.createdAt)}
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="grid h-5 w-5 place-items-center rounded text-text-disabled transition-colors hover:bg-destructive/15 hover:text-rose-300"
          title="Delete note"
        >
          <Icon name="trash" size={11} />
        </button>
      </div>
      {note.anchorQuote ? (
        <blockquote
          className={`mb-1 border-l-2 pl-2 text-[11px] italic ${
            note.orphaned
              ? "border-destructive/60 text-text-disabled line-through"
              : "border-accent-warm/60 text-text-3"
          }`}
        >
          “{note.anchorQuote}”
          {note.orphaned ? (
            <span className="ml-1 not-italic text-destructive">
              · content changed
            </span>
          ) : null}
        </blockquote>
      ) : null}
      {note.title ? (
        <p className="mb-1 text-sm font-medium leading-[1.35] text-text-1">
          {note.title}
        </p>
      ) : null}
      {bodyHtml ? (
        <div
          className="ws-doc-preview ws-note-md"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: same-origin markdown, XSS via marked hardened elsewhere in project
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      ) : null}
      {refs.length > 0 || docRefs.length > 0 || note.universeId ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {note.universeId ? <GameChip universeId={note.universeId} /> : null}
          {docRefs.map((id) => (
            <button
              key={id}
              type="button"
              title={docTitles.get(id) ?? "Open doc"}
              onClick={() => onOpenDoc?.(id)}
              className="ws-note-link"
            >
              ¶ {docTitles.get(id) ?? "Untitled"}
            </button>
          ))}
          {refs.map((r) => {
            const title = refTitles.get(r);
            return (
              <button
                key={r}
                type="button"
                title={title ? `${r} · ${title}` : r}
                onClick={() => {
                  onOpenCard?.(r);
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
                          () =>
                            el.classList.remove("ring-1", "ring-accent-warm"),
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
                → {title ?? r}
              </button>
            );
          })}
        </div>
      ) : null}
    </li>
  );
}

// A note's attached game, rendered from its structured universeId. The name is
// read from the ["game-name", id] cache — primed the moment a game is picked in
// the composer, so a just-pinned note's chip paints instantly; for older notes
// loaded cold it falls back to a one-off game fetch. Clicking opens /games/:id.
function GameChip({ universeId }: { universeId: number }) {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["game-name", universeId],
    queryFn: async () => (await api.game(universeId)).name,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const name = q.data;
  return (
    <button
      type="button"
      title={name ? `Open ${name}` : "Open game"}
      onClick={() =>
        navigate({ to: "/games/$id", params: { id: String(universeId) } })
      }
      className="ws-note-link"
    >
      ◆ {name ?? `Game ${universeId}`}
    </button>
  );
}

function ActivityStub() {
  return (
    <p className="text-xs text-text-disabled">Activity feed coming soon.</p>
  );
}
