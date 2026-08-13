// Response DTOs for the global read surface, derived from docs/api-contract.md
// (which is itself derived from schema.ts). Shared verbatim by apps/api (the
// producer) and apps/web (the consumer) so the HTTP seam is typed on both ends.
//
// Convention: every object carrying a scraped/derived number also carries the
// timestamp it was captured/computed at (capturedAt | computedAt) so the web
// layer can label it an estimate. See docs/api-contract.md "Freshness".

import type {
  DemandKind,
  LifecycleEventType,
  LifecycleStage,
  NoteVisibility,
  TagAxis,
} from "./enums.js";

// jsonb columns — unknown shape at the type layer.
export type Json = unknown;

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface LatestMetric {
  playing: number | null;
  visits: number | null;
  upVotes: number | null;
  downVotes: number | null;
  favoritedCount: number | null;
  capturedAt: string;
}

export interface LatestStats {
  trendScore: number | null;
  velocity: number | null;
  spikeScore: number | null;
  lifecycle: LifecycleStage | null;
  computedAt: string;
}

export interface FeedItem {
  universeId: number;
  name: string;
  iconUrl: string | null;
  robloxGenre: string | null;
  creatorName: string | null;
  currentSort: string | null;
  currentSortRank: number | null;
  latestMetric: LatestMetric | null;
  latestStats: LatestStats | null;
}

export interface Creator {
  creatorId: number | null;
  type: string | null;
  name: string | null;
  hasVerifiedBadge: boolean | null;
  memberCount: number | null;
}

export interface GameStat {
  computedAt: string;
  trendScore: number | null;
  velocity: number | null;
  spikeScore: number | null;
  lifecycle: LifecycleStage | null;
  ccuSlope7d: number | null;
  ccuSlope28d: number | null;
  ccuMean24h: number | null;
  troughPeakRatio: number | null;
  likeRatio: number | null;
  favoritesPerVisit: number | null;
  daysSinceUpdate: number | null;
  updatesPer28d: number | null;
  genrePercentile: number | null;
}

export interface GameDetail {
  universeId: number;
  rootPlaceId: number | null;
  name: string;
  description: string | null;
  robloxGenre: string | null;
  creator: Creator | null;
  createdAt: string | null;
  updatedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  isTracked: boolean;
  currentSort: string | null;
  currentSortRank: number | null;
  iconUrl: string | null;
  maxPlayers: number | null;
  playableDevices: Json | null;
  supportedLanguages: Json | null;
  ageRecommendation: string | null;
  descriptors: Json | null;
  latestStats: GameStat | null;
}

export interface GameMetric {
  capturedAt: string;
  playing: number | null;
  visits: number | null;
  favoritedCount: number | null;
  upVotes: number | null;
  downVotes: number | null;
  activeEvent: boolean | null;
}

export interface LifecycleEvent {
  id: string;
  type: LifecycleEventType;
  detectedAt: string;
  magnitude: number | null;
  meta: Json | null;
}

export interface SortSnapshot {
  sortName: string;
  rank: number;
  capturedAt: string;
}

export interface GameEvent {
  eventId: string;
  title: string | null;
  subtitle: string | null;
  tagline: string | null;
  startUtc: string | null;
  endUtc: string | null;
  hostId: number | null;
  hostName: string | null;
  categories: Json | null;
  thumbnailUrl: string | null;
  status: string | null;
  createdUtc: string | null;
  updatedUtc: string | null;
}

export interface GamePass {
  passId: number;
  name: string | null;
  priceRobux: number | null;
  refreshedAt: string;
}

export interface DevProduct {
  productId: number;
  name: string | null;
  priceRobux: number | null;
  refreshedAt: string;
}

export interface Monetization {
  passes: GamePass[];
  products: DevProduct[];
}

export interface DemandSnapshot {
  capturedAt: string;
  ytVideoCount7d: number | null;
  ytViewDelta7d: number | null;
  trendsScore: number | null;
}

export interface DemandTerm {
  term: string;
  kind: DemandKind;
  genreLabel: string | null;
  snapshots: DemandSnapshot[];
  // The payoff flag (specs/04 §4.3): external YouTube velocity is positive while
  // the matched on-platform CCU is flat or negative — "heating, not yet
  // reflected." null when no valid match exists (unmapped term → surface for
  // curation) or the latest snapshot lacks a YouTube view delta.
  heating: boolean | null;
  // The on-platform CCU slope the flag was compared against: the matched game's
  // 7-day slope (game-term) or the genre-aggregate slope (theme-term). null when
  // no match exists. Included so the surface can label the flag honestly.
  matchedCcuSlope: number | null;
}

export interface DemandOverlay {
  terms: DemandTerm[];
}

export interface Tag {
  id: string;
  axis: TagAxis;
  slug: string;
  label: string;
  description: string | null;
}

export interface GameNote {
  id: string;
  universeId: number;
  authorId: string;
  authorName: string | null;
  body: string;
  visibility: NoteVisibility;
  isOwn: boolean;
  createdAt: string;
  updatedAt: string;
}

// Discovery surfaces — superset item; per-surface payloads extend this. Every
// flagged trend carries carrierCount + ccuGrowth so the confirmation rule is
// visible (specs/02, 08-web §8.2).
export interface DiscoverItem {
  carrierCount: number;
  ccuGrowth: number;
  computedAt: string;
  [key: string]: Json;
}

// Standard error envelope (docs/api-contract.md "Error envelope").
export interface ApiError {
  error: { code: string; message: string; retryAfter?: number };
}
