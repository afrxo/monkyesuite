// Package roblox is the single shared HTTP client for all Roblox calls.
//
// Every outbound call goes through here (specs/01 Step 1.0):
//  1. rate limit first — 60 req / 10s shared limiter; over-limit → skip.
//  2. fetch — User-Agent monkyesuite-worker/1.0, per-request context deadline,
//     exponential backoff + jitter on 5xx/429/network within a retry budget.
//  3. decode into typed structs; reject malformed payloads.
//  4. log endpoint · status · latency.
//
// No auth token is ever sent; every call fails soft. Fan-out is a bounded
// goroutine pool (errgroup with SetLimit) under the shared limiter — see fan.go.
package roblox

import (
	"context"
	crand "crypto/rand"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/rand"
	"net/http"
	"time"

	"golang.org/x/time/rate"

	"monkyesuite/worker/internal/telemetry"
)

// UserAgent identifies the worker to Roblox on every request.
const UserAgent = "monkyesuite-worker/1.0"

// Rate-limit budget (two-tier, specs/01 §1.0). Two INDEPENDENT limiters, not one
// shared pool — that separation is what makes the reservation real:
//   - Critical: 40 req/10s (burst 40) — discover · snapshot · events draw here.
//   - Enrich:   20 req/10s (burst 20) — the daily enrich drain draws here.
//
// The tiers share no tokens, so a saturated enrich drain can NEVER consume a
// critical token: snapshot's private budget is always intact and a tick always
// completes on time. The aggregate to Roblox is bounded by the sum — burst 60,
// sustained 60 req/10s — so the politeness ceiling is preserved exactly.
//
// (A single shared ceiling with an enrich sub-cap does NOT deliver this: because
// each call skips rather than waits, a transiently-drained shared burst zeroes a
// whole snapshot even when enrich is within its sub-cap. Independent pools fix it.)
const (
	RateLimitRequests    = 60 // aggregate politeness ceiling to Roblox (sum of tiers)
	CriticalRateRequests = 40 // reserved for the every-tick critical path
	EnrichRateRequests   = 20 // the daily enrich drain only
	RateLimitWindow      = 10 * time.Second
)

// ErrRateLimited is returned (no fetch performed) when the shared limiter has no
// token immediately available. The caller skips this id/sort to the next tick —
// a gap is data, not a crash (specs/01 §1.0, §1.5).
var ErrRateLimited = errors.New("roblox: rate-limit gate closed, skipped")

// Client is the shared Roblox HTTP client. The limiter it holds is its tier's
// private budget: the base client carries the critical-path limiter; the view
// returned by ForEnrich carries the independent enrich limiter.
type Client struct {
	http        *http.Client
	limiter     *rate.Limiter // this client's tier budget (critical or enrich)
	tier        string        // "critical" | "enrich" — for logging only
	log         *slog.Logger
	maxRetries  int
	baseBackoff time.Duration
	sessionID   string // Explore API requires a per-session GUID
}

// Option configures a Client.
type Option func(*Client)

// WithHTTPClient overrides the underlying *http.Client (tests, custom transport).
func WithHTTPClient(h *http.Client) Option { return func(c *Client) { c.http = h } }

// WithLogger sets the structured logger.
func WithLogger(l *slog.Logger) Option { return func(c *Client) { c.log = l } }

// WithMaxRetries sets the per-call retry budget (default 3).
func WithMaxRetries(n int) Option { return func(c *Client) { c.maxRetries = n } }

// New builds the shared client. The limiter is sized to RateLimitRequests over
// RateLimitWindow with a full burst, so a fresh tick can fan out immediately but
// sustained throughput is capped at 60/10s.
func New(opts ...Option) *Client {
	c := &Client{
		http:        &http.Client{Timeout: 15 * time.Second},
		limiter:     rate.NewLimiter(rate.Every(RateLimitWindow/CriticalRateRequests), CriticalRateRequests),
		tier:        "critical",
		log:         slog.Default(),
		maxRetries:  3,
		baseBackoff: 200 * time.Millisecond,
		sessionID:   newSessionID(),
	}
	for _, o := range opts {
		o(c)
	}
	return c
}

// ForEnrich returns a view of the client for the daily enrich drain, carrying an
// INDEPENDENT enrich limiter (EnrichRateRequests/10s). It shares the parent's
// http client, logger and sessionID, but NOT its token budget — so enrich draws
// from its own 20/10s pool and can never spend a critical-path token (§1.0).
func (c *Client) ForEnrich() *Client {
	cp := *c // shares http, log, sessionID
	cp.limiter = rate.NewLimiter(rate.Every(RateLimitWindow/EnrichRateRequests), EnrichRateRequests)
	cp.tier = "enrich"
	return &cp
}

// SessionID is the per-process GUID the Explore API requires on get-sort-content.
func (c *Client) SessionID() string { return c.sessionID }

// newSessionID returns a random v4-shaped GUID for the Explore session param.
func newSessionID() string {
	var b [16]byte
	if _, err := crand.Read(b[:]); err != nil {
		// math/rand fallback is fine: this is a cache-busting session id, not a secret.
		return fmt.Sprintf("%08x-worker-session", time.Now().UnixNano())
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// Allow reports whether a token from this client's tier budget is immediately
// available, consuming it if so. Exposed for testing the tier budgets.
func (c *Client) Allow() bool { return c.limiter.Allow() }

// backoff returns the delay before retry attempt `n` (1-based): exponential on
// the base delay plus up to 50% jitter, so concurrent retries de-correlate.
func (c *Client) backoff(n int) time.Duration {
	d := c.baseBackoff << (n - 1)
	jitter := time.Duration(rand.Int63n(int64(d/2 + 1)))
	return d + jitter
}

// endpointGroups maps a call's log label to the coarser group the admin panel
// reports failure rates by (specs/09 §9.4.5). Grouping is deliberate: the two
// thumbnail calls fail for the same reason, and the panel's question is "which
// upstream is degrading", not "which URL". Log labels stay as they are.
var endpointGroups = map[string]string{
	"explore/get-sort-content": "explore",
	"games/games":              "games",
	"games/votes":              "votes",
	"virtual-events/list":      "virtual-events",
	"thumbnails/icons":         "thumbnails",
	"thumbnails/assets":        "thumbnails",
	"rotunnel/game-passes":     "rotunnel-passes",
	"rotunnel/dev-products":    "rotunnel-products",
	"games/creator-games":      "studio-games",
	"groups/get":               "groups-meta",
}

// endpointGroup resolves a label to its group, falling back to the label so a
// newly-added endpoint appears in the panel instead of vanishing from it.
func endpointGroup(endpoint string) string {
	if g, ok := endpointGroups[endpoint]; ok {
		return g
	}
	return endpoint
}

// getJSON gates on the limiter, fetches with retries, decodes into out, and
// records the outcome against this run's telemetry counter (specs/09 §9.6):
// a closed gate is `skipped`, a returned error is `fail`, otherwise `ok`.
func getJSON[T any](ctx context.Context, c *Client, endpoint, url string, out *T) error {
	err := fetchJSON(ctx, c, endpoint, url, out)
	ctr := telemetry.FromContext(ctx)
	group := endpointGroup(endpoint)
	switch {
	case errors.Is(err, ErrRateLimited):
		ctr.Skip(group) // gate shut: never issued, not a failure
	case err != nil:
		ctr.Fail(group)
	default:
		ctr.OK(group)
	}
	return err
}

// fetchJSON is the call itself. Retryable failures (network, 5xx, 429) are
// retried within the budget with backoff; 4xx and decode errors fail
// immediately. Fails soft: the error is returned for the caller to log and
// skip, never panicking the tick.
func fetchJSON[T any](ctx context.Context, c *Client, endpoint, url string, out *T) error {
	// Gate on this client's private tier budget. Because critical and enrich are
	// independent pools, an exhausted enrich budget skips enrich calls without
	// ever touching the critical path's reserved tokens (§1.0).
	if !c.limiter.Allow() {
		c.log.Warn("roblox skip: tier budget spent", "endpoint", endpoint, "tier", c.tier)
		return ErrRateLimited
	}
	var last error
	for attempt := 0; attempt <= c.maxRetries; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(c.backoff(attempt)):
			}
		}
		retryable, err := doOnce(ctx, c, endpoint, url, out)
		if err == nil {
			return nil
		}
		last = err
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if !retryable {
			return err
		}
	}
	return fmt.Errorf("roblox %s: retries exhausted: %w", endpoint, last)
}

// doOnce performs a single request/decode. Returns (retryable, err).
func doOnce[T any](ctx context.Context, c *Client, endpoint, url string, out *T) (bool, error) {
	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("User-Agent", UserAgent)
	// Public/unofficial endpoints: no auth token is ever sent.

	resp, err := c.http.Do(req)
	if err != nil {
		c.log.Warn("roblox call failed", "endpoint", endpoint, "latency_ms", time.Since(start).Milliseconds(), "err", err)
		return true, err // network error → retryable
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	lat := time.Since(start).Milliseconds()
	c.log.Info("roblox call", "endpoint", endpoint, "status", resp.StatusCode, "latency_ms", lat, "bytes", len(body))
	if err != nil {
		return true, fmt.Errorf("read body: %w", err)
	}
	switch {
	case resp.StatusCode == 429 || resp.StatusCode >= 500:
		return true, fmt.Errorf("status %d", resp.StatusCode)
	case resp.StatusCode >= 400:
		return false, fmt.Errorf("status %d", resp.StatusCode)
	}
	if err := decodeJSON(body, out); err != nil {
		return false, fmt.Errorf("decode %s: %w", endpoint, err)
	}
	return false, nil
}
