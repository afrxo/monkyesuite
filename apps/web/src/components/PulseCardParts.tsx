export { default as Kicker } from "./shared/Kicker";
export { default as Thumb } from "./shared/Thumb";
export { default as VerifiedBadge } from "./shared/VerifiedBadge";

export function accelerationWord(
  velocityChange24hPct: number | null,
  delta24hPct: number | null,
): string | null {
  if (velocityChange24hPct == null) return null;
  if (delta24hPct != null && Math.abs(delta24hPct) < 0.05) return null;
  if (Math.abs(velocityChange24hPct) < 5) return null;
  const rising = delta24hPct == null || delta24hPct >= 0;
  const gaining = velocityChange24hPct >= 5;
  if (rising && gaining) return "accelerating";
  if (rising && !gaining) return "slowing";
  if (!rising && !gaining) return "falling faster";
  return "recovering";
}

export function liveDotColor(ageMs: number): string {
  if (ageMs < 2 * 60_000) return "#22c55e";
  if (ageMs < 10 * 60_000) return "#eab308";
  return "#a8a29e";
}
