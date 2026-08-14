// Client-safe: pure types and computation only. No db imports.

export type JobHealthRecord = {
  name: string;
  status: "ok" | "failed";
  ranAt: number;
  succeededAt: number | null;
  ageMinutes: number;
  staleness: "fresh" | "stale" | "degraded";
};

export type SystemHealthTone = "fresh" | "partial" | "snapshot-only" | "stale";

export type SystemHealth = {
  label: string;
  ageMinutes: number;
  tone: SystemHealthTone;
};

export function computeSystemHealth(
  jobs: Record<string, JobHealthRecord>,
): SystemHealth {
  const snapshot = jobs.snapshot;
  const derivedKeys = ["derive", "cohort", "events", "acceleration"];
  const derivedStaleness = derivedKeys.map(
    (n) => jobs[n]?.staleness ?? "degraded",
  );
  const allDerivedDegraded = derivedStaleness.every((s) => s === "degraded");
  const anyDerivedDegraded = derivedStaleness.some((s) => s === "degraded");

  if (snapshot?.staleness !== "fresh") {
    return {
      label: "Stale",
      ageMinutes: snapshot?.ageMinutes ?? 999,
      tone: "stale",
    };
  }
  if (allDerivedDegraded) {
    return {
      label: "Snapshot only",
      ageMinutes: snapshot.ageMinutes,
      tone: "snapshot-only",
    };
  }
  if (anyDerivedDegraded) {
    return { label: "Live", ageMinutes: snapshot.ageMinutes, tone: "partial" };
  }
  return { label: "Live", ageMinutes: snapshot.ageMinutes, tone: "fresh" };
}
