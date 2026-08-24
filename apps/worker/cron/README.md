# Cron services

One Railway service per job. Each `<name>.railway.toml` matches the
service on Railway with the same name.

## New service on Railway

1. New service → Deploy from GitHub repo `afrxo/monkyesuite`.
2. Settings → Config-as-code path: `apps/worker/cron/<name>.railway.toml`.
3. Variables — set:
   - `DATABASE_URL` — service role (`monkye_service`, `BYPASSRLS`).
   - `HEALTHCHECKS_PING_KEY` — the ping key from healthchecks.io
     (Project Settings → Ping Key). Same value across every service;
     each job pings a distinct slug so healthchecks.io auto-creates
     one check per job.
   - `YOUTUBE_API_KEY` (demand only).
4. Deploy. Cron schedule is honored on next scheduled fire; the initial
   deploy does not run the entrypoint.

## Cadence

| Service                | Schedule           | Notes                                 |
| ---------------------- | ------------------ | ------------------------------------- |
| `monkye-snapshot`      | `*/5 * * * *`      | Chains snapshot → derive              |
| `monkye-discover`      | `2-59/5 * * * *`   | Offset 2m from snapshot               |
| `monkye-events`        | `13 */3 * * *`     | Every 3h                              |
| `monkye-icon-backfill` | `27 * * * *`       | Hourly                                |
| `monkye-enrich`        | `17 3 * * *`       | Daily 03:17 UTC                       |
| `monkye-trend-drift`   | `37 4 * * *`       | Daily 04:37 UTC                       |
| `monkye-demand`        | `23 8 * * *`       | Daily 08:23 UTC (post-YT quota reset) |

## Retirement

`monkye-worker` (the persistent tick loop) stays deployed until Grafana
confirms each cron is landing rows at the same cadence. Then delete the
persistent service — `cmd/worker/main.go` is kept for that transition
only.
