export type LifecycleStage = "new" | "growing" | "peaking" | "declining";

export const FILTERS = [
  "all",
  "new",
  "growing",
  "peaking",
  "declining",
] as const;
export type FilterValue = (typeof FILTERS)[number];

export const SORTS = ["spike", "trend", "ccu", "velocity", "newest"] as const;
export type SortValue = (typeof SORTS)[number];

export const SORT_LABEL: Record<SortValue, string> = {
  spike: "Spike",
  trend: "Trend",
  ccu: "CCU",
  velocity: "Velocity",
  newest: "Newest",
};

export type LifecycleEventKind =
  | "lifecycle_transition"
  | "new_high_24h"
  | "new_high_7d"
  | "roblox_sort_appearance"
  | "roblox_sort_exit"
  | "update_shipped"
  | "update_lift_measured";

export type LifecycleEvent = {
  stage: LifecycleStage;
  kind: LifecycleEventKind;
  occurredAt: number;
  reason: string;
  ccu: number | null;
  delta24hPct: number | null;
  delta24hAbs: number | null;
  windowMinutes: number | null;
  ccuBefore: number | null;
  ccuAfter: number | null;
  fromStage: LifecycleStage | null;
  context: string | null;
};
