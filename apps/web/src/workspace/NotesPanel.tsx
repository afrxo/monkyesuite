// Short pinned notes (specs/05 §5.4). A note may reference a tracked game by
// universeId; the API resolves the chip. Distinct from docs: quick observations,
// not long-form writing.

import type { CreateNoteInput } from "@monkyesuite/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ScopedError } from "../components/scoped";
import { api } from "../lib/api";
import { relTime } from "../lib/format";

export function NotesPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const notes = useQuery({
    queryKey: ["project-notes", projectId],
    queryFn: () => api.projectNotes(projectId),
  });
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["project-notes", projectId] });

  const create = useMutation({
    mutationFn: (input: CreateNoteInput) =>
      api.createProjectNote(projectId, input),
    onSuccess: invalidate,
  });
  const del = useMutation({
    mutationFn: (id: string) => api.deleteProjectNote(id),
    onSuccess: invalidate,
  });

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [universe, setUniverse] = useState("");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !body.trim()) return;
    const universeId = universe.trim() ? Number(universe.trim()) : undefined;
    create.mutate(
      {
        title: title.trim() || undefined,
        body: body.trim() || undefined,
        universeId:
          universeId && Number.isInteger(universeId) && universeId > 0
            ? universeId
            : undefined,
      },
      {
        onSuccess: () => {
          setTitle("");
          setBody("");
          setUniverse("");
        },
      },
    );
  };

  if (notes.isError) return <ScopedError error={notes.error} />;
  if (notes.isPending)
    return <p className="text-sm text-neutral-600">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional)"
          className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-600"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="A quick observation or dated call…"
          className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-600"
        />
        <div className="flex items-center gap-2">
          <input
            value={universe}
            onChange={(e) => setUniverse(e.target.value)}
            placeholder="universeId (optional)"
            inputMode="numeric"
            className="w-48 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-600"
          />
          <button
            type="submit"
            disabled={create.isPending}
            className="ml-auto rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
          >
            Pin note
          </button>
        </div>
        {create.isError ? (
          <p className="text-sm text-rose-400">{create.error.message}</p>
        ) : null}
      </form>

      {notes.data.length === 0 ? (
        <p className="text-sm text-neutral-600">No notes pinned yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notes.data.map((n) => (
            <li
              key={n.id}
              className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 text-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  {n.title ? (
                    <div className="font-medium text-neutral-200">
                      {n.title}
                    </div>
                  ) : null}
                  {n.body ? (
                    <p className="whitespace-pre-wrap text-neutral-400">
                      {n.body}
                    </p>
                  ) : null}
                  <div className="mt-1 flex items-center gap-2 text-xs text-neutral-600">
                    <span>{relTime(n.createdAt)}</span>
                    {n.game ? (
                      <span className="rounded bg-neutral-800 px-1.5 py-px text-neutral-400">
                        {n.game.name}
                      </span>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => del.mutate(n.id)}
                  className="text-xs text-neutral-600 hover:text-rose-300"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
