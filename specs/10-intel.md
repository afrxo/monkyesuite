# 10 — Intel (the /discover dashboard)

The "what's my next move" surface. Replaces the earlier per-surface /discover
plan (08-web §8.2's trend-drift/whitespace widgets) with one dashboard fed by a
dedicated batch service that synthesizes the derive layer into ranked,
pre-headlined insights. Signal over data, sentence over number.

## 10.1 Shape

```
game_stats(_latest) · game_tags · tags · games · game_events
lifecycle_events · cohort_stats          (aggregation stays in Postgres)
        │
apps/intel — Python, Railway cron (*/30), connects as monkye_service
        │  upsert
intel_insights (GLOBAL; kind, subject, rank, score, headline, evidence, computed_at)
        │
GET /v1/intel — latest run per kind, 60s TtlCache + s-maxage=60
        │
apps/web /discover — three text-first sections
```

Three deliverables in V1, one `kind` each:

| kind               | subject | section            | question answered                        |
| ------------------ | ------- | ------------------ | ---------------------------------------- |
| `trend_confidence` | tag     | Trend signal       | how strongly is this direction moving?   |
| `movement`         | game    | Movers, explained  | why did this move?                       |
| `watch`            | game    | Watchlist          | what deserves tracking before it's obvious? |

## 10.2 Rules

- **intel is a presentation-layer leaf.** It reads derived tables (allowed
  derived-from-derived exception) and NOTHING reads `intel_insights` back into
  derivation. The worker never touches it.
- **Confirmation rule survives** (00-overview): tags need ≥ 2 carriers to
  appear and rising-carrier fraction is the heaviest score weight.
- **Estimates, always labeled.** Headlines read as estimates; scores carry a
  component breakdown in `evidence` so the page shows *why*, never a bare
  number.
- **Idempotent + rebuildable** on `(kind, subject_key, computed_at)`; 14-day
  retention; a scoring bug is fixed by re-running.
- **Failure domains per job** — one broken job never blanks the other
  sections (same isolation principle as discover-vs-snapshot in the worker).
- **Warm-up is a state, not an error**: `computedAt: null` → the page says the
  first run hasn't landed; thin sections say data is accumulating.

## 10.3 Scoring (V1: stats-first)

Transparent seeded weights over population-relative features (z-scores,
percentile ranks) through a logistic squash — see `apps/intel/intel/scoring.py`
and per-job `WEIGHTS`. No trained model ships in V1 on purpose: days of
history can't validate one.

## 10.4 How ML grows in (V2)

- Per-job fitted models (logistic/GBM) predicting forward CCU outcomes
  (self-labeled: "was CCU higher 7d later" — a proxy, labeled as such),
  replacing seeded weights behind the same `run(conn, computed_at)` interface
  and the same `evidence.components` contract.
- New kinds land as new job modules writing new `kind` values (`forecast`,
  `lead_time` for demand-vs-CCU lag) — `kind` is text and the payload is
  grouped at the API, so no migration is needed.
- Prerequisite: weeks of `game_stats` history; validate a model against the
  seeded heuristic before swapping it in.

## 10.5 Deploy

Fourth deployable: Railway cron service on `apps/intel` (Python/Nixpacks,
`python -m intel.run`, schedule `*/30 * * * *`), `DATABASE_URL` = the
monkye_service connection string. Grants live in `roles.sql` (intel_insights
is in the GLOBAL block); migration `0016` creates the table.
