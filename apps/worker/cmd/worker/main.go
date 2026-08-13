// Command worker is the monkyesuite scraper + derive orchestrator (Railway).
//
// A single persistent process driving all scheduled scraping on one tiered tick
// loop (specs/01-ingestion.md). Go is deliberate: the fetch fan-out is
// I/O-concurrency-bound; all aggregation stays in Postgres.
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"monkyesuite/worker/internal/jobs"
	"monkyesuite/worker/internal/roblox"
	"monkyesuite/worker/internal/sched"
	"monkyesuite/worker/internal/store"
	"monkyesuite/worker/internal/trends"
	"monkyesuite/worker/internal/youtube"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(log)

	// Cancel the whole loop on SIGINT/SIGTERM (Railway sends SIGTERM on deploy).
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// DATABASE_URL is the SERVICE role (RLS bypass) — the worker writes only
	// global scraped tables. Absent → run with no store (jobs log and skip).
	var st *store.Store
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		s, err := store.New(ctx, dsn)
		if err != nil {
			slog.Error("store connect failed", "err", err)
			os.Exit(1)
		}
		defer s.Close()
		st = s
		slog.Info("store connected")
	} else {
		slog.Warn("DATABASE_URL unset; jobs will skip DB writes")
	}

	client := roblox.New(roblox.WithLogger(log))

	// Off-platform demand clients (specs/04). YouTube is skipped when its key is
	// unset (yt returns nil); Trends is credential-free but disabled with
	// TRENDS_ENABLED=false since the unofficial endpoint is flaky.
	yt := youtube.New(os.Getenv("YOUTUBE_API_KEY"), youtube.WithLogger(log))
	if yt == nil {
		slog.Warn("YOUTUBE_API_KEY unset; demand job will skip")
	}
	var tr *trends.Client
	if os.Getenv("TRENDS_ENABLED") != "false" {
		tr = trends.New(trends.WithLogger(log))
	}

	reg := jobs.Default(jobs.Deps{Client: client, Store: st, Youtube: yt, Trends: tr})

	// WORKER_TICK_INTERVAL overrides the 5-minute cadence for local/demo runs.
	interval := sched.TickInterval
	if v := os.Getenv("WORKER_TICK_INTERVAL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			interval = d
		} else {
			slog.Warn("bad WORKER_TICK_INTERVAL, using default", "value", v, "err", err)
		}
	}
	loop := sched.NewWithInterval(reg, interval)

	// WORKER_DAY_TICKS / WORKER_HOUR_TICKS override the tier moduli for local/demo
	// runs (e.g. fire the daily enrich tier on a warmed-up system, not only tick 0).
	loop.WithTierTicks(envUint("WORKER_HOUR_TICKS"), envUint("WORKER_DAY_TICKS"))
	slog.Info("worker starting", "interval", interval.String())

	if err := loop.Run(ctx); err != nil && ctx.Err() == nil {
		slog.Error("worker exited with error", "err", err)
		os.Exit(1)
	}
	slog.Info("worker stopped")
}

// envUint parses a small unsigned override from env; 0 (or unset/invalid) means
// "keep the default".
func envUint(key string) uint64 {
	v := os.Getenv(key)
	if v == "" {
		return 0
	}
	n, err := strconv.ParseUint(v, 10, 64)
	if err != nil {
		slog.Warn("ignoring bad env override", "key", key, "value", v, "err", err)
		return 0
	}
	return n
}
