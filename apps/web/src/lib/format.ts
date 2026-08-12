// Presentation helpers. Kept dumb: no data fetching, no side effects.

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const full = new Intl.NumberFormat("en");

export function fmtCompact(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return compact.format(n);
}

export function fmtFull(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return full.format(n);
}

export function fmtPct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtSigned(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const s = compact.format(Math.abs(n));
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : "0";
}

// Relative freshness, e.g. "3m ago" — the honesty label on every proxy number.
export function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}
