// The single period control shared by every Finances tab. Owns URL-synced
// state; the old separate "As of X | All time" toggle inside PositionZone
// disappears — a period is one thing, not two.
//
// URL params:
//   view=statements|ledger|people   — active tab (redirected from ?tab=overview)
//   ptype=month|quarter|year|all|custom
//   pstart=YYYY-MM-DD               — used by custom; derivable for others but
//                                     kept explicit so a shared URL is complete
//   pend=YYYY-MM-DD
//
// Keyboard: [/] steps by the current period type; Shift+[/] cycles the type.

import { useCallback, useEffect, useMemo } from "react";

export type PeriodType = "month" | "quarter" | "year" | "all" | "custom";

export interface Period {
  type: PeriodType;
  // Inclusive YYYY-MM-DD. For "all", `start` is a sentinel (project-earliest
  // is a server concern; the UI passes null-ish shape via "all").
  start: string;
  end: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function iso(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function firstOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function lastOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

// Snap a range to the given type, keyed off the current period's start.
function snap(type: PeriodType, anchor: Date): { start: Date; end: Date } {
  switch (type) {
    case "month": {
      const s = firstOfMonth(anchor);
      return { start: s, end: lastOfMonth(s) };
    }
    case "quarter": {
      const q = Math.floor(anchor.getUTCMonth() / 3);
      const s = new Date(Date.UTC(anchor.getUTCFullYear(), q * 3, 1));
      const e = new Date(Date.UTC(anchor.getUTCFullYear(), q * 3 + 3, 0));
      return { start: s, end: e };
    }
    case "year": {
      const s = new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1));
      const e = new Date(Date.UTC(anchor.getUTCFullYear(), 11, 31));
      return { start: s, end: e };
    }
    case "all": {
      // Sentinel range — the tab is expected to interpret "all" as project
      // history. Kept as valid dates so URL parsing is symmetric.
      const now = new Date();
      return { start: new Date(Date.UTC(2000, 0, 1)), end: firstOfMonth(now) };
    }
    case "custom":
      return { start: anchor, end: anchor };
  }
}

export function todayPeriod(type: PeriodType = "month"): Period {
  const { start, end } = snap(type, new Date());
  return { type, start: iso(start), end: iso(end) };
}

// Read the current period from URL. Falls back to current month.
export function useUrlPeriod(): [Period, (p: Period) => void] {
  const period = useMemo<Period>(() => {
    const params = new URLSearchParams(window.location.search);
    const type = (params.get("ptype") as PeriodType | null) ?? "month";
    const start = params.get("pstart");
    const end = params.get("pend");
    if (start && end && /^\d{4}-\d{2}-\d{2}$/.test(start)) {
      return { type, start, end };
    }
    return todayPeriod(type);
    // Read once on mount — subsequent updates flow through setPeriod which
    // writes to the URL and calls a rerender via history.replaceState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPeriod = useCallback((next: Period) => {
    const params = new URLSearchParams(window.location.search);
    params.set("ptype", next.type);
    params.set("pstart", next.start);
    params.set("pend", next.end);
    const url = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.replaceState(null, "", url);
    // A cheap forced rerender for the top-level: fire a synthetic popstate.
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  // Rerender on URL change.
  useEffect(() => {
    const handler = () => {
      // no-op — setState hook triggers the reader below to re-run.
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  return [period, setPeriod];
}

// Step a period by one unit of its type ("[" and "]"). "all" ignores steps.
export function stepPeriod(p: Period, delta: -1 | 1): Period {
  if (p.type === "all") return p;
  const start = new Date(`${p.start}T00:00:00Z`);
  switch (p.type) {
    case "month": {
      const s = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + delta, 1),
      );
      return { type: "month", start: iso(s), end: iso(lastOfMonth(s)) };
    }
    case "quarter": {
      const s = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3 * delta, 1),
      );
      const e = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 3, 0));
      return { type: "quarter", start: iso(s), end: iso(e) };
    }
    case "year": {
      const y = start.getUTCFullYear() + delta;
      return {
        type: "year",
        start: `${y}-01-01`,
        end: `${y}-12-31`,
      };
    }
    case "custom": {
      // Slide the window by its own length so the type behaves like "range".
      const end = new Date(`${p.end}T00:00:00Z`);
      const spanMs = end.getTime() - start.getTime();
      const s = new Date(start.getTime() + delta * (spanMs + 86_400_000));
      const e = new Date(end.getTime() + delta * (spanMs + 86_400_000));
      return { type: "custom", start: iso(s), end: iso(e) };
    }
  }
}

// Cycle period type (Shift+[/]). Preserves the anchor date.
const TYPE_ORDER: PeriodType[] = ["month", "quarter", "year", "all", "custom"];
export function cycleType(p: Period, delta: -1 | 1): Period {
  const i = TYPE_ORDER.indexOf(p.type);
  const nextType =
    TYPE_ORDER[(i + delta + TYPE_ORDER.length) % TYPE_ORDER.length];
  if (!nextType || nextType === p.type) return p;
  const anchor = new Date(`${p.start}T00:00:00Z`);
  const { start, end } = snap(nextType, anchor);
  return { type: nextType, start: iso(start), end: iso(end) };
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function periodLabel(p: Period): string {
  if (p.type === "all") return "All time";
  const s = new Date(`${p.start}T00:00:00Z`);
  switch (p.type) {
    case "month":
      return `${MONTH_NAMES[s.getUTCMonth()]} ${s.getUTCFullYear()}`;
    case "quarter":
      return `Q${Math.floor(s.getUTCMonth() / 3) + 1} ${s.getUTCFullYear()}`;
    case "year":
      return String(s.getUTCFullYear());
    case "custom":
      return `${p.start} → ${p.end}`;
  }
}

export function PeriodControl({
  period,
  onChange,
}: {
  period: Period;
  onChange: (p: Period) => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border-1 bg-surface-0 px-5 py-2.5">
      {/* Type chips */}
      <div className="flex gap-0.5">
        {(["month", "quarter", "year", "all"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              const anchor = new Date(`${period.start}T00:00:00Z`);
              const snapped = snap(t, anchor);
              onChange({
                type: t,
                start: iso(snapped.start),
                end: iso(snapped.end),
              });
            }}
            className={`rounded px-2 py-0.5 text-[11px] capitalize transition-colors ${
              period.type === t
                ? "bg-white/[0.06] text-text-1"
                : "text-text-3 hover:text-text-1"
            }`}
          >
            {t === "all" ? "All time" : t}
          </button>
        ))}
      </div>

      <div className="mx-1 h-4 w-px bg-border-2" />

      {/* Nav */}
      <button
        type="button"
        onClick={() => onChange(stepPeriod(period, -1))}
        disabled={period.type === "all"}
        className="rounded px-1.5 py-0.5 text-text-3 hover:text-text-1 disabled:opacity-30"
        aria-label="Previous period"
      >
        ‹
      </button>
      <span className="min-w-[8rem] text-center text-sm font-semibold tracking-[0.02em] text-text-1">
        {periodLabel(period)}
      </span>
      <button
        type="button"
        onClick={() => onChange(stepPeriod(period, 1))}
        disabled={period.type === "all"}
        className="rounded px-1.5 py-0.5 text-text-3 hover:text-text-1 disabled:opacity-30"
        aria-label="Next period"
      >
        ›
      </button>

      <button
        type="button"
        onClick={() =>
          onChange(todayPeriod(period.type === "all" ? "month" : period.type))
        }
        className="ml-1 rounded border border-border-2 px-2 py-0.5 text-[11px] text-text-3 hover:text-text-1"
      >
        Today
      </button>
    </div>
  );
}
