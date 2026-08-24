# Grafana Cloud — worker observability

Two artifacts in this dir:

- [`dashboard.json`](./dashboard.json) — worker overview dashboard.
- [`alerts.json`](./alerts.json) — alert rules (paging + warning).

## Import

### Dashboard

1. Grafana Cloud → Dashboards → New → Import.
2. Upload `dashboard.json`.
3. Data sources: pick the default `grafanacloud-<stack>-prom` for metrics
   and the Postgres data source you'll create below.

### Alerts

1. Alerting → Alert rules → New folder `monkyesuite`.
2. For each rule in `alerts.json`, create it via the UI or the Alerting
   API (`POST /api/v1/provisioning/alert-rules`). File is provisioning
   format compatible with the API.
3. Notification: pick the contact point that pages you (PagerDuty,
   Grafana OnCall, Slack — whichever you already use).

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
