// Small presentational primitives shared by feed + detail. The non-negotiable
// one is <Estimate>: every scraped/derived number renders with its freshness so
// a proxy never reads as ground truth (specs/00-overview, 08-web acceptance).

import type { LifecycleStage } from "@monkyesuite/shared";
import type { ReactNode } from "react";
import { relTime } from "../lib/format";

const LIFECYCLE_COLOR: Record<LifecycleStage, string> = {
  launching: "bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-500/30",
  growing: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  stable: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  cooling: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  declining: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  dormant: "bg-neutral-500/15 text-neutral-400 ring-neutral-500/30",
  revived: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
};

export function LifecycleBadge({ stage }: { stage: LifecycleStage | null }) {
  if (!stage) {
    return (
      <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-500 ring-1 ring-neutral-700">
        no signal
      </span>
    );
  }
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ${LIFECYCLE_COLOR[stage]}`}
    >
      {stage}
    </span>
  );
}

// The estimate label: an "est." tag + when it was computed/captured. Hover shows
// the exact timestamp. This is the freshness contract made visible.
export function Estimate({
  at,
  label = "est.",
}: {
  at: string | null;
  label?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] text-neutral-500"
      title={at ? new Date(at).toISOString() : "no timestamp"}
    >
      <span className="rounded bg-neutral-800 px-1 py-px font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </span>
      <span>{relTime(at)}</span>
    </span>
  );
}

export function SortRank({
  sort,
  rank,
}: {
  sort: string | null;
  rank: number | null;
}) {
  if (!sort || rank === null) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-indigo-500/10 px-2 py-0.5 text-xs text-indigo-300 ring-1 ring-indigo-500/25">
      <span className="opacity-70">#{rank}</span>
      <span className="capitalize">{sort.replace(/-/g, " ")}</span>
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-neutral-500">
        {label}
      </span>
      <span className="text-lg font-semibold tabular-nums text-neutral-100">
        {value}
      </span>
      {hint ? <span className="text-xs text-neutral-500">{hint}</span> : null}
    </div>
  );
}
