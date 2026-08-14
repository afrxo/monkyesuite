import type {
  CohortContext,
  CohortFallbackKind,
  CohortStats,
  CreatorContextData,
  DetailsData,
  EngagementSnapshot,
  EngagementTexture,
  GenreContext,
  MonetizationData,
  OtherGame,
  Peak21d,
  Sentiment,
  SortEvent,
  StudioData,
  Verdict,
} from "./context";
import type { LifecycleEvent, LifecycleStage } from "./lifecycle";

export type GameEvent = {
  id: string;
  title: string;
  subtitle: string | null;
  startUtc: number;
  endUtc: number | null;
  hostName: string | null;
  category: string | null;
  thumbnailMediaId: string | null;
  thumbnailUrl: string | null;
  tagline: string | null;
  status: string;
  ccuLift24hPct: number | null;
};

export type UpdateCadenceData = {
  upcoming: GameEvent[];
  history: GameEvent[];
  prediction: { meanPct: number; stdevPct: number; sampleSize: number } | null;
  cadenceLine: string | null;
};

export type AudienceRhythmData = {
  cells: number[];
  avgCcuByCell: number[];
  pattern:
    | "weekend-evening"
    | "flat"
    | "weekday-after-school"
    | "asia"
    | "mixed";
  peak: { dayIdx: number; bandIdx: number; avgCcu: number };
  trough: { dayIdx: number; bandIdx: number; avgCcu: number };
};

export type MoverCard = {
  id: number;
  name: string;
  thumbnail: string | null;
  ccu: number;
  lifecycle: LifecycleStage;
  spark: number[];
};

export type CohortBundle = {
  cohort: CohortContext | null;
  cohortFallback: CohortFallbackKind;
};

export type CreatorBundle = {
  creatorOtherGames: OtherGame[];
  creator: CreatorContextData | null;
};

export type MonetizationStudioBundle = {
  monetization: MonetizationData | null;
  studio: StudioData | null;
};

export type GameDetailStreamPayload = Omit<
  GameDetailPayload,
  | "cohort"
  | "cohortFallback"
  | "creatorOtherGames"
  | "creator"
  | "monetization"
  | "studio"
  | "audienceRhythm"
  | "whatElseMoving"
> & {
  cohortP: Promise<CohortBundle>;
  creatorP: Promise<CreatorBundle>;
  monetizationStudioP: Promise<MonetizationStudioBundle>;
  audienceRhythmP: Promise<AudienceRhythmData | null>;
  whatElseMovingP: Promise<MoverCard[]>;
};

export type GameDetailPayload = {
  id: number;
  placeId: number;
  name: string;
  creatorName: string;
  creatorVerified: boolean;
  thumbnail: string | null;
  ccu: number;
  ccu_24h_ago: number | null;
  ccu_avg_window: number | null;
  ccu_peak_24h: number | null;
  ccu_peak_window: number | null;
  windowHours: number;
  daysTracked: number;
  trackedHours: number;
  firstSeenMs: number;
  history: number[];
  historyTimestamps: number[];
  delta24hPct: number | null;
  velocityChange24hPct: number | null;
  lastRefreshMs: number | null;
  visits24h: number | null;
  avgCcu24h: number | null;
  sentiment: Sentiment | null;
  currentSorts: string[];
  recentSortAbsence: { sort: string; hoursAgo: number } | null;
  sortEvents: SortEvent[];
  peak21d: Peak21d | null;
  creatorOtherGames: OtherGame[];
  cohort: CohortContext | null;
  creator: CreatorContextData | null;
  genreContext: GenreContext | null;
  lifecycle: import("../metric-value").MetricValue<LifecycleStage>;
  reason: import("../metric-value").MetricValue<string>;
  spike: import("../metric-value").MetricValue<number>;
  lifecycleHistory: import("../metric-value").MetricValue<LifecycleEvent[]>;
  lifecycleTransitionCount: import("../metric-value").MetricValue<number>;
  growthFromInitialPct: import("../metric-value").MetricValue<number | null>;
  cohortStats: import("../metric-value").MetricValue<CohortStats>;
  engagementSnapshot: import("../metric-value").MetricValue<EngagementSnapshot>;
  engagement: EngagementTexture | null;
  genreLiftBaselinePct: number | null;
  updateCadence: import("../metric-value").MetricValue<UpdateCadenceData>;
  verdict: import("../metric-value").MetricValue<Verdict>;
  details: DetailsData | null;
  monetization: MonetizationData | null;
  studio: StudioData | null;
  audienceRhythm: AudienceRhythmData | null;
  whatElseMoving: MoverCard[];
  cohortFallback: CohortFallbackKind;
  jobHealth: Record<string, import("../system-health").JobHealthRecord>;
};
