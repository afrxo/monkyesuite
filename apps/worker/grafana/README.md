# Grafana Cloud — worker observability

Two artifacts in this dir:

- [`dashboard.json`](./dashboard.json) — worker overview dashboard.
- [`alerts.md`](./alerts.md) — alert rules with click-by-click steps.

## Import order

1. Add the Postgres datasource (below).
2. Import the dashboard (below).
3. Create the alert rules following [`alerts.md`](./alerts.md).

## Dashboard

1. Grafana Cloud → Dashboards → New → Import.
2. Upload `dashboard.json`.
3. On the import screen pick your Prometheus datasource for `DS_PROM`
   and the Postgres datasource for `DS_PG`. The dashboard uses variables,
   not baked UIDs, so it moves cleanly between stacks.

## Postgres data source (one-time)

Two alerts read `game_metrics.max(captured_at)` directly against
Railway Postgres. Grafana → Connections → Data sources → New →
PostgreSQL. Fill:

- Host: Railway's public host from `RAILWAY_POSTGRES_PUBLIC_URL`
  (never the internal `.railway.internal` — Grafana isn't on that
  network).
- User: `monkye_app` or a read-only role. Do not use the service role.
- SSL mode: `require`.
- Name: `railway-postgres`.

## Metric names

OTEL → Prometheus naming: dots become underscores, counters get
`_total` suffix. Panels use these:

| OTEL instrument           | Prometheus metric               |
| ------------------------- | ------------------------------- |
| `worker.job.runs`         | `worker_job_runs_total`         |
| `worker.job.duration_ms`  | `worker_job_duration_ms_bucket` |
| `worker.job.rows_written` | `worker_job_rows_written_total` |
| `worker.job.counter`      | `worker_job_counter_total`      |

Attributes: `job_name`, `job_status`, `counter_name`.

## Rotating the credential

Grafana Cloud → Access Policies → `monkyesuite-worker` → revoke. New
token → update `OTEL_EXPORTER_OTLP_HEADERS` on every Railway service
that exports (persistent worker + seven cron services).
