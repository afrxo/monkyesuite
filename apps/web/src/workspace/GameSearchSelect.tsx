// Shared game-search combobox — the "search a game by name, pick one" control
// used both to add a tracked game to a project (Sidebar `RefForm`) and to
// attach a game as context to a note (NotesRail composer). Debounced global
// search (`pulseSearch`, 2+ chars), thumbnail/name/creator/CCU rows, keyboard
// nav. It owns the query + selected display; parents mirror the choice via
// onPick / onClear for their own downstream state.

import type { PulseSearchResult } from "@monkyesuite/shared";
import { useQuery } from "@tanstack/react-query";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { Skeleton, useDelayedFlag } from "../components/Skeleton";
import { api } from "../lib/api";

export function formatCcu(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function GameSearchSelect({
  onPick,
  onClear,
  onEscapeEmpty,
  placeholder = "Search game by name",
  autoFocus,
}: {
  onPick: (r: PulseSearchResult) => void;
  onClear?: () => void;
  onEscapeEmpty?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<PulseSearchResult | null>(null);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (selected) return;
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query, selected]);

  const search = useQuery({
    queryKey: ["gameSearch", debounced],
    queryFn: () => api.pulseSearch(debounced),
    enabled: !selected && debounced.length >= 2,
    staleTime: 15_000,
  });

  const results = useMemo(() => search.data ?? [], [search.data]);
  const showDropdown =
    open && !selected && debounced.length >= 2 && !search.isFetching;
  // Only counts as loading once the fetch has run past the flash threshold —
  // a cached term resolves under it and never shows a placeholder at all.
  const showLoading = useDelayedFlag(
    open && !selected && debounced.length >= 2 && search.isFetching,
  );

  const pick = (r: PulseSearchResult) => {
    setSelected(r);
    setQuery(r.name);
    setOpen(false);
    onPick(r);
  };

  const clear = () => {
    setSelected(null);
    setQuery("");
    setDebounced("");
    setOpen(true);
    onClear?.();
  };

  const onQueryKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (open) setOpen(false);
      else onEscapeEmpty?.();
      return;
    }
    if (!showDropdown || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[cursor];
      if (r) pick(r);
    }
  };

  return (
    <div className="relative">
      <input
        // biome-ignore lint/a11y/noAutofocus: focus what the user opened
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => {
          const v = e.target.value;
          setQuery(v);
          if (selected && v !== selected.name) {
            setSelected(null);
            onClear?.();
          }
          setOpen(true);
          setCursor(0);
        }}
        onFocus={() => !selected && setOpen(true)}
        onKeyDown={onQueryKey}
        placeholder={placeholder}
        className="w-full rounded border border-border-1 bg-surface-1 px-2 py-1 pr-6 text-xs text-text-1 outline-none focus:border-text-5"
      />
      {selected ? (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear selection"
          className="absolute right-1 top-1/2 grid h-4 w-4 -translate-y-1/2 place-items-center rounded text-text-disabled hover:bg-white/[0.06] hover:text-text-1"
        >
          <Icon name="x" size={10} />
        </button>
      ) : null}
      {showLoading ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 flex flex-col gap-2 rounded-md border border-border-1 bg-surface-1 p-2 shadow-lg">
          {[86, 68, 74].map((w) => (
            <div key={`gs-${w}`} className="flex items-center gap-2">
              <Skeleton w={22} h={22} className="rounded" />
              <Skeleton w={`${w}%`} h={10} />
            </div>
          ))}
        </div>
      ) : null}
      {showDropdown ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-border-1 bg-surface-1 py-1 shadow-lg">
          {results.length === 0 ? (
            <div className="px-2 py-1.5 text-[11px] leading-tight text-text-disabled">
              No tracked game matches. Scraper may not have picked it up yet.
            </div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.id}
                type="button"
                onMouseEnter={() => setCursor(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(r);
                }}
                className={`flex w-full items-center gap-2 px-2 py-1 text-left text-xs ${
                  i === cursor
                    ? "bg-white/[0.05] text-text-1"
                    : "text-text-3 hover:bg-white/[0.04]"
                }`}
              >
                {r.thumbnail ? (
                  <img
                    src={r.thumbnail}
                    alt=""
                    className="h-4 w-4 shrink-0 rounded-sm object-cover"
                  />
                ) : (
                  <span className="grid h-4 w-4 shrink-0 place-items-center rounded-sm bg-white/[0.06] text-[10px] font-bold text-text-1">
                    {r.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{r.name}</span>
                  <span className="truncate text-[10px] text-text-disabled">
                    {r.creatorName}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-text-disabled">
                  {formatCcu(r.ccu)}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
