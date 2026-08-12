// Package jobs holds the scheduled scraping/derive units: discover, snapshot,
// events (every tick), and enrich (~daily). See specs/01-ingestion.md.
//
// These are scaffold no-ops: they log and return. Real implementations fetch
// through internal/roblox (bounded goroutine pool under a shared limiter) and
// write through internal/store (pgx), keeping aggregation in Postgres.
package jobs

import (
	"context"
	"log/slog"

	"monkyesuite/worker/internal/sched"
)

// job is a named placeholder implementing sched.Job.
type job struct {
	name string
}

func (j job) Name() string { return j.name }

func (j job) Run(ctx context.Context, tick uint64) error {
	slog.Info("job tick (scaffold no-op)", "job", j.name, "tick", tick)
	return nil
}

// Default returns the registry wired to the tiered cadence. Discover is
// isolated from snapshot per spec 1.5 once implemented; here they are stubs.
func Default() sched.Registry {
	return sched.Registry{
		EveryTick: []sched.Job{
			job{name: "discover"},
			job{name: "snapshot"},
			job{name: "events"},
		},
		EveryHour: []sched.Job{
			job{name: "rollup"},
		},
		EveryDay: []sched.Job{
			job{name: "enrich"},
		},
	}
}
