// Long-form project docs (markdown stored as text; specs/05 §5.4). List on the
// left, a simple title + body editor on the right. Kept deliberately plain — a
// doc is a textarea, not a rich editor.

import type { Doc } from "@monkyesuite/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ScopedError } from "../components/scoped";
import { api } from "../lib/api";

export function DocsPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const docs = useQuery({
    queryKey: ["docs", projectId],
    queryFn: () => api.docs(projectId),
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["docs", projectId] });

  const create = useMutation({
    mutationFn: () => api.createDoc(projectId, { title: "Untitled" }),
    onSuccess: (doc) => {
      invalidate();
      setActiveId(doc.id);
    },
  });

  if (docs.isError) return <ScopedError error={docs.error} />;
  if (docs.isPending)
    return <p className="text-sm text-neutral-600">Loading…</p>;

  const active = docs.data.find((d) => d.id === activeId) ?? null;

  return (
    <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => create.mutate()}
          className="mb-2 w-fit rounded-md border border-dashed border-neutral-700 px-2.5 py-1 text-sm text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
        >
          + New doc
        </button>
        {docs.data.length === 0 ? (
          <p className="text-sm text-neutral-600">No docs yet.</p>
        ) : (
          docs.data.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setActiveId(d.id)}
              className={`truncate rounded-md px-2.5 py-1.5 text-left text-sm ${
                d.id === activeId
                  ? "bg-neutral-800 text-neutral-100"
                  : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
              }`}
            >
              {d.title}
            </button>
          ))
        )}
      </div>

      {active ? (
        <DocEditor key={active.id} doc={active} onChanged={invalidate} />
      ) : (
        <p className="text-sm text-neutral-600">Select or create a doc.</p>
      )}
    </div>
  );
}

// Keyed by doc.id in the parent, so it remounts (and re-seeds these) when the
// user switches docs — no sync effect needed, and in-progress edits survive the
// post-save refetch.
function DocEditor({ doc, onChanged }: { doc: Doc; onChanged: () => void }) {
  const [title, setTitle] = useState(doc.title);
  const [body, setBody] = useState(doc.body ?? "");

  const save = useMutation({
    mutationFn: () => api.patchDoc(doc.id, { title, body }),
    onSuccess: onChanged,
  });
  const del = useMutation({
    mutationFn: () => api.deleteDoc(doc.id),
    onSuccess: onChanged,
  });

  const dirty = title !== doc.title || body !== (doc.body ?? "");

  return (
    <div className="flex flex-col gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none focus:border-neutral-600"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={16}
        placeholder="Markdown…"
        className="rounded-md border border-neutral-800 bg-neutral-950/60 px-3 py-2 font-mono text-sm text-neutral-200 outline-none focus:border-neutral-600"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate()}
          className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-40"
        >
          {save.isPending ? "Saving…" : dirty ? "Save" : "Saved"}
        </button>
        <button
          type="button"
          onClick={() => del.mutate()}
          className="text-sm text-rose-400/80 hover:text-rose-300"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
