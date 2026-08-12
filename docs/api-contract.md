# API Contract

The concrete HTTP surface for the monkyesuite API (`apps/api`). **Contract only — no implementation.** Request/response shapes are derived from `packages/database/src/schema.ts`; endpoint behaviour follows `specs/07-api.md`, the surfaces in `specs/08-web.md`, and the realm/auth rules in `specs/00-overview.md` + `specs/06-identity-access.md`.

The frontend (`apps/web`) talks to this API **only over HTTP** — it never reads Postgres. This document is the boundary both sides build against.

> **Review flags** (decisions made here that deviate from or extend the specs):
> 1. **Auth families are five, not two.** `07-api.md` splits handlers into *global* and *scoped*. That's the middleware split, but "scoped" collapses three distinct checks — *authenticated*, *member*, *owner* — plus the *author*-only check that game-notes and project-notes need. This doc names all five so each route's 401-vs-403 behaviour is unambiguous. See [Auth families](#auth-families).
> 2. **Board move/reorder take named neighbours, not a raw `orderKey`.** `07-api.md §7.2` shows `{ status, orderKey }` as the write, but its closing line says compute `orderKey` server-side from the neighbours the client names. The request body therefore carries `beforeTaskId` / `afterTaskId`; the server computes and writes `orderKey`. See [Board](#board--tasks).
> 3. **Path collision resolved.** `07-api.md §7.3` puts game-note mutations at `PATCH/DELETE /notes/:id`, but the project-scoped `notes` table needs item routes too. Both cannot own `/notes/:id`. Resolution: game-note items → `/game-notes/:id`, project-note items → `/project-notes/:id`. Collection routes are unaffected. Confirm before implementing. Both item routes are **flat** — `/game-notes/:id` and `/project-notes/:id` live at the API root, NOT nested under their `…/notes` collections — so the web track builds item URLs from the note id alone, without a `universeId` or `projectId` in the path.

---

## Conventions

### Base + format
- Base path: `/v1`. All paths below are relative to it.
- Request and response bodies are `application/json; charset=utf-8`.
- All mutations are non-batch (one resource per call) unless stated.

### Encoding of schema types
Derived from the Drizzle column types in `schema.ts`:

| Schema type | JSON encoding | Notes |
|---|---|---|
| `uuid` | `string` (UUID v4) | scoped-row ids, note ids, tag ids, etc. |
| `bigint({ mode: "number" })` | `number` | `universeId`, `creatorId`, `passId`, `productId`, `hostId`, `visits`, `favoritedCount`, `upVotes`, `downVotes`. Schema stores these as JS numbers; all current Roblox values are well under 2^53. If any counter ever exceeds that, revisit as `string`. |
| `integer` | `number` | `playing`, `rank`, `priceRobux`, `attempts`, `maxPlayers`, … |
| `doublePrecision` | `number` | signal fields (`trendScore`, `velocity`, `ccuSlope7d`, …) |
| `text` / enum | `string` | enums serialise as their literal value (see [Enums](#enum-values)) |
| `boolean` | `boolean` | |
| `timestamp({ withTimezone: true })` | `string` (ISO 8601, UTC, `Z`) | e.g. `"2026-08-12T14:05:00Z"` |
| `jsonb` | object / array | `playableDevices`, `supportedLanguages`, `descriptors`, `categories`, `meta` |

`game_metrics.raw` (the untrimmed scrape payload) is **never** exposed by the API.

### Pagination
Page-based. List endpoints accept `?page` (1-based, default `1`) and `?pageSize` (default per endpoint, hard max noted). Envelope:

```json
{ "items": [ /* … */ ], "page": 1, "pageSize": 24, "total": 137 }
```

### Freshness / estimate labelling
Every response object carrying a **scraped or derived** number includes the timestamp it was computed/captured at, so the UI can label it an estimate (`08-web.md`):
- raw metric objects carry `capturedAt`;
- derived signal objects carry `computedAt`.

The API does not send a literal `estimate: true` flag — the presence of `capturedAt`/`computedAt` on proxy data is the contract; the web layer renders the label.

### Error envelope
Non-2xx responses use:

```json
{ "error": { "code": "forbidden", "message": "Not a member of this project.", "retryAfter": 5 } }
```

`retryAfter` (seconds) appears only on `503`.

### Status codes

| Status | `code` | Meaning |
|---|---|---|
| `400` | `bad_request` | malformed JSON, wrong types the schema layer rejects pre-validation |
| `401` | `unauthenticated` | **no / invalid session** on a route that requires one |
| `403` | `forbidden` | **authenticated but not permitted** — not a member, not the owner, or not the author |
| `404` | `not_found` | resource id doesn't exist (or is hidden by RLS — see note) |
| `409` | `conflict` | rule violation: collaborator cap reached, slug taken, subtask-of-subtask |
| `410` | `gone` | accepting an **expired** invite — the invite moves to status `expired` and no membership is created (`06-identity-access.md §6.3`) |
| `422` | `validation_error` | well-formed JSON that fails Zod — includes free-text tag rejection (`07-api.md §7.4`) |
| `503` | `service_unavailable` | **DB unavailable** — returned with `retryAfter`, never a silent empty list (`07-api.md §7.5`) |

**401 vs 403 (the distinction the UI depends on, `07-api.md §7.5` / `08-web.md §8.6`):**
- `401` → the caller isn't signed in. Web redirects to `/sign-in`.
- `403` → the caller is signed in but lacks the required relationship (membership/ownership/authorship). Web shows a directed empty state ("not a member of this project"), never a blank screen.

**404-vs-403 under RLS:** for member-gated *item* routes (`GET /docs/:id`, etc.), a non-member's request resolves zero rows at the database (RLS backstop) and at the API membership check. To avoid leaking existence, these return **`403`** when the caller is authenticated-but-not-a-member and **`404`** only when the id genuinely doesn't exist for a permitted caller. (For an unauthenticated caller: `401`.)

> **Implementation requirement.** To keep `403`-vs-`404` decidable, a scoped item handler must resolve the caller's membership against the **target row's `project_id` first, then fetch the row** — not fetch-then-check. Concretely: look up the row's owning project (a minimal `project_id` read), run the membership check, and only then return the full row. If membership fails it returns `403` regardless of whether the row exists (no existence leak); if membership passes and the row is absent it returns `404`. Fetching the row first would collapse both cases into an indistinguishable empty result under RLS.

<a id="auth-families"></a>
## Auth families

| Family | Requirement | 401? | 403? | Enforcement |
|---|---|---|---|---|
| **global / optional** | none; a session, if present, may enrich the response | never | never | no `app.current_user_id`; reads global tables. `game_notes` read relies on the RLS `visibility='shared' OR author=…` policy, so it works signed-out (shared only) or signed-in (shared + own private). |
| **authenticated** | a valid session (any user) | if absent | never | sets `app.current_user_id`; no membership needed. Used by vocabulary tagging writes, creating your own game note, accepting an invite, creating a project. |
| **member** | authenticated **and** a `memberships` row for the project | if unauth | if not a member | API membership helper + RLS. Board, docs, project notes, project-game, invite listing. |
| **owner** | authenticated **and** `memberships.role = 'owner'` for the project | if unauth | if not owner | mirrors the `projects_update` / `projects_delete` RLS policies. Destructive/config: update/delete project, remove member, create/revoke invite. |
| **author** | authenticated **and** the row's `author_id` = caller | if unauth | if not author | game-note and (implicitly) private project-note item mutations. Mirrors the `game_notes_write` policy. |

Every non-global route opens its request transaction with `SET LOCAL app.current_user_id = '<uuid>'` (`06-identity-access.md §6.4`). A missing setting fails closed.

---

## Global endpoints (auth optional)

Mirror the global table realm. Responses are cacheable (short-TTL in-process cache for hot reads like the feed, `07-api.md §7.5`).

### Feed & discovery

#### `GET /feed` — Pulse feed
Tracked games with their latest derived signals (`08-web.md §8.1`).

Query:
| param | type | default | notes |
|---|---|---|---|
| `page` | number | 1 | |
| `pageSize` | number | 24 | max 24 |
| `lifecycle` | `LifecycleStage` | — | filter by stage |
| `sort` | `"spike" \| "trend" \| "ccu" \| "velocity" \| "newest"` | `"trend"` | |
| `genre` | string | — | `games.robloxGenre` filter |

Response: `Paged<FeedItem>` (see [FeedItem](#feeditem)). Auth: global/optional. Errors: `422` (bad query), `503`.

#### `GET /discover/:surface` — intelligence surfaces
One route per surface named in `08-web.md §8.2`; `:surface` ∈ `trend-drift | acceleration | spotlight | whitespace | patterns`. Each returns signal payloads derived in `specs/02` + `specs/03` (not raw tables), and **every flagged trend carries its carrier count and growth** so the confirmation rule is visible (`08-web.md §8.2`).

Common item fields (superset; per-surface payloads specified in specs 02/03):
```
{ "carrierCount": number,       // # of games moving together (confirmation rule)
  "ccuGrowth": number,          // correlated CCU growth
  "computedAt": string,         // freshness
  /* surface-specific fields */ }
```
Auth: global/optional. Errors: `404` (unknown surface), `503`.

### Game detail

Aggregate root + time-series/sub-resources for `08-web.md §8.3`. All global/optional; errors `404` (unknown `universeId`), `503`.

| Method + path | Returns | Source table(s) |
|---|---|---|
| `GET /games/:universeId` | [`GameDetail`](#gamedetail) — game dimension + creator + latest stats + current sort | `games`, `creators`, latest `game_stats` |
| `GET /games/:universeId/metrics` | `Paged<GameMetric>` — CCU/visits/votes time-series | `game_metrics` |
| `GET /games/:universeId/stats` | `Paged<GameStat>` — derived-signal history | `game_stats` |
| `GET /games/:universeId/lifecycle` | `LifecycleEvent[]` | `lifecycle_events` |
| `GET /games/:universeId/sorts` | `SortSnapshot[]` — sort-rank timeline | `sort_snapshots` |
| `GET /games/:universeId/events` | `GameEvent[]` — virtual events | `game_events` |
| `GET /games/:universeId/monetization` | `{ passes: GamePass[], products: DevProduct[] }` | `game_passes`, `dev_products` |
| `GET /games/:universeId/demand` | `DemandOverlay` — off-platform interest vs CCU | `demand_terms`, `demand_snapshots` |
| `GET /games/:universeId/tags` | `Tag[]` — tags applied to this game | `game_tags` ⋈ `tags` |

`GET /games/:universeId/metrics` and `/stats` query params: `from`, `to` (ISO 8601), `page`, `pageSize` (default 200, max 1000), plus `interval` on `/metrics` (`"raw" | "hour" | "day"`, default `raw`).

### Tag vocabulary (read)

#### `GET /tags`
Controlled vocabulary (`03-tagging.md`). Query `?axis=<TagAxis>` optional. Response: `Tag[]`. Auth: global/optional. Errors: `503`.

### Game notes (read — the shared/private split)

#### `GET /games/:universeId/notes`
Returns **shared** notes from any author **plus the caller's own private** notes. Never returns another user's private note (enforced by the `game_notes_select` RLS policy; the API sets `app.current_user_id` when a session is present, and leaves it unset otherwise so only `visibility='shared'` rows return).

Response: `GameNote[]`, each with `isOwn: boolean` so the compose/edit UI can gate controls. Auth: **global/optional** — signed-out returns shared only; signed-in adds own-private. Errors: `404` (unknown game), `503`.

---

## Scoped endpoints (auth required)

Mirror the project-scoped realm plus author-gated content. Each opens a transaction with `app.current_user_id`. Auth family per route in the tables.

### Projects

| Method + path | Body | Returns | Auth | Errors |
|---|---|---|---|---|
| `GET /projects` | — | `Project[]` (only the caller's memberships resolve) | authenticated | `401`, `503` |
| `POST /projects` | `{ name, slug, description? }` | `Project` (creates the row **and** an `owner` membership for the caller) | authenticated | `401`, `409` (slug taken), `422`, `503` |
| `GET /projects/:id` | — | [`ProjectDetail`](#projectdetail) | member | `401`, `403`, `404`, `503` |
| `PATCH /projects/:id` | `{ name?, description?, status? }` | `Project` | **owner** (mirrors `projects_update`) | `401`, `403`, `422`, `503` |
| `DELETE /projects/:id` | — | `204` | **owner** (mirrors `projects_delete`) | `401`, `403`, `503` |

`status` ∈ `ProjectStatus`. `POST /projects` is the sole "creates its own membership" path (`06-identity-access.md §6.2`).

### Membership & invites

Collaborator cap: **two** collaborators per project (`06-identity-access.md §6.3`) — i.e. owner + up to two members.

| Method + path | Body | Returns | Auth | Errors |
|---|---|---|---|---|
| `GET /projects/:id/members` | — | `Membership[]` | member | `401`, `403`, `503` |
| `DELETE /projects/:id/members/:userId` | — | `204` | owner | `401`, `403`, `404`, `503` |
| `GET /projects/:id/invites` | — | `Invite[]` (token omitted) | member | `401`, `403`, `503` |
| `POST /projects/:id/invites` | `{ email, role? }` | `Invite` (token delivered by email, not in body) | owner | `401`, `403`, `409` (cap reached), `422`, `503` |
| `DELETE /invites/:id` | — | `204` (sets status `revoked`) | owner | `401`, `403`, `404`, `503` |
| `POST /invites/:token/accept` | — | `Membership` | authenticated | `401`, `409` (cap reached / already a member), `410` (expired → status `expired`), `503` |

`role` ∈ `MemberRole`. Expired-invite acceptance returns `410 Gone` (never creates a membership, `06-identity-access.md §6.3`).

<a id="board--tasks"></a>
### Board & tasks

Board operations from `07-api.md §7.2`. **The server computes `orderKey` from the neighbours the client names** (fractional index; a reorder rewrites exactly one row — `CLAUDE.md` core conventions). The client never sends an `orderKey`.

Neighbour semantics (shared by move/reorder/create/milestones): the client sends `beforeTaskId` and/or `afterTaskId` naming the rows the card should land *between* in the target lane. Server rules:
- both given → new key strictly between them;
- only `afterTaskId` → land at lane **start** (before that row);
- only `beforeTaskId` → land at lane **end** (after that row);
- neither → lane **end** (append).

| Method + path | Body | Writes | Returns | Auth | Errors |
|---|---|---|---|---|---|
| `GET /projects/:id/board` | — | — | [`Board`](#board) — lanes grouped by `status`, tasks ordered by `orderKey`, milestone info included | member | `401`, `403`, `503` |
| `POST /projects/:id/tasks` | `{ title, body?, milestoneId?, priority?, assigneeId?, universeId?, dueAt?, status?, beforeTaskId?, afterTaskId? }` | one `tasks` row | `Task` | member | `401`, `403`, `422`, `503` |
| `PATCH /tasks/:id` | `{ title?, body?, priority?, milestoneId?, assigneeId?, universeId?, dueAt? }` (no `status`/`orderKey` here) | fields given | `Task` | member | `401`, `403`, `404`, `422`, `503` |
| `PATCH /tasks/:id/move` | `{ status, beforeTaskId?, afterTaskId? }` | **`status` + `orderKey`** (cross-lane) | `Task` | member | `401`, `403`, `404`, `422`, `503` |
| `PATCH /tasks/:id/reorder` | `{ beforeTaskId?, afterTaskId? }` | **`orderKey` only** (within-lane) | `Task` | member | `401`, `403`, `404`, `422`, `503` |
| `POST /tasks/:id/subtasks` | `{ title, body?, priority?, assigneeId?, dueAt? }` | one `tasks` row with `parentTaskId = :id` | `Task` | member | `401`, `403`, `409` (parent is itself a subtask — one-deep), `422`, `503` |
| `DELETE /tasks/:id` | — | `204` | member | `401`, `403`, `404`, `503` |

`status` ∈ `TaskStatus`, `priority` ∈ `TaskPriority`. `move` and `reorder` are separated precisely so each writes the **minimal** row set (`07-api.md` acceptance): `reorder` never touches `status`. The one-deep rule (`07-api.md §7.2`): `POST /tasks/:id/subtasks` is rejected `409` when `:id` already has a non-null `parentTaskId`.

### Milestones

`orderKey` computed from named neighbours as above (via `beforeMilestoneId` / `afterMilestoneId`).

| Method + path | Body | Returns | Auth | Errors |
|---|---|---|---|---|
| `GET /projects/:id/milestones` | — | `Milestone[]` (ordered by `orderKey`) | member | `401`, `403`, `503` |
| `POST /projects/:id/milestones` | `{ name, description?, targetDate?, beforeMilestoneId?, afterMilestoneId? }` | `Milestone` | member | `401`, `403`, `422`, `503` |
| `PATCH /milestones/:id` | `{ name?, description?, status?, targetDate?, beforeMilestoneId?, afterMilestoneId? }` | `Milestone` | member | `401`, `403`, `404`, `422`, `503` |
| `DELETE /milestones/:id` | — | `204` (tasks' `milestoneId` → null via FK) | member | `401`, `403`, `404`, `503` |

`status` ∈ `MilestoneStatus`.

### Docs

| Method + path | Body | Returns | Auth | Errors |
|---|---|---|---|---|
| `GET /projects/:id/docs` | — | `Doc[]` (bodies may be omitted in list; full on item) | member | `401`, `403`, `503` |
| `POST /projects/:id/docs` | `{ title, body? }` | `Doc` | member | `401`, `403`, `422`, `503` |
| `GET /docs/:id` | — | `Doc` | member | `401`, `403`, `404`, `503` |
| `PATCH /docs/:id` | `{ title?, body? }` | `Doc` | member | `401`, `403`, `404`, `422`, `503` |
| `DELETE /docs/:id` | — | `204` | member | `401`, `403`, `404`, `503` |

### Project notes (short pins)

The project-scoped `notes` table. **Item routes namespaced `/project-notes/:id`** (see review flag 3).

| Method + path | Body | Returns | Auth | Errors |
|---|---|---|---|---|
| `GET /projects/:id/notes` | — | `ProjectNote[]` | member | `401`, `403`, `503` |
| `POST /projects/:id/notes` | `{ title?, body?, universeId? }` | `ProjectNote` | member | `401`, `403`, `422`, `503` |
| `PATCH /project-notes/:id` | `{ title?, body?, universeId? }` | `ProjectNote` | member | `401`, `403`, `404`, `422`, `503` |
| `DELETE /project-notes/:id` | — | `204` | member | `401`, `403`, `404`, `503` |

### Pinned games (`project_game` bridge)

| Method + path | Body | Returns | Auth | Errors |
|---|---|---|---|---|
| `GET /projects/:id/games` | — | `ProjectGame[]` | member | `401`, `403`, `503` |
| `POST /projects/:id/games` | `{ universeId, note? }` | `ProjectGame` | member | `401`, `403`, `404` (unknown game), `409` (already pinned), `422`, `503` |
| `DELETE /projects/:id/games/:universeId` | — | `204` | member | `401`, `403`, `404`, `503` |

### Tagging writes (authenticated; global `game_tags` table)

Auth family is **authenticated**, not member — `game_tags` is global and carries an `addedBy` author, not a project. Free-text is impossible: `tagId` must reference an existing vocabulary row (`03-tagging.md`, `07-api.md §7.4`).

| Method + path | Body | Returns | Auth | Errors |
|---|---|---|---|---|
| `POST /tags` | `{ axis, slug, label, description? }` | `Tag` (creates a vocabulary entry — a deliberate act) | authenticated | `401`, `409` (`(axis, slug)` exists), `422` (bad axis/slug), `503` |
| `POST /games/:universeId/tags` | `{ tagId }` | `Tag` (applies vocab tag to the game) | authenticated | `401`, `404` (unknown game/tag), `409` (already applied), `422`, `503` |
| `DELETE /games/:universeId/tags/:tagId` | — | `204` | authenticated | `401`, `404`, `503` |

`axis` ∈ `TagAxis`; a body whose `axis` isn't one of the five enum values is the canonical `422` free-text rejection.

### Game notes (write — author-gated)

Collection read is [global](#game-notes-read--the-sharedprivate-split). Writes are **author**-gated (mirrors `game_notes_write`). Item routes namespaced `/game-notes/:id` (review flag 3).

| Method + path | Body | Returns | Auth | Errors |
|---|---|---|---|---|
| `POST /games/:universeId/notes` | `{ body, visibility? }` | `GameNote` (`authorId` = caller) | authenticated | `401`, `404` (unknown game), `422`, `503` |
| `PATCH /game-notes/:id` | `{ body?, visibility? }` | `GameNote` | **author** | `401`, `403` (not author), `404`, `422`, `503` |
| `DELETE /game-notes/:id` | — | `204` | **author** | `401`, `403`, `404`, `503` |

`visibility` ∈ `NoteVisibility` (default `"shared"`). A non-author `PATCH`/`DELETE` resolves zero rows under the `game_notes_write` policy → API returns `403`.

---

## Response object shapes

Field lists derived directly from `schema.ts`. Timestamps are ISO 8601 UTC strings; ids per the [encoding table](#encoding-of-schema-types).

<a id="feeditem"></a>
### FeedItem (`GET /feed`)
Game dimension + its latest metric + latest derived signals + current sort. Freshness via `computedAt` / `capturedAt`.
```
{ "universeId": number, "name": string, "iconUrl": string | null,
  "robloxGenre": string | null, "creatorName": string | null,
  "currentSort": string | null, "currentSortRank": number | null,
  "latestMetric": { "playing": number | null, "visits": number | null,
                    "upVotes": number | null, "downVotes": number | null,
                    "favoritedCount": number | null, "capturedAt": string },
  "latestStats":  { "trendScore": number | null, "velocity": number | null,
                    "spikeScore": number | null, "lifecycle": LifecycleStage | null,
                    "computedAt": string } | null }
```

<a id="gamedetail"></a>
### GameDetail (`GET /games/:universeId`)
```
{ "universeId": number, "rootPlaceId": number | null, "name": string,
  "description": string | null, "robloxGenre": string | null,
  "creator": { "creatorId": number | null, "type": string | null,
               "name": string | null, "hasVerifiedBadge": boolean | null,
               "memberCount": number | null } | null,
  "createdAt": string | null, "updatedAt": string | null,
  "firstSeenAt": string, "lastSeenAt": string, "isTracked": boolean,
  "currentSort": string | null, "currentSortRank": number | null,
  "iconUrl": string | null, "maxPlayers": number | null,
  "playableDevices": Json | null, "supportedLanguages": Json | null,
  "ageRecommendation": string | null, "descriptors": Json | null,
  "latestStats": GameStat | null }
```

### GameMetric (`game_metrics`)
```
{ "capturedAt": string, "playing": number | null, "visits": number | null,
  "favoritedCount": number | null, "upVotes": number | null,
  "downVotes": number | null, "activeEvent": boolean | null }
```
(`id`, `hasVerifiedBadge`, and `raw` are internal — omitted.)

### GameStat (`game_stats`)
```
{ "computedAt": string, "trendScore": number | null, "velocity": number | null,
  "spikeScore": number | null, "lifecycle": LifecycleStage | null,
  "ccuSlope7d": number | null, "ccuSlope28d": number | null,
  "ccuMean24h": number | null, "troughPeakRatio": number | null,
  "likeRatio": number | null, "favoritesPerVisit": number | null,
  "daysSinceUpdate": number | null, "updatesPer28d": number | null,
  "genrePercentile": number | null }
```

### LifecycleEvent / SortSnapshot / GameEvent
```
LifecycleEvent { "id": string, "type": LifecycleEventType, "detectedAt": string,
                 "magnitude": number | null, "meta": Json | null }
SortSnapshot   { "sortName": string, "rank": number, "capturedAt": string }
GameEvent      { "eventId": string, "title": string | null, "subtitle": string | null,
                 "tagline": string | null, "startUtc": string | null, "endUtc": string | null,
                 "hostId": number | null, "hostName": string | null,
                 "categories": Json | null, "thumbnailUrl": string | null,
                 "status": string | null, "createdUtc": string | null, "updatedUtc": string | null }
```

### GamePass / DevProduct / DemandOverlay
```
GamePass   { "passId": number, "name": string | null, "priceRobux": number | null, "refreshedAt": string }
DevProduct { "productId": number, "name": string | null, "priceRobux": number | null, "refreshedAt": string }
DemandOverlay {
  "terms": [ { "term": string, "kind": DemandKind, "genreLabel": string | null,
              "snapshots": [ { "capturedAt": string, "ytVideoCount7d": number | null,
                               "ytViewDelta7d": number | null, "trendsScore": number | null } ] } ] }
```

### Tag / GameNote
```
Tag      { "id": string, "axis": TagAxis, "slug": string, "label": string, "description": string | null }
GameNote { "id": string, "universeId": number, "authorId": string, "authorName": string | null,
           "body": string, "visibility": NoteVisibility, "isOwn": boolean,
           "createdAt": string, "updatedAt": string }
```

<a id="projectdetail"></a>
### Project / ProjectDetail / Membership / Invite
```
Project    { "id": string, "name": string, "slug": string, "description": string | null,
             "status": ProjectStatus, "createdBy": string, "createdAt": string, "updatedAt": string }
ProjectDetail = Project & { "membership": { "role": MemberRole }, "counts": { "members": number, "openTasks": number } }
Membership { "id": string, "projectId": string, "userId": string, "role": MemberRole, "createdAt": string,
             "user": { "id": string, "name": string | null, "email": string } }
Invite     { "id": string, "projectId": string, "email": string, "role": MemberRole,
             "status": InviteStatus, "invitedBy": string, "createdAt": string, "expiresAt": string | null }
```
`Invite.token` is never returned in a body — it travels only in the invite email. `Membership.user` (joined from `users`) is embedded so the workspace member list renders names/emails without a second call per member.

<a id="board"></a>
### Board / Task / Milestone
```
Board { "milestones": Milestone[],
        "lanes": [ { "status": TaskStatus, "tasks": Task[] /* ordered by orderKey */ } ] }
Task  { "id": string, "projectId": string, "milestoneId": string | null,
        "parentTaskId": string | null, "title": string, "body": string | null,
        "status": TaskStatus, "priority": TaskPriority, "orderKey": string,
        "assigneeId": string | null, "universeId": number | null,
        "createdBy": string, "createdAt": string, "updatedAt": string, "dueAt": string | null }
Milestone { "id": string, "projectId": string, "name": string, "description": string | null,
            "status": MilestoneStatus, "orderKey": string, "targetDate": string | null,
            "createdBy": string | null, "createdAt": string }
```
`orderKey` is returned (the client renders order) but is **never accepted** in a request body.

### ProjectNote / ProjectGame
```
ProjectNote { "id": string, "projectId": string, "title": string | null, "body": string | null,
              "universeId": number | null, "createdBy": string, "createdAt": string, "updatedAt": string }
ProjectGame { "projectId": string, "universeId": number, "note": string | null,
              "addedBy": string | null, "addedAt": string }
```

<a id="enum-values"></a>
## Enum values

Serialised as their literal strings (from `schema.ts`):

- `LifecycleStage`: `launching | growing | stable | cooling | declining | dormant | revived`
- `LifecycleEventType`: `launch | spike | cooldown | decline | revival | death | sort_appearance | sort_exit | update_shipped`
- `TagAxis`: `genre | mechanic | progression | social | monetization`
- `NoteVisibility`: `shared | private`
- `MemberRole`: `owner | member`
- `InviteStatus`: `pending | accepted | revoked | expired`
- `ProjectStatus`: `active | paused | shipped | archived`
- `TaskStatus`: `backlog | todo | in_progress | review | done | archived`
- `TaskPriority`: `none | low | medium | high | urgent`
- `MilestoneStatus`: `planned | active | done`
- `DemandKind`: `game | theme`

---

## Acceptance cross-check (`07-api.md`)

- **No scoped endpoint returns data without a passing membership/authorship check** — every member/owner/author route sets `app.current_user_id` and the RLS policy is the backstop; unauth → `401`, wrong-relationship → `403`.
- **Global endpoints never require auth** — the global table sits behind global/optional routes; game-note reads degrade to shared-only when signed out.
- **Board move/reorder each write the minimal set of rows** — `move` writes `status`+`orderKey`, `reorder` writes `orderKey` only; `orderKey` computed server-side from named neighbours.
- **Malformed payloads rejected before persistence** — `400` (shape) / `422` (Zod, incl. free-text tag axis) precede any write.
