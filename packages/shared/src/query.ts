// Zod validators for global-read query params. The API parses request input
// through these at the boundary (07-api.md §7.4); malformed queries → 422.

import { z } from "zod";
import {
  DISCOVER_SURFACES,
  FEED_SORTS,
  LIFECYCLE_STAGES,
  MEMBER_ROLES,
  PROJECT_STATUSES,
  TAG_AXES,
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

export const createInviteSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(MEMBER_ROLES).default("member"),
});
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

// uuid path param for scoped item routes.
export const uuidSchema = z.string().uuid();
