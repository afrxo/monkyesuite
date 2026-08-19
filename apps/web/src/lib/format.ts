export function fmtRank(i: number): string {
  return i < 9 ? `0${i + 1}` : String(i + 1);
}

export function fmtCCU(n: number, opts: { compact?: boolean } = {}): string {
  if (opts.compact) {
    if (n >= 1_000_000)
      return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
    return String(n);
  }
  return n.toLocaleString("en-US");
}

export function fmtVelocity(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (abs >= 1000)
    return `${sign + (abs / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return sign + abs;
}

const DELTA_FLAT_THRESHOLD = 0.01;

export function fmtTrendPct(t: number): string {
  if (Math.abs(t) < DELTA_FLAT_THRESHOLD) return "—";
  const pct = Math.round(t * 100);
  if (pct > 0) return `+${pct}%`;
  if (pct < 0) return `−${Math.abs(pct)}%`;
  return "—";
}

export function deltaColorVar(value: number | null | undefined): string {
  if (value == null || Math.abs(value) < DELTA_FLAT_THRESHOLD)
    return "var(--delta-flat)";
  return value > 0 ? "var(--delta-up)" : "var(--delta-down)";
}

export function fmtRelative(thenMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - thenMs);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function fmtVisitsLifetime(n: number): string {
  if (n >= 1_000_000_000)
    return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

export function fmtMonthYear(ms: number): string {
  const d = new Date(ms);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

export function fmtCCUCompact(n: number): string {
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

export function fmtFirstSeen(ms: number): string {
  const d = new Date(ms);
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(d);
}

export function fmtNextRefresh(liveSinceMs: number, nowMs: number): string {
  const REFRESH_INTERVAL_MS = 30 * 60_000;
  const minsLeft = Math.ceil(
    (liveSinceMs + REFRESH_INTERVAL_MS - nowMs) / 60_000,
  );
  if (minsLeft <= 0) return "next refresh due";
  return `next refresh in ${minsLeft} minute${minsLeft === 1 ? "" : "s"}`;
}

export function fmtKicker(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} · ${get("month")} ${get("day")} · ${get("hour")}:${get("minute")} UTC`;
}

export function relAgo(now: number, t: number): string {
  const ageMs = now - t;
  const days = Math.floor(ageMs / 86_400_000);
  const hours = Math.floor(ageMs / 3_600_000);
  const minutes = Math.floor(ageMs / 60_000);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

/** "over Xm" / "over Xh" / "over Xd" per spec §4.5. NULL → empty string. */
export function fmtWindow(windowMinutes: number | null): string {
  if (windowMinutes === null || windowMinutes <= 0) return "";
  if (windowMinutes < 60) return `over ${windowMinutes}m`;
  if (windowMinutes <= 1440) return `over ${Math.round(windowMinutes / 60)}h`;
  return `over ${Math.round(windowMinutes / 1440)}d`;
}

// fmtTransitionDelta removed: depended on the game-detail lifecycle-curation
// module, which is not part of the pulse port scope.

/* --------------------------- compat shims --------------------------- */
// Old apps/web format helpers. Preserved so pre-existing workspace/detail
// files keep compiling after the pulse port; new code should use the tlw
// helpers above.
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
// Finances (spec §8): signed USD, always with the sign, never parentheses.
export function fmtUsdSigned(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (n > 0) return `+$${abs}`;
  if (n < 0) return `−$${abs}`;
  return `$${abs}`;
}

export function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Never abbreviated in a table — thousands separators, R$ suffix (§8).
export function fmtRobux(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} R$`;
}

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
