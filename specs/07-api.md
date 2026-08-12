# 07 — API

Context: `00-overview.md`. Owns the HTTP layer on the backend service; no tables of its own. It is the only thing the frontend talks to, and the home of the authorization boundary.

## Step 7.1 — Two handler families

Split handlers by the data realm they serve, with different middleware:

- **Global** — feed, game detail, discovery, tags (read), shared game notes. Auth optional; responses cacheable (short-TTL in-process cache for hot reads like the feed).
- **Scoped** — projects, board, tasks, docs, notes, tagging writes, private game notes. Auth **required** → resolve membership/authorship via the shared helper → open a transaction that sets `app.current_user_id` (see `06-identity-access.md`).

The split mirrors the global/scoped table division exactly.

## Step 7.2 — Board endpoints (explicit shapes)

The board needs precise operations so the frontend can build against them:

- `GET /projects/:id/board` → lanes grouped by status, tasks ordered by `orderKey`, milestone info included.
- `POST /projects/:id/tasks` → create task (default `status='backlog'`, `orderKey` at lane end).
- `PATCH /tasks/:id/move` → `{ status, orderKey }` — cross-lane move; writes both.
- `PATCH /tasks/:id/reorder` → `{ orderKey }` — within-lane; writes only `orderKey`.
- `POST /tasks/:id/subtasks` → create subtask; **reject if the parent is already a subtask** (one-deep).
- Milestone CRUD; `PATCH` for project status.

Compute `orderKey` server-side from the neighbours the client names (before/after task ids), so ordering logic lives in one place.

## Step 7.3 — Game-notes endpoints

- `GET /games/:universeId/notes` → returns **shared** notes from anyone plus the caller's **private** notes.
- `POST /games/:universeId/notes` → create own note (`body`, `visibility`).
- `PATCH /notes/:id`, `DELETE /notes/:id` → author-only.

## Step 7.4 — Validation

Validate every input at the boundary with Zod, including the tag axis/slug enum (this is where free-text tags are rejected). Reject malformed payloads before persistence.

## Step 7.5 — Caching & error semantics

- Short-TTL in-process cache for hot global reads.
- Distinguish **`401`** (unauthenticated) from **`403`** (authenticated but not a member) so the UI can respond correctly.
- DB unavailable → **`503`** with a retry hint, never a silent empty result.

## Acceptance

- No scoped endpoint returns data without a passing membership/authorship check.
- Global endpoints never require auth.
- Board move/reorder each write the minimal set of rows.
- Malformed payloads are rejected before persistence.
