// Command worker is the monkyesuite scraper + derive orchestrator (Railway).
//
// A single persistent process driving all scheduled scraping and derivation on
// one tiered tick loop (see specs/01-ingestion.md). Go is deliberate: the fetch
// fan-out is I/O-concurrency-bound; all aggregation stays in Postgres.
//
// This is the scaffold entrypoint — the tick loop is wired but every job is a
// no-op placeholder until phase 01 lands.
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"monkyesuite/worker/internal/jobs"
	"monkyesuite/worker/internal/sched"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(log)

	// Cancel the whole loop on SIGINT/SIGTERM (Railway sends SIGTERM on deploy).
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// DATABASE_URL is the SERVICE role (RLS bypass) — the worker writes only
	// global scraped tables. Read here so a misconfig fails fast at boot; the
	// pgx pool is wired in phase 01 via internal/store.
	if os.Getenv("DATABASE_URL") == "" {
		slog.Warn("DATABASE_URL is unset; store writes will be skipped (scaffold)")
	}

	loop := sched.New(jobs.Default())
	slog.Info("worker starting", "interval", sched.TickInterval.String())

	if err := loop.Run(ctx); err != nil && ctx.Err() == nil {
		slog.Error("worker exited with error", "err", err)
		os.Exit(1)
	}
	slog.Info("worker stopped")
}
