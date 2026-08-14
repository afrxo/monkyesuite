// Optional pinned tracker games (specs/05 §5.5). A project needs zero linked
// games to be usable, so this is a lightweight watch-set: link by universeId,
// unlink, jump to the game's detail page. Deleting the global game (elsewhere)
// nulls references but never the project.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { ScopedError } from "../components/scoped";
import { api } from "../lib/api";

export function GamesPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const games = useQuery({
    queryKey: ["project-games", projectId],
    queryFn: () => api.projectGames(projectId),
  });
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["project-games", projectId] });

  const link = useMutation({
    mutationFn: (v: { universeId: number; note?: string }) =>
      api.linkGame(projectId, v),
    onSuccess: invalidate,
  });
  const unlink = useMutation({
    mutationFn: (universeId: number) => api.unlinkGame(projectId, universeId),
    onSuccess: invalidate,
  });

  const [universe, setUniverse] = useState("");
  const [note, setNote] = useState("");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const universeId = Number(universe.trim());
    if (!Number.isInteger(universeId) || universeId <= 0) return;
    link.mutate(
      { universeId, note: note.trim() || undefined },
      {
        onSuccess: () => {
          setUniverse("");
          setNote("");
        },
      },
    );
  };

  if (games.isError) return <ScopedError error={games.error} />;
  if (games.isPending) return <p className="text-sm text-text-5">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={onSubmit}
        className="flex flex-wrap items-center gap-2 rounded-lg border border-border-1 bg-surface-1/40 p-3"
      >
        <input
          value={universe}
          onChange={(e) => setUniverse(e.target.value)}
          placeholder="universeId"
          inputMode="numeric"
          className="w-40 rounded-md border border-border-1 bg-surface-1 px-3 py-1.5 text-sm text-text-1 outline-none focus:border-text-5"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="why pin it (optional)"
          className="flex-1 rounded-md border border-border-1 bg-surface-1 px-3 py-1.5 text-sm text-text-1 outline-none focus:border-text-5"
        />
        <button
          type="submit"
          disabled={link.isPending}
          className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
        >
          Pin game
        </button>
        {link.isError ? (
          <p className="w-full text-sm text-rose-400">{link.error.message}</p>
        ) : null}
      </form>

      {games.data.length === 0 ? (
        <p className="text-sm text-text-5">
          No games pinned. A project works fine without any.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {games.data.map((g) => (
            <li
              key={g.universeId}
              className="flex items-center gap-3 rounded-lg border border-border-1 bg-surface-1/40 p-3"
            >
              {g.iconUrl ? (
                <img
                  src={g.iconUrl}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded-lg bg-white/[0.04] object-cover"
                />
              ) : (
                <div className="h-10 w-10 shrink-0 rounded-lg bg-white/[0.04]" />
              )}
              <div className="min-w-0 flex-1">
                <Link
                  to="/games/$id"
                  params={{ id: String(g.universeId) }}
                  className="truncate font-medium text-text-1 hover:underline"
                >
                  {g.name}
                </Link>
                {g.note ? (
                  <p className="truncate text-xs text-text-4">{g.note}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => unlink.mutate(g.universeId)}
                className="text-xs text-text-5 hover:text-rose-300"
              >
                unpin
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
