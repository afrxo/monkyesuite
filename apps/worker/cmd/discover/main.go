// Command discover is the Railway cron entrypoint for the discover job:
// walks Roblox's sort endpoints, upserts new games, records sort snapshots.
// Isolated from snapshot per specs/01 §1.5 — a discover outage cannot fail
// the snapshot cron.
package main

import (
	"monkyesuite/worker/internal/jobs"
	"monkyesuite/worker/internal/runner"
)

func main() {
	runner.Run(runner.Config{
		Name:       "discover",
		NeedsStore: true,
	}, func(env *runner.Env) error {
		return runner.RunJob(env, jobs.NewDiscover(env.Deps))
	})
}
