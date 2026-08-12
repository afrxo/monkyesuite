// Package roblox is the single shared HTTP client for all Roblox calls.
//
// Every outbound call goes through here (specs/01 Step 1.0):
//   1. rate limit first — 60 req / 10s shared limiter; over-limit → skip.
//   2. fetch — User-Agent monkyesuite-worker/1.0, per-request context deadline,
//      exponential backoff + jitter on 5xx/network within a per-tick budget.
//   3. decode into typed structs; reject malformed payloads.
//   4. log endpoint · status · latency · batch size.
// No auth token is ever sent; every call fails soft.
//
// Fan-out is a bounded goroutine pool (errgroup with SetLimit) under the shared
// limiter. Scaffold: config only; the limiter (golang.org/x/time/rate) and pool
// (golang.org/x/sync/errgroup) are wired in phase 01.
package roblox

import "time"

// UserAgent identifies the worker to Roblox on every request.
const UserAgent = "monkyesuite-worker/1.0"

// Rate-limit budget: 60 requests per 10s, shared across all jobs/goroutines.
const (
	RateLimitRequests = 60
	RateLimitWindow   = 10 * time.Second
)

// Client is the shared Roblox HTTP client. Fields are wired in phase 01.
type Client struct {
	// limiter *rate.Limiter
	// http    *http.Client
}

// New returns a scaffold client. Real construction (limiter, http client,
// timeouts) lands with phase 01.
func New() *Client { return &Client{} }
