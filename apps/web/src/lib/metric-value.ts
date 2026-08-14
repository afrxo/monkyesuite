export type MetricState = "ok" | "stale" | "pending" | "unavailable";

export type MetricValue<T> =
  | { state: "ok"; value: T; computedAt: number }
  | { state: "stale"; value: T; computedAt: number; ageMinutes: number }
  | { state: "pending"; reason: "cold-start" | "job-lag" }
  | { state: "unavailable"; reason: "job-failed" | "insufficient-data" };

export const ok = <T>(value: T, computedAt = Date.now()): MetricValue<T> => ({
  state: "ok",
  value,
  computedAt,
});

export const stale = <T>(
  value: T,
  computedAt: number,
  ageMinutes: number,
): MetricValue<T> => ({ state: "stale", value, computedAt, ageMinutes });

export const pending = (
  reason: "cold-start" | "job-lag",
): MetricValue<never> => ({ state: "pending", reason });

export const unavailable = (
  reason: "job-failed" | "insufficient-data",
): MetricValue<never> => ({ state: "unavailable", reason });
