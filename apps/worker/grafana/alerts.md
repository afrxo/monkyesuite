# Alert rules

Four rules. Create each via **Alerting → Alert rules → New alert rule**.
Datasource UIDs cannot be templated in provisioning files reliably across
Grafana Cloud stacks, so this is a manual step per stack — but each rule
is one paste of the query text plus threshold.

For every rule below:

- Folder: `monkyesuite`
- Evaluation group: `worker` (interval `1m`)
- Contact point: whichever paging channel you want on `severity=page`
  (create a notification policy that routes `severity=page` to PagerDuty
  or Slack; `severity=warn` to a low-noise channel)

---

## 1. Snapshot has not succeeded in 15 minutes — PAGE

- **Type:** Grafana-managed
- **Datasource (query A):** your Prometheus datasource
- **Query A (instant):**
  ```
  sum(increase(worker_job_runs_total{job_name="snapshot", job_status="ok"}[15m]))
  ```
- **Reduce B:** `A` → `Last`
- **Threshold C:** `B` `< 1`
- **Alert condition:** `C`
- **Pending for:** `0m`
- **Labels:** `severity=page`
- **Summary:** Snapshot has not landed a successful run in 15 min.
- **Description:**
  > Critical scraping path is dark. game_metrics is not receiving fresh
  > rows; every downstream signal is derived from stale data. Check
  > Railway → `monkye-worker` (or `monkye-snapshot` after cron cutover)
  > logs, and `job_runs.error` for the most recent snapshot row.

## 2. game_metrics is stale — PAGE

- **Type:** Grafana-managed
- **Datasource (query A):** your Postgres datasource
- **Query A (SQL, format Table):**
  ```sql
  select extract(epoch from (now() - max(captured_at))) as v from game_metrics
  ```
- **Reduce B:** `A` → `Last`
- **Threshold C:** `B` `> 900`
- **Alert condition:** `C`
- **Pending for:** `5m`
- **Labels:** `severity=page`
- **Summary:** game_metrics.captured_at is more than 15 min stale.
- **Description:**
  > Same page as rule 1 from the DB side. If both fire together,
  > snapshot is broken. If only this one fires, snapshot is writing
  > but the row isn't landing (RLS regression, connection pool, disk).

## 3. Snapshot yield below 90% for 30 min — WARN

- **Type:** Grafana-managed
- **Datasource:** your Prometheus datasource
- **Query A (instant):**
  ```
  sum(rate(worker_job_counter_total{job_name="snapshot", counter_name="real"}[30m])) / sum(rate(worker_job_counter_total{job_name="snapshot", counter_name="tracked"}[30m]))
  ```
- **Reduce B:** `A` → `Last`
- **Threshold C:** `B` `< 0.9`
- **Alert condition:** `C`
- **Pending for:** `30m`
- **Labels:** `severity=warn`
- **Description:**
  > Sustained low yield = Roblox is refusing a large share of batches
  > (rate cap, bot challenge, contract drift). Rows still land, so this
  > warns rather than pages — but if unattended it hides trend signal.

## 4. A job has errored continuously for 15 min — WARN

- **Type:** Grafana-managed
- **Datasource:** your Prometheus datasource
- **Query A (range 15m, instant):**
  ```
  sum by (job_name) (rate(worker_job_runs_total{job_status="error"}[15m])) > 0
  ```
- **Reduce B:** `A` → `Last`
- **Threshold C:** `B` `> 0`
- **Alert condition:** `C`
- **Pending for:** `15m`
- **Labels:** `severity=warn`
- **Description:**
  > One-offs don't fire. Sustained = the job cannot recover — read
  > job_runs.error and Railway logs.

## Notification policy (one-time)

Alerting → Notification policies → Root → **Add new specific policy**:

- Matcher: `severity = page`
- Contact point: your paging channel
- Grouping: `alertname, job_name`

Second child policy:

- Matcher: `severity = warn`
- Contact point: your low-noise channel

The default policy handles anything unlabeled (should stay empty).
