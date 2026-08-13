package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"

	"monkyesuite/worker/internal/sched"
)

// Worker telemetry + the admin control plane (specs/09 §9.6).
//
// The worker exposes no HTTP, so these two tables ARE the interface: job_runs is
// what the admin panel reads to know what the worker did, and job_commands is
// the only way anything reaches the worker from outside. Both are global,
// written here as the service role.

// RecordJobRun persists one job execution. Called by the scheduler for every
// run — ok, error and skipped alike.
func (s *Store) RecordJobRun(ctx context.Context, r sched.Run) error {
	metrics, err := json.Marshal(r.Metrics)
	if err != nil {
		// Never lose the run over an unmarshalable counter: land the row with
		// empty metrics rather than nothing at all.
		metrics = []byte(`{}`)
	}
	var finished *time.Time
	if !r.FinishedAt.IsZero() {
		finished = &r.FinishedAt
	}
	var errText *string
	if r.Error != "" {
		errText = &r.Error
	}
	_, err = s.pool.Exec(ctx,
		`insert into job_runs
		   (job, tick, tier, started_at, finished_at, duration_ms, status, rows_written, error, metrics)
		 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		r.Job, int64(r.Tick), r.Tier, r.StartedAt, finished, r.DurationMs,
		r.Status, r.RowsWritten, errText, metrics)
	return err
}

// PruneJobRuns deletes telemetry older than `before` (the 14-day retention in
// specs/09 §9.6). Returns the number of rows removed.
func (s *Store) PruneJobRuns(ctx context.Context, before time.Time) (int64, error) {
	tag, err := s.pool.Exec(ctx, `delete from job_runs where started_at < $1`, before)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// ClaimJobCommand atomically claims the oldest pending admin command with
// FOR UPDATE SKIP LOCKED — the same pattern as the enrich queue, so a second
// worker instance can never run the same manual trigger twice. Returns
// (nil, nil) when nothing is queued.
func (s *Store) ClaimJobCommand(ctx context.Context) (*sched.Command, error) {
	var c sched.Command
	err := s.pool.QueryRow(ctx,
		`update job_commands set status = 'claimed', claimed_at = now()
		 where id = (
		   select id from job_commands
		   where status = 'pending'
		   order by requested_at
		   for update skip locked
		   limit 1)
		 returning id, kind, job`).Scan(&c.ID, &c.Kind, &c.Job)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// FinishJobCommand closes out a claimed command with the outcome of the run it
// requested, so the panel can resolve "queued" into done or failed.
func (s *Store) FinishJobCommand(ctx context.Context, id string, runErr error) error {
	status := "done"
	var errText *string
	if runErr != nil {
		status = "failed"
		msg := runErr.Error()
		errText = &msg
	}
	_, err := s.pool.Exec(ctx,
		`update job_commands set status = $2, finished_at = now(), error = $3 where id = $1`,
		id, status, errText)
	return err
}
