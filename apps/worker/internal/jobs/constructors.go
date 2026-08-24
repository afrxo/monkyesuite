// Constructors expose each job as a sched.Job so cmd/ entrypoints can wire one
// job without going through the tick-loop registry. Kept in one file so the
// public surface is auditable at a glance.
package jobs

import "monkyesuite/worker/internal/sched"

// NewSnapshot builds the snapshot job. The in-memory seenSet stays for
// parity with the loop; a cron process gets a fresh set per invocation, so
// InsertCreators' ON CONFLICT DO NOTHING carries the dedupe across runs.
func NewSnapshot(d Deps) sched.Job { return &snapshotJob{d: d, seen: newSeenSet()} }

// NewDerive builds the derive job.
func NewDerive(d Deps) sched.Job { return &deriveJob{d: d} }

// NewDiscover builds the discover job.
func NewDiscover(d Deps) sched.Job { return &discoverJob{d: d} }

// NewEvents builds the events job.
func NewEvents(d Deps) sched.Job { return &eventsJob{d: d} }

// NewEnrich builds the enrich job. Uses the enrich-scoped roblox client so
// the cron slot's rate budget is separated from any critical-path fetches.
func NewEnrich(d Deps) sched.Job {
	return &enrichJob{d: d, client: enrichClient(d.Client)}
}

// NewDemand builds the daily demand job (YouTube + Trends).
func NewDemand(d Deps) sched.Job { return &demandJob{d: d} }

// NewIconBackfill builds the daily icon-backfill job.
func NewIconBackfill(d Deps) sched.Job { return &iconBackfillJob{d: d} }

// NewTrendDrift builds the daily trend-drift job.
func NewTrendDrift(d Deps) sched.Job { return &trendDriftJob{d: d} }
