// Package runner is the shared bootstrap for the per-job cron entrypoints in
// cmd/. Each entrypoint calls Run with a name and a callback that receives a
// prepared *Env; the callback runs one Job (or a chain of them) and returns.
//
// Owned here so a job never re-implements: signal-driven ctx, OTEL init +
// shutdown flush, store connect, Roblox/YouTube/Trends clients, per-job span,
// job_runs recording, and a deadline shorter than the wall-clock tick so a
// cron process never overruns its slot.
package runner

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"monkyesuite/worker/internal/jobs"
	wotel "monkyesuite/worker/internal/otel"
	"monkyesuite/worker/internal/roblox"
	"monkyesuite/worker/internal/sched"
	"monkyesuite/worker/internal/store"
	"monkyesuite/worker/internal/telemetry"
	"monkyesuite/worker/internal/trends"
	"monkyesuite/worker/internal/youtube"
)

// Env is the prepared collaborators passed to the callback. Only fields the
// job actually needs; nil-safe for optional integrations (YouTube, Trends).
type Env struct {
	Ctx     context.Context
	Deps    jobs.Deps
	Store   *store.Store // Deps.Store, hoisted for readability
	Log     *slog.Logger
	StartAt time.Time
}

// Config lets each entrypoint tune the run without duplicating env parsing.
type Config struct {
	// Name is the job name — appears in logs, spans, and the job_runs row.
	Name string
	// Deadline is the hard cap for the job callback. Defaults to 4m — one
	// under the 5-min cron cadence so a stalled process yields before the
	// next cron fires. Set explicitly for longer-running jobs (enrich).
	Deadline time.Duration
	// NeedsStore true = fail closed when DATABASE_URL is unset. Every job
	// writes something, so keep this true; the flag exists so a smoke-test
	// entrypoint could opt out later.
	NeedsStore bool
}

// Run wires the whole bootstrap, calls the callback, then flushes telemetry
// and exits. Errors surface as non-zero exit codes so Railway marks the cron
// run as failed and the alert fires.
func Run(cfg Config, fn func(*Env) error) {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(log)
	if cfg.Deadline == 0 {
		cfg.Deadline = 4 * time.Minute
	}

	root, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	shutdownOtel, err := wotel.Init(root)
	if err != nil {
		slog.Warn("otel init failed; continuing without telemetry", "err", err)
	}
	defer func() {
		if err := shutdownOtel(context.Background()); err != nil {
			slog.Warn("otel shutdown", "err", err)
		}
	}()

	var st *store.Store
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		s, err := store.New(root, dsn)
		if err != nil {
			slog.Error("store connect failed", "err", err)
			os.Exit(1)
		}
		defer s.Close()
		st = s
	} else if cfg.NeedsStore {
		slog.Error("DATABASE_URL required but unset")
		os.Exit(1)
	} else {
		slog.Warn("DATABASE_URL unset; running without store")
	}

	client := roblox.New(roblox.WithLogger(log))
	yt := youtube.New(os.Getenv("YOUTUBE_API_KEY"), youtube.WithLogger(log))
	var tr *trends.Client
	if os.Getenv("TRENDS_ENABLED") != "false" {
		tr = trends.New(trends.WithLogger(log))
	}

	deps := jobs.Deps{Client: client, Store: st, Youtube: yt, Trends: tr}

	// One deadline bounds every callback so a broken outbound never eats the
	// full container lifetime; the caller keeps the cron slot free.
	runCtx, cancel := context.WithTimeout(root, cfg.Deadline)
	defer cancel()

	env := &Env{
		Ctx:     runCtx,
		Deps:    deps,
		Store:   st,
		Log:     log,
		StartAt: time.Now().UTC(),
	}

	slog.Info("cron start", "job", cfg.Name, "deadline", cfg.Deadline.String())
	if err := fn(env); err != nil {
		slog.Error("cron failed", "job", cfg.Name, "err", err)
		os.Exit(1)
	}
	slog.Info("cron done", "job", cfg.Name, "duration_ms", time.Since(env.StartAt).Milliseconds())
}

// RunJob is a convenience for entrypoints that run a single sched.Job. Emits
// the same OTEL span + job_runs row as the loop would, so per-cron and
// per-loop history line up 1:1 in the admin panel and in Grafana.
//
// tick is passed for span/log parity — for cron runs it's always 0 (there is
// no tick concept), which the recorder tolerates.
func RunJob(env *Env, j sched.Job) error {
	ctr := telemetry.NewCounter()
	spanCtx, span := wotel.StartJobSpan(env.Ctx, j.Name(), 0)
	runCtx := telemetry.WithCounter(spanCtx, ctr)

	started := time.Now().UTC()
	res, err := j.Run(runCtx, 0)
	finished := time.Now().UTC()

	status := "ok"
	switch {
	case err != nil:
		status = "error"
	case res.Skipped:
		status = "skipped"
	}
	durMs := finished.Sub(started).Milliseconds()
	wotel.RecordJobRun(spanCtx, j.Name(), status, durMs, int64(res.RowsWritten))
	for name, v := range res.Metrics {
		if n, ok := metricInt(v); ok {
			wotel.RecordCounter(spanCtx, j.Name(), name, n)
		}
	}
	wotel.EndJobSpan(span, status, err)

	// Record to job_runs so the admin panel keeps showing history for
	// cron-mode runs. Tolerates a nil store — a smoke run without the DB
	// still emits OTEL, just no admin history.
	if env.Store != nil {
		run := sched.Run{
			Job:         j.Name(),
			Tick:        0,
			Tier:        sched.TierOf(j),
			StartedAt:   started,
			FinishedAt:  finished,
			DurationMs:  int(durMs),
			Status:      status,
			RowsWritten: res.RowsWritten,
			Metrics:     ctr.Fold(res.Metrics),
		}
		if err != nil {
			run.Error = err.Error()
		}
		wctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if rerr := env.Store.RecordJobRun(wctx, run); rerr != nil {
			slog.Warn("record run failed", "job", j.Name(), "err", rerr)
		}
	}
	return err
}

// metricInt matches the sched package's coercion so the OTEL counter values
// are consistent between loop and cron paths. Duplicated intentionally —
// exporting a helper across two packages that only need it locally is worse
// than a five-line switch.
func metricInt(v any) (int64, bool) {
	switch n := v.(type) {
	case int:
		return int64(n), true
	case int64:
		return n, true
	case int32:
		return int64(n), true
	case uint64:
		return int64(n), true
	case float64:
		return int64(n), true
	}
	return 0, false
}
