import type { LifecycleStage } from "./lifecycle";

export type PulseCardGame = {
  id: number;
  name: string;
  creatorName: string;
  creatorVerified: boolean;
  genre: string | null;
  thumbnail: string | null;
  ccu: number;
  ccu24hAgo: number | null;
  velocity: number;
  spike: number;
  trendScore: number;
  lifecycle: LifecycleStage;
  reason: string;
  spark: number[];
  currentSort: string | null;
  currentSortRank: number | null;
  createdAtMs: number | null;
  trackingDays: number;
  velocityPctInCohort: number | null;
  cohortBasis: "full" | "no_age" | "scale_only" | null;
  cohortSize: number;
  velocityChange24hPct: number | null;
  delta24hPct: number | null;
};

export type Signal = {
  label: string;
  text: string;
};

export type HeroStats = {
  trackedCcu: number;
  movers: number;
  new48h: number;
};

export type LifecycleDistribution = Record<LifecycleStage, number>;

export type LifecycleTransitions = {
  toNew: number;
  toGrowing: number;
  toPeaking: number;
  toDeclining: number;
};

export type SignalInputs = {
  firstTime10kToday: number;
  moversPeakHourMode: number | null;
  noNewIn48h: boolean;
};

export type RailPayload = {
  signal: Signal | null;
  distribution: LifecycleDistribution;
  transitions6h: LifecycleTransitions;
};

export type FeedPayload = {
  games: PulseCardGame[];
  hero: HeroStats;
  kicker: string;
  liveSince: number;
  rail: RailPayload;
  degradedMode: boolean;
  jobHealth: Record<string, import("../system-health").JobHealthRecord>;
};
