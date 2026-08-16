// Zod validators for global-read query params. The API parses request input
// through these at the boundary (07-api.md §7.4); malformed queries → 422.

import { z } from "zod";
import {
  DISCOVER_SURFACES,
  FEED_SORTS,
  LIFECYCLE_STAGES,
  MEMBER_ROLES,
  MILESTONE_STATUSES,
  NOTE_VISIBILITIES,
  PROJECT_STATUSES,
  TAG_AXES,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "./enums.js";

// Coerce ?page/?pageSize (strings on the wire) into bounded ints.
const pageParam = z.coerce.number().int().min(1).default(1);
const pageSizeParam = (def: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(def);

export const feedQuerySchema = z.object({
  page: pageParam,
  pageSize: pageSizeParam(24, 24),
  lifecycle: z.enum(LIFECYCLE_STAGES).optional(),
  sort: z.enum(FEED_SORTS).default("trend"),
  genre: z.string().min(1).max(100).optional(),
});
export type FeedQuery = z.infer<typeof feedQuerySchema>;

export const discoverSurfaceSchema = z.enum(DISCOVER_SURFACES);

export const timeseriesQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: pageParam,
  pageSize: pageSizeParam(200, 1000),
});
export type TimeseriesQuery = z.infer<typeof timeseriesQuerySchema>;

export const metricsQuerySchema = timeseriesQuerySchema.extend({
  interval: z.enum(["raw", "hour", "day"]).default("raw"),
});
export type MetricsQuery = z.infer<typeof metricsQuerySchema>;

export const tagsQuerySchema = z.object({
  axis: z.enum(TAG_AXES).optional(),
});

// universeId path param: bigint-as-number, must be a positive integer.
export const universeIdSchema = z.coerce.number().int().positive();

/* ------------------------- scoped input validators ------------------------ */

const slug = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be kebab-case");

export const createProjectSchema = z.object({
  name: z.string().min(1).max(120),
  slug,
  description: z.string().max(2000).optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const patchProjectSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).nullable().optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "no fields to update");
export type PatchProjectInput = z.infer<typeof patchProjectSchema>;

// Add an EXISTING user to a project by email (no invite/token flow — the
// closed suite has no one left to onboard-by-email, docs/api-contract.md
// review flag 4).
export const addMemberSchema = z.object({
  email: z.string().trim().min(1).max(320),
  role: z.enum(MEMBER_ROLES).default("member"),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

// uuid path param for scoped item routes.
export const uuidSchema = z.string().uuid();

/* ------------------------------ tagging writes ----------------------------- */
// 03-tagging.md §3.2: adding vocabulary is a separate, deliberate act from
// applying it. `axis` restricted to the five-axis enum is the canonical
// free-text rejection — anything else is 422, not a UI-only guard.

export const createTagSchema = z.object({
  axis: z.enum(TAG_AXES),
  slug,
  label: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
});
export type CreateTagInput = z.infer<typeof createTagSchema>;

// Applying a tag is dropdown-only from existing vocabulary — a tagId, never
// free text (03-tagging.md §3.2).
export const applyTagSchema = z.object({ tagId: uuidSchema });
export type ApplyTagInput = z.infer<typeof applyTagSchema>;

/* ------------------------------ board writes ------------------------------ */

// Positive-integer universeId link, or explicit null to clear it.
const universeLink = z.number().int().positive().nullable();

export const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(20000).optional(),
  status: z.enum(TASK_STATUSES).optional(), // defaults to backlog server-side
  priority: z.enum(TASK_PRIORITIES).default("none"),
  milestoneId: z.string().uuid().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  universeId: universeLink.optional(),
  dueAt: z.string().datetime().nullable().optional(),
});
export type CreateTaskInput = z.input<typeof createTaskSchema>;

export const patchTaskSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    body: z.string().max(20000).nullable().optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    milestoneId: z.string().uuid().nullable().optional(),
    assigneeId: z.string().nullable().optional(),
    universeId: universeLink.optional(),
    dueAt: z.string().datetime().nullable().optional(),
    coverAttachmentId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "no fields to update");
export type PatchTaskInput = z.infer<typeof patchTaskSchema>;

// Ordering is computed server-side from the neighbours the client names, so the
// board never trusts a client-sent orderKey (07-api.md §7.2). prevId/nextId are
// the cards this one lands between; both null = the lane is empty.
const neighbours = z.object({
  prevId: z.string().uuid().nullable().optional(),
  nextId: z.string().uuid().nullable().optional(),
});

// Cross-lane move: names the destination status + the neighbours in that lane.
export const moveTaskSchema = neighbours.extend({
  status: z.enum(TASK_STATUSES),
});
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;

// Within-lane reorder: neighbours only.
export const reorderTaskSchema = neighbours;
export type ReorderTaskInput = z.infer<typeof reorderTaskSchema>;

export const createSubtaskSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(20000).optional(),
  assigneeId: z.string().nullable().optional(),
  priority: z.enum(TASK_PRIORITIES).default("none"),
});
export type CreateSubtaskInput = z.input<typeof createSubtaskSchema>;

/* ---------------------------- milestone writes ---------------------------- */

export const createMilestoneSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  status: z.enum(MILESTONE_STATUSES).default("planned"),
  targetDate: z.string().datetime().nullable().optional(),
});
export type CreateMilestoneInput = z.input<typeof createMilestoneSchema>;

export const patchMilestoneSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).nullable().optional(),
    status: z.enum(MILESTONE_STATUSES).optional(),
    targetDate: z.string().datetime().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "no fields to update");
export type PatchMilestoneInput = z.infer<typeof patchMilestoneSchema>;

/* ------------------------------- doc writes ------------------------------- */

export const createDocSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(100000).optional(),
});
export type CreateDocInput = z.infer<typeof createDocSchema>;

export const patchDocSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    body: z.string().max(100000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "no fields to update");
export type PatchDocInput = z.infer<typeof patchDocSchema>;

/* --------------------------- project-note writes -------------------------- */

// A short pin needs at least a title or a body — not an empty row.
export const createNoteSchema = z
  .object({
    title: z.string().max(200).optional(),
    body: z.string().max(5000).optional(),
    universeId: universeLink.optional(),
  })
  .refine((v) => Boolean(v.title?.trim() || v.body?.trim()), "note is empty");
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export const patchNoteSchema = z
  .object({
    title: z.string().max(200).nullable().optional(),
    body: z.string().max(5000).nullable().optional(),
    universeId: universeLink.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "no fields to update");
export type PatchNoteInput = z.infer<typeof patchNoteSchema>;

/* -------------------------- pinned tracker games -------------------------- */

export const createProjectGameSchema = z.object({
  universeId: z.number().int().positive(),
  note: z.string().max(500).optional(),
});
export type CreateProjectGameInput = z.infer<typeof createProjectGameSchema>;

/* ------------------------------ game notes -------------------------------- */

export const createGameNoteSchema = z.object({
  body: z.string().min(1).max(5000),
  visibility: z.enum(NOTE_VISIBILITIES).default("shared"),
});
export type CreateGameNoteInput = z.input<typeof createGameNoteSchema>;

export const patchGameNoteSchema = z
  .object({
    body: z.string().min(1).max(5000).optional(),
    visibility: z.enum(NOTE_VISIBILITIES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "no fields to update");
export type PatchGameNoteInput = z.infer<typeof patchGameNoteSchema>;

/* --------------------------- card detail writes --------------------------- */

export const createCommentSchema = z.object({
  body: z.string().min(1).max(10000),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const patchCommentSchema = z.object({
  body: z.string().min(1).max(10000),
});
export type PatchCommentInput = z.infer<typeof patchCommentSchema>;

export const createChecklistItemSchema = z.object({
  text: z.string().min(1).max(500),
  prevId: z.string().uuid().nullable().optional(),
  nextId: z.string().uuid().nullable().optional(),
});
export type CreateChecklistItemInput = z.infer<typeof createChecklistItemSchema>;

export const patchChecklistItemSchema = z
  .object({
    text: z.string().min(1).max(500).optional(),
    done: z.boolean().optional(),
    prevId: z.string().uuid().nullable().optional(),
    nextId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "no fields to update");
export type PatchChecklistItemInput = z.infer<typeof patchChecklistItemSchema>;

export const attachmentUploadRequestSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().min(0).max(5 * 1024 * 1024 * 1024), // 5 GB hard cap
});
export type AttachmentUploadRequest = z.infer<typeof attachmentUploadRequestSchema>;

export const attachmentConfirmSchema = z.object({
  attachmentId: z.string().uuid(),
});
export type AttachmentConfirmInput = z.infer<typeof attachmentConfirmSchema>;
