package sched

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"monkyesuite/worker/internal/telemetry"
)

// fakeJob is a Job whose result and error are set by the test.
type fakeJob struct {
	name  string
	res   Result
	err   error
	calls int
	// onRun lets a job record Roblox calls against the run's counter, the way a
	// real job does through the shared client.
	onRun func(ctx context.Context)
}

func (f *fakeJob) Name() string { return f.name }

func (f *fakeJob) Run(ctx context.Context, tick uint64) (Result, error) {
	f.calls++
	if f.onRun != nil {
		f.onRun(ctx)
	}
	return f.res, f.err
}

// tieredJob adds the optional Tiered interface.
type tieredJob struct {
	fakeJob
	tier string
}

func (t *tieredJob) Tier() string { return t.tier }

// fakeRecorder captures the job_runs rows the loop would write.
type fakeRecorder struct {
	mu     sync.Mutex
	runs   []Run
	pruned []time.Time
}

func (r *fakeRecorder) RecordJobRun(_ context.Context, run Run) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.runs = append(r.runs, run)
	return nil
}

func (r *fakeRecorder) PruneJobRuns(_ context.Context, before time.Time) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.pruned = append(r.pruned, before)
	return 3, nil
}

func (r *fakeRecorder) byJob(name string) []Run {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []Run
	for _, run := range r.runs {
		if run.Job == name {
			out = append(out, run)
		}
	}
	return out
}

// fakeCommander serves a fixed queue of admin commands, then empties.
type fakeCommander struct {
	queue    []Command
	finished map[string]error
}

func (c *fakeCommander) ClaimJobCommand(context.Context) (*Command, error) {
	if len(c.queue) == 0 {
		return nil, nil
	}
	cmd := c.queue[0]
	c.queue = c.queue[1:]
	return &cmd, nil
}

func (c *fakeCommander) FinishJobCommand(_ context.Context, id string, runErr error) error {
	if c.finished == nil {
		c.finished = map[string]error{}
	}
	c.finished[id] = runErr
	return nil
}

// TestEveryJobRecordsARun is the telemetry contract (specs/09 §9.6): ok, error
// and skipped runs all leave exactly one row. A missing row is indistinguishable
// from a job that never ran, so "no row on failure" would be the worst case.
func TestEveryJobRecordsARun(t *testing.T) {
	ok := &fakeJob{name: "ok-job", res: Result{RowsWritten: 7, Metrics: map[string]any{"tracked": 12}}}
	bad := &fakeJob{name: "bad-job", err: errors.New("boom")}
	skip := &fakeJob{name: "skip-job", res: Result{Skipped: true}}

	rec := &fakeRecorder{}
	l := New(Registry{EveryTick: []Job{ok, bad, skip}}).WithRecorder(rec)
	l.fire(context.Background(), 5)

	if len(rec.runs) != 3 {
		t.Fatalf("want 3 job_runs rows, got %d", len(rec.runs))
	}
	want := map[string]string{"ok-job": "ok", "bad-job": "error", "skip-job": "skipped"}
	for _, run := range rec.runs {
		if got := want[run.Job]; run.Status != got {
			t.Errorf("%s: status = %q, want %q", run.Job, run.Status, got)
		}
		if run.Tick != 5 {
			t.Errorf("%s: tick = %d, want 5", run.Job, run.Tick)
		}
		if run.Tier != TierCritical {
			t.Errorf("%s: tier = %q, want %q", run.Job, run.Tier, TierCritical)
		}
		if run.StartedAt.IsZero() || run.FinishedAt.IsZero() {
			t.Errorf("%s: timestamps not stamped", run.Job)
		}
		// The shared call counters are on every row, whether or not the job made
		// a call — a panel query must never have to handle their absence.
		for _, k := range []string{"callsIssued", "callsSkipped", "endpoints"} {
			if _, present := run.Metrics[k]; !present {
				t.Errorf("%s: metrics missing %q", run.Job, k)
			}
		}
	}

	errRun := rec.byJob("bad-job")[0]
	if !strings.Contains(errRun.Error, "boom") {
		t.Errorf("error not recorded: %q", errRun.Error)
	}
	okRun := rec.byJob("ok-job")[0]
	if okRun.RowsWritten != 7 {
		t.Errorf("rowsWritten = %d, want 7", okRun.RowsWritten)
	}
	if okRun.Metrics["tracked"] != 12 {
		t.Errorf("job metrics not preserved: %v", okRun.Metrics)
	}
}

// TestRunRecordsCallCounters asserts the loop folds the run's Roblox call
// outcomes into its metrics — the source for the admin limiter and
// gated-endpoint panels (§9.4.3, §9.4.5).
func TestRunRecordsCallCounters(t *testing.T) {
	j := &fakeJob{name: "caller", onRun: func(ctx context.Context) {
		c := telemetry.FromContext(ctx)
		c.OK("games")
		c.OK("games")
		c.Fail("rotunnel-passes")
		c.Skip("votes")
	}}
	rec := &fakeRecorder{}
	New(Registry{EveryTick: []Job{j}}).WithRecorder(rec).fire(context.Background(), 1)

	m := rec.runs[0].Metrics
	if m["callsIssued"] != 3 {
		t.Errorf("callsIssued = %v, want 3 (2 ok + 1 fail; a skip was never issued)", m["callsIssued"])
	}
	if m["callsSkipped"] != 1 {
		t.Errorf("callsSkipped = %v, want 1", m["callsSkipped"])
	}
	eps, ok := m["endpoints"].(map[string]telemetry.EndpointStat)
	if !ok {
		t.Fatalf("endpoints has wrong type: %T", m["endpoints"])
	}
	if eps["games"].OK != 2 || eps["rotunnel-passes"].Fail != 1 || eps["votes"].Skipped != 1 {
		t.Errorf("endpoint tallies wrong: %+v", eps)
	}
}

// TestTierIsRecorded covers the split the limiter panel depends on: enrich-tier
// consumption must be attributable separately from the critical path (§9.4.3).
func TestTierIsRecorded(t *testing.T) {
	enrich := &tieredJob{fakeJob: fakeJob{name: "enrich"}, tier: TierEnrich}
	rec := &fakeRecorder{}
	New(Registry{EveryTick: []Job{enrich}}).WithRecorder(rec).fire(context.Background(), 0)

	if got := rec.runs[0].Tier; got != TierEnrich {
		t.Fatalf("tier = %q, want %q", got, TierEnrich)
	}
}

// TestCommandDrainRunsNamedJob covers the admin manual trigger (§9.5): the panel
// cannot run a job, it enqueues a row and the worker runs it here — recording a
// job_runs row like any other run, and closing the command out as done.
func TestCommandDrainRunsNamedJob(t *testing.T) {
	target := &fakeJob{name: "derive"}
	daily := &fakeJob{name: "trend-drift"}
	cmd := &fakeCommander{queue: []Command{{ID: "c1", Kind: "run_job", Job: "trend-drift"}}}
	rec := &fakeRecorder{}

	// tick 1 with default moduli: the daily tier does NOT fire, so the only way
	// trend-drift runs is the command.
	New(Registry{EveryTick: []Job{target}, EveryDay: []Job{daily}}).
		WithRecorder(rec).WithCommander(cmd).
		fire(context.Background(), 1)

	if daily.calls != 1 {
		t.Fatalf("commanded job ran %d times, want 1", daily.calls)
	}
	if len(rec.byJob("trend-drift")) != 1 {
		t.Errorf("commanded run left no job_runs row")
	}
	if err, done := cmd.finished["c1"]; !done || err != nil {
		t.Errorf("command not closed out cleanly: done=%v err=%v", done, err)
	}
}

// TestCommandFailuresPropagate: a failing job fails its command, and an unknown
// job name fails rather than vanishing.
func TestCommandFailuresPropagate(t *testing.T) {
	bad := &fakeJob{name: "snapshot", err: errors.New("db down")}
	cmd := &fakeCommander{queue: []Command{
		{ID: "c1", Kind: "run_job", Job: "snapshot"},
		{ID: "c2", Kind: "run_job", Job: "not-a-job"},
	}}
	New(Registry{EveryTick: []Job{bad}}).
		WithRecorder(&fakeRecorder{}).WithCommander(cmd).
		fire(context.Background(), 3)

	if err := cmd.finished["c1"]; err == nil || !strings.Contains(err.Error(), "db down") {
		t.Errorf("failed job did not fail its command: %v", err)
	}
	if err := cmd.finished["c2"]; !errors.Is(err, ErrUnknownJob) {
		t.Errorf("unknown job did not fail its command: %v", err)
	}
}

// TestCommandDrainIsBounded: a flooded queue can't push a tick into the next.
func TestCommandDrainIsBounded(t *testing.T) {
	j := &fakeJob{name: "derive"}
	var queue []Command
	for i := 0; i < maxCommandsPerTick+5; i++ {
		queue = append(queue, Command{ID: "c", Kind: "run_job", Job: "derive"})
	}
	cmd := &fakeCommander{queue: queue}
	New(Registry{EveryTick: []Job{j}}).WithRecorder(&fakeRecorder{}).WithCommander(cmd).
		fire(context.Background(), 1)

	// maxCommandsPerTick commanded runs + the one scheduled every-tick run.
	if want := maxCommandsPerTick + 1; j.calls != want {
		t.Fatalf("ran %d times, want %d (drain bounded per tick)", j.calls, want)
	}
}

// TestPruneRunsOnDailyTierOnly covers the 14-day retention (§9.6).
func TestPruneRunsOnDailyTierOnly(t *testing.T) {
	rec := &fakeRecorder{}
	l := New(Registry{EveryTick: []Job{&fakeJob{name: "snapshot"}}}).WithRecorder(rec)

	l.fire(context.Background(), 1) // not a daily tick
	if len(rec.pruned) != 0 {
		t.Fatalf("pruned off the daily tier")
	}
	l.fire(context.Background(), TicksPerDay)
	if len(rec.pruned) != 1 {
		t.Fatalf("daily tier did not prune")
	}
	cutoff := time.Since(rec.pruned[0])
	if cutoff < JobRunRetention-time.Minute || cutoff > JobRunRetention+time.Minute {
		t.Errorf("prune cutoff %v, want ~%v", cutoff, JobRunRetention)
	}
}

// TestNoRecorderStillRuns: telemetry is observation, never a dependency — a
// worker with no database must still tick.
func TestNoRecorderStillRuns(t *testing.T) {
	j := &fakeJob{name: "snapshot"}
	New(Registry{EveryTick: []Job{j}}).fire(context.Background(), 1)
	if j.calls != 1 {
		t.Fatalf("job did not run without a recorder")
	}
}
