// Shared loading-shape primitives. Two rules hold everywhere:
//
//  1. A skeleton is only for genuinely cold data. If the value is already in
//     the query cache (or derivable from a parent list), render the real thing
//     — a skeleton over known data is a regression, not a loading state.
//  2. Never flash. `useDelayedFlag` holds the skeleton back ~120ms so a fast
//     response paints straight to content instead of strobing through a
//     placeholder. Same trick the search modal has used since day one.
//
// The shimmer itself is the `.skel` class in styles.css (reduced-motion aware).

import { useEffect, useState } from "react";
import { cn } from "#/lib/utils";

/** True only once `active` has held for `delayMs`. Resets instantly on false. */
export function useDelayedFlag(active: boolean, delayMs = 120): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!active) {
      setOn(false);
      return;
    }
    const t = setTimeout(() => setOn(true), delayMs);
    return () => clearTimeout(t);
  }, [active, delayMs]);
  return on;
}

type SkeletonProps = React.ComponentProps<"div"> & {
  /** Any CSS width — number is treated as px. Defaults to full width. */
  w?: number | string;
  /** Any CSS height — number is treated as px. */
  h?: number | string;
  /** Circle instead of the default 4px radius. */
  round?: boolean;
};

export function Skeleton({
  className,
  style,
  w,
  h,
  round,
  ...props
}: SkeletonProps) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("skel", round && "rounded-full", className)}
      style={{
        width: typeof w === "number" ? `${w}px` : w,
        height: typeof h === "number" ? `${h}px` : (h ?? 12),
        ...style,
      }}
      {...props}
    />
  );
}

/**
 * A paragraph-shaped run of lines. Widths taper so it reads as prose rather
 * than a stack of identical bars; `seed` shifts the pattern so two blocks on
 * screen at once don't look copy-pasted.
 */
export function SkeletonText({
  lines = 3,
  seed = 0,
  lineHeight = 12,
  gap = 10,
  className,
}: {
  lines?: number;
  seed?: number;
  lineHeight?: number;
  gap?: number;
  className?: string;
}) {
  const widths = ["100%", "92%", "97%", "78%", "88%", "63%"];
  // Key on the line's own offset rather than the map index — same value, but
  // it survives the lint rule and stays stable if the widths list changes.
  const offsets = Array.from({ length: lines }, (_, i) => seed * 100 + i);
  return (
    <div className={cn("flex flex-col", className)} style={{ gap }}>
      {offsets.map((offset, i) => (
        <Skeleton
          key={`skel-line-${offset}`}
          h={lineHeight}
          w={widths[(i + seed) % widths.length]}
        />
      ))}
    </div>
  );
}
