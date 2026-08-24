// Command events is the Railway cron entrypoint for the events job. Runs
// less often than snapshot; the event flag on game_metrics only needs the
// bucketed refresh cadence.
package main

import (
	"monkyesuite/worker/internal/jobs"
	"monkyesuite/worker/internal/runner"
)

func main() {
	runner.Run(runner.Config{
		Name:       "events",
		NeedsStore: true,
	}, func(env *runner.Env) error {
		return runner.RunJob(env, jobs.NewEvents(env.Deps))
	})
}
