// Response DTOs for the global read surface, derived from docs/api-contract.md
// (which is itself derived from schema.ts). Shared verbatim by apps/api (the
// producer) and apps/web (the consumer) so the HTTP seam is typed on both ends.
//
// Convention: every object carrying a scraped/derived number also carries the
// timestamp it was captured/computed at (capturedAt | computedAt) so the web
// layer can label it an estimate. See docs/api-contract.md "Freshness".

import type {
  CohortBasis,
  DemandKind,
  LifecycleEventType,
  LifecycleStage,
  MemberRole,
  MilestoneStatus,
  NoteVisibility,
  ProjectStatus,
  PulseStage,
  TagAxis,
  TaskPriority,
  TaskStatus,
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

/* ----------------------------- scoped realm ------------------------------- */

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: ProjectStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetail extends Project {
  membership: { role: MemberRole };
  counts: { members: number; openTasks: number };
}

export interface Membership {
  id: string;
  projectId: string;
  userId: string;
  role: MemberRole;
  createdAt: string;
  user: { id: string; name: string | null; email: string };
}

// No Invite type — adding a collaborator is a direct membership write against
// an existing account (docs/api-contract.md review flag 4). See Membership
// above for the shape POST /projects/:id/members returns.

/* ------------------------------- board ------------------------------------ */

export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  status: MilestoneStatus;
  orderKey: string;
  targetDate: string | null;
  createdBy: string | null;
  createdAt: string;
}

// A minimal reference to a linked tracker game, for rendering a card's chip.
export interface TaskGameRef {
  universeId: number;
  name: string;
  iconUrl: string | null;
}

// Per-project card label (distinct from the global `Tag` above, which describes
// games with a controlled 5-axis vocabulary). Free-form, renameable.
export interface ProjectTag {
  id: string;
  projectId: string;
  name: string;
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  milestoneId: string | null;
  parentTaskId: string | null;
  title: string;
  body: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  orderKey: string;
  // Cards can carry any number of members (specs/05). The legacy single-column
  // assigneeId/assignee shape was replaced by this list in migration 0010.
  assignees: { id: string; name: string | null; email: string }[];
  universeId: number | null;
  game: TaskGameRef | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  dueAt: string | null;
  coverUrl: string | null;
  tags: ProjectTag[];
  // One level of subtasks only (specs/05 §5.1). Present on top-level cards.
  subtasks: Task[];
}

// One board column: its status plus the ordered cards in it.
export interface BoardLane {
  status: TaskStatus;
  tasks: Task[];
}

// The full board fetch (07-api.md §7.2): lanes in canonical order, plus the
// project's milestones so the UI can group/filter without a second round-trip.
export interface Board {
  projectId: string;
  lanes: BoardLane[];
  milestones: Milestone[];
}

/* ---------------------------- card detail modal --------------------------- */

export interface TaskComment {
  id: string;
  taskId: string;
  authorId: string;
  author: { id: string; name: string | null; email: string } | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskChecklistItem {
  id: string;
  taskId: string;
  text: string;
  done: boolean;
  orderKey: string;
  createdAt: string;
}

export interface TaskAttachment {
  id: string;
  taskId: string;
  uploadedBy: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  // Grid thumbnail URL when the backend has one (images/video); null otherwise.
  thumbnailUrl: string | null;
  createdAt: string;
}

export type TaskActivityKind =
  | "create"
  | "status_change"
  | "title_change"
  | "assignee_change"
  | "comment"
  | "attachment"
  | "checklist_add"
  | "checklist_complete";

export interface TaskActivityEvent {
  id: string;
  taskId: string;
  actorId: string;
  actor: { id: string; name: string | null; email: string } | null;
  kind: TaskActivityKind;
  payload: Record<string, unknown>;
  createdAt: string;
}

// One backlink note whose body mentions this card's short ID (e.g. "SG-010").
export interface LinkedNote {
  id: string;
  title: string | null;
  body: string | null;
  createdAt: string;
  updatedAt: string;
}

// Bundled fetch when the card modal opens — one round-trip.
export interface TaskDetail {
  task: Task;
  comments: TaskComment[];
  checklistItems: TaskChecklistItem[];
  attachments: TaskAttachment[];
  activity: TaskActivityEvent[];
  linkedNotes: LinkedNote[];
}

// Response from the presigned-upload endpoint.
export interface AttachmentUploadTicket {
  attachmentId: string;
  uploadUrl: string;
  r2Key: string;
  expiresInSeconds: number;
}

// Response for a per-attachment view/download URL.
export interface AttachmentViewTicket {
  url: string;
  expiresInSeconds: number;
}

/* --------------------------- docs & project notes ------------------------- */

export interface Doc {
  id: string;
  projectId: string;
  folderId: string | null;
  orderKey: string;
  title: string;
  body: string | null;
  migratedToBlocks: boolean;
  icon: string | null;
  coverUrl: string | null;
  deletedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------- blocks --------------------------------- */

// Inline runs inside a text-bearing block. `link` collapses to plain if empty.
export interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strikethrough?: boolean;
  link?: string;
}

export interface TextBlockContent {
  runs: InlineRun[];
}

export type BlockType =
  | "paragraph"
  | "heading"
  | "bulletListItem"
  | "numberedListItem"
  | "checkListItem"
  | "quote"
  | "codeBlock"
  | "divider"
  | "image"
  | "callout"
  | "refEmbed";

// The DB envelope. `content` and `props` shapes vary by type; text-bearing
// blocks store `{ runs }`, code stores `{ text }`, image/divider carry only
// props. The API validates the shape per type before persisting.
export interface Block {
  id: string;
  docId: string;
  parentId: string | null;
  position: string;
  type: BlockType;
  content: TextBlockContent | Record<string, unknown>;
  props: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// Server response for GET /docs/:id/blocks — the doc envelope + its blocks in
// order. Client rebuilds the tree via parent_id + position.
export interface DocBlocks {
  doc: Doc;
  blocks: Block[];
}

export interface DocFolder {
  id: string;
  projectId: string;
  name: string;
  orderKey: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectNote {
  id: string;
  projectId: string;
  title: string | null;
  body: string | null;
  universeId: number | null;
  game: TaskGameRef | null;
  // Anchoring. All null → project-level pin. `docId` alone → doc-level.
  // `blockId + anchorStart + anchorEnd` → inline anchored comment.
  docId: string | null;
  blockId: string | null;
  anchorStart: number | null;
  anchorEnd: number | null;
  anchorQuote: string | null;
  resolved: boolean;
  createdBy: string;
  author: { id: string; name: string | null; email: string } | null;
  createdAt: string;
  updatedAt: string;
}

/* --------------------------- pinned tracker games ------------------------- */

export interface ProjectGame {
  projectId: string;
  universeId: number;
  name: string;
  iconUrl: string | null;
  note: string | null;
  addedBy: string | null;
  addedAt: string;
}

/* --------------------------------- pulse ---------------------------------- */

// One card on the pulse feed. Mirrors the shape the presentational stack in
// apps/web consumes; every derived field is precomputed by the worker into
// game_stats_latest, so a card is one row read.
export interface PulseCardGame {
  id: number; // universeId
  name: string;
  creatorName: string;
  creatorVerified: boolean;
  genre: string | null;
  thumbnail: string | null;
  ccu: number;
  ccu24hAgo: number | null;
  velocity: number;
  spike: number | null; // multiplicative ratio (current / baseline_avg)
  trendScore: number | null;
  lifecycle: PulseStage | null;
  reason: string; // annotation kicker; "" when nothing notable
  spark: number[]; // last-24h hourly CCU points; [] when insufficient data
  currentSort: string | null;
  currentSortRank: number | null;
  createdAtMs: number | null; // Roblox-side createdAt (js ms)
  trackingDays: number; // days since firstSeenAt on our side
  velocityPctInCohort: number | null;
  cohortBasis: CohortBasis | null;
  cohortSize: number;
  velocityChange24hPct: number | null;
  delta24hPct: number | null;
}

export interface PulseHero {
  trackedCcu: number;
  movers: number;
  new48h: number;
}

export interface PulseDistribution {
  new: number;
  growing: number;
  peaking: number;
  declining: number;
}

export interface PulseTransitions {
  toNew: number;
  toGrowing: number;
  toPeaking: number;
  toDeclining: number;
}

// The rail-side aggregate block (distribution + transitions + editorial signal
// string). Signal is currently derived server-side; kept nullable so pulse can
// render without it during warm-up.
export interface PulseRail {
  signal: string | null;
  distribution: PulseDistribution;
  transitions6h: PulseTransitions;
}

export interface PulsePayload {
  games: PulseCardGame[];
  hero: PulseHero;
  liveSince: number; // ms since epoch (feed_health.live_since)
  rail: PulseRail;
  degradedMode: boolean;
}

export interface PulseSearchResult {
  id: number;
  name: string;
  creatorName: string;
  genre: string | null;
  thumbnail: string | null;
  ccu: number;
  lifecycle: PulseStage | null;
}
