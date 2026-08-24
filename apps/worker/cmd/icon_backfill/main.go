// Command icon_backfill fills games.icon_url for tracked games discover
// missed. Runs hourly.
package main

import (
	"monkyesuite/worker/internal/jobs"
	"monkyesuite/worker/internal/runner"
)

func main() {
	runner.Run(runner.Config{
		Name:       "icon_backfill",
		NeedsStore: true,
	}, func(env *runner.Env) error {
		return runner.RunJob(env, jobs.NewIconBackfill(env.Deps))
	})
}
