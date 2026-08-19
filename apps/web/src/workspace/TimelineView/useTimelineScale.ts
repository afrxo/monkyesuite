// Zoom + horizontal scale for the timeline. The entire coordinate system is
// `x = (dayIndex − origin) × dayWidth` — everything else here is preset
// bookkeeping, per-project preference persistence, and scroll helpers.

import { useCallback, useEffect, useRef, useState } from "react";

export type ZoomKey = "quarter" | "month" | "week" | "day";

export const ZOOM: Record<
  ZoomKey,
  {
    dayWidth: number;
    major: "year" | "month";
    minor: "quarter" | "month" | "week" | "day";
  }
> = {
  quarter: { dayWidth: 2.6, major: "year", minor: "quarter" },
  month: { dayWidth: 6.5, major: "year", minor: "month" },
  week: { dayWidth: 18, major: "month", minor: "week" },
  day: { dayWidth: 44, major: "month", minor: "day" },
};

// Ordered small → large so [ / ] can step through presets.
export const ZOOM_ORDER: ZoomKey[] = ["quarter", "month", "week", "day"];

export const GUTTER_W = 280;

type TimelinePrefs = {
  zoom: ZoomKey;
  trayOpen: boolean;
  collapsedMilestoneIds: string[];
  expandedMilestoneIds: string[]; // completed groups the user re-opened
};

const PREFS_KEY = (projectId: string) => `monkye:timeline:${projectId}`;

const isZoomKey = (v: unknown): v is ZoomKey =>
  v === "quarter" || v === "month" || v === "week" || v === "day";

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function loadPrefs(projectId: string): TimelinePrefs {
  const fallback: TimelinePrefs = {
    zoom: "week",
    trayOpen: true,
    collapsedMilestoneIds: [],
    expandedMilestoneIds: [],
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY(projectId));
    if (!raw) return fallback;
    const p: unknown = JSON.parse(raw);
    if (!p || typeof p !== "object") return fallback;
    const o = p as Record<string, unknown>;
    const strings = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === "string")
        : [];
    return {
      zoom: isZoomKey(o.zoom) ? o.zoom : fallback.zoom,
      trayOpen: typeof o.trayOpen === "boolean" ? o.trayOpen : true,
      collapsedMilestoneIds: strings(o.collapsedMilestoneIds),
      expandedMilestoneIds: strings(o.expandedMilestoneIds),
    };
  } catch {
    return fallback;
  }
}

export function savePrefs(projectId: string, prefs: TimelinePrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFS_KEY(projectId), JSON.stringify(prefs));
  } catch {
    /* storage full / unavailable — prefs just won't persist */
  }
}

export function useTimelineScale({
  projectId,
  originDay,
  endDay,
  todayDay,
}: {
  projectId: string;
  originDay: number;
  endDay: number;
  todayDay: number;
}) {
  const [zoom, setZoomState] = useState<ZoomKey>(
    () => loadPrefs(projectId).zoom,
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  const dayWidth = ZOOM[zoom].dayWidth;
  const totalDays = endDay - originDay + 1;
  const canvasWidth = totalDays * dayWidth;

  const x = useCallback(
    (day: number) => (day - originDay) * dayWidth,
    [originDay, dayWidth],
  );
  /** Canvas px → day index, snapped to the containing day. */
  const dayAt = useCallback(
    (px: number) => originDay + Math.floor(px / dayWidth),
    [originDay, dayWidth],
  );

  const scrollToToday = useCallback(
    (smooth = true) => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({
        left: Math.max(
          0,
          (todayDay - originDay) * ZOOM[zoom].dayWidth -
            (el.clientWidth - GUTTER_W) * 0.25,
        ),
        behavior: smooth && !reducedMotion() ? "smooth" : "auto",
      });
    },
    [todayDay, originDay, zoom],
  );

  const setZoom = useCallback(
    (z: ZoomKey) => {
      setZoomState((prev) => {
        if (prev === z) return prev;
        // Keep the day under the viewport's focal point stable across the
        // preset switch: re-derive scrollLeft from the anchored day.
        const el = scrollRef.current;
        if (el) {
          const focalPx = el.scrollLeft + (el.clientWidth - GUTTER_W) * 0.25;
          const focalDay = originDay + focalPx / ZOOM[prev].dayWidth;
          requestAnimationFrame(() => {
            el.scrollLeft = Math.max(
              0,
              (focalDay - originDay) * ZOOM[z].dayWidth -
                (el.clientWidth - GUTTER_W) * 0.25,
            );
          });
        }
        return z;
      });
    },
    [originDay],
  );

  const zoomStep = useCallback((delta: 1 | -1) => {
    setZoomState((prev) => {
      const i = ZOOM_ORDER.indexOf(prev) + delta;
      const next = ZOOM_ORDER[Math.max(0, Math.min(ZOOM_ORDER.length - 1, i))];
      return next ?? prev;
    });
  }, []);

  // Fit: largest preset whose full range fits the viewport, scrolled to origin.
  const fit = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const avail = el.clientWidth - GUTTER_W;
    const pick =
      [...ZOOM_ORDER]
        .reverse()
        .find((k) => totalDays * ZOOM[k].dayWidth <= avail) ?? "quarter";
    setZoomState(pick);
    requestAnimationFrame(() => {
      el.scrollTo({ left: 0, behavior: reducedMotion() ? "auto" : "smooth" });
    });
  }, [totalDays]);

  // First mount: default view is today at 25% of the canvas viewport.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    scrollToToday(false);
  }, [scrollToToday]);

  return {
    zoom,
    setZoom,
    zoomStep,
    dayWidth,
    canvasWidth,
    totalDays,
    x,
    dayAt,
    fit,
    scrollToToday,
    scrollRef,
  };
}
