// Command enrich is the Railway cron entrypoint for the enrich fan-out.
// Longer deadline because it drains a queue on its own rate budget — the
// tick loop scheduled it daily; on cron we still bound to 25 minutes so a
// broken outbound doesn't hog the runtime.
package main

import (
	"time"

	"monkyesuite/worker/internal/jobs"
	"monkyesuite/worker/internal/runner"
)

func main() {
	runner.Run(runner.Config{
		Name:       "enrich",
		NeedsStore: true,
		Deadline:   25 * time.Minute,
	}, func(env *runner.Env) error {
		return runner.RunJob(env, jobs.NewEnrich(env.Deps))
	})
}
