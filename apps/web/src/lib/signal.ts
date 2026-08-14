import type {
  LifecycleDistribution,
  PulseCardGame,
  Signal,
  SignalInputs,
} from "./types";

const SIGNAL_LABEL = "TODAY'S SIGNAL";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

type DetectorContext = {
  games: PulseCardGame[];
  inputs: SignalInputs;
  distribution: LifecycleDistribution;
};

type Detector = (ctx: DetectorContext) => Signal | null;

const sig = (text: string): Signal => ({ label: SIGNAL_LABEL, text });

// Disabled: the loader currently feeds firstTime10kToday from `new_high_24h`
// events with eventCcu >= 10K, which fires every time an established game beats
// its prior 24h peak — not "first time crossing 10K ever." Re-enable once the
// loader query is rebuilt to require prior_peak_7d < 10K AND latest_ccu >= 10K.
const firstTime10K: Detector = () => null;

const genreDominance: Detector = ({ games }) => {
  const top = games.slice(0, 10);
  if (top.length === 0) return null;
  // Require real diversity in the top set — otherwise we're rendering a poisoned/empty
  // genre column as if it were editorial. Stay silent until ≥2 distinct non-null genres
  // are tagged across ≥60% of the top.
  const withGenre = top.filter((g) => g.genre);
  const distinct = new Set(withGenre.map((g) => g.genre));
  if (withGenre.length < top.length * 0.6 || distinct.size < 2) return null;
  const counts = new Map<string, number>();
  for (const g of withGenre)
    if (g.genre) counts.set(g.genre, (counts.get(g.genre) ?? 0) + 1);
  for (const [genre, n] of counts) {
    if (n / top.length >= 0.5) {
      return sig(
        `${genre} titles are ${n} of today's top ${top.length} movers.`,
      );
    }
  }
  return null;
};

const peakHourCluster: Detector = ({ inputs, games }) => {
  if (inputs.moversPeakHourMode === null) return null;
  const top = games.slice(0, 5);
  if (top.length < 3) return null;
  const start = inputs.moversPeakHourMode;
  const end = (start + 2) % 24;
  const fmt = (h: number) => `${h.toString().padStart(2, "0")}:00`;
  return sig(
    `Top ${top.length} movers all peaked between ${fmt(start)} and ${fmt(end)} UTC.`,
  );
};

const creatorCluster: Detector = ({ games }) => {
  const top = games.slice(0, 10);
  const counts = new Map<string, number>();
  for (const g of top)
    counts.set(g.creatorName, (counts.get(g.creatorName) ?? 0) + 1);
  for (const [creator, n] of counts) {
    if (n >= 2 && creator !== "Unknown studio") {
      return sig(`${creator} has ${n} games in today's movers.`);
    }
  }
  return null;
};

const recentLaunches: Detector = ({ games }) => {
  const top = games.slice(0, 10);
  const now = Date.now();
  const recent = top.filter(
    (g) => g.createdAtMs !== null && now - g.createdAtMs < SEVEN_DAYS_MS,
  );
  if (recent.length < 2) return null;
  return sig(
    `${recent.length} games launched in the last week are already in today's movers.`,
  );
};

const fieldConsolidating: Detector = ({ inputs, distribution }) => {
  if (!inputs.noNewIn48h) return null;
  if (distribution.peaking < distribution.declining) return null;
  return sig("No new entries in 48h — the field is consolidating.");
};

const DETECTORS: Detector[] = [
  firstTime10K,
  genreDominance,
  peakHourCluster,
  creatorCluster,
  recentLaunches,
  fieldConsolidating,
];

export function generateSignal(ctx: DetectorContext): Signal | null {
  for (const detect of DETECTORS) {
    const hit = detect(ctx);
    if (hit) return hit;
  }
  return null;
}
