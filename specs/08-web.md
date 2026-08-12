# 08 — Web / Frontend

Context: `00-overview.md`. A separate SSR app (TanStack Start, React) deployed independently. It **never touches the database** — all data comes from the API (`07-api.md`) over HTTP. That boundary is deliberate: it's where authorization lives.

## Step 8.1 — `/` Pulse feed

Tracked games, paged (~24/page). Filter by lifecycle stage; sort by spike / trend / ccu / velocity / newest. Show discovery **sort rank** where present. Every scraped number is labelled an **estimate** and shows its freshness (`computedAt`).

## Step 8.2 — `/discover`

The intelligence surface: trend-drift, acceleration, operator spotlight, vacancy/whitespace heatmap, pattern index — powered by tags (`03`) and signals (`02`). Crucially, a flagged trend **shows its carrier count and growth**, so the confirmation rule is visible — the user sees *why* something is a direction, not just that it's flagged.

## Step 8.3 — `/games/$id` (game detail)

Everything known about one game:
- CCU/metric history, derived signals, lifecycle + **sort-rank timeline**, virtual events.
- **Tags** (with the tagging control from 8.4).
- **Monetization** — gamepasses and dev products with prices.
- Off-platform **demand overlay** (from `04`) — external interest vs on-platform CCU, surfacing the "heating, not yet reflected" flag.
- **Game notes** — a per-game thread showing the team's **shared** notes plus **your private** ones, with an author + visibility control on compose. Never render another user's private note.

## Step 8.4 — Tagging UI

Dropdown-only per axis (genre / mechanic / progression / social / monetization), with coverage indicators showing which axes are still empty. Free-text is impossible.

## Step 8.5 — Project workspaces

Member-gated build workspace:
- **Kanban board** — drag cards across lanes, reorder within a lane (calls the move/reorder endpoints; optimistic update, single-row write).
- **Milestone** grouping and filter.
- **Docs** (long-form markdown) and **notes** (short pins).
- Optional pinned tracked games.

## Step 8.6 — Auth & empty states

`/sign-in`, `/sign-up`. On `403` → a "not a member of this project" empty state with an action, never a blank screen. On `401` → redirect to sign-in. Never show a derived number without its freshness / estimate labelling.

## Data access

Reads go through the API, not the database. Use TanStack Query for client-side fetch/cache; mutations call the API. Nothing here reads Postgres directly.

## Acceptance

- No route reads the database directly.
- Scoped views degrade to directed empty states on `401` / `403`.
- Game detail shows shared + own-private notes and never another user's private note.
- Every derived number displays its freshness and estimate labelling.
- The confirmation rule (carrier count + growth) is visible on flagged trends.
