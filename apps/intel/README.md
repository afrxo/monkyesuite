# apps/intel — intelligence batch service

Python batch job (Railway cron, every 30 min) that synthesizes the derive
layer's signals into ranked, pre-headlined insights for the `/discover`
dashboard. Reads global tables only, writes `intel_insights`, connects as
`monkye_service` (RLS bypass — same role as the Go worker).

Three jobs, each in its own transaction/failure domain:

| kind               | subject | question it answers                                  |
| ------------------ | ------- | ---------------------------------------------------- |
| `trend_confidence` | tag     | how strongly is this direction moving, vs all tags?  |
| `movement`         | game    | why did this game move? (update/event/sort/organic)  |
| `watch`            | game    | which early-stage games deserve tracking now?        |

## Design rules

- **Aggregation stays in Postgres.** Jobs run GROUP BY / window SQL and score
  the few-hundred-row aggregated result in Python. Never fold raw
  `game_metrics` rows in app memory (CLAUDE.md CPU strategy).
- **Derived-from-derived, deliberately.** intel reads `game_stats*` — allowed
  here because `intel_insights` is a presentation-layer leaf: nothing
  downstream consumes it back into derivation.
- **Idempotent + rebuildable.** Upsert on `(kind, subject_key, computed_at)`;
  14-day retention pruned per run. A scoring bug is fixed by re-running,
  never by patching rows.
- **Estimates, labeled.** Every headline reads as an estimate. Scores are
  decomposed into named components in `evidence` so the page can always show
  *why*, not just *how much*.
- **Confirmation rule intact.** A tag needs ≥ 2 carriers to appear at all and
  rising-carrier fraction is the heaviest score weight — one spiking game
  never mints a trend (specs/00).

## How ML grows in

V1 scoring is transparent seeded weights (`scoring.py`, per-job `WEIGHTS`)
over population-relative features. That is intentional scaffolding:

1. **Now (days of history):** logistic-shaped heuristics, honest confidence.
2. **Later (weeks of `game_stats` history):** fit a real model per job —
   e.g. predict `P(CCU higher in 7d)` from today's feature row, trained on
   self-labeled forward outcomes (no ground-truth retention exists; labels
   are forward CCU, a proxy, and stay labeled as such).
3. The fitted model replaces `WEIGHTS`/`sigmoid` behind the same
   `run(conn, computed_at) -> int` interface and keeps writing the same
   `evidence.components` breakdown. New kinds (`forecast`, `lead_time`) are
   new job modules writing new `kind` values — the table and API need no
   migration (kind is text, validated at the API).

## Run locally

```bash
cd apps/intel
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
DATABASE_URL=postgres://monkye_service:...@localhost:5432/monkyesuite \
  .venv/bin/python -m intel.run
```

Logs are JSON lines per job: `{"job": "...", "status": "ok", "rows": N}`.
Exit 0 if ≥ 1 job landed, 1 on total failure (cron alert threshold).
