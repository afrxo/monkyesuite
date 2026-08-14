import type { LifecycleStage } from "./lifecycle";

export type CohortGame = {
  id: number;
  name: string;
  thumbnail: string | null;
  ccu: number;
  lifecycle: LifecycleStage;
  spark: number[];
  isSelf: boolean;
};

export type CohortContext = {
  genre: string;
  games: CohortGame[];
  totalCount: number;
  rank: number | null;
  widened: boolean;
};

export type EngagementSnapshot = {
  peak24hCcu: number | null;
  peak24hAt: number | null;
  volatility24hPct: number | null;
  visitsPerCcu: number | null;
  visitsLifetime: number | null;
  sortPresence7d: Record<string, number>;
};

export type Sentiment = {
  upVotes: number;
  downVotes: number;
  upVotes24hAgo: number | null;
  downVotes24hAgo: number | null;
};

export type CreatorPortfolioGame = {
  id: number;
  name: string;
  thumbnail: string | null;
  ccu: number;
  lifecycle: LifecycleStage;
  spark: number[];
  isSelf: boolean;
};

export type CreatorContextData = {
  name: string;
  verified: boolean;
  trackedCount: number;
  totalCcu: number;
  portfolioSpark: number[];
  games: CreatorPortfolioGame[];
  pattern: string | null;
};

export type Verdict = {
  shape:
    | "spike-then-floor"
    | "slow-burn"
    | "roller-coaster"
    | "recently-launched"
    | "graveyard"
    | "recovering";
  text: string;
};

export type OtherGame = {
  id: number;
  name: string;
  thumbnail: string | null;
  ccu: number;
  lifecycle: LifecycleStage;
  relation: "creator" | "genre";
};

export type GenreContext = {
  genre: string;
  rank: number;
  avgCcu: number;
  trackedCount: number;
};

export type SortEvent = {
  ts: number;
  sortName: string;
  kind: "entry" | "exit";
  rank: number;
  tier: "headline" | "niche";
};

export type Peak21d = { ccu: number; at: number };

export type CohortStats = {
  velocityPctInCohort: number | null;
  volatilityVsCohortMedian: number | null;
  cohortBasis: "full" | "no_age" | "scale_only" | null;
  cohortSize: number;
};

export type EngagementTexture = {
  visitsPerCcu: number;
  label: string;
};

export type DetailsData = {
  maxPlayers: number | null;
  supportedDevices: string[];
  languages: string[];
  ageGuidance: string | null;
  ageDescriptors: string[];
  peakObserved: { ccu: number; at: number } | null;
  peakWithinTrackedWindow: boolean;
  createdAt: number | null;
  lastUpdatedAt: number | null;
};

export type MonetizationItem = {
  id: number;
  name: string;
  iconAssetId: number | null;
  priceRobux: number | null;
};
export type MonetizationData = {
  gamepasses: MonetizationItem[];
  developerProducts: MonetizationItem[];
  cohortMedianPaidItems: number | null;
};

export type StudioOtherGame = {
  id: number;
  name: string;
  thumbnail: string | null;
  ccu: number | null;
  lifecycle: LifecycleStage | null;
  lifetimeVisits: number | null;
};
export type StudioData = {
  creatorName: string;
  creatorType: "Group" | "User";
  memberCount: number | null;
  isVerified: boolean;
  tenureFromMs: number | null;
  otherGames: StudioOtherGame[];
};

export type CohortFallbackKind = "cohort" | "similar" | "sparse";
