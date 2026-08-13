// Package jobs holds the scheduled scraping units: discover, snapshot, events
// (every tick) and enrich (~daily). See specs/01-ingestion.md.
//
// Each job fetches through internal/roblox (a bounded goroutine pool under a
// shared limiter) and writes through internal/store (pgx). Aggregation stays in
// Postgres — jobs land raw only. Every job guards itself with a context deadline
// shorter than the tick interval so a tick never overruns the next (§1.5), fails
// soft, and is idempotent (natural keys make a re-run a no-op).
package jobs

import (
	"monkyesuite/worker/internal/roblox"
	"monkyesuite/worker/internal/sched"
	"monkyesuite/worker/internal/store"
	"monkyesuite/worker/internal/trends"
	"monkyesuite/worker/internal/youtube"
)

// Deps are the shared collaborators every job needs. Youtube/Trends are only
// used by the daily demand job and may be nil (unconfigured → demand skips).
type Deps struct {
	Client  *roblox.Client
	Store   *store.Store
	Youtube *youtube.Client
	Trends  *trends.Client
}

// Default wires the registry to the tiered cadence with real jobs. discover is a
// separate registry entry from snapshot so a discover outage can't fail snapshot
// (§1.5) — the loop logs each job's error independently.
func Default(d Deps) sched.Registry {
	return sched.Registry{
		EveryTick: []sched.Job{
			&discoverJob{d},
			&snapshotJob{d, newSeenSet()},
			&eventsJob{d},
			// derive runs AFTER snapshot so it sees this tick's fresh metrics;
			// it triggers SQL only (aggregation stays in Postgres, specs/02).
			&deriveJob{d},
		},
		EveryDay: []sched.Job{
			&enrichJob{d: d, client: enrichClient(d.Client)},
			&trendDriftJob{d},
			// demand snapshots off-platform interest (YouTube + Trends) daily;
			// skips itself if no YouTube client is configured.
			&demandJob{d: d},
		},
	}
}

// enrichClient derives the enrich-budget view of the shared client (shares the
// ceiling, adds the sub-budget). Nil-safe for the no-client scaffold path.
func enrichClient(c *roblox.Client) *roblox.Client {
	if c == nil {
		return nil
	}
	return c.ForEnrich()
}

// chunk splits s into contiguous slices of at most size. The snapshot job uses
// it to hold games/votes requests to GamesBatchLimit (50) ids each.
func chunk[T any](s []T, size int) [][]T {
	if size <= 0 || len(s) == 0 {
		return nil
	}
	out := make([][]T, 0, (len(s)+size-1)/size)
	for i := 0; i < len(s); i += size {
		end := i + size
		if end > len(s) {
			end = len(s)
		}
		out = append(out, s[i:end])
	}
	return out
}

// missingFrom returns the ids in tracked that are absent from seen — the
// set-difference carry-forward is built on. A game missing from a snapshot tick
// gets its last metric re-inserted so velocity reads 0, not a fake spike (§1.2).
func missingFrom(tracked []int64, seen map[int64]struct{}) []int64 {
	var out []int64
	for _, id := range tracked {
		if _, ok := seen[id]; !ok {
			out = append(out, id)
		}
	}
	return out
}
