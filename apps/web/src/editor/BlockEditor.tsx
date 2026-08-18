// Block-native doc editor (Phase 1). Replaces the legacy markdown DocEditor at
// the route boundary. Fetches typed blocks from the server, feeds them to
// BlockNote, and autosaves diffs on 1s idle. Preserves the old header shape:
// breadcrumb (Docs / folder / title), save-state chip, delete.
//
// Save model:
//   * Snapshot server truth (last-received {block.id → block}) after every
//     successful load or upsert.
//   * On 1s idle after a keystroke, translate the editor document into our
//     Block union, diff against the snapshot: any block whose (type, props,
//     position, content) changed is upserted; any snapshotted id that
//     disappeared is deleted.
//   * Every upsert carries the version we last saw; the server rejects stale
//     versions with 409 (surfaced in Phase 4).
//
// Title lives outside the block stream (docs.title). It saves via patchDoc on
// the same 1s debounce, mirroring the legacy editor.

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
import { useEffect, useRef, useState } from "react";
import { toastError } from "../components/Toast";
import { api } from "../lib/api";
import { relTime } from "../lib/format";

type Props = {
  docId: string;
  projectId: string;
  onExit: () => void;
};

// Restrict BlockNote to the block types persisted in Phase 1. Types added in
// Phase 2 (code, callout, image, refEmbed, divider) plug in here.
const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    quote: defaultBlockSpecs.quote,
  },
});
type Schema = typeof schema;
type SchemaBlock = BNBlock<Schema["blockSchema"], Schema["inlineContentSchema"], Schema["styleSchema"]>;

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

  // Server-truth snapshot: id → block. Rebuilt after every successful save so
  // subsequent diffs are computed against the freshest known state.
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
  });

  const [title, setTitle] = useState(doc.title);
  const [pulse, setPulse] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string>(doc.updatedAt);
  const [dirtyTick, setDirtyTick] = useState(0);
  const [dirty, setDirty] = useState(false);
  const skipNext = useRef(true);

  // BlockNote change subscription — bumps `dirtyTick` on every edit so the
  // debounce below re-arms. Title changes go through setTitle directly.
  useEffect(() => {
    const off = editor.onChange(() => setDirtyTick((n) => n + 1));
    return off;
  }, [editor]);

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
      // Anything the client kept but didn't upsert is unchanged; carry over.
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
    },
    onError: (err) => toastError(err, "Failed to save."),
  });

  const del = useMutation({
    mutationFn: () => api.deleteDoc(doc.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["docs", projectId] });
      onExit();
    },
    onError: (err) => toastError(err),
  });

  // Debounced autosave — 1s idle after last block edit OR title edit. Skips
  // the first pass so mount doesn't fire redundant saves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: debounce keyed to dirtyTick/title only; mutations are stable snapshots
  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    setDirty(true);
    const t = setTimeout(() => {
      if (title !== doc.title) saveTitle.mutate(title);
      saveBlocks.mutate();
    }, 1000);
    return () => clearTimeout(t);
  }, [dirtyTick, title]);

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
          <span className="truncate text-text-1">{title || "Untitled"}</span>
        </nav>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-text-disabled">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full bg-delta-up ${pulse ? "ws-save-dot" : ""}`}
          />
          {saveBlocks.isPending || saveTitle.isPending
            ? "saving…"
            : dirty
              ? "unsaved"
              : `saved · ${relTime(lastSavedAt)}`}
        </div>
        <button
          type="button"
          onClick={() => del.mutate()}
          className="rounded px-2.5 py-1 text-[11px] text-destructive hover:bg-destructive/10"
        >
          Delete
        </button>
      </div>

      <div className="flex flex-1 justify-center overflow-y-auto px-6 pb-16 pt-8 md:px-12">
        <div className="w-full max-w-[720px]">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled"
            className="mb-6 w-full bg-transparent text-[28px] font-bold tracking-[-0.02em] text-text-1 outline-none placeholder:text-text-disabled"
          />
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
      </div>
    </div>
  );
}

/* ---------------------------- block <-> BlockNote --------------------------- */
//
// BlockNote's block model is close to ours but not identical:
//  * Content is an array of InlineContent nodes (text | link | ...).
//  * Marks live in styles: {bold?, italic?, code?, strike?}.
//  * Nesting uses `children` on the parent block, not a parent_id back-ref.
// The mappers below bridge the two. Order of a block within its siblings is
// its array position; we assign fractional keys per (docId, parentId) group.

function runsToInline(runs: InlineRun[]): InlineContent<Schema["inlineContentSchema"], Schema["styleSchema"]>[] {
  const out: InlineContent<Schema["inlineContentSchema"], Schema["styleSchema"]>[] = [];
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
  content: InlineContent<Schema["inlineContentSchema"], Schema["styleSchema"]>[] | undefined,
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

function blocksToBlockNote(rows: Block[]): PartialBlock<Schema["blockSchema"], Schema["inlineContentSchema"], Schema["styleSchema"]>[] {
  // Group children by parentId; render each root then recurse.
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
  const build = (parentId: string | null): PartialBlock<Schema["blockSchema"], Schema["inlineContentSchema"], Schema["styleSchema"]>[] =>
    (byParent.get(parentId) ?? []).map((b) => {
      const children = build(b.id);
      const content = runsToInline(b.content.runs);
      const base: Record<string, unknown> = {
        id: b.id,
        type: b.type,
        content,
      };
      if (b.type === "heading") {
        base.props = { level: (b.props.level as 1 | 2 | 3) ?? 1 };
      } else if (b.type === "checkListItem") {
        base.props = { checked: Boolean(b.props.checked) };
      }
      if (children.length) base.children = children;
      return base as PartialBlock<Schema["blockSchema"], Schema["inlineContentSchema"], Schema["styleSchema"]>;
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
      const runs = inlineToRuns(
        n.content as InlineContent<Schema["inlineContentSchema"], Schema["styleSchema"]>[] | undefined,
      );
      const content: TextBlockContent = { runs };
      const props =
        type === "heading"
          ? { level: (n.props as { level?: number }).level === 2 || (n.props as { level?: number }).level === 3 ? (n.props as { level: 2 | 3 }).level : 1 }
          : type === "checkListItem"
            ? { checked: Boolean((n.props as { checked?: boolean }).checked) }
            : {};
      const version = prior.get(id)?.version ?? 0;
      const position = keys[i];
      if (!position) throw new Error("position missing");
      out.push({
        id,
        parentId,
        position,
        version,
        type,
        content,
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
