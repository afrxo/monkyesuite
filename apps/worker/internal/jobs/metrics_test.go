package jobs

import (
	"context"
	"testing"

	"monkyesuite/worker/internal/sched"
)

// requiredMetricKeys is the per-job contract from specs/09 §9.6. The admin
// panels index straight into these keys — snapshot's carried/tracked IS the
// carry-forward rate on §9.4.1 — so a job that stops emitting one silently
// blanks a panel. This table is what keeps that from happening quietly.
var requiredMetricKeys = map[string][]string{
	"discover":    {"sortsOk", "sortsFailed", "gamesSeen", "newGames"},
	"snapshot":    {"tracked", "real", "carried"},
	"events":      {"bucket", "gamesPolled", "eventsUpserted"},
	"enrich":      {"claimed", "done", "failed", "byKindDone", "byKindFail"},
	"derive":      {"statsRows", "lifecycleEvents"},
	"trend-drift": {"confirmed", "minRising"},
	"demand":      {"terms", "ytQuotaUsed"},
}

// sharedMetricKeys ride on every row, added by the scheduler from the run's call
// counter (§9.6 "all jobs").
var sharedMetricKeys = []string{"callsIssued", "callsSkipped", "endpoints"}

// TestEveryJobEmitsItsRequiredMetrics runs the real registry with empty Deps.
// Every job then takes its no-store early return — which is exactly the path
// worth pinning: a job must emit its full key set even when it does nothing, so
// a panel never has to distinguish "key absent" from "value zero".
func TestEveryJobEmitsItsRequiredMetrics(t *testing.T) {
	reg := Default(Deps{})
	all := append(append([]sched.Job{}, reg.EveryTick...), reg.EveryDay...)
	all = append(all, reg.EveryHour...)

	seen := map[string]bool{}
	for _, j := range all {
		name := j.Name()
		seen[name] = true
		want, ok := requiredMetricKeys[name]
		if !ok {
			t.Errorf("job %q has no §9.6 metrics contract — add one", name)
			continue
		}
		res, err := j.Run(context.Background(), 0)
		if err != nil {
			t.Errorf("%s: unexpected error with empty deps: %v", name, err)
			continue
		}
		if !res.Skipped {
			t.Errorf("%s: want Skipped=true with no store (the credentials panel reads this)", name)
		}
		for _, k := range want {
			if _, present := res.Metrics[k]; !present {
				t.Errorf("%s: metrics missing required key %q", name, k)
			}
		}
	}
	for name := range requiredMetricKeys {
		if name != DrainJobName && !seen[name] {
			t.Errorf("contract names job %q, but it is not registered", name)
		}
	}
}

// TestSnapshotMetricsCarryForwardShape pins the numbers behind the primary
// data-quality signal (§9.4.1). carried/tracked is the carry-forward rate; real
// + carried should account for every tracked game on a healthy tick.
func TestSnapshotMetricsCarryForwardShape(t *testing.T) {
	m := snapshotMetrics(120, 118, 2)
	if m["tracked"] != 120 || m["real"] != 118 || m["carried"] != 2 {
		t.Fatalf("snapshot metrics = %v", m)
	}
	// The alert case the panel turns red on: everything carried, nothing real.
	blind := snapshotMetrics(120, 0, 120)
	if blind["real"] != 0 || blind["carried"] != 120 {
		t.Fatalf("total-carry-forward case = %v", blind)
	}
}

// TestEnrichDrainTallySplitsByKind: universe failures point at rotunnel, creator
// failures at Studio/Groups, so the queue panel breaks them out (§9.4.2).
func TestEnrichDrainTallySplitsByKind(t *testing.T) {
	var tally drainTally
	tally.record("universe", true)
	tally.record("universe", false)
	tally.record("creator", true)

	c := tally.snapshot()
	if c.claimed != 3 || c.done != 2 || c.failed != 1 {
		t.Fatalf("counts = %+v", c)
	}
	if c.byKindDone["universe"] != 1 || c.byKindFail["universe"] != 1 || c.byKindDone["creator"] != 1 {
		t.Fatalf("per-kind split wrong: done=%v fail=%v", c.byKindDone, c.byKindFail)
	}
	m := enrichMetrics(c)
	for _, k := range requiredMetricKeys["enrich"] {
		if _, ok := m[k]; !ok {
			t.Errorf("enrich metrics missing %q", k)
		}
	}
}

// TestSharedKeysAreTheSchedulersJob documents the split: jobs emit their own
// keys, and the loop folds the call counters on top (proved in sched's tests).
// A job must NOT hand-roll the shared keys, or two writers would disagree.
func TestSharedKeysAreTheSchedulersJob(t *testing.T) {
	res, err := (&snapshotJob{d: Deps{}, seen: newSeenSet()}).Run(context.Background(), 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, k := range sharedMetricKeys {
		if _, present := res.Metrics[k]; present {
			t.Errorf("job set shared key %q itself; the scheduler owns it", k)
		}
	}
}
