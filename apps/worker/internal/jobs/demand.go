package jobs

import (
	"context"
	"log/slog"
	"time"

	"monkyesuite/worker/internal/store"
	"monkyesuite/worker/internal/youtube"
)

// demandLookback is the recency window for the YouTube search (§4.2: 7 days).
const demandLookback = 7 * 24 * time.Hour

// demandJob is the once-per-day off-platform demand ingestion (specs/04 §4.2).
// For each active term it lands a demand_snapshots row: YouTube recent video
// count + aggregate views (the primary lead signal) and a best-effort Google
// Trends score (confirming only).
//
// YouTube quota (10k units/day) is the binding constraint. Terms are consumed in
// the order the store returns them — theme-terms first — so if the budget runs
// out, the deferred remainder is game-terms, snapshotted on the next day (§4.2).
// Trends has no quota and never blocks the snapshot: any Trends failure lands a
// null trendsScore.
type demandJob struct {
	d     Deps
	quota int // YouTube daily unit budget (defaults to youtube.DailyQuota)
}

func (j *demandJob) Name() string { return "demand" }

func (j *demandJob) Run(ctx context.Context, tick uint64) error {
	if j.d.Store == nil {
		slog.Warn("demand skipped: no store")
		return nil
	}
	if j.d.Youtube == nil {
		slog.Warn("demand skipped: no YouTube client (YOUTUBE_API_KEY unset)")
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()

	terms, err := j.d.Store.ActiveDemandTerms(ctx)
	if err != nil {
		return err
	}
	if len(terms) == 0 {
		slog.Info("demand: no active terms", "tick", tick)
		return nil
	}

	// captured_at is the UTC day so the write is idempotent per day (§4.2).
	capturedAt := time.Now().UTC().Truncate(24 * time.Hour)
	since := time.Now().UTC().Add(-demandLookback)

	quota := j.quota
	if quota <= 0 {
		quota = youtube.DailyQuota
	}
	spent := 0
	var snapshotted, deferred int

	for _, t := range terms {
		// Reserve the worst case (search + videos) before spending. If it won't
		// fit, stop: everything after this point is deferred to the next day.
		// Theme-terms sort first, so the deferred tail is game-terms (§4.2).
		if spent+youtube.SearchCost+youtube.VideosCost > quota {
			deferred = len(terms) - snapshotted
			slog.Warn("demand: YouTube quota reached, deferring remaining terms to next day",
				"spent", spent, "quota", quota, "deferred", deferred)
			break
		}

		snap := store.DemandSnapshot{TermID: t.ID, CapturedAt: capturedAt}

		res, err := j.d.Youtube.SearchRecent(ctx, t.Term, since)
		spent += youtube.SearchCost // a failed search still consumes quota
		if err != nil {
			slog.Warn("demand: youtube search failed", "term", t.Term, "err", err)
		} else {
			count := res.VideoCount
			snap.YtVideoCount7d = &count
			if len(res.VideoIDs) > 0 {
				views, verr := j.d.Youtube.VideoViews(ctx, res.VideoIDs)
				spent += youtube.VideosCost
				if verr != nil {
					slog.Warn("demand: youtube videos failed", "term", t.Term, "err", verr)
				} else {
					snap.YtViewDelta7d = &views
				}
			}
		}

		// Trends is confirming-only and flaky — best-effort, never fatal (§4.2).
		if j.d.Trends != nil {
			if score, terr := j.d.Trends.Interest(ctx, t.Term); terr != nil {
				slog.Warn("demand: trends failed (null score)", "term", t.Term, "err", terr)
			} else {
				snap.TrendsScore = &score
			}
		}

		if err := j.d.Store.UpsertDemandSnapshot(ctx, snap); err != nil {
			slog.Warn("demand: snapshot upsert failed", "term", t.Term, "err", err)
			continue
		}
		snapshotted++
	}

	slog.Info("demand done", "tick", tick, "terms", len(terms),
		"snapshotted", snapshotted, "deferred", deferred, "yt_units_spent", spent, "yt_quota", quota)
	return nil
}
