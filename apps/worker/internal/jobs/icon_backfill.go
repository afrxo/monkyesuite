package jobs

import (
	"context"
	"log/slog"
	"time"

	"monkyesuite/worker/internal/sched"
)

// iconBackfillJob fills games.icon_url for tracked games the discover-time
// prewarm missed (network hiccup, added via seeding/manual, etc.). Pulse reads
// icon_url directly, so a null icon = an empty thumbnail card. Cheap, chunked,
// rate-limited by the shared roblox client. Runs on the daily schedule.
type iconBackfillJob struct{ d Deps }

// IconBackfillBatch is the per-request universeId count for
// thumbnails.roblox.com/v1/games/icons. The endpoint accepts up to ~100 ids
// per call; 50 keeps room for other consumers on the same shared limiter.
const IconBackfillBatch = 50

// IconBackfillCap bounds a single tick's work so a large backlog is drained
// over several days rather than saturating the ceiling in one pass.
const IconBackfillCap = 500

func (j *iconBackfillJob) Name() string { return "icon-backfill" }

func (j *iconBackfillJob) Run(ctx context.Context, tick uint64) (sched.Result, error) {
	if j.d.Store == nil || j.d.Client == nil {
		slog.Warn("icon-backfill skipped: no store or client")
		return sched.Result{Skipped: true, Metrics: iconBackfillMetrics(0, 0)}, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	ids, err := j.d.Store.TrackedWithoutIcon(ctx, IconBackfillCap)
	if err != nil {
		return sched.Result{Metrics: iconBackfillMetrics(0, 0)}, err
	}
	if len(ids) == 0 {
		slog.Info("icon-backfill done", "tick", tick, "candidates", 0, "resolved", 0)
		return sched.Result{Metrics: iconBackfillMetrics(0, 0)}, nil
	}

	resolved := 0
	for _, batch := range chunk(ids, IconBackfillBatch) {
		icons, err := j.d.Client.GetGameIcons(ctx, batch)
		if err != nil {
			slog.Warn("icon-backfill: fetch failed", "err", err, "batch_size", len(batch))
			continue
		}
		if err := j.d.Store.SetIcons(ctx, icons); err != nil {
			slog.Warn("icon-backfill: persist failed", "err", err)
			continue
		}
		resolved += len(icons)
	}
	slog.Info("icon-backfill done", "tick", tick, "candidates", len(ids), "resolved", resolved)
	return sched.Result{RowsWritten: resolved, Metrics: iconBackfillMetrics(len(ids), resolved)}, nil
}

func iconBackfillMetrics(candidates, resolved int) map[string]any {
	return map[string]any{"candidates": candidates, "resolved": resolved}
}
