import { useNavigate, useRouter } from "@tanstack/react-router";
import { Dialog } from "radix-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "#/lib/api";
import { fmtCCU } from "#/lib/format";
import type { SearchResult } from "#/lib/types";
import { Thumb } from "../PulseCardParts";
import Highlight from "./Highlight";
import { LIFECYCLE_DOT, s } from "./SearchModal.styles";
import SearchSkeleton from "./SearchSkeleton";

const DEBOUNCE_MS = 150;
const SPINNER_DELAY_MS = 200;
const SKELETON_DELAY_MS = 120;
const CACHE_MAX = 20;
const MIN_QUERY = 2;

type SearchModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function SearchModal({ open, onOpenChange }: SearchModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [resultsKey, setResultsKey] = useState("");
  const [showSpinner, setShowSpinner] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const spinnerTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const skeletonTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const requestIdRef = useRef(0);
  const hasFiredRef = useRef(false);
  const cacheRef = useRef<Map<string, SearchResult[]>>(new Map());
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const router = useRouter();

  const clearAllTimers = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (spinnerTimerRef.current) clearTimeout(spinnerTimerRef.current);
    if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current);
  }, []);

  useEffect(() => {
    if (!open) {
      clearAllTimers();
      setQuery("");
      setResults([]);
      setResultsKey("");
      setShowSpinner(false);
      setShowSkeleton(false);
      setActiveIndex(0);
      hasFiredRef.current = false;
      requestIdRef.current++;
    }
  }, [open, clearAllTimers]);

  const cacheGet = useCallback((key: string): SearchResult[] | undefined => {
    const c = cacheRef.current;
    const v = c.get(key);
    if (v) {
      c.delete(key);
      c.set(key, v);
    }
    return v;
  }, []);

  const cacheSet = useCallback((key: string, value: SearchResult[]) => {
    const c = cacheRef.current;
    if (c.has(key)) c.delete(key);
    c.set(key, value);
    if (c.size > CACHE_MAX) {
      const oldest = c.keys().next().value;
      if (oldest !== undefined) c.delete(oldest);
    }
  }, []);

  const longestPrefixHit = useCallback(
    (key: string): { key: string; results: SearchResult[] } | null => {
      const c = cacheRef.current;
      let best: { key: string; results: SearchResult[] } | null = null;
      for (const [k, v] of c) {
        if (key.startsWith(k) && k.length >= MIN_QUERY) {
          if (!best || k.length > best.key.length)
            best = { key: k, results: v };
        }
      }
      return best;
    },
    [],
  );

  const fireQuery = useCallback(
    async (trimmed: string) => {
      const id = ++requestIdRef.current;
      try {
        const data = (await api.pulseSearch(trimmed))
          // Filter out rows without a lifecycle stage — the local SearchResult
          // type expects non-null (matches tlw), and rows without a stage are
          // typically warm-up games with no useful signal to display anyway.
          .filter(
            (
              r,
            ): r is typeof r & { lifecycle: NonNullable<typeof r.lifecycle> } =>
              r.lifecycle !== null,
          ) as SearchResult[];
        if (id !== requestIdRef.current) return;
        cacheSet(trimmed, data);
        setResults(data);
        setResultsKey(trimmed);
      } finally {
        if (id === requestIdRef.current) {
          if (spinnerTimerRef.current) clearTimeout(spinnerTimerRef.current);
          if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current);
          setShowSpinner(false);
          setShowSkeleton(false);
        }
      }
    },
    [cacheSet],
  );

  const handleInput = useCallback(
    (value: string) => {
      setQuery(value);
      setActiveIndex(0);
      clearAllTimers();

      const trimmed = value.trim().toLowerCase();

      if (trimmed.length < MIN_QUERY) {
        setResults([]);
        setResultsKey("");
        setShowSpinner(false);
        setShowSkeleton(false);
        hasFiredRef.current = false;
        requestIdRef.current++;
        return;
      }

      const exact = cacheGet(trimmed);
      if (exact) {
        setResults(exact);
        setResultsKey(trimmed);
        setShowSpinner(false);
        setShowSkeleton(false);
        fireQuery(trimmed);
        return;
      }

      const prefix = longestPrefixHit(trimmed);
      if (prefix) {
        const filtered = prefix.results.filter((r) => {
          return (
            r.name.toLowerCase().includes(trimmed) ||
            r.creatorName.toLowerCase().includes(trimmed)
          );
        });
        setResults(filtered);
        setResultsKey(prefix.key);
      }

      spinnerTimerRef.current = setTimeout(
        () => setShowSpinner(true),
        SPINNER_DELAY_MS,
      );
      skeletonTimerRef.current = setTimeout(
        () => setShowSkeleton(true),
        SKELETON_DELAY_MS,
      );

      if (!hasFiredRef.current) {
        hasFiredRef.current = true;
        fireQuery(trimmed);
      } else {
        debounceTimerRef.current = setTimeout(
          () => fireQuery(trimmed),
          DEBOUNCE_MS,
        );
      }
    },
    [cacheGet, clearAllTimers, fireQuery, longestPrefixHit],
  );

  const selectResult = useCallback(
    (r: SearchResult) => {
      onOpenChange(false);
      navigate({ to: "/games/$id", params: { id: String(r.id) } });
    },
    [navigate, onOpenChange],
  );

  const prefetchResult = useCallback(
    (r: SearchResult) => {
      void router
        .preloadRoute({ to: "/games/$id", params: { id: String(r.id) } })
        .catch(() => {});
    },
    [router],
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[activeIndex]) {
      e.preventDefault();
      selectResult(results[activeIndex]);
    }
  }

  useEffect(() => {
    const r = results[activeIndex];
    if (r) prefetchResult(r);
  }, [activeIndex, results, prefetchResult]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    if (el) (el as HTMLElement).scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const trimmed = useMemo(() => query.trim().toLowerCase(), [query]);
  const hasQuery = trimmed.length >= MIN_QUERY;
  const isStale = hasQuery && resultsKey !== trimmed;
  const renderSkeletons = hasQuery && showSkeleton && results.length === 0;
  const showEmpty =
    hasQuery &&
    !renderSkeletons &&
    results.length === 0 &&
    resultsKey === trimmed;
  const showIdle = !hasQuery;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="search-overlay" />
        <Dialog.Content
          className="search-content"
          style={s.panel}
          onKeyDown={handleKeyDown}
          aria-label="Search games and creators"
        >
          <div style={s.inputRow}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0, color: "var(--text-4)" }}
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={query}
              onChange={(e) => handleInput(e.target.value)}
              placeholder="Search games, creators…"
              // The modal exists to be typed into: it opens on ⌘K and traps
              // focus, so this is expected behaviour, not a hijack of an
              // already-loaded page.
              // biome-ignore lint/a11y/noAutofocus: see above
              autoFocus
              style={s.input}
            />
            {showSpinner && <span style={s.spinner} />}
            <kbd style={s.kbd}>esc</kbd>
          </div>

          <div style={s.divider} />

          <div
            ref={listRef}
            style={s.resultsList}
            className="no-scrollbar"
            role="listbox"
            aria-label="Search results"
          >
            {!renderSkeletons && results.length > 0 && (
              <div
                style={{
                  opacity: isStale ? 0.6 : 1,
                  transition: "opacity 120ms ease",
                }}
              >
                {results.map((r, i) => (
                  // Arrow-key navigation lives on the panel's handleKeyDown
                  // (↑/↓ move activeIndex, Enter selects). The listbox/option
                  // roles are what let a screen reader follow that same state;
                  // tabIndex -1 keeps the row focusable without adding it to
                  // the tab order, which belongs to the input.
                  <div
                    key={r.id}
                    role="option"
                    aria-selected={i === activeIndex}
                    tabIndex={-1}
                    data-index={i}
                    data-active={i === activeIndex}
                    className="search-result"
                    style={s.resultRow}
                    onClick={() => selectResult(r)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectResult(r);
                      }
                    }}
                    onMouseEnter={() => {
                      setActiveIndex(i);
                      prefetchResult(r);
                    }}
                    onFocus={() => prefetchResult(r)}
                  >
                    <Thumb
                      name={r.name}
                      src={r.thumbnail}
                      size={36}
                      radius={8}
                    />
                    <div style={s.resultInfo}>
                      <div style={s.resultName}>
                        <Highlight text={r.name} q={trimmed} />
                      </div>
                      <div style={s.resultMeta}>
                        <span style={s.resultMetaText}>
                          <Highlight text={r.creatorName} q={trimmed} />
                        </span>
                        {r.genre && <span style={s.genreBadge}>{r.genre}</span>}
                      </div>
                    </div>
                    <div style={s.resultRight}>
                      <span style={s.resultCcu}>
                        {fmtCCU(r.ccu, { compact: true })}
                      </span>
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 3,
                          background: LIFECYCLE_DOT[r.lifecycle],
                          flexShrink: 0,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {renderSkeletons && <SearchSkeleton />}
            {showEmpty && <div style={s.emptyState}>No games found</div>}
            {showIdle && (
              <div style={s.idleState}>Search by game name or creator…</div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
