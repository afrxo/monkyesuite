// Command demand is the Railway cron entrypoint for the daily demand
// snapshot (YouTube + Trends). YouTube quota is the ceiling; the job
// skips if the key is unset.
package main

import (
	"time"

	"monkyesuite/worker/internal/jobs"
	"monkyesuite/worker/internal/runner"
)

func main() {
	runner.Run(runner.Config{
		Name:       "demand",
		NeedsStore: true,
		Deadline:   20 * time.Minute,
	}, func(env *runner.Env) error {
		return runner.RunJob(env, jobs.NewDemand(env.Deps))
	})
}
