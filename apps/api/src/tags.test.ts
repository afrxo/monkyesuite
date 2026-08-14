// Integration coverage for tags.ts (specs/03-tagging.md, docs/api-contract.md
// "Tagging writes"). Unlike admin.test.ts's pure-logic coverage, these routes
// ARE the DB write — there's no meaningful way to test "apply a tag" without a
// real `tags`/`game_tags` insert. So this suite talks to a real Postgres via
// APP_DATABASE_URL/DATABASE_URL (same connection apps/api uses) and skips
// itself, rather than failing the whole run, when neither is set — consistent
// with this repo's existing convention that DB-dependent behaviour is verified
// against a real database, not mocked (see admin.test.ts's header comment).
//
// The route handlers are exercised through a real Hono app + real HTTP-shaped
// request/response, with only session resolution stubbed (a fixed userId) —
// Better Auth sign-in itself is out of scope for this suite.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_URL = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;

describe.skipIf(!DB_URL)("tag routes (Postgres integration)", () => {
  const userId = "test-user-tags";
  // Sentinel id, far outside any real Roblox universeId range in this dataset.
  const universeId = 999999990001;
  const unknownUniverseId = 999999990002;
  const axis = "mechanic";
  const slug = `vitest-${Date.now()}`;

  // biome-ignore lint: dynamically typed test fixtures, imported after env setup
  let app: any;
  // biome-ignore lint: dynamically typed test fixtures
  let db: any;
  // biome-ignore lint: dynamically typed test fixtures
  let schema: any;
  // biome-ignore lint: dynamically typed test fixtures
  let eq: any;
  let createdTagId: string;

  beforeAll(async () => {
    const { Hono } = await import("hono");
    ({ db } = await import("./db.js"));
    schema = await import("@monkyesuite/database");
    ({ eq } = await import("drizzle-orm"));
    const { tagRoutes } = await import("./tags.js");
    const { sendError, toHttpError } = await import("./errors.js");

    await db
      .insert(schema.games)
      .values({ universeId, name: "vitest tag-route fixture game" })
      .onConflictDoNothing();

    app = new Hono();
    app.use("*", async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
      c.set("userId", userId);
      await next();
    });
    app.route("/", tagRoutes());
    app.onError((err: unknown, c: Parameters<typeof sendError>[0]) =>
      sendError(c, toHttpError(err)),
    );
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.gameTags).where(eq(schema.gameTags.universeId, universeId));
    await db.delete(schema.games).where(eq(schema.games.universeId, universeId));
    if (createdTagId) {
      await db.delete(schema.tags).where(eq(schema.tags.id, createdTagId));
    }
  });

  it("rejects a bad axis with 422 — the canonical free-text rejection", async () => {
    const res = await app.request("/tags", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ axis: "not-a-real-axis", slug, label: "Bad" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
  });

  it("creates a new vocabulary term", async () => {
    const res = await app.request("/tags", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        axis,
        slug,
        label: "Vitest Fixture Tag",
        description: "Created by tags.test.ts",
      }),
    });
    expect(res.status).toBe(201);
    const tag = await res.json();
    expect(tag.axis).toBe(axis);
    expect(tag.slug).toBe(slug);
    createdTagId = tag.id;
  });

  it("404s applying a tag to an unknown universeId", async () => {
    const res = await app.request(`/games/${unknownUniverseId}/tags`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tagId: createdTagId }),
    });
    expect(res.status).toBe(404);
  });

  it("applies the tag to a game, recording addedBy/addedAt", async () => {
    const res = await app.request(`/games/${universeId}/tags`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tagId: createdTagId }),
    });
    expect(res.status).toBe(201);
    const tag = await res.json();
    expect(tag.id).toBe(createdTagId);

    const [row] = await db
      .select()
      .from(schema.gameTags)
      .where(eq(schema.gameTags.tagId, createdTagId));
    expect(row.universeId).toBe(universeId);
    expect(row.addedBy).toBe(userId);
    expect(row.addedAt).toBeInstanceOf(Date);
  });

  it("rejects a duplicate apply with 409", async () => {
    const res = await app.request(`/games/${universeId}/tags`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tagId: createdTagId }),
    });
    expect(res.status).toBe(409);
  });

  it("deletes the application", async () => {
    const res = await app.request(`/games/${universeId}/tags/${createdTagId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);

    const rows = await db
      .select()
      .from(schema.gameTags)
      .where(eq(schema.gameTags.tagId, createdTagId));
    expect(rows).toHaveLength(0);
  });

  it("404s deleting an application that no longer exists", async () => {
    const res = await app.request(`/games/${universeId}/tags/${createdTagId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });
});
