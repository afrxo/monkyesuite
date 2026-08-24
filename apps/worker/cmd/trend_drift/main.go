// Command trend_drift runs the daily confirmation-rule query (§2.3). SQL
// only — no rows persisted; the log line + OTEL counter is the record.
package main

import (
	"monkyesuite/worker/internal/jobs"
	"monkyesuite/worker/internal/runner"
)

func main() {
	runner.Run(runner.Config{
		Name:       "trend_drift",
		NeedsStore: true,
	}, func(env *runner.Env) error {
		return runner.RunJob(env, jobs.NewTrendDrift(env.Deps))
	})
}
