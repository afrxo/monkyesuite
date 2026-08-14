import type { LifecycleEventKind, LifecycleStage } from "./types";

export const LIFECYCLE: Record<
  LifecycleStage,
  { label: string; color: string }
> = {
  new: { label: "New", color: "var(--lifecycle-new)" },
  growing: { label: "Growing", color: "var(--lifecycle-growing)" },
  peaking: { label: "Peaking", color: "var(--lifecycle-peaking)" },
  declining: { label: "Declining", color: "var(--lifecycle-declining)" },
};

export type EventKindStyle = {
  label: string;
  color: string;
  shape: "circle" | "diamond" | "star" | "square";
};

export const EVENT_KIND: Record<LifecycleEventKind, EventKindStyle> = {
  lifecycle_transition: {
    label: "Stage change",
    color: "var(--text-3)",
    shape: "circle",
  },
  new_high_24h: {
    label: "24h high",
    color: "var(--event-mint)",
    shape: "diamond",
  },
  new_high_7d: {
    label: "7d high",
    color: "var(--event-gold)",
    shape: "star",
  },
  roblox_sort_appearance: {
    label: "Sort entry",
    color: "var(--event-muted)",
    shape: "square",
  },
  roblox_sort_exit: {
    label: "Sort exit",
    color: "var(--text-4)",
    shape: "square",
  },
  update_shipped: {
    label: "Update shipped",
    color: "var(--lifecycle-growing)",
    shape: "diamond",
  },
  update_lift_measured: {
    label: "Update lift",
    color: "var(--lifecycle-growing)",
    shape: "diamond",
  },
};

export const SORT_LABELS: Record<string, string> = {
  "top-trending": "Top Trending",
  "up-and-coming": "Up & Coming",
  "top-playing-now": "Top Playing Now",
  "fun-with-friends": "Fun With Friends",
  "top-revisited": "Top Revisited",
  "top-earning": "Top Earning",
  "top-paid-access": "Top Paid Access",
  "top-rated": "Top Rated",
  "most-popular": "Most Popular",
};

export function sortLabel(s: string): string {
  return SORT_LABELS[s] ?? s;
}

const HEADLINE_SORTS = new Set([
  "top-trending",
  "up-and-coming",
  "top-playing-now",
]);

export function sortTier(name: string): "headline" | "niche" {
  return HEADLINE_SORTS.has(name) ? "headline" : "niche";
}

export const SORT_TIER_COLOR: Record<"headline" | "niche", string> = {
  headline: "var(--event-gold)",
  niche: "var(--event-muted)",
};
