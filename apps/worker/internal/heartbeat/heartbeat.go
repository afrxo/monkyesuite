// Package heartbeat pings healthchecks.io after each job run so a missed
// tick surfaces as an alert without any log-scraping or dashboard config.
//
// One env var: HEALTHCHECKS_PING_KEY (the project-level ping key from
// healthchecks.io). Checks are auto-created on first ping via the ping
// key's slug scheme:
//
//	success → https://hc-ping.com/<key>/<job>
//	failure → https://hc-ping.com/<key>/<job>/fail
//	start   → https://hc-ping.com/<key>/<job>/start   (optional, not used)
//
// Fire-and-forget: a ping failure never fails a job — the alert is what
// tells you the worker is down, so blocking on the alerter is the wrong
// direction. A 2s timeout guards against a hung healthchecks.io
// endpoint stalling the tick.
package heartbeat

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"
)

// Ping notifies healthchecks.io of a job outcome. status is "ok" or
// "error"; anything else is coerced to "ok" so a caller doesn't
// accidentally silence a check by passing "skipped".
func Ping(name, status string) {
	key := os.Getenv("HEALTHCHECKS_PING_KEY")
	if key == "" {
		return
	}
	url := "https://hc-ping.com/" + key + "/" + name
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
