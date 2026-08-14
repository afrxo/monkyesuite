# 06 — Identity & Access

Context: `00-overview.md`. Tables: `users` (via Better Auth), `memberships`, `invites`; governs RLS on all project-scoped tables and on `game_notes`.

This realm authenticates users and enforces that scoped data is visible only to the right people. It is the weight behind the whole collaboration layer, and it lands last in the build sequence — right when collaborators first matter.

## Step 6.1 — Authentication

Use **Better Auth** for sign-in and sessions. It owns the `users` table; everything else references `users.id`.

**Closed suite (§6.6): there is no public sign-up.** The only way an account comes into existence is an admin creating it from `/admin` (`09-admin.md §9.3a`), via Better Auth's server API — same hashing, same `accounts` row, same validation as the old public path, just a different caller. The public `/v1/auth/sign-up/email` HTTP route is disabled (returns `404`, not merely hidden in the web UI); `auth.api.signUpEmail(...)` called in-process by the admin action still works, since it never goes through that route.

## Step 6.2 — Membership is the authorization model

A `memberships` row joins a user to a project with a role (`owner` | `member`). Every project-scoped question reduces to a single predicate: **is this user a member of this project?** Keep roles to just owner and member — owner for destructive actions (delete project, remove member), member for everything else.

## Step 6.3 — Adding collaborators (no invite/token flow)

**Amended for the closed suite.** The original design was an async invite: enter an email → create a `pending` invite with a token → invitee accepts → a `membership` row is created. That flow existed to onboard someone who didn't have an account yet. Under the closed model nobody reaches monkyesuite without an account an admin already created, so the async step has nothing left to bridge — an "invite" would just be a slower way to do a membership insert.

**Replacement: adding a collaborator is a direct, synchronous write against an existing account.** An owner names an **existing** user by email; the API looks the user up, checks the cap, and creates the `membership` row in the same request — no token, no `pending` state, no expiry, no delivery email. `POST /projects/:id/members { email, role? }` (`docs/api-contract.md`), owner-gated, backed by the `add_member_by_email` SECURITY DEFINER function (mirrors `create_project` / `remove_member` in `functions.sql`).

**Cap two collaborators per project**, enforced inside `add_member_by_email` itself (not just at the API), so the rule can't be routed around — same principle the admin path already followed for the invite flow it replaces (`09-admin.md §9.3a`).

Owners can add existing users and manage memberships within the cap; they **cannot create accounts** — that stays admin-only (§6.1).

The `invites` table, its enum, RLS policy, and the `accept_invite` / `admin_create_invite` functions are **removed**, not deprecated in place — there is no reachable code path that still needs them.

## Step 6.4 — Two-backstop enforcement

Project scoping is enforced twice, on purpose:

1. **Primary — API.** Every scoped handler resolves the caller's membership through **one shared helper** before touching data. This is the single chokepoint.
2. **Backstop — Postgres RLS.** The API opens each request transaction with `SET LOCAL app.current_user_id = '<uuid>'`. The policies in `schema.ts` read `current_setting('app.current_user_id', true)` and filter at the database.

**Connection roles:**
- The **API** connects as a restricted role with RLS enforced, and sets `app.current_user_id` per request transaction.
- The **scraper / derive / enrich jobs** connect as a **service role that bypasses RLS** — they operate on global scraped tables and must never be filtered. Grant scoped tables to the app role only.

A missing `app.current_user_id` must **fail closed** (policies return zero rows), never open.

## Step 6.5 — Game-note access (the global exception)

`game_notes` is global (a note follows its game across all projects) but user-authored, so it carries RLS by **author + visibility**, with no project membership involved:

- **read** if `visibility = 'shared'` OR `author_id = current_user`
- **write** only your own note

Same `app.current_user_id` mechanism as scoped tables.

## Step 6.6 — Closed suite: nothing is public, and revocation is real

**Every `/v1` route requires a valid session at minimum.** There is no `global`/optional auth family anymore (`docs/api-contract.md` "Auth families"): the reads that used to be public signed-out — feed, discovery, game detail and its sub-resources, tag-vocabulary reads, game-notes reads — are now `authenticated`. Game-notes read drops its signed-out "shared-only" degradation for the same reason: a caller is always authenticated, so it returns shared + own-private unconditionally.

**Three deliberate exceptions**, or the app locks everyone out: the web sign-in page, the Better Auth sign-in endpoint it posts to, and the static assets those two need to render. `/admin/login` is the equivalent exception for the admin surface and keeps working unchanged under this model (`09-admin.md §9.2`) — same session, same cookie, no separate admin credential.

**Revocation — `users.disabled`.** An admin can revoke a user (`09-admin.md §9.5`), which must kill access **immediately**, not just block the next login. Chosen: a boolean flag, not a delete — deleting would orphan `game_notes.author_id`, `audit_log.actor_id`, and every `created_by`/`invited_by`-shaped reference the revoked user left behind; disabling preserves all of it while cutting the user off.

Enforcement, two parts:
1. **Existing session dies now.** Revoking deletes every row in `sessions` for that user in the same transaction that sets `disabled = true`. Better Auth's session lookup reads `sessions`; with the rows gone, the very next request — including one mid-flight on the user's already-open tab — resolves no session.
2. **The session resolver itself checks the flag** (`apps/api/src/middleware.ts`), the same defensive belt Better Auth's own state can't guarantee alone (a session row could in principle survive a partial failure). A disabled user's session, if one somehow resolves, is treated as absent — `401`, same as no session at all. This applies everywhere a session is read, `/v1` and `/admin` both; there is no surface where a revoked account still functions.
3. **A revoked user cannot sign back in.** Better Auth's sign-in endpoint checks `users.disabled` before issuing a new session (a `hooks.before` check on `/sign-in/email`, `apps/api/src/auth.ts`) — refusing a fresh sign-in, not just invalidating what already existed.

The last admin cannot revoke themselves (`09-admin.md §9.4`) — that would lock the operator out of the one surface that can create or revoke anyone.

## Acceptance

- A non-member sees zero rows for a project at both the API and the database.
- Adding a collaborator cannot exceed two per project.
- A dropped, missing, or disabled-user session cannot read scoped **or** global-table data (fails closed) — no `/v1` route is reachable signed-out except the three named exceptions.
- Private game notes are invisible to everyone but their author.
- A revoked user's existing session fails on its next request and a fresh sign-in is refused; their authored rows (`game_notes`, `audit_log`, etc.) are untouched.
- The last remaining admin cannot revoke themselves.
