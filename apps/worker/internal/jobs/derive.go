package jobs

import (
	"context"
	"log/slog"
	"time"
)

// TrendDriftMinRising is the confirmation-rule threshold: a tag needs at least
// this many rising carriers to surface as a direction (specs/02 §2.3).
const TrendDriftMinRising = 3

// deriveJob triggers the per-game signal derivation every tick (specs/02 §2.1)
// and emits stage-change lifecycle events (§2.2). It TRIGGERS SQL only — the
// slope/spike/trough math and classification run in Postgres; nothing about the
// raw series enters worker memory. Any aggregation here would be a bug.
//
// It runs after snapshot in the tick so it sees this tick's fresh metrics, and
// is idempotent on (universe_id, computed_at).
type deriveJob struct{ d Deps }

func (j *deriveJob) Name() string { return "derive" }

func (j *deriveJob) Run(ctx context.Context, tick uint64) error {
	if j.d.Store == nil {
		slog.Warn("derive skipped: no store")
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	computedAt := time.Now().UTC()

	stats, err := j.d.Store.DeriveStats(ctx, computedAt)
	if err != nil {
		return err
	}
	changes, err := j.d.Store.EmitLifecycleChanges(ctx, computedAt)
	if err != nil {
		slog.Warn("derive: lifecycle emit failed", "err", err)
	}
	slog.Info("derive done", "tick", tick, "stats_rows", stats, "lifecycle_changes", changes)
	return nil
}

// trendDriftJob runs the daily confirmation-rule query (§2.3). The multi-game +
// growth rule is enforced in SQL; this job only triggers it and logs the
// confirmed directions (there is no trend table in the schema to persist to).
type trendDriftJob struct{ d Deps }

func (j *trendDriftJob) Name() string { return "trend-drift" }

func (j *trendDriftJob) Run(ctx context.Context, tick uint64) error {
	if j.d.Store == nil {
		slog.Warn("trend-drift skipped: no store")
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 1*time.Minute)
	defer cancel()

	rows, err := j.d.Store.TrendDrift(ctx, TrendDriftMinRising)
	if err != nil {
		return err
	}
	for _, r := range rows {
		slog.Info("trend confirmed", "axis", r.Axis, "slug", r.Slug,
			"rising_carriers", r.RisingCarriers, "total_carriers", r.TotalCarriers)
	}
	slog.Info("trend-drift done", "tick", tick, "confirmed", len(rows), "min_rising", TrendDriftMinRising)
	return nil
}
