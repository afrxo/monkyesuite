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
  IntelPayload,
  FeedItem,
  GameDetail,
  GameEvent,
  GameMetric,
  GameStat,
  LifecycleEvent,
  Monetization,
  Paged,
  PulsePayload,
  PulseSearchResult,
  SortSnapshot,
  Tag,
} from "@monkyesuite/shared";
import {
  discoverSurfaceSchema,
  feedQuerySchema,
  metricsQuerySchema,
  PULSE_FILTERS,
  PULSE_SORTS,
  tagsQuerySchema,
  timeseriesQuerySchema,
  universeIdSchema,
} from "@monkyesuite/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { z } from "zod";
import { adminRoutes } from "./admin/index.js";
import { auth } from "./auth.js";
import { boardRoutes } from "./board.js";
import { cardRoutes } from "./cards.js";
import { toAuthEmail, toDisplayUsername } from "./identity.js";
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
  getPulse,
  getPulseSearch,
  getSorts,
  getStatsHistory,
  getTags,
} from "./data.js";
import { getDiscover } from "./discover.js";
import { getIntel } from "./intel.js";
import {
  HttpError,
  notFound,
  sendError,
  toHttpError,
  validationError,
} from "./errors.js";
import { financeRoutes } from "./finances.js";
import { gameNoteRoutes } from "./gamenotes.js";
import { type AppEnv, requireUser, resolveSession } from "./middleware.js";
import { scopedRoutes } from "./scoped.js";
import { projectTagRoutes } from "./projectTags.js";
import { tagRoutes } from "./tags.js";
import { workspaceRoutes } from "./workspace.js";

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
// Pulse: 30s in-process memo mirrors the s-maxage sent to CDN, so a Railway
// instance still absorbs bursty request-path hits between edge revalidations.
const pulseCache = new TtlCache<PulsePayload>(30_000);
// Search: 15s memo keeps user typing latency low without loading the DB. Keyed
// by lowercased query.
const searchCache = new TtlCache<PulseSearchResult[]>(15_000);
// Intel: the batch service runs every ~30min, so 60s is effectively free
// staleness — one indexed read per instance per minute at worst.
const intelCache = new TtlCache<IntelPayload>(60_000);

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
  // credentials:true so the browser sends the Better Auth session cookie.
  // Scoped to /v1 deliberately: /admin is same-origin only and carries NO CORS
  // allowance at all (specs/09 §9.0) — apps/web never calls it, and no browser
  // origin may (the operator opens it directly on the API host).
  app.use("/v1/*", cors({ origin: origins, credentials: true }));

  // Closed suite (specs/06 §6.1): public sign-up is disabled at the HTTP
  // route, not merely hidden in the web UI. This must be registered BEFORE
  // the /v1/auth/* wildcard below so it wins the match. The admin panel still
  // creates accounts — it calls auth.api.signUpEmail(...) directly, in
  // process, which never touches this route at all.
  app.on(["GET", "POST"], "/v1/auth/sign-up/email", (c) =>
    sendError(c, notFound("Sign-up is disabled.")),
  );

  // Better Auth owns the rest of /v1/auth/* (sign-in, session, sign-out).
  // Its own body schema hardcodes z.email() with no config escape hatch, but
  // `users.email` is really a username slot here (specs/06 §6.1 closed
  // suite). So the boundary does the translation: append the synthetic
  // suffix on the way in for sign-in, strip it back off any `user.email` in
  // the JSON response — apps/web and its users never see or type an "@".
  app.on(["GET", "POST"], "/v1/auth/*", async (c) => {
    let req = c.req.raw;
    if (c.req.path === "/v1/auth/sign-in/email" && c.req.method === "POST") {
      const body = (await c.req.json().catch(() => null)) as
        | { email?: unknown }
        | null;
      if (body && typeof body.email === "string") {
        req = new Request(c.req.raw.url, {
          method: "POST",
          headers: c.req.raw.headers,
          body: JSON.stringify({ ...body, email: toAuthEmail(body.email) }),
        });
      }
    }
    const res = await auth.handler(req);
    if (
      c.req.path === "/v1/auth/sign-in/email" ||
      c.req.path === "/v1/auth/get-session"
    ) {
      const data = (await res.clone().json().catch(() => null)) as {
        user?: { email?: unknown };
      } | null;
      if (data?.user && typeof data.user.email === "string") {
        data.user.email = toDisplayUsername(data.user.email);
        return new Response(JSON.stringify(data), {
          status: res.status,
          headers: res.headers,
        });
      }
    }
    return res;
  });

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

  const v1 = new Hono<AppEnv>();
  // Closed suite (specs/06 §6.6): every /v1 route requires a session at
  // minimum, including the reads that used to be public (feed, discovery,
  // game detail, tags, game-notes). requireUser is the chokepoint — it throws
  // 401 for both no session and a disabled one (resolveSession already
  // collapses the latter into the former).
  v1.use("*", resolveSession);
  v1.use("*", async (c, next) => {
    requireUser(c);
    await next();
  });

  /* ------------------------------- feed --------------------------------- */
  v1.get("/feed", async (c) => {
    const q = parse(feedQuerySchema, c.req.query());
    const key = JSON.stringify(q);
    return c.json(await feedCache.get(key, () => getFeed(q)));
  });

  /* ------------------------------- pulse -------------------------------- */
  // Reads exclusively from the denormalized game_stats_latest + cohort_stats +
  // feed_health tables (worker precomputes; specs/02). Two indexed reads per
  // hit; expected server time <50ms even cold. Edge/CDN caches on
  // Cache-Control: s-maxage=30, stale-while-revalidate=120 — the derive tick
  // is the actual freshness resolution.
  v1.get("/pulse", async (c) => {
    const filterRaw = c.req.query("filter") ?? "all";
    const sortRaw = c.req.query("sort") ?? "spike";
    const filter = (PULSE_FILTERS as readonly string[]).includes(filterRaw)
      ? (filterRaw as (typeof PULSE_FILTERS)[number])
      : "all";
    const sort = (PULSE_SORTS as readonly string[]).includes(sortRaw)
      ? (sortRaw as (typeof PULSE_SORTS)[number])
      : "spike";
    const payload = await pulseCache.get(`${filter}:${sort}`, () =>
      getPulse(filter, sort),
    );
    c.header(
      "Cache-Control",
      "public, s-maxage=30, stale-while-revalidate=120",
    );
    return c.json(payload);
  });

  /* ------------------------------ search -------------------------------- */
  // Game/creator name substring lookup for the pulse Cmd-K modal. Auth-gated
  // (specs/06 §6.6); returns [] for queries shorter than 2 chars.
  v1.get("/search", async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    if (q.length < 2) return c.json([] as PulseSearchResult[]);
    const results = await searchCache.get(q.toLowerCase(), () =>
      getPulseSearch(q),
    );
    c.header("Cache-Control", "public, s-maxage=15, stale-while-revalidate=60");
    return c.json(results);
  });

  /* ------------------------------ intel ---------------------------------- */
  // Latest intel run (specs/10-intel.md), grouped by kind. Freshness is the
  // apps/intel cron cadence, not this cache — see intelCache above.
  v1.get("/intel", async (c) => {
    const payload = await intelCache.get("intel", () => getIntel());
    c.header(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300",
    );
    return c.json(payload);
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
  // Every caller is authenticated now (specs/06 §6.6), so this always returns
  // shared + the caller's own-private notes (RLS via app.current_user_id) with
  // isOwn flipped correctly. Never cached — the response is per-user.
  v1.get("/games/:universeId/notes", async (c) => {
    const id = parseUniverseId(c.req.param("universeId"));
    await assertGame(id);
    const userId = requireUser(c);
    return c.json(await getGameNotes(id, userId));
  });

  app.route("/v1", v1);
  // Scoped realm (auth required). Each router resolves membership/authorship
  // through the shared helper before touching data (07-api.md §7.1).
  //   scopedRoutes    — projects, membership
  //   boardRoutes     — board, tasks, milestones
  //   workspaceRoutes — docs, notes, pinned games
  //   gameNoteRoutes  — game-note authoring (global-realm, author-gated)
  //   tagRoutes       — tag vocabulary + application (global-realm, authenticated)
  const scoped = new Hono<AppEnv>();
  scoped.use("*", resolveSession);
  scoped.route("/", scopedRoutes());
  scoped.route("/", boardRoutes());
  scoped.route("/", cardRoutes());
  scoped.route("/", workspaceRoutes());
  scoped.route("/", gameNoteRoutes());
  scoped.route("/", tagRoutes());
  scoped.route("/", projectTagRoutes());
  scoped.route("/", financeRoutes());
  app.route("/v1", scoped);
  // Operator surface (specs/09). Outside /v1 and outside the JSON contract:
  // server-rendered HTML behind the admin-only gate, with its own error
  // handling so nothing here ever answers in the /v1 envelope.
  app.route("/admin", adminRoutes());
  return app;
}
