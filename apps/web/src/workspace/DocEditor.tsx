// Center-pane doc editor state. Autosaves on debounced input (1s idle) — the
// pulse dot on the save-state line fires once per successful save. Rendered
// preview is the default view; clicking the preview swaps to a plain
// monospace textarea (Notion-style), blur/Escape swaps back.

import type { Doc } from "@monkyesuite/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { marked } from "marked";
import { useEffect, useMemo, useRef, useState } from "react";
import { toastError } from "../components/Toast";
import { api } from "../lib/api";
import { relTime } from "../lib/format";

// Marked config — GFM on (tables, strikethrough, task lists, autolinks),
// linebreaks translate single-newline to <br>. Sync mode: parse returns a
// string directly. Docs are auth-scoped and author-owned, so raw-HTML
// passthrough is intentional; would need DOMPurify if we ever surface
// docs from an untrusted source.
marked.use({ gfm: true, breaks: true, async: false });

type Props = {
  docId: string;
  projectId: string;
  onExit: () => void;
};

export function DocEditor({ docId, projectId, onExit }: Props) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["doc", docId],
    queryFn: () => api.doc(docId),
  });
  if (q.isPending)
    return <div className="p-6 text-sm text-text-5">Loading…</div>;
  if (q.isError)
    return <div className="p-6 text-sm text-rose-400">{q.error.message}</div>;
  return (
    <Editor
      key={docId}
      doc={q.data}
      projectId={projectId}
      onSaved={() => qc.invalidateQueries({ queryKey: ["docs", projectId] })}
      onExit={onExit}
    />
  );
}

function Editor({
  doc,
  projectId,
  onSaved,
  onExit,
}: {
  doc: Doc;
  projectId: string;
  onSaved: () => void;
  onExit: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(doc.title);
  const [body, setBody] = useState(doc.body ?? "");
  const [pulse, setPulse] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string>(doc.updatedAt);
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const skipNext = useRef(true);

  const rendered = useMemo(() => marked.parse(body) as string, [body]);

  const save = useMutation({
    mutationFn: (v: { title: string; body: string }) => api.patchDoc(doc.id, v),
    onSuccess: (d) => {
      setLastSavedAt(d.updatedAt);
      setPulse(true);
      setTimeout(() => setPulse(false), 1600);
      qc.setQueryData(["doc", doc.id], d);
      onSaved();
    },
    onError: (err) => toastError(err, "Failed to save document."),
  });

  // Debounced autosave — 1s idle after last edit. Skip the first pass so
  // mount doesn't fire a redundant save.
  // biome-ignore lint/correctness/useExhaustiveDependencies: debounce keyed to title/body only; save.mutate + doc.* are stable snapshots
  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    const clean = title !== doc.title || body !== (doc.body ?? "");
    if (!clean) return;
    const t = setTimeout(() => save.mutate({ title, body }), 1000);
    return () => clearTimeout(t);
  }, [title, body]);

  const del = useMutation({
    mutationFn: () => api.deleteDoc(doc.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["docs", projectId] });
      onExit();
    },
    onError: (err) => toastError(err),
  });

  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  const dirty = title !== doc.title || body !== (doc.body ?? "");

  // Enter edit mode → focus textarea. Caret position isn't recovered from the
  // click (would require mapping rendered offset back to source); focus lands
  // at end and the user can click within the textarea to move it.
  const enterEdit = () => {
    setEditing(true);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-border-1 bg-surface-0 px-4 py-2.5">
        <nav className="flex items-center gap-1.5 text-xs text-text-disabled">
          <button
            type="button"
            onClick={onExit}
            className="rounded px-1 hover:text-text-1"
            title="Back to board"
          >
            ← Docs
          </button>
          <span>/</span>
          <span className="text-text-1">{title || "Untitled"}</span>
        </nav>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-text-disabled">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full bg-delta-up ${pulse ? "ws-save-dot" : ""}`}
          />
          {save.isPending
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
            className="mb-2 w-full bg-transparent text-[28px] font-bold tracking-[-0.02em] text-text-1 outline-none placeholder:text-text-disabled"
          />
          <div className="mb-6 flex gap-2.5 font-mono text-[11px] text-text-disabled">
            <span>edited {relTime(lastSavedAt)}</span>
            <span>·</span>
            <span>
              {words} word{words === 1 ? "" : "s"}
            </span>
          </div>
          {editing ? (
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onBlur={() => setEditing(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(false);
              }}
              spellCheck={false}
              placeholder="# heading…"
              className="min-h-[500px] w-full resize-none bg-transparent font-mono text-[13px] leading-[1.7] text-text-1 outline-none placeholder:text-text-disabled"
            />
          ) : (
            // biome-ignore lint/a11y/useSemanticElements: intentionally a div — a native button would collapse the rendered markdown flow (block-level children like h1/ul/pre are invalid inside <button>)
            <div
              role="button"
              tabIndex={0}
              onClick={enterEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  enterEdit();
                }
              }}
              className="ws-doc-preview min-h-[500px] w-full cursor-text text-[14px] leading-[1.65] text-text-2"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: docs are auth-scoped, author-owned; marked handles escaping of inline text
              dangerouslySetInnerHTML={{
                __html:
                  rendered ||
                  '<p class="text-text-disabled">Click to start writing…</p>',
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
