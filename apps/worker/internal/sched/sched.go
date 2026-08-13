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
//
// It also owns TELEMETRY (specs/09 §9.6): the loop already wraps every Run and
// catches its error, so it — not each job — stamps one job_runs row per run with
// start/finish/status/error/rows/metrics. One write site means a job added later
// is instrumented by existing, not by remembering.
package sched

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"monkyesuite/worker/internal/telemetry"
)

// TickInterval is the base cadence. Everything else is a multiple of it.
const TickInterval = 5 * time.Minute

// Tier multipliers relative to a single tick.
const (
	TicksPerHour = 12  // ~hourly
	TicksPerDay  = 288 // ~daily
)

// Limiter tiers (specs/01 §1.0). A job's tier is which of the two independent
// token pools its Roblox calls draw from, and it is what lets the admin panel
// tell "the enrich drain saturated its own budget" (fine, by design) from "the
// critical path is losing tokens" (the bug the two-tier split exists to prevent).
const (
	TierCritical = "critical"
	TierEnrich   = "enrich"
)

// JobRunRetention bounds job_runs. ~288 ticks/day × the every-tick jobs × 14
// days is a few tens of thousands of rows — small enough that the admin panel's
// jsonb aggregation stays cheap without a rollup table (specs/09 §9.6).
const JobRunRetention = 14 * 24 * time.Hour

// maxCommandsPerTick bounds the manual-trigger drain so a pile of queued
// commands can't push one tick into the next. The remainder waits a tick.
const maxCommandsPerTick = 4

// Result is what a job reports back for its job_runs row. Metrics carries the
// per-job key contract in specs/09 §9.6 (snapshot's tracked/real/carried,
// derive's statsRows, …); the loop folds the shared Roblox call counters in on
// top of it.
type Result struct {
	RowsWritten int
	Metrics     map[string]any
	// Skipped marks a run that could not proceed because a precondition was
	// missing (no store, no API key) — distinct from a run that did its work and
	// found nothing to do. The admin credentials panel reads exactly that
	// difference: "configured but never used" vs "used and empty".
	Skipped bool
}

// Job is a unit of scheduled work. Implementations must respect ctx deadlines
// and fail soft — a job error is logged and recorded, never fatal to the loop.
type Job interface {
	Name() string
	Run(ctx context.Context, tick uint64) (Result, error)
}

// Tiered is the optional interface a job implements when it draws from a
// non-default limiter pool. Only the enrich drain does; everything else is
// critical-path, so the default needs no ceremony.
type Tiered interface{ Tier() string }

// TierOf reports which limiter pool a job draws from.
func TierOf(j Job) string {
	if t, ok := j.(Tiered); ok {
		return t.Tier()
	}
	return TierCritical
}

// Run is one persisted job execution — the row shape of job_runs.
type Run struct {
	Job         string
	Tick        uint64
	Tier        string
	StartedAt   time.Time
	FinishedAt  time.Time
	DurationMs  int
	Status      string // ok|error|skipped
	RowsWritten int
	Error       string
	Metrics     map[string]any
}

// Recorder persists job telemetry. Implemented by internal/store; nil in runs
// with no database, where the loop degrades to logging only.
type Recorder interface {
	RecordJobRun(ctx context.Context, r Run) error
	PruneJobRuns(ctx context.Context, before time.Time) (int64, error)
}

// Command is a claimed admin request to run a job out of cadence (specs/09 §9.5).
type Command struct {
	ID   string
	Kind string // run_job
	Job  string
}

// Commander is the admin panel → worker channel. The panel cannot run a job:
// the worker owns the loop. The panel inserts a row and the worker claims it
// here, at the top of a tick.
type Commander interface {
	ClaimJobCommand(ctx context.Context) (*Command, error)
	FinishJobCommand(ctx context.Context, id string, runErr error) error
}

// Registry groups jobs by cadence tier.
type Registry struct {
	EveryTick []Job // discover, snapshot, events
	EveryHour []Job // rollups, cohort percentiles
	EveryDay  []Job // enrich, baselines, trend-drift
}

// find returns the registered job with the given name, across all tiers.
func (r Registry) find(name string) Job {
	for _, tier := range [][]Job{r.EveryTick, r.EveryHour, r.EveryDay} {
		for _, j := range tier {
			if j.Name() == name {
				return j
			}
		}
	}
	return nil
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
	rec       Recorder
	cmd       Commander
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

// WithRecorder attaches job_runs persistence. Without it the loop still runs; it
// just leaves no queryable trace (the pre-telemetry behaviour).
func (l *Loop) WithRecorder(r Recorder) *Loop { l.rec = r; return l }

// WithCommander attaches the admin manual-trigger channel.
func (l *Loop) WithCommander(c Commander) *Loop { l.cmd = c; return l }

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
	// Admin-requested runs go first: an operator triggering a job is waiting on
	// it, and going first keeps the manual run inside this tick's budget.
	l.drainCommands(ctx, tick)

	l.runAll(ctx, tick, l.reg.EveryTick)
	if l.hourTicks > 0 && tick%l.hourTicks == 0 {
		l.runAll(ctx, tick, l.reg.EveryHour)
	}
	if l.dayTicks > 0 && tick%l.dayTicks == 0 {
		l.runAll(ctx, tick, l.reg.EveryDay)
		l.pruneJobRuns(ctx)
	}
}

func (l *Loop) runAll(ctx context.Context, tick uint64, js []Job) {
	for _, j := range js {
		if ctx.Err() != nil {
			return
		}
		l.runOne(ctx, tick, j)
	}
}

// runOne executes one job and records exactly one job_runs row for it. Every
// path through here writes a row — ok, error and skipped alike — because a
// missing row is indistinguishable from a job that never ran.
func (l *Loop) runOne(ctx context.Context, tick uint64, j Job) error {
	ctr := telemetry.NewCounter()
	runCtx := telemetry.WithCounter(ctx, ctr)

	started := time.Now().UTC()
	res, err := j.Run(runCtx, tick)
	finished := time.Now().UTC()

	status := "ok"
	switch {
	case err != nil:
		status = "error"
		slog.Error("job failed", "job", j.Name(), "tick", tick, "err", err)
	case res.Skipped:
		status = "skipped"
	}

	run := Run{
		Job:         j.Name(),
		Tick:        tick,
		Tier:        TierOf(j),
		StartedAt:   started,
		FinishedAt:  finished,
		DurationMs:  int(finished.Sub(started).Milliseconds()),
		Status:      status,
		RowsWritten: res.RowsWritten,
		Metrics:     ctr.Fold(res.Metrics),
	}
	if err != nil {
		run.Error = err.Error()
	}
	l.record(ctx, run)
	return err
}

// record persists a run, tolerating a missing recorder. A telemetry write that
// fails is logged and dropped: losing an observation must never fail a tick.
func (l *Loop) record(ctx context.Context, run Run) {
	if l.rec == nil {
		return
	}
	// Detached from the tick's cancellation: a run that ended *because* its
	// context expired must still be able to report that it did.
	wctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	if err := l.rec.RecordJobRun(wctx, run); err != nil {
		slog.Warn("job_runs write failed", "job", run.Job, "tick", run.Tick, "err", err)
	}
}

// drainCommands runs jobs the admin panel queued, marking each done or failed.
// Bounded per tick; an unknown job name fails its command rather than silently
// disappearing.
func (l *Loop) drainCommands(ctx context.Context, tick uint64) {
	if l.cmd == nil {
		return
	}
	for i := 0; i < maxCommandsPerTick; i++ {
		if ctx.Err() != nil {
			return
		}
		c, err := l.cmd.ClaimJobCommand(ctx)
		if err != nil {
			slog.Warn("job_commands claim failed", "err", err)
			return
		}
		if c == nil {
			return // nothing queued
		}
		job := l.reg.find(c.Job)
		if job == nil {
			err = fmt.Errorf("%w: %s", ErrUnknownJob, c.Job)
			slog.Warn("job_commands: unknown job", "job", c.Job, "command", c.ID)
		} else {
			slog.Info("job_commands: manual run", "job", c.Job, "command", c.ID, "tick", tick)
			err = l.runOne(ctx, tick, job)
		}
		if ferr := l.cmd.FinishJobCommand(ctx, c.ID, err); ferr != nil {
			slog.Warn("job_commands finish failed", "command", c.ID, "err", ferr)
		}
	}
}

// ErrUnknownJob is returned when a command names a job that is not registered.
var ErrUnknownJob = errors.New("sched: unknown job")

// pruneJobRuns trims telemetry past the retention window, once a day.
func (l *Loop) pruneJobRuns(ctx context.Context) {
	if l.rec == nil {
		return
	}
	n, err := l.rec.PruneJobRuns(ctx, time.Now().UTC().Add(-JobRunRetention))
	if err != nil {
		slog.Warn("job_runs prune failed", "err", err)
		return
	}
	if n > 0 {
		slog.Info("job_runs pruned", "rows", n, "retention", JobRunRetention.String())
	}
}
