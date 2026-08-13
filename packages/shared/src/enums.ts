// Enum literal unions + value arrays, mirroring packages/database/src/schema.ts.
// Kept here (not imported from @monkyesuite/database) so the web app can depend
// on the API contract types without pulling in Drizzle/pg.

export const LIFECYCLE_STAGES = [
  "launching",
  "growing",
  "stable",
  "cooling",
  "declining",
  "dormant",
  "revived",
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const LIFECYCLE_EVENT_TYPES = [
  "launch",
  "spike",
  "cooldown",
  "decline",
  "revival",
  "death",
  "sort_appearance",
  "sort_exit",
  "update_shipped",
] as const;
export type LifecycleEventType = (typeof LIFECYCLE_EVENT_TYPES)[number];

export const TAG_AXES = [
  "genre",
  "mechanic",
  "progression",
  "social",
  "monetization",
] as const;
export type TagAxis = (typeof TAG_AXES)[number];

export const NOTE_VISIBILITIES = ["shared", "private"] as const;
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];

export const DEMAND_KINDS = ["game", "theme"] as const;
export type DemandKind = (typeof DEMAND_KINDS)[number];

export const MEMBER_ROLES = ["owner", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const INVITE_STATUSES = [
  "pending",
  "accepted",
  "revoked",
  "expired",
] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export const PROJECT_STATUSES = [
  "active",
  "paused",
  "shipped",
  "archived",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

// Feed sort + discovery surfaces (API contract, not schema enums).
export const FEED_SORTS = [
  "spike",
  "trend",
  "ccu",
  "velocity",
  "newest",
] as const;
export type FeedSort = (typeof FEED_SORTS)[number];

export const DISCOVER_SURFACES = [
  "trend-drift",
  "acceleration",
  "spotlight",
  "whitespace",
  "patterns",
] as const;
export type DiscoverSurface = (typeof DISCOVER_SURFACES)[number];
