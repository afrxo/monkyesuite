# 06 — Identity & Access

Context: `00-overview.md`. Tables: `users` (via Better Auth), `memberships`, `invites`; governs RLS on all project-scoped tables and on `game_notes`.

This realm authenticates users and enforces that scoped data is visible only to the right people. It is the weight behind the whole collaboration layer, and it lands last in the build sequence — right when collaborators first matter.

## Step 6.1 — Authentication

Use **Better Auth** for sign-in / sign-up and sessions. It owns the `users` table; everything else references `users.id`.

## Step 6.2 — Membership is the authorization model

A `memberships` row joins a user to a project with a role (`owner` | `member`). Every project-scoped question reduces to a single predicate: **is this user a member of this project?** Keep roles to just owner and member — owner for destructive actions (delete project, remove member), member for everything else.

## Step 6.3 — Invites

Flow: enter an email → create a `pending` invite with a token → invitee accepts → a `membership` row is created. **Cap two collaborators per project.** Invites expire (`expiresAt`); expired invites move to `expired` and create no membership.

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

## Acceptance

- A non-member sees zero rows for a project at both the API and the database.
- Invites cannot exceed two collaborators per project.
- A dropped or missing session cannot read scoped data (fails closed).
- Private game notes are invisible to everyone but their author.
