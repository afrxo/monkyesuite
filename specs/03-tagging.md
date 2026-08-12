# 03 — Tagging

Context: `00-overview.md`. Tables: `tags`, `game_tags`. Surfaces: tagging UI (`08-web.md`) and its write endpoints (`07-api.md`).

Tagging lets the team describe what each game **has**, on independent axes, without vocabulary rot. It converts loose observation into something queryable — "pets are trending" becomes a count, not a memory. It's the input the trend-drift signal (`02-signals.md`) reads.

## Step 3.1 — Controlled vocabulary on independent axes

Tags live on five **independent axes** — never one flat bag:

- **genre** — what it is (tycoon, simulator, obby, tower_defense, rpg)
- **mechanic** — what you do (collect, fight, build, trade, roll)
- **progression** — how you advance (rebirth, unlock_tree, gacha, level_grind, collection)
- **social** — how players interact (coop, pvp, trading, guilds, solo)
- **monetization** — how it charges (gamepass, gacha, ugc, cosmetics, subscription)

Independence matters: cross-axis findings like "simulators shifting from rebirth to gacha progression" are only expressible if genre and progression are separate. Each `tags` row has a `slug` (machine key), `label` (display), and a **`description`** (definition) — a tag without a definition rots. Uniqueness on `(axis, slug)` blocks "pets" / "Pets" / "pet_system" drift.

## Step 3.2 — Constrained input (the multi-writer discipline)

- Applying a tag is **dropdown-only** from the existing vocabulary — free-text is impossible in the UI **and** rejected at the API (validate against the axis enum / known slugs).
- Adding a **new** vocabulary term is a separate, deliberate action (writes `tags`), distinct from applying an existing one (writes `game_tags`). This is the single most important rule for keeping three writers' data consistent.

## Step 3.3 — Traceability & coverage

- Every `game_tags` row records `addedBy` + `addedAt`.
- Expose a **coverage** query: which games are still untagged on which axes, so gaps are visible.

## Step 3.4 — Descriptive, not aspirational

Record what a game *has*, not what you think makes it good. The intelligence layer discovers "good" by seeing which tags recur across rising games — pre-judging just feeds your own bias back.

## Acceptance

- No two vocabulary entries mean the same thing on an axis.
- Free-text tagging is impossible at both UI and API.
- Every applied tag traces to a user and time.
- Coverage per axis is queryable.
