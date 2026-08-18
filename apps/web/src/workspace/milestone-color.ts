// Deterministic per-milestone color. Sidebar dot + board card chip both draw
// from the same slot so a milestone reads as one visual identity across the UI.
// Full class literals so the tailwind JIT keeps them.

export type MilestoneColor = {
  dot: string; // solid dot (sidebar bullet, picker)
  chip: string; // text + wash chip (card milestone tag)
};

const PALETTE: MilestoneColor[] = [
  { dot: "bg-emerald-400", chip: "bg-emerald-400/10 text-emerald-300" },
  { dot: "bg-sky-400", chip: "bg-sky-400/10 text-sky-300" },
  { dot: "bg-amber-400", chip: "bg-amber-400/10 text-amber-300" },
  { dot: "bg-rose-400", chip: "bg-rose-400/10 text-rose-300" },
  { dot: "bg-violet-400", chip: "bg-violet-400/10 text-violet-300" },
  { dot: "bg-cyan-400", chip: "bg-cyan-400/10 text-cyan-300" },
  { dot: "bg-fuchsia-400", chip: "bg-fuchsia-400/10 text-fuchsia-300" },
  { dot: "bg-lime-400", chip: "bg-lime-400/10 text-lime-300" },
];

export function milestoneColor(id: string): MilestoneColor {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const slot = PALETTE[h % PALETTE.length];
  // Non-null: h % len < len, PALETTE has entries.
  if (!slot) throw new Error("palette empty");
  return slot;
}
