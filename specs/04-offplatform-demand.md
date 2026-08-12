# 04 — Off-platform Demand

Context: `00-overview.md`. Tables: `demand_terms`, `demand_snapshots`. A daily backend job plus display on the game-detail surface.

External interest often rises **before** on-platform CCU — video is the acquisition funnel, so a mechanic trends on YouTube before it trends on Roblox. This realm captures that lead signal and joins it back to the tracker.

## Step 4.1 — The curated map (the join between two worlds)

On-platform data keys on `universeId`; off-platform data keys on a **search string**. They don't join naturally, so `demand_terms` is a hand-curated bridge. Each term is one of:

- **`kind = 'game'`** → mapped to a `universeId`. Answers "is *this game* heating up?"
- **`kind = 'theme'`** → mapped to a genre label. Answers "is this *category* forming a wave?" (the portfolio-relevant question).

## Step 4.2 — Daily ingestion

For each active term, once per day, write a `demand_snapshots` row:

- **YouTube Data API v3** — `search.list` with `q=term` and `publishedAfter=<7 days ago>` for the recent **video count**; `videos.list` for **aggregate views**. This is the strongest lead indicator.
- **Google Trends** (via `pytrends`) — a 0–100 interest curve. Direction only; noisy on niche terms. Treat as **confirming, not primary**.
- **No TikTok** — no viable free API; leave manual or skip.

Respect YouTube quota: 10k units/day, `search.list` costs 100 units, so ~100 term-searches/day — ample for a bounded set. On exhaustion, prioritize theme-terms and defer game-terms to the next day.

## Step 4.3 — The payoff flag

Compute, per term, a single flag: **external velocity positive while matched on-platform CCU is flat or negative** ⇒ *"heating, not yet reflected."*

- Game-term: compare `yt_view_delta_7d` against the matched game's CCU slope.
- Theme-term: compare against the genre-aggregate CCU slope.

This flag is the entire reason the realm exists — it surfaces bets the on-platform charts haven't priced in yet.

## Acceptance

- Every active term is snapshotted daily.
- The heating flag is computed only where a valid match exists; unmapped terms surface for curation.
- YouTube quota is never exceeded.
