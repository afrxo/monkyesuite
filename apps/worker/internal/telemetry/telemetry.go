// Package telemetry counts the Roblox calls one job run makes, so the admin
// panel can read from Postgres what the worker did (specs/09 §9.4.3, §9.4.5).
//
// The counters ride on the context rather than on the client: several jobs share
// one *roblox.Client, so the client cannot attribute a call to a run, but the
// context a job passes down its fan-out can. The scheduler puts a fresh Counter
// in the context before each run and folds the totals into that run's metrics.
//
// Every method is nil-safe: a job invoked without a counter in its context (a
// test, a manual call) records nothing instead of panicking.
package telemetry

import (
	"context"
	"sync"
)

// EndpointStat is one endpoint group's outcome tally for a single run.
// `Skipped` is the rate-limit gate closing — not an error, and the number that
// distinguishes an exhausted budget from a broken endpoint.
type EndpointStat struct {
	OK      int `json:"ok"`
	Fail    int `json:"fail"`
	Skipped int `json:"skipped"`
}

// Counter accumulates one run's call outcomes. Safe for concurrent use: the
// fan-out pools call into it from many goroutines at once.
type Counter struct {
	mu        sync.Mutex
	issued    int
	skipped   int
	endpoints map[string]*EndpointStat
}

// NewCounter returns an empty counter.
func NewCounter() *Counter {
	return &Counter{endpoints: map[string]*EndpointStat{}}
}

// OK records a call that was issued and succeeded.
func (c *Counter) OK(group string) { c.record(group, func(s *EndpointStat) { s.OK++ }, true) }

// Fail records a call that was issued and failed (after its retry budget).
func (c *Counter) Fail(group string) { c.record(group, func(s *EndpointStat) { s.Fail++ }, true) }

// Skip records a call never issued because the tier's rate-limit gate was shut.
func (c *Counter) Skip(group string) { c.record(group, func(s *EndpointStat) { s.Skipped++ }, false) }

func (c *Counter) record(group string, f func(*EndpointStat), issued bool) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.endpoints == nil {
		c.endpoints = map[string]*EndpointStat{}
	}
	s, ok := c.endpoints[group]
	if !ok {
		s = &EndpointStat{}
		c.endpoints[group] = s
	}
	f(s)
	if issued {
		c.issued++
	} else {
		c.skipped++
	}
}

// Fold writes this run's call counters into a job's metrics map under the keys
// every job_runs row carries (§9.6): callsIssued, callsSkipped, endpoints.
// A nil counter still writes zeroed keys — the contract is that the keys are
// always present, so a panel query never has to handle their absence.
func (c *Counter) Fold(m map[string]any) map[string]any {
	if m == nil {
		m = map[string]any{}
	}
	if c == nil {
		m["callsIssued"] = 0
		m["callsSkipped"] = 0
		m["endpoints"] = map[string]EndpointStat{}
		return m
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	eps := make(map[string]EndpointStat, len(c.endpoints))
	for k, v := range c.endpoints {
		eps[k] = *v
	}
	m["callsIssued"] = c.issued
	m["callsSkipped"] = c.skipped
	m["endpoints"] = eps
	return m
}

type ctxKey struct{}

// WithCounter returns a context carrying c, so every Roblox call made under it
// is attributed to this run.
func WithCounter(ctx context.Context, c *Counter) context.Context {
	return context.WithValue(ctx, ctxKey{}, c)
}

// FromContext returns the run's counter, or nil (whose methods are no-ops).
func FromContext(ctx context.Context) *Counter {
	c, _ := ctx.Value(ctxKey{}).(*Counter)
	return c
}
