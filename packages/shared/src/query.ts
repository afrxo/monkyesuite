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

// Assignee membership is a full replacement — the client sends the desired
// user-id set, the server diffs it against the current set (add/remove).
const assigneeIds = z.array(z.string()).max(20);

export const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(20000).optional(),
  status: z.enum(TASK_STATUSES).optional(), // defaults to backlog server-side
  priority: z.enum(TASK_PRIORITIES).default("none"),
  milestoneId: z.string().uuid().nullable().optional(),
  assigneeIds: assigneeIds.optional(),
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
    assigneeIds: assigneeIds.optional(),
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
  assigneeIds: assigneeIds.optional(),
  priority: z.enum(TASK_PRIORITIES).default("none"),
});
export type CreateSubtaskInput = z.input<typeof createSubtaskSchema>;

/* --------------------------- project tag writes --------------------------- */
// Per-project card labels — separate table + separate schemas from the global
// `tags` axis vocabulary (createTagSchema above), which describes games.

const projectTagName = z.string().trim().min(1).max(40);
const projectTagColor = z
  .string()
  .regex(/^[a-z0-9-]{1,20}$/, "invalid color key")
  .nullable()
  .optional();

export const createProjectTagSchema = z.object({
  name: projectTagName,
  color: projectTagColor,
});
export type CreateProjectTagInput = z.infer<typeof createProjectTagSchema>;

export const patchProjectTagSchema = z
  .object({
    name: projectTagName.optional(),
    color: projectTagColor,
  })
  .refine((v) => Object.keys(v).length > 0, "no fields to update");
export type PatchProjectTagInput = z.infer<typeof patchProjectTagSchema>;

// Applying a tag to a card: existing project_tags row only. No free text.
export const applyTaskTagSchema = z.object({ tagId: uuidSchema });
export type ApplyTaskTagInput = z.infer<typeof applyTaskTagSchema>;

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
    // Move + reorder: folderId=null → move to root; prevId/nextId name
    // neighbours in the destination folder; the server computes the orderKey.
    folderId: z.string().uuid().nullable().optional(),
    prevId: z.string().uuid().nullable().optional(),
    nextId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "no fields to update");
export type PatchDocInput = z.infer<typeof patchDocSchema>;

/* ------------------------------ doc folders ------------------------------- */

export const createDocFolderSchema = z.object({
  name: z.string().min(1).max(120),
});
export type CreateDocFolderInput = z.infer<typeof createDocFolderSchema>;

export const patchDocFolderSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    prevId: z.string().uuid().nullable().optional(),
    nextId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "no fields to update");
export type PatchDocFolderInput = z.infer<typeof patchDocFolderSchema>;

/* ---------------------------------- blocks -------------------------------- */

// Inline runs — the leaves of a text-bearing block's content. `link` is a bare
// URL string; anchor text lives in `text` (matches BlockNote's inline model).
const inlineRunSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  code: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  link: z.string().url().optional(),
});
const textContentSchema = z.object({
  runs: z.array(inlineRunSchema).max(500),
});

// Per-type props. Heading level clamped to 1..3; check items carry `checked`.
// Everything else props-empty for Phase 1.
const emptyProps = z.object({}).strict();
const headingProps = z.object({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]) }).strict();
const checkProps = z.object({ checked: z.boolean() }).strict();

// Non-text block content shapes. Code stores raw text; image / divider have
// no textual content and lean on props for state.
const codeContent = z.object({ text: z.string().max(100_000) }).strict();
const emptyContent = z.object({}).strict();
const codeProps = z
  .object({
    language: z.string().max(40).optional(),
    // BlockNote's defaults include layout props; accept them opaquely.
  })
  .catchall(z.unknown());
const imageProps = z
  .object({
    url: z.string().url().or(z.literal("")),
    caption: z.string().max(400).optional(),
    name: z.string().max(240).optional(),
    previewWidth: z.number().nonnegative().optional(),
  })
  .catchall(z.unknown());

// Validated block-input schema (used by upsert). Discriminated on `type` so
// wrong-shape blocks are rejected before touching the DB.
export const blockInputSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    position: z.string().min(1).max(1024),
    version: z.number().int().nonnegative(),
    type: z.literal("paragraph"),
    content: textContentSchema,
    props: emptyProps,
  }),
  z.object({
    id: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    position: z.string().min(1).max(1024),
    version: z.number().int().nonnegative(),
    type: z.literal("heading"),
    content: textContentSchema,
    props: headingProps,
  }),
  z.object({
    id: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    position: z.string().min(1).max(1024),
    version: z.number().int().nonnegative(),
    type: z.literal("bulletListItem"),
    content: textContentSchema,
    props: emptyProps,
  }),
  z.object({
    id: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    position: z.string().min(1).max(1024),
    version: z.number().int().nonnegative(),
    type: z.literal("numberedListItem"),
    content: textContentSchema,
    props: emptyProps,
  }),
  z.object({
    id: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    position: z.string().min(1).max(1024),
    version: z.number().int().nonnegative(),
    type: z.literal("checkListItem"),
    content: textContentSchema,
    props: checkProps,
  }),
  z.object({
    id: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    position: z.string().min(1).max(1024),
    version: z.number().int().nonnegative(),
    type: z.literal("quote"),
    content: textContentSchema,
    props: emptyProps,
  }),
  z.object({
    id: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    position: z.string().min(1).max(1024),
    version: z.number().int().nonnegative(),
    type: z.literal("codeBlock"),
    content: codeContent,
    props: codeProps,
  }),
  z.object({
    id: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    position: z.string().min(1).max(1024),
    version: z.number().int().nonnegative(),
    type: z.literal("divider"),
    content: emptyContent,
    props: emptyProps,
  }),
  z.object({
    id: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    position: z.string().min(1).max(1024),
    version: z.number().int().nonnegative(),
    type: z.literal("image"),
    content: emptyContent,
    props: imageProps,
  }),
]);
export type BlockInput = z.infer<typeof blockInputSchema>;

// Bulk upsert payload. Bounded at 1000 blocks per request — a doc that big
// signals a UI problem, not a real user's writing.
export const upsertBlocksSchema = z.object({
  blocks: z.array(blockInputSchema).max(1000),
});
export type UpsertBlocksInput = z.infer<typeof upsertBlocksSchema>;

export const deleteBlocksSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
});
export type DeleteBlocksInput = z.infer<typeof deleteBlocksSchema>;

// Doc metadata patch — icon + cover. Title lives in patchDocSchema above.
export const patchDocMetaSchema = z
  .object({
    icon: z.string().max(16).nullable().optional(),
    coverUrl: z.string().url().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "no fields to update");
export type PatchDocMetaInput = z.infer<typeof patchDocMetaSchema>;

/* --------------------------- project-note writes -------------------------- */

// A short pin needs at least a title or a body — not an empty row. Anchor
// fields are all-or-nothing: passing any of docId/blockId/anchorStart/anchorEnd
// implies an anchored note; the API enforces consistency (see workspace.ts).
export const createNoteSchema = z
  .object({
    title: z.string().max(200).optional(),
    body: z.string().max(5000).optional(),
    universeId: universeLink.optional(),
    docId: z.string().uuid().optional(),
    blockId: z.string().uuid().optional(),
    anchorStart: z.number().int().nonnegative().optional(),
    anchorEnd: z.number().int().nonnegative().optional(),
    anchorQuote: z.string().max(500).optional(),
  })
  .refine((v) => Boolean(v.title?.trim() || v.body?.trim()), "note is empty");
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export const patchNoteSchema = z
  .object({
    title: z.string().max(200).nullable().optional(),
    body: z.string().max(5000).nullable().optional(),
    universeId: universeLink.optional(),
    resolved: z.boolean().optional(),
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
