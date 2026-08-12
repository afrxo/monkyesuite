// Package sched drives the tiered tick loop: one timer, several cadences.
//
// From specs/00-overview.md:
//
//	every tick   (5 min):  discover · snapshot · events (bucketed)
//	every 12     (~hourly): hourly rollup · cohort percentiles
//	every 288    (~daily):  enrich fan-out · lift baseline · trend-drift
//
// The loop owns cadence only. Each job guards itself with a context deadline
// shorter than the tick interval so a tick never overruns into the next.
package sched

import (
	"context"
	"log/slog"
	"time"
)

// TickInterval is the base cadence. Everything else is a multiple of it.
const TickInterval = 5 * time.Minute

// Tier multipliers relative to a single tick.
const (
	TicksPerHour = 12  // ~hourly
	TicksPerDay  = 288 // ~daily
)

// Job is a unit of scheduled work. Implementations must respect ctx deadlines
// and fail soft — a job error is logged, never fatal to the loop.
type Job interface {
	Name() string
	Run(ctx context.Context, tick uint64) error
}

// Registry groups jobs by cadence tier.
type Registry struct {
	EveryTick []Job // discover, snapshot, events
	EveryHour []Job // rollups, cohort percentiles
	EveryDay  []Job // enrich, baselines, trend-drift
}

// Loop runs the registered jobs on the tiered cadence. hourTicks/dayTicks are
// the tier moduli; they default to TicksPerHour/TicksPerDay but are overridable
// for local/demo runs (e.g. to fire the daily enrich tier on a warmed-up system
// rather than only at tick 0).
type Loop struct {
	reg       Registry
	interval  time.Duration
	hourTicks uint64
	dayTicks  uint64
}

// New builds a Loop at the default TickInterval and tier moduli.
func New(reg Registry) *Loop {
	return NewWithInterval(reg, TickInterval)
}

// NewWithInterval builds a Loop at a custom base cadence with default tier
// moduli. Used to drive fast ticks in local/demo runs; production uses the
// default 5-minute TickInterval.
func NewWithInterval(reg Registry, interval time.Duration) *Loop {
	if interval <= 0 {
		interval = TickInterval
	}
	return &Loop{reg: reg, interval: interval, hourTicks: TicksPerHour, dayTicks: TicksPerDay}
}

// WithTierTicks overrides the hourly/daily tier moduli (0 = keep default). A
// local/demo affordance only — production keeps 12 / 288.
func (l *Loop) WithTierTicks(hourTicks, dayTicks uint64) *Loop {
	if hourTicks > 0 {
		l.hourTicks = hourTicks
	}
	if dayTicks > 0 {
		l.dayTicks = dayTicks
	}
	return l
}

// Run blocks until ctx is cancelled, firing the appropriate tiers each tick.
// Tick 0 fires immediately; subsequent ticks fire on the interval.
func (l *Loop) Run(ctx context.Context) error {
	ticker := time.NewTicker(l.interval)
	defer ticker.Stop()

	var tick uint64
	l.fire(ctx, tick)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			tick++
			l.fire(ctx, tick)
		}
	}
}

// fire runs the tier(s) due on this tick. Each tier is a superset trigger:
// hourly/daily tiers run in addition to the every-tick jobs.
func (l *Loop) fire(ctx context.Context, tick uint64) {
	l.runAll(ctx, tick, l.reg.EveryTick)
	if l.hourTicks > 0 && tick%l.hourTicks == 0 {
		l.runAll(ctx, tick, l.reg.EveryHour)
	}
	if l.dayTicks > 0 && tick%l.dayTicks == 0 {
		l.runAll(ctx, tick, l.reg.EveryDay)
	}
}

func (l *Loop) runAll(ctx context.Context, tick uint64, js []Job) {
	for _, j := range js {
		if ctx.Err() != nil {
			return
		}
		if err := j.Run(ctx, tick); err != nil {
			slog.Error("job failed", "job", j.Name(), "tick", tick, "err", err)
		}
	}
}
