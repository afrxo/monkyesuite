import type { LifecycleStage } from "./types";

// Adapter type — the loader synthesizes these from the API's LifecycleEvent[]
// so the verdict math speaks a stage-oriented dialect (matches trend-pulse).
export type LifecycleTransition = {
  kind: "lifecycle_transition";
  stage: LifecycleStage;
  occurredAt: number;
};

export type Verdict = { shape: string; text: string };

const HOUR_MS = 3_600_000;

interface VerdictInput {
  history: number[];
  transitions: LifecycleTransition[]; // newest first
  daysTracked: number;
  trackedHours: number;
  lifecycle: LifecycleStage;
}

function countStage(
  transitions: LifecycleTransition[],
  stage: LifecycleStage,
): number {
  return transitions.filter((e) => e.stage === stage).length;
}

// One editorial sentence — cold-start silent, curated shape set. Never freeform.
export function buildVerdict(input: VerdictInput): Verdict | null {
  const { transitions, daysTracked, trackedHours, lifecycle, history } = input;
  if (trackedHours < 72) return null;

  const peakingCount = countStage(transitions, "peaking");
  const decliningCount = countStage(transitions, "declining");
  const growingCount = countStage(transitions, "growing");
  const lastTransition = transitions[0];

  if (lastTransition && lastTransition.stage === "growing") {
    const ageMs = Date.now() - lastTransition.occurredAt;
    if (
      ageMs >= 48 * HOUR_MS &&
      transitions.some((t) => t.stage === "declining")
    ) {
      return { shape: "recovering", text: "Quiet recovery. Worth watching." };
    }
  }

  if (lifecycle === "declining" && daysTracked >= 7 && growingCount === 0) {
    return {
      shape: "graveyard",
      text: "Long bleed. The recovery never came.",
    };
  }

  if (peakingCount >= 2 && decliningCount >= 2) {
    return {
      shape: "roller-coaster",
      text: "Multi-cycle — each spike followed by partial recovery.",
    };
  }

  if (peakingCount >= 1 && decliningCount >= 1 && history.length >= 4) {
    const launch = history[0] ?? 0;
    const recent = history.slice(-Math.min(8, history.length));
    const recentMean = recent.reduce((s, n) => s + n, 0) / recent.length;
    const peak = Math.max(...history);
    if (recentMean > launch * 1.5 && recentMean < peak * 0.7) {
      return {
        shape: "spike-then-floor",
        text: "Viral spike, then sustained organic floor.",
      };
    }
  }

  if (lifecycle === "growing" && peakingCount === 0 && history.length >= 4) {
    const launch = history[0] ?? 0;
    const recent = history[history.length - 1] ?? 0;
    if (launch > 0 && recent / launch >= 1.5) {
      return {
        shape: "slow-burn",
        text: "Slow burn. The growth never broke.",
      };
    }
  }

  return null;
}

export interface CallLineInput {
  lifecycle: LifecycleStage;
  cohortPct: number | null;
  history: number[];
  daysTracked: number;
}

// One italic editorial sentence for the hero. Cold-start gate: <7d → null.
export function buildCallLine(input: CallLineInput): string | null {
  const { lifecycle, cohortPct, history, daysTracked } = input;
  if (daysTracked < 7) return null;
  if (history.length === 0) return null;

  const current = history[history.length - 1] ?? 0;
  const peak = Math.max(...history);
  const peakDropPct =
    peak > 0 ? Math.round(((peak - current) / peak) * 100) : null;

  if (lifecycle === "declining" && peakDropPct != null && peakDropPct >= 10) {
    return `Past its peak. Down ${peakDropPct}% from its high.`;
  }
  if (lifecycle === "peaking") return "Holding peak. Watching for the turn.";
  if (lifecycle === "growing") {
    if (cohortPct != null && cohortPct >= 75)
      return "Growing fast — top of its cohort.";
    if (cohortPct != null && cohortPct < 50)
      return "Growing — lower half of its genre.";
    return "Growth sustained.";
  }
  if (lifecycle === "declining") return "Cooling off. Watching the floor.";
  return null;
}
