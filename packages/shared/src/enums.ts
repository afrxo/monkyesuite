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

export const PROJECT_STATUSES = [
  "active",
  "paused",
  "shipped",
  "archived",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

// Board columns — canonical left-to-right order (mirrors task_status in schema).
export const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "done",
  "archived",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const MILESTONE_STATUSES = ["planned", "active", "done"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

// Feed sort + discovery surfaces (API contract, not schema enums).
export const FEED_SORTS = [
  "spike",
  "trend",
  "ccu",
  "velocity",
  "newest",
] as const;
export type FeedSort = (typeof FEED_SORTS)[number];

// Pulse-page 4-stage lifecycle taxonomy (mirrors pulse_stage in schema).
// Distinct from LIFECYCLE_STAGES above — pulse rolls the 7-stage analytical
// classification into a compact feed-facing model. Order is display order.
export const PULSE_STAGES = ["new", "growing", "peaking", "declining"] as const;
export type PulseStage = (typeof PULSE_STAGES)[number];

export const PULSE_FILTERS = [
  "all",
  "new",
  "growing",
  "peaking",
  "declining",
] as const;
export type PulseFilter = (typeof PULSE_FILTERS)[number];

// Same set as FEED_SORTS today — kept as a distinct union so pulse's sort
// surface can diverge (e.g. "spike" gains a compound ranking on pulse only)
// without silently changing /feed contract.
export const PULSE_SORTS = [
  "spike",
  "trend",
  "ccu",
  "velocity",
  "newest",
] as const;
export type PulseSort = (typeof PULSE_SORTS)[number];

export const COHORT_BASES = ["genre", "global"] as const;
export type CohortBasis = (typeof COHORT_BASES)[number];

export const DISCOVER_SURFACES = [
  "trend-drift",
  "acceleration",
  "spotlight",
  "whitespace",
  "patterns",
] as const;
export type DiscoverSurface = (typeof DISCOVER_SURFACES)[number];
