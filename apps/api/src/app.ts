// Hono app — the GLOBAL read surface (auth optional). Scoped/auth'd routes land
// with identity/access (specs/06). Every handler here reads global data, is
// cacheable behind a short TTL, and never requires a session.
//
// Error contract: handlers throw HttpError (or let a DB error bubble); onError
// maps both to the standard envelope, turning DB outages into 503 + Retry-After
// rather than a silent empty result (07-api.md §7.5).

import type {
  DemandOverlay,
  DiscoverItem,
  FeedItem,
  GameDetail,
  GameEvent,
  GameMetric,
  GameNote,
  GameStat,
  LifecycleEvent,
  Monetization,
  Paged,
  SortSnapshot,
  Tag,
} from "@monkyesuite/shared";
import {
  discoverSurfaceSchema,
  feedQuerySchema,
  metricsQuerySchema,
  tagsQuerySchema,
  timeseriesQuerySchema,
  universeIdSchema,
} from "@monkyesuite/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { z } from "zod";
import { TTL, TtlCache } from "./cache.js";
import {
  gameExists,
  getDemand,
  getEvents,
  getFeed,
  getGameDetail,
  getGameNotes,
  getGameTags,
  getLifecycleEvents,
  getMetrics,
  getMonetization,
  getSorts,
  getStatsHistory,
  getTags,
} from "./data.js";
import { getDiscover } from "./discover.js";
import {
  HttpError,
  notFound,
  sendError,
  toHttpError,
  validationError,
} from "./errors.js";

// Parse a Zod schema, converting failures into the 422 validation envelope.
function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const first = r.error.issues[0];
    const path = first?.path.join(".");
    throw validationError(
      `${path ? `${path}: ` : ""}${first?.message ?? "Invalid input."}`,
    );
  }
  return r.data;
}

const parseUniverseId = (raw: string): number => parse(universeIdSchema, raw);

// Per-resource caches (typed; see cache.ts).
const feedCache = new TtlCache<Paged<FeedItem>>(TTL.feed);
const discoverCache = new TtlCache<DiscoverItem[]>(TTL.discover);
const detailCache = new TtlCache<GameDetail | null>(TTL.gameDetail);
const metricsCache = new TtlCache<Paged<GameMetric>>(TTL.timeseries);
const statsCache = new TtlCache<Paged<GameStat>>(TTL.timeseries);
const lifecycleCache = new TtlCache<LifecycleEvent[]>(TTL.timeseries);
const sortsCache = new TtlCache<SortSnapshot[]>(TTL.timeseries);
const eventsCache = new TtlCache<GameEvent[]>(TTL.timeseries);
const monetizationCache = new TtlCache<Monetization>(TTL.timeseries);
const demandCache = new TtlCache<DemandOverlay>(TTL.timeseries);
const gameTagsCache = new TtlCache<Tag[]>(TTL.tags);
const tagsCache = new TtlCache<Tag[]>(TTL.tags);
const notesCache = new TtlCache<GameNote[]>(TTL.notes);

// Resolve a game or throw 404 — used before returning sub-resources so an
// unknown universeId is a clean 404, not an empty list masquerading as data.
async function assertGame(universeId: number): Promise<void> {
  if (!(await gameExists(universeId))) throw notFound("Unknown game.");
}

export function createApp() {
  const app = new Hono();

  const origins = (process.env.WEB_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim());
  app.use("*", cors({ origin: origins }));

  app.onError((err, c) => {
    const http = toHttpError(err);
    // Log server-side faults (5xx) for diagnosis; client errors stay quiet.
    if (http.code === "service_unavailable") console.error("[api] error:", err);
    return sendError(c, http);
  });
  app.notFound((c) =>
    sendError(c, new HttpError("not_found", "No such route.")),
  );

  app.get("/health", (c) => c.json({ ok: true }));

  const v1 = new Hono();

  /* ------------------------------- feed --------------------------------- */
  v1.get("/feed", async (c) => {
    const q = parse(feedQuerySchema, c.req.query());
    const key = JSON.stringify(q);
    return c.json(await feedCache.get(key, () => getFeed(q)));
  });

  /* --------------------------- discovery -------------------------------- */
  v1.get("/discover/:surface", async (c) => {
    const surface = parse(discoverSurfaceSchema, c.req.param("surface"));
    return c.json(await discoverCache.get(surface, () => getDiscover(surface)));
  });

  /* --------------------------- game detail ------------------------------ */
  v1.get("/games/:universeId", async (c) => {
    const id = parseUniverseId(c.req.param("universeId"));
    const detail = await detailCache.get(String(id), () => getGameDetail(id));
    if (!detail) throw notFound("Unknown game.");
    return c.json(detail);
  });

  v1.get("/games/:universeId/metrics", async (c) => {
    const id = parseUniverseId(c.req.param("universeId"));
    const q = parse(metricsQuerySchema, c.req.query());
    await assertGame(id);
    const key = `${id}:${JSON.stringify(q)}`;
    return c.json(await metricsCache.get(key, () => getMetrics(id, q)));
  });

  v1.get("/games/:universeId/stats", async (c) => {
    const id = parseUniverseId(c.req.param("universeId"));
    const q = parse(timeseriesQuerySchema, c.req.query());
    await assertGame(id);
    const key = `${id}:${JSON.stringify(q)}`;
    return c.json(await statsCache.get(key, () => getStatsHistory(id, q)));
  });

  v1.get("/games/:universeId/lifecycle", async (c) => {
    const id = parseUniverseId(c.req.param("universeId"));
    await assertGame(id);
    return c.json(
      await lifecycleCache.get(String(id), () => getLifecycleEvents(id)),
    );
  });

  v1.get("/games/:universeId/sorts", async (c) => {
    const id = parseUniverseId(c.req.param("universeId"));
    await assertGame(id);
    return c.json(await sortsCache.get(String(id), () => getSorts(id)));
  });

  v1.get("/games/:universeId/events", async (c) => {
    const id = parseUniverseId(c.req.param("universeId"));
    await assertGame(id);
    return c.json(await eventsCache.get(String(id), () => getEvents(id)));
  });

  v1.get("/games/:universeId/monetization", async (c) => {
    const id = parseUniverseId(c.req.param("universeId"));
    await assertGame(id);
    return c.json(
      await monetizationCache.get(String(id), () => getMonetization(id)),
    );
  });

  v1.get("/games/:universeId/demand", async (c) => {
    const id = parseUniverseId(c.req.param("universeId"));
    await assertGame(id);
    return c.json(await demandCache.get(String(id), () => getDemand(id)));
  });

  v1.get("/games/:universeId/tags", async (c) => {
    const id = parseUniverseId(c.req.param("universeId"));
    await assertGame(id);
    return c.json(await gameTagsCache.get(String(id), () => getGameTags(id)));
  });

  /* ------------------------------ tags ---------------------------------- */
  v1.get("/tags", async (c) => {
    const { axis } = parse(tagsQuerySchema, c.req.query());
    return c.json(await tagsCache.get(axis ?? "all", () => getTags(axis)));
  });

  /* --------------------------- game notes ------------------------------- */
  v1.get("/games/:universeId/notes", async (c) => {
    const id = parseUniverseId(c.req.param("universeId"));
    await assertGame(id);
    return c.json(await notesCache.get(String(id), () => getGameNotes(id)));
  });

  app.route("/v1", v1);
  return app;
}
