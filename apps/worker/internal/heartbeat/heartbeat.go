// Package heartbeat pings healthchecks.io after each job run so a missed
// tick surfaces as an alert without any log-scraping or dashboard config.
//
// One env var per job — the ping URL healthchecks.io shows on each check's
// page. Convention: HC_URL_<UPPER_JOB>, with dashes replaced by underscores.
//
//	HC_URL_SNAPSHOT       → https://hc-ping.com/<uuid>
//	HC_URL_DISCOVER       → https://hc-ping.com/<uuid>
//	HC_URL_DERIVE         → https://hc-ping.com/<uuid>
//	HC_URL_EVENTS         → https://hc-ping.com/<uuid>
//	HC_URL_ENRICH         → https://hc-ping.com/<uuid>
//	HC_URL_DEMAND         → https://hc-ping.com/<uuid>
//	HC_URL_ICON_BACKFILL  → https://hc-ping.com/<uuid>
//	HC_URL_TREND_DRIFT    → https://hc-ping.com/<uuid>
//
// success appends nothing, failure appends /fail. Fire-and-forget: a ping
// failure never fails a job — the alert is what tells you the worker is
// down, so blocking on the alerter is the wrong direction. A 2s timeout
// guards against a hung healthchecks.io endpoint stalling the tick.
package heartbeat

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"
)

// Ping notifies healthchecks.io of a job outcome. status is "ok" or
// "error"; anything else is coerced to "ok" so a caller doesn't
// accidentally silence a check by passing "skipped".
func Ping(name, status string) {
	url := os.Getenv(envKey(name))
	if url == "" {
		return
	}
	if status == "error" {
		url += "/fail"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodHead, url, nil)
	if err != nil {
		slog.Debug("heartbeat: request build failed", "job", name, "err", err)
		return
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		slog.Debug("heartbeat: ping failed", "job", name, "err", err)
		return
	}
	_ = resp.Body.Close()
}

// envKey maps a job name to its env var. Dashes become underscores because
// env var names cannot contain dashes; upper-case for shell convention.
// trend-drift → HC_URL_TREND_DRIFT.
func envKey(name string) string {
	return "HC_URL_" + strings.ToUpper(strings.ReplaceAll(name, "-", "_"))
}
