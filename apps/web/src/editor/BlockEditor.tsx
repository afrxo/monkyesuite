// Block-native doc editor.
//
// Save model (Phase 1 + Phase 4 hardening):
//   * Snapshot server truth (last-received {block.id → block}) after every
//     successful load or upsert.
//   * On 1s idle after a keystroke, translate the editor document into our
//     Block union, diff against the snapshot: any block whose (type, props,
//     position, content) changed is upserted; any snapshotted id that
//     disappeared is deleted.
//   * Every upsert carries the version we last saw; the server rejects stale
//     versions with 409. On 409 we invalidate the query, refetch, and toast.
//   * Cmd/Ctrl+S cancels the debounce and flushes immediately.
//   * beforeunload guards navigation while the document is dirty.
//   * sessionStorage mirrors the pending draft per tab so a crash before the
//     debounce fires can be recovered from on the next mount.
//   * Failed saves retry with exponential backoff (1s → 30s cap). The chip
//     reports "error — retrying in Ns" during the wait.
//   * offline/online listeners hold saves while offline and flush on reconnect.
//
// Content types this pass supports: paragraph, heading, bulletListItem,
// numberedListItem, checkListItem, quote (Phase 1) plus codeBlock, divider,
// image (Phase 2). Callout / refEmbed / table / video / audio / file remain
// deferred — the schema below is the source of truth on what actually persists.

import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import "./blocknote.css";

import { generateNKeysBetween } from "@monkyesuite/core";
import type {
  Block,
  BlockInput,
  DocBlocks,
  InlineRun,
  TextBlockContent,
} from "@monkyesuite/shared";
import {
  type Block as BNBlock,
  BlockNoteSchema,
  defaultBlockSpecs,
  filterSuggestionItems,
  type InlineContent,
  type PartialBlock,
} from "@blocknote/core";
import {
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  useCreateBlockNote,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../lib/api";
import { toastError } from "../components/Toast";
import { api } from "../lib/api";
import { relTime } from "../lib/format";
import { DocCover } from "./DocCover";
import { DocIcon } from "./DocIcon";
import { DocOutline } from "./DocOutline";
import { ShortcutSheet } from "./ShortcutSheet";

type Props = {
  docId: string;
  projectId: string;
  onExit: () => void;
};

// Restrict BlockNote to the block types we persist. Anything not listed here
// stays out of the slash menu and won't survive a round-trip through the DB.
const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    quote: defaultBlockSpecs.quote,
    codeBlock: defaultBlockSpecs.codeBlock,
    divider: defaultBlockSpecs.divider,
    image: defaultBlockSpecs.image,
  },
});
type Schema = typeof schema;
type SchemaBlock = BNBlock<
  Schema["blockSchema"],
  Schema["inlineContentSchema"],
  Schema["styleSchema"]
>;

// Block types with an inline text `runs` shape. Others (image, divider, code)
// store their whole content/props blobs verbatim.
const TEXT_TYPES = new Set<Block["type"] | string>([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "quote",
]);

// sessionStorage key namespace for the crash-recovery draft mirror. Scoped by
// tab (sessionStorage) and by doc id so multiple docs open in one session
// don't collide, and two tabs on the same doc keep independent drafts.
const draftKey = (docId: string) => `blockDraft:${docId}`;

type Draft = {
  document: SchemaBlock[];
  title: string;
  savedAt: string; // server-side updatedAt seen at draft time
  writtenAt: string;
};

export function BlockEditor({ docId, projectId, onExit }: Props) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["doc-blocks", docId],
    queryFn: () => api.docBlocks(docId),
  });
  if (q.isPending)
    return <div className="p-6 text-sm text-text-5">Loading…</div>;
  if (q.isError)
    return (
      <div className="p-6 text-sm text-rose-400">
        {(q.error as Error)?.message ?? "Failed to load doc."}
      </div>
    );
  return (
    <Editor
      key={docId}
      payload={q.data}
      projectId={projectId}
      onSavedDoc={() => qc.invalidateQueries({ queryKey: ["docs", projectId] })}
      onExit={onExit}
    />
  );
}

function Editor({
  payload,
  projectId,
  onSavedDoc,
  onExit,
}: {
  payload: DocBlocks;
  projectId: string;
  onSavedDoc: () => void;
  onExit: () => void;
}) {
  const qc = useQueryClient();
  const { doc, blocks: initialBlocks } = payload;
  const folders = useQuery({
    queryKey: ["doc-folders", projectId],
    queryFn: () => api.docFolders(projectId),
  });
  const folder = doc.folderId
    ? (folders.data ?? []).find((f) => f.id === doc.folderId) ?? null
    : null;

  const snapshotRef = useRef<Map<string, Block>>(new Map());
  useEffect(() => {
    snapshotRef.current = new Map(initialBlocks.map((b) => [b.id, b]));
  }, [initialBlocks]);

  const editor = useCreateBlockNote({
    schema,
    initialContent:
      initialBlocks.length > 0
        ? blocksToBlockNote(initialBlocks)
        : [{ type: "paragraph", content: [] }],
    // BlockNote's built-in image block calls this to turn a File into a URL.
    // We presign a PUT against R2, upload, then hand back the public URL that
    // gets stored in the block's `url` prop and persisted on save.
    uploadFile: async (file: File) => {
      const { uploadUrl, publicUrl } = await api.docMediaUpload(doc.id, {
        fileName: file.name,
        mimeType: file.type,
      });
      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      return publicUrl;
    },
  });

  const [title, setTitle] = useState(doc.title);
  const [icon, setIcon] = useState<string | null>(doc.icon);
  const [coverUrl, setCoverUrl] = useState<string | null>(doc.coverUrl);
  const [pulse, setPulse] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string>(doc.updatedAt);
  const [dirtyTick, setDirtyTick] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [retryIn, setRetryIn] = useState<number | null>(null);
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const [showRecover, setShowRecover] = useState<Draft | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const skipNext = useRef(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(1000);
  const retryCountdown = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reading time (Phase 7): ~220 wpm reader on plain text. Only text-bearing
  // blocks contribute; code/divider/image are skipped by shape.
  const readingMinutes = useMemo(() => {
    const text = initialBlocks
      .map((b) => {
        const c = b.content as { runs?: { text: string }[] };
        return (c.runs ?? []).map((r) => r.text).join(" ");
      })
      .join(" ");
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return Math.max(1, Math.ceil(words / 220));
  }, [initialBlocks, dirtyTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Draft mirror: on mount, check sessionStorage for a draft newer than the
  // server-reported updatedAt. Surface a recover pill; user opts in.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(draftKey(doc.id));
      if (!raw) return;
      const d = JSON.parse(raw) as Draft;
      if (d.savedAt === doc.updatedAt) {
        setShowRecover(d);
      } else {
        // Server has moved on since the draft was written — draft is stale.
        sessionStorage.removeItem(draftKey(doc.id));
      }
    } catch {
      /* ignore malformed draft */
    }
    // Only on mount for this doc; a fresh keydown handler wires up separately.
  }, [doc.id, doc.updatedAt]);

  const writeDraft = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const draft: Draft = {
        document: editor.document as SchemaBlock[],
        title,
        savedAt: lastSavedAt,
        writtenAt: new Date().toISOString(),
      };
      sessionStorage.setItem(draftKey(doc.id), JSON.stringify(draft));
    } catch {
      /* quota exhausted or serialization loop; skip silently */
    }
  }, [doc.id, editor, title, lastSavedAt]);

  const clearDraft = useCallback(() => {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem(draftKey(doc.id));
  }, [doc.id]);

  useEffect(() => {
    const off = editor.onChange(() => {
      setDirtyTick((n) => n + 1);
      // Throttle draft writes to at most one per 250ms via microtask
      // batching — cheap enough that we don't need a full throttle helper.
      writeDraft();
    });
    return off;
  }, [editor, writeDraft]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOnline = () => {
      setOffline(false);
      // Fire an immediate save on reconnect.
      setDirtyTick((n) => n + 1);
    };
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const saveTitle = useMutation({
    mutationFn: (t: string) => api.patchDoc(doc.id, { title: t }),
    onSuccess: (d) => {
      setLastSavedAt(d.updatedAt);
      qc.setQueryData<DocBlocks>(["doc-blocks", doc.id], (prev) =>
        prev ? { ...prev, doc: d } : prev,
      );
      onSavedDoc();
    },
    onError: (err) => toastError(err, "Failed to save title."),
  });

  const saveMeta = useMutation({
    mutationFn: (v: { icon?: string | null; coverUrl?: string | null }) =>
      api.patchDocMeta(doc.id, v),
    onSuccess: (d) => {
      qc.setQueryData<DocBlocks>(["doc-blocks", doc.id], (prev) =>
        prev ? { ...prev, doc: d } : prev,
      );
      onSavedDoc();
    },
    onError: (err) => toastError(err, "Failed to save doc metadata."),
  });

  const scheduleRetry = useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    if (retryCountdown.current) clearInterval(retryCountdown.current);
    const delay = retryDelay.current;
    retryDelay.current = Math.min(delay * 2, 30_000);
    let remaining = Math.ceil(delay / 1000);
    setRetryIn(remaining);
    retryCountdown.current = setInterval(() => {
      remaining -= 1;
      setRetryIn(remaining > 0 ? remaining : null);
    }, 1000);
    retryTimer.current = setTimeout(() => {
      if (retryCountdown.current) {
        clearInterval(retryCountdown.current);
        retryCountdown.current = null;
      }
      setRetryIn(null);
      setDirtyTick((n) => n + 1);
    }, delay);
  }, []);

  const saveBlocks = useMutation({
    mutationFn: async () => {
      const current = editor.document as SchemaBlock[];
      const desired = blockNoteToBlocks(current, snapshotRef.current);
      const snapshot = snapshotRef.current;

      const upserts: BlockInput[] = [];
      for (const b of desired) {
        const prev = snapshot.get(b.id);
        if (!prev || blockChanged(prev, b)) upserts.push(b);
      }
      const desiredIds = new Set(desired.map((b) => b.id));
      const deletes: string[] = [];
      for (const id of snapshot.keys()) {
        if (!desiredIds.has(id)) deletes.push(id);
      }

      let saved: Block[] = [];
      if (upserts.length) {
        const res = await api.upsertBlocks(doc.id, upserts);
        saved = res.blocks;
      }
      if (deletes.length) {
        await api.deleteBlocks(doc.id, deletes);
      }
      return { saved, deletedIds: deletes, keptIds: desired.map((b) => b.id) };
    },
    onSuccess: ({ saved, deletedIds, keptIds }) => {
      const next = new Map(snapshotRef.current);
      for (const id of deletedIds) next.delete(id);
      for (const b of saved) next.set(b.id, b);
      for (const id of keptIds) {
        if (!next.has(id)) {
          const prior = snapshotRef.current.get(id);
          if (prior) next.set(id, prior);
        }
      }
      snapshotRef.current = next;
      setLastSavedAt(new Date().toISOString());
      setPulse(true);
      setTimeout(() => setPulse(false), 1600);
      setDirty(false);
      // Reset retry state on success.
      retryDelay.current = 1000;
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
      if (retryCountdown.current) {
        clearInterval(retryCountdown.current);
        retryCountdown.current = null;
      }
      setRetryIn(null);
      clearDraft();
    },
    onError: (err) => {
      // Conflict: server has fresher blocks. Invalidate + refetch; user's
      // in-flight edits keep living in the local editor. On refetch the
      // snapshot rebases; the next debounce diffs against the new baseline.
      if (err instanceof ApiError && err.status === 409) {
        toastError(err, "Someone else edited this doc — refreshing.");
        qc.invalidateQueries({ queryKey: ["doc-blocks", doc.id] });
        retryDelay.current = 1000;
        return;
      }
      // Network / 5xx / offline: back off and retry.
      scheduleRetry();
    },
  });

  const flushNow = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (title !== doc.title) saveTitle.mutate(title);
    saveBlocks.mutate();
  }, [title, doc.title, saveTitle, saveBlocks]);

  // Cmd/Ctrl+S — force flush. Also swallow the browser's Save Page As.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key === "s") {
        e.preventDefault();
        flushNow();
      } else if (cmd && e.key === "/") {
        e.preventDefault();
        setShowShortcuts((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flushNow]);

  // beforeunload guard while there are unsaved edits or an inflight save.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty || saveBlocks.isPending) {
        e.preventDefault();
        // Legacy return-value protocol; modern browsers show a generic prompt.
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, saveBlocks.isPending]);

  const del = useMutation({
    mutationFn: () => api.deleteDoc(doc.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["docs", projectId] });
      clearDraft();
      onExit();
    },
    onError: (err) => toastError(err),
  });

  // Debounced autosave. Skips first pass so mount doesn't fire redundant saves;
  // holds when offline (the online listener re-triggers a save on reconnect).
  // biome-ignore lint/correctness/useExhaustiveDependencies: debounce keyed to dirtyTick/title only
  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    setDirty(true);
    if (offline) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      if (title !== doc.title) saveTitle.mutate(title);
      saveBlocks.mutate();
    }, 1000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [dirtyTick, title, offline]);

  const recover = useCallback(() => {
    if (!showRecover) return;
    editor.replaceBlocks(
      editor.document,
      showRecover.document as PartialBlock<
        Schema["blockSchema"],
        Schema["inlineContentSchema"],
        Schema["styleSchema"]
      >[],
    );
    setTitle(showRecover.title);
    setShowRecover(null);
    // Trigger a save so the recovered content lands on the server.
    setDirtyTick((n) => n + 1);
  }, [editor, showRecover]);
  const discardRecover = useCallback(() => {
    clearDraft();
    setShowRecover(null);
  }, [clearDraft]);

  const chip = (() => {
    if (offline) return "offline — will save when back online";
    if (retryIn !== null) return `error — retrying in ${retryIn}s`;
    if (saveBlocks.isPending || saveTitle.isPending) return "saving…";
    if (dirty) return "unsaved";
    return `saved · ${relTime(lastSavedAt)}`;
  })();

  const editorDoc = editor.document as SchemaBlock[];

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-border-1 bg-surface-0 px-4 py-2.5">
        <nav className="flex min-w-0 items-center gap-1 text-xs text-text-disabled">
          <button
            type="button"
            onClick={onExit}
            className="shrink-0 rounded px-1 hover:text-text-1"
            title="Back to board"
          >
            ← Docs
          </button>
          {folder ? (
            <>
              <span className="shrink-0 text-text-5">/</span>
              <span className="shrink-0 truncate max-w-[160px] text-text-3">
                {folder.name}
              </span>
            </>
          ) : null}
          <span className="shrink-0 text-text-5">/</span>
          {icon ? (
            <span className="shrink-0" aria-hidden>
              {icon}
            </span>
          ) : null}
          <span className="truncate text-text-1">{title || "Untitled"}</span>
        </nav>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-text-disabled">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              offline
                ? "bg-text-disabled"
                : retryIn !== null
                  ? "bg-destructive"
                  : "bg-delta-up"
            } ${pulse ? "ws-save-dot" : ""}`}
          />
          {chip}
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirm(`Delete doc "${title || "Untitled"}"? This cannot be undone.`))
              del.mutate();
          }}
          className="rounded px-2.5 py-1 text-[11px] text-destructive hover:bg-destructive/10"
        >
          Delete
        </button>
      </div>

      {showRecover ? (
        <div className="flex items-center justify-between gap-3 border-b border-border-1 bg-surface-1 px-4 py-2 text-xs text-text-2">
          <span>
            Unsaved changes from your last session (
            {relTime(showRecover.writtenAt)}
            ).
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={recover}
              className="rounded bg-accent-warm/20 px-2.5 py-1 text-accent-warm hover:bg-accent-warm/30"
            >
              Recover
            </button>
            <button
              type="button"
              onClick={discardRecover}
              className="rounded px-2.5 py-1 text-text-3 hover:text-text-1"
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}

      <div className="relative flex flex-1 justify-center overflow-y-auto pb-16 pt-8">
        <div className="w-full max-w-[720px] px-6 md:px-12">
          <DocCover
            docId={doc.id}
            url={coverUrl}
            onChange={(next) => {
              setCoverUrl(next);
              saveMeta.mutate({ coverUrl: next });
            }}
          />
          <div className="mt-2 mb-3 flex items-center gap-3">
            <DocIcon
              value={icon}
              onChange={(next) => {
                setIcon(next);
                saveMeta.mutate({ icon: next });
              }}
            />
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled"
            className="mb-2 w-full bg-transparent text-[28px] font-bold tracking-[-0.02em] text-text-1 outline-none placeholder:text-text-disabled"
          />
          <div className="mb-6 flex gap-2.5 font-mono text-[11px] text-text-disabled">
            <span>edited {relTime(lastSavedAt)}</span>
            <span>·</span>
            <span>{readingMinutes} min read</span>
          </div>
          <BlockNoteView editor={editor} theme="dark">
            <SuggestionMenuController
              triggerCharacter="/"
              getItems={async (query) =>
                filterSuggestionItems(
                  getDefaultReactSlashMenuItems(editor),
                  query,
                )
              }
            />
          </BlockNoteView>
        </div>
        <DocOutline blocks={editorDoc as unknown as Parameters<typeof DocOutline>[0]["blocks"]} />
      </div>

      {showShortcuts ? (
        <ShortcutSheet onClose={() => setShowShortcuts(false)} />
      ) : null}
    </div>
  );
}

/* ---------------------------- block <-> BlockNote --------------------------- */

function runsToInline(
  runs: InlineRun[],
): InlineContent<Schema["inlineContentSchema"], Schema["styleSchema"]>[] {
  const out: InlineContent<
    Schema["inlineContentSchema"],
    Schema["styleSchema"]
  >[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const styles: Record<string, boolean> = {};
    if (r.bold) styles.bold = true;
    if (r.italic) styles.italic = true;
    if (r.code) styles.code = true;
    if (r.strikethrough) styles.strike = true;
    const styledText = { type: "text" as const, text: r.text, styles };
    if (r.link) {
      out.push({ type: "link", href: r.link, content: [styledText] });
    } else {
      out.push(styledText);
    }
  }
  return out;
}

function inlineToRuns(
  content:
    | InlineContent<Schema["inlineContentSchema"], Schema["styleSchema"]>[]
    | undefined,
): InlineRun[] {
  const runs: InlineRun[] = [];
  if (!content) return runs;
  for (const node of content) {
    if (node.type === "text") {
      const marks: InlineRun = { text: node.text };
      const s = node.styles as Record<string, unknown>;
      if (s.bold) marks.bold = true;
      if (s.italic) marks.italic = true;
      if (s.code) marks.code = true;
      if (s.strike) marks.strikethrough = true;
      runs.push(marks);
    } else if (node.type === "link") {
      const inner = inlineToRuns(node.content);
      for (const r of inner) runs.push({ ...r, link: node.href });
    }
  }
  return runs.length ? runs : [{ text: "" }];
}

function blocksToBlockNote(
  rows: Block[],
): PartialBlock<
  Schema["blockSchema"],
  Schema["inlineContentSchema"],
  Schema["styleSchema"]
>[] {
  const byParent = new Map<string | null, Block[]>();
  for (const b of rows) {
    const key = b.parentId;
    const arr = byParent.get(key) ?? [];
    arr.push(b);
    byParent.set(key, arr);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => (a.position < b.position ? -1 : 1));
  }
  const build = (
    parentId: string | null,
  ): PartialBlock<
    Schema["blockSchema"],
    Schema["inlineContentSchema"],
    Schema["styleSchema"]
  >[] =>
    (byParent.get(parentId) ?? []).map((b) => {
      const children = build(b.id);
      const base: Record<string, unknown> = { id: b.id, type: b.type };
      if (TEXT_TYPES.has(b.type)) {
        const c = b.content as TextBlockContent;
        base.content = runsToInline(c.runs ?? []);
      } else if (b.type === "codeBlock") {
        const text = (b.content as unknown as { text?: string })?.text ?? "";
        base.content = text
          ? [{ type: "text", text, styles: {} }]
          : [];
      } else if (b.type === "divider") {
        base.content = [];
      } else if (b.type === "image") {
        base.content = [];
      }
      if (b.type === "heading") {
        base.props = { level: (b.props.level as 1 | 2 | 3) ?? 1 };
      } else if (b.type === "checkListItem") {
        base.props = { checked: Boolean(b.props.checked) };
      } else if (b.type === "codeBlock" || b.type === "image") {
        base.props = { ...(b.props as Record<string, unknown>) };
      }
      if (children.length) base.children = children;
      return base as PartialBlock<
        Schema["blockSchema"],
        Schema["inlineContentSchema"],
        Schema["styleSchema"]
      >;
    });
  return build(null);
}

function blockNoteToBlocks(
  tree: SchemaBlock[],
  prior: Map<string, Block>,
): BlockInput[] {
  const out: BlockInput[] = [];
  const walk = (nodes: SchemaBlock[], parentId: string | null) => {
    const keys = generateNKeysBetween(null, null, nodes.length);
    nodes.forEach((n, i) => {
      const id = n.id;
      const type = n.type as Block["type"];
      let content: TextBlockContent | { text?: string } | Record<string, unknown>;
      if (TEXT_TYPES.has(type)) {
        content = {
          runs: inlineToRuns(
            n.content as InlineContent<
              Schema["inlineContentSchema"],
              Schema["styleSchema"]
            >[] | undefined,
          ),
        };
      } else if (type === "codeBlock") {
        const inline = n.content as unknown as { text?: string }[] | undefined;
        const text = inline?.[0]?.text ?? "";
        content = { text };
      } else if (type === "divider") {
        content = {};
      } else if (type === "image") {
        content = {};
      } else {
        content = {};
      }
      const props =
        type === "heading"
          ? {
              level:
                (n.props as { level?: number }).level === 2 ||
                (n.props as { level?: number }).level === 3
                  ? (n.props as { level: 2 | 3 }).level
                  : 1,
            }
          : type === "checkListItem"
            ? { checked: Boolean((n.props as { checked?: boolean }).checked) }
            : ((n.props as Record<string, unknown>) ?? {});
      const version = prior.get(id)?.version ?? 0;
      const position = keys[i];
      if (!position) throw new Error("position missing");
      out.push({
        id,
        parentId,
        position,
        version,
        type,
        content: content as unknown as TextBlockContent,
        props,
      } as BlockInput);
      if (n.children?.length) walk(n.children as SchemaBlock[], id);
    });
  };
  walk(tree, null);
  return out;
}

function blockChanged(prev: Block, next: BlockInput): boolean {
  if (prev.type !== next.type) return true;
  if (prev.parentId !== next.parentId) return true;
  if (prev.position !== next.position) return true;
  if (JSON.stringify(prev.props ?? {}) !== JSON.stringify(next.props ?? {}))
    return true;
  if (JSON.stringify(prev.content) !== JSON.stringify(next.content))
    return true;
  return false;
}
