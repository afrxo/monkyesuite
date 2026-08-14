import type { PulseCardGame } from "./types";

export type SpikeTier = "calm" | "whisper" | "speak" | "shout";

export function spikeTier(spike: number, ccu: number): SpikeTier {
  if (ccu < 5_000) return spike >= 3.0 && ccu >= 1_000 ? "whisper" : "calm";
  if (spike >= 3.0) return "shout";
  if (spike >= 2.5) return "speak";
  if (spike >= 2.0) return "whisper";
  return "calm";
}

export function sparkColorFor(tier: SpikeTier, isUp = true): string {
  if (tier === "shout") return "var(--spike-shout)";
  if (tier === "speak") return "var(--spike-speak)";
  return isUp ? "var(--text-3)" : "var(--text-5)";
}

export function parseSpark(raw: string): number[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is number => typeof n === "number");
  } catch {
    return [];
  }
}

export function computePeakHourMode(games: PulseCardGame[]): number | null {
  const top = games.slice(0, 5);
  if (top.length < 3) return null;
  const now = Date.now();
  const buckets = new Map<number, number>();
  for (const g of top) {
    if (g.spark.length === 0) continue;
    let peakIdx = 0;
    for (let i = 1; i < g.spark.length; i++) {
      if ((g.spark[i] ?? -Infinity) > (g.spark[peakIdx] ?? -Infinity))
        peakIdx = i;
    }
    const minutesAgo = (g.spark.length - 1 - peakIdx) * 30;
    const peakMs = now - minutesAgo * 60_000;
    const utcHour = new Date(peakMs).getUTCHours();
    const bucketStart = Math.floor(utcHour / 2) * 2;
    buckets.set(bucketStart, (buckets.get(bucketStart) ?? 0) + 1);
  }
  for (const [hour, n] of buckets) {
    if (n / top.length >= 0.6) return hour;
  }
  return null;
}
