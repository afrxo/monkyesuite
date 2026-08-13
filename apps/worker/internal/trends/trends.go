// Package trends is a best-effort Google Trends client for the demand job.
//
// Trends is CONFIRMING, not primary (specs/04 §4.2): a noisy 0–100 interest
// curve, direction only. There is no official API; this hits the same unofficial
// endpoints pytrends does — a two-step token dance:
//
//  1. /api/explore returns widgets, each with a token + request payload.
//  2. /api/widgetdata/multiline for the TIMESERIES widget returns the curve.
//
// Both responses are prefixed with an anti-JSON-hijack guard ()]}',) that must
// be stripped. The endpoint is rate-limited and flaky, so EVERY failure here is
// soft: Interest returns (nil, err) and the job records a null trendsScore. It
// must never fail the snapshot.
package trends

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// exploreBase / widgetBase are the unofficial Trends endpoints. Overridable in
// tests.
const (
	exploreBase = "https://trends.google.com/trends/api/explore"
	widgetBase  = "https://trends.google.com/trends/api/widgetdata/multiline"
)

// browserUA — Trends rejects the default Go user agent.
const browserUA = "Mozilla/5.0 (compatible; monkyesuite-worker/1.0)"

// defaultTimeframe is the interest window. "today 3-m" is the last ~90 days,
// enough for a direction read without over-smoothing.
const defaultTimeframe = "today 3-m"

// Client fetches interest curves. Best-effort by construction.
type Client struct {
	http       *http.Client
	exploreURL string
	widgetURL  string
	timeframe  string
	log        *slog.Logger
}

// Option configures a Client.
type Option func(*Client)

// WithHTTPClient overrides the underlying *http.Client.
func WithHTTPClient(h *http.Client) Option { return func(c *Client) { c.http = h } }

// WithBaseURLs overrides the explore/widget endpoints (tests).
func WithBaseURLs(explore, widget string) Option {
	return func(c *Client) { c.exploreURL, c.widgetURL = explore, widget }
}

// WithLogger sets the structured logger.
func WithLogger(l *slog.Logger) Option { return func(c *Client) { c.log = l } }

// New builds a Trends client. Always usable (no credentials); the caller may
// still choose to disable it via config.
func New(opts ...Option) *Client {
	c := &Client{
		http:       &http.Client{Timeout: 12 * time.Second},
		exploreURL: exploreBase,
		widgetURL:  widgetBase,
		timeframe:  defaultTimeframe,
		log:        slog.Default(),
	}
	for _, o := range opts {
		o(c)
	}
	return c
}

// Interest returns the most recent 0–100 interest value for term, or an error.
// Direction only — treat as confirming (§4.2).
func (c *Client) Interest(ctx context.Context, term string) (float64, error) {
	token, request, err := c.explore(ctx, term)
	if err != nil {
		return 0, err
	}
	return c.timeseries(ctx, token, request)
}

type exploreResponse struct {
	Widgets []struct {
		ID      string          `json:"id"`
		Token   string          `json:"token"`
		Request json.RawMessage `json:"request"`
	} `json:"widgets"`
}

// explore performs step 1 and returns the TIMESERIES widget's token + request.
func (c *Client) explore(ctx context.Context, term string) (string, json.RawMessage, error) {
	reqPayload := fmt.Sprintf(
		`{"comparisonItem":[{"keyword":%q,"geo":"","time":%q}],"category":0,"property":""}`,
		term, c.timeframe)
	q := url.Values{}
	q.Set("hl", "en-US")
	q.Set("tz", "0")
	q.Set("req", reqPayload)

	var resp exploreResponse
	if err := c.getGuardedJSON(ctx, "explore", c.exploreURL, q, &resp); err != nil {
		return "", nil, err
	}
	for _, w := range resp.Widgets {
		if w.ID == "TIMESERIES" {
			if w.Token == "" || len(w.Request) == 0 {
				return "", nil, fmt.Errorf("trends: TIMESERIES widget missing token/request")
			}
			return w.Token, w.Request, nil
		}
	}
	return "", nil, fmt.Errorf("trends: no TIMESERIES widget for term")
}

type widgetResponse struct {
	Default struct {
		TimelineData []struct {
			Value   []float64 `json:"value"`
			HasData []bool    `json:"hasData"`
		} `json:"timelineData"`
	} `json:"default"`
}

// timeseries performs step 2 and returns the latest non-empty interest value.
func (c *Client) timeseries(ctx context.Context, token string, request json.RawMessage) (float64, error) {
	q := url.Values{}
	q.Set("hl", "en-US")
	q.Set("tz", "0")
	q.Set("req", string(request))
	q.Set("token", token)

	var resp widgetResponse
	if err := c.getGuardedJSON(ctx, "widgetdata", c.widgetURL, q, &resp); err != nil {
		return 0, err
	}
	// Walk backwards to the latest point that actually has data.
	pts := resp.Default.TimelineData
	for i := len(pts) - 1; i >= 0; i-- {
		if len(pts[i].Value) > 0 {
			return pts[i].Value[0], nil
		}
	}
	return 0, fmt.Errorf("trends: empty timeline")
}

// getGuardedJSON GETs url, strips the anti-hijack guard prefix, and decodes.
func (c *Client) getGuardedJSON(ctx context.Context, endpoint, base string, q url.Values, out any) error {
	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", browserUA)
	resp, err := c.http.Do(req)
	if err != nil {
		c.log.Warn("trends call failed", "endpoint", endpoint, "err", err)
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	c.log.Info("trends call", "endpoint", endpoint, "status", resp.StatusCode,
		"latency_ms", time.Since(start).Milliseconds(), "bytes", len(body))
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("trends %s: status %d", endpoint, resp.StatusCode)
	}
	clean := stripGuard(body)
	if err := json.Unmarshal(clean, out); err != nil {
		return fmt.Errorf("decode %s: %w", endpoint, err)
	}
	return nil
}

// stripGuard drops Google's anti-JSON-hijack prefix ()]}', or similar) by
// returning everything from the first JSON opening brace/bracket.
func stripGuard(body []byte) []byte {
	s := string(body)
	if i := strings.IndexAny(s, "{["); i >= 0 {
		return body[i:]
	}
	return body
}
