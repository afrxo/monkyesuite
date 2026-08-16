// Per-game notes thread (specs/07 §7.3, 08-web §8.3). The SSR loader seeds the
// shared notes; on the client we refetch with the session cookie so a signed-in
// user also sees THEIR private notes and gets the compose + edit controls. The
// API never returns another user's private note, so nothing here can leak one.

import type { GameNote, NoteVisibility } from "@monkyesuite/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { toastError } from "./Toast";
import { api } from "../lib/api";
import { useSession } from "../lib/auth";
import { relTime } from "../lib/format";

export function GameNotes({
  universeId,
  initial,
}: {
  universeId: number;
  initial: GameNote[];
}) {
  const { user } = useSession();
  const qc = useQueryClient();
  const key = ["game-notes", universeId] as const;
  const notes = useQuery({
    queryKey: key,
    queryFn: () => api.notes(universeId),
    initialData: initial,
    // Once we know a user is present, refetch to pull in private notes.
    enabled: true,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  return (
    <div className="flex flex-col gap-3">
      {user ? (
        <Compose universeId={universeId} onChanged={invalidate} />
      ) : (
        <p className="text-xs text-text-5">
          <Link to="/sign-in" className="text-indigo-400 hover:underline">
            Sign in
          </Link>{" "}
          to add notes or see your private ones. Signed-out view shows shared
          notes only.
        </p>
      )}

      {notes.data.length === 0 ? (
        <p className="text-sm text-text-5">No notes yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notes.data.map((n) => (
            <NoteRow key={n.id} note={n} onChanged={invalidate} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Compose({
  universeId,
  onChanged,
}: {
  universeId: number;
  onChanged: () => void;
}) {
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<NoteVisibility>("shared");
  const create = useMutation({
    mutationFn: () =>
      api.createNote(universeId, { body: body.trim(), visibility }),
    onSuccess: () => {
      setBody("");
      onChanged();
    },
    onError: (err) => toastError(err),
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (body.trim()) create.mutate();
  };
  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-2 rounded-lg border border-border-1 bg-surface-1/40 p-3"
    >
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="Add a note about this game…"
        className="rounded-md border border-border-1 bg-surface-1 px-3 py-1.5 text-sm text-text-1 outline-none focus:border-text-5"
      />
      <div className="flex items-center gap-3">
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as NoteVisibility)}
          className="rounded-md border border-border-1 bg-surface-1 px-2 py-1 text-xs text-text-2"
        >
          <option value="shared">Shared (team)</option>
          <option value="private">Private (only me)</option>
        </select>
        <button
          type="submit"
          disabled={create.isPending || !body.trim()}
          className="ml-auto rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
        >
          Post
        </button>
      </div>
      {create.isError ? (
        <p className="text-sm text-rose-400">{create.error.message}</p>
      ) : null}
    </form>
  );
}

function NoteRow({
  note,
  onChanged,
}: {
  note: GameNote;
  onChanged: () => void;
}) {
  const del = useMutation({
    mutationFn: () => api.deleteNote(note.id),
    onSuccess: onChanged,
    onError: (err) => toastError(err),
  });
  return (
    <li className="rounded-lg border border-border-1 bg-surface-1/40 p-3 text-sm">
      <div className="mb-1 flex items-center gap-2 text-xs text-text-4">
        <span className="text-text-2">
          {note.isOwn ? "You" : (note.authorName ?? note.authorId)}
        </span>
        <span
          className={`rounded px-1.5 py-px capitalize ${
            note.visibility === "private"
              ? "bg-amber-500/10 text-amber-300"
              : "bg-white/[0.04] text-text-3"
          }`}
        >
          {note.visibility}
        </span>
        <span>{relTime(note.createdAt)}</span>
        {note.isOwn ? (
          <button
            type="button"
            onClick={() => del.mutate()}
            aria-label="Delete note"
            className="ml-auto text-text-5 transition-colors hover:text-rose-300"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
          </button>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap text-text-2">{note.body}</p>
    </li>
  );
}
