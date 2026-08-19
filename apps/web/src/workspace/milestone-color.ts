// Deterministic per-milestone color. Sidebar dot + board card chip + timeline
// track all draw from the same slot so a milestone reads as one visual
// identity across the UI. Full class literals so the tailwind JIT keeps them;
// `hex` is the same tailwind-400 value for surfaces that need raw color math
// (timeline bars mix opacity in inline styles).

export type MilestoneColor = {
  dot: string; // solid dot (sidebar bullet, picker)
  chip: string; // text + wash chip (card milestone tag)
  hex: string; // raw color for alpha-mixed inline styles (timeline)
};

const PALETTE: MilestoneColor[] = [
  {
    dot: "bg-emerald-400",
    chip: "bg-emerald-400/10 text-emerald-300",
    hex: "#34d399",
  },
  { dot: "bg-sky-400", chip: "bg-sky-400/10 text-sky-300", hex: "#38bdf8" },
  {
    dot: "bg-amber-400",
    chip: "bg-amber-400/10 text-amber-300",
    hex: "#fbbf24",
  },
  { dot: "bg-rose-400", chip: "bg-rose-400/10 text-rose-300", hex: "#fb7185" },
  {
    dot: "bg-violet-400",
    chip: "bg-violet-400/10 text-violet-300",
    hex: "#a78bfa",
  },
  { dot: "bg-cyan-400", chip: "bg-cyan-400/10 text-cyan-300", hex: "#22d3ee" },
  {
    dot: "bg-fuchsia-400",
    chip: "bg-fuchsia-400/10 text-fuchsia-300",
    hex: "#e879f9",
  },
  { dot: "bg-lime-400", chip: "bg-lime-400/10 text-lime-300", hex: "#a3e635" },
];

// Neutral identity for the "No milestone" group (timeline, tray chips).
export const NO_MILESTONE_HEX = "#6b6e76";

export function milestoneColor(id: string): MilestoneColor {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const slot = PALETTE[h % PALETTE.length];
  // Non-null: h % len < len, PALETTE has entries.
  if (!slot) throw new Error("palette empty");
  return slot;
}

/** hex + alpha → rgba() string, for the timeline's status fill ladder. */
export function hexAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
