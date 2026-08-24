// Command snapshot is the Railway cron entrypoint for the every-tick data
// path: snapshot lands the raw metrics row per tracked game, then derive
// re-derives game_stats + pulse_stats + cohort + feed_health so the pulse
// feed's hot-path row is fresh before the next tick.
//
// The chain runs in one process so ordering is guaranteed even under Railway
// cron's per-job scheduling (a separate derive cron could race snapshot).
// derive failing does not fail the snapshot run — snapshot is the critical
// path (metrics land), derive degrades gracefully via feed_health.
package main

import (
	"monkyesuite/worker/internal/jobs"
	"monkyesuite/worker/internal/runner"
)

func main() {
	runner.Run(runner.Config{
		Name:       "snapshot",
		NeedsStore: true,
	}, func(env *runner.Env) error {
		if err := runner.RunJob(env, jobs.NewSnapshot(env.Deps)); err != nil {
			return err
		}
		// derive is best-effort — pulse degrades to the previous tick if it
		// fails, but a snapshot success alone is still a good tick.
		if err := runner.RunJob(env, jobs.NewDerive(env.Deps)); err != nil {
			env.Log.Warn("derive failed after successful snapshot", "err", err)
		}
		return nil
	})
}
