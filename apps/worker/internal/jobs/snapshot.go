package jobs

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"monkyesuite/worker/internal/roblox"
	"monkyesuite/worker/internal/store"
)

// SnapshotConcurrency is the number of batches fetched at once (§1.2: ~10).
const SnapshotConcurrency = 10

// seenSet tracks creators already inserted this process lifetime, so the
// snapshot job only inserts newly-seen creators (§1.2).
type seenSet struct {
	mu  sync.Mutex
	ids map[int64]struct{}
}

func newSeenSet() *seenSet { return &seenSet{ids: map[int64]struct{}{}} }

// markNew returns true if id was not seen before (and records it).
func (s *seenSet) markNew(id int64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.ids[id]; ok {
		return false
	}
	s.ids[id] = struct{}{}
	return true
}

// snapshotJob appends a raw metrics row per tracked game each tick, batching 50
// ids/request at ~10 concurrent, and carries forward any game missing from the
// tick so derivation reads velocity 0 rather than a fabricated spike.
type snapshotJob struct {
	d    Deps
	seen *seenSet
}

func (j *snapshotJob) Name() string { return "snapshot" }

func (j *snapshotJob) Run(ctx context.Context, tick uint64) error {
	if j.d.Store == nil {
		slog.Warn("snapshot skipped: no store")
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()
	now := time.Now().UTC()

	tracked, err := j.d.Store.TrackedUniverseIDs(ctx)
	if err != nil {
		return err
	}
	if len(tracked) == 0 {
		slog.Info("snapshot: no tracked games", "tick", tick)
		return nil
	}

	batches := chunk(tracked, roblox.GamesBatchLimit)
	results := roblox.Fanout(ctx, SnapshotConcurrency, batches,
		func(ctx context.Context, ids []int64) (batchResult, error) {
			games, gerr := j.d.Client.GetGames(ctx, ids)
			votes, verr := j.d.Client.GetVotes(ctx, ids)
			if gerr != nil {
				return batchResult{}, gerr // no games → nothing to land
			}
			if verr != nil {
				slog.Warn("snapshot: votes batch failed (metrics land without votes)", "err", verr)
			}
			return batchResult{games: games, votes: votes}, nil
		})

	var metrics []store.Metric
	var creators []store.Creator
	var metas []store.GameMeta
	seenThisTick := map[int64]struct{}{}

	for i, r := range results {
		if r.Err != nil {
			slog.Warn("snapshot: batch failed, ids skipped to next tick", "batch", i, "err", r.Err)
			continue // a gap is data, not a crash (§1.5)
		}
		voteByID := map[int64]roblox.Votes{}
		for _, v := range r.Value.votes {
			voteByID[v.UniverseID] = v
		}
		for _, g := range r.Value.games {
			seenThisTick[g.UniverseID] = struct{}{}
			raw, _ := json.Marshal(g)
			m := store.Metric{
				UniverseID:     g.UniverseID,
				CapturedAt:     now,
				Playing:        ptr(g.Playing),
				Visits:         ptr(g.Visits),
				FavoritedCount: ptr(g.FavoritedCount),
				Raw:            raw,
			}
			if v, ok := voteByID[g.UniverseID]; ok {
				m.UpVotes = ptr(v.UpVotes)
				m.DownVotes = ptr(v.DownVotes)
			}
			metrics = append(metrics, m)

			if g.Creator.ID != 0 && j.seen.markNew(g.Creator.ID) {
				creators = append(creators, store.Creator{
					CreatorID: g.Creator.ID, Type: g.Creator.Type,
					Name: g.Creator.Name, HasVerifiedBadge: g.Creator.HasVerifiedBadge,
				})
			}
			metas = append(metas, store.GameMeta{
				UniverseID: g.UniverseID, Genre: g.Genre,
				CreatorID: g.Creator.ID, CreatorType: g.Creator.Type, CreatorName: g.Creator.Name,
				Created: g.Created, Updated: g.Updated,
			})
		}
	}

	// Creators must exist before games.creator_id updates (FK).
	if err := j.d.Store.InsertCreators(ctx, creators); err != nil {
		slog.Warn("snapshot: insert creators failed", "err", err)
	}
	if err := j.d.Store.InsertMetrics(ctx, metrics); err != nil {
		return err
	}
	if err := j.d.Store.UpdateGameMeta(ctx, metas); err != nil {
		slog.Warn("snapshot: update game meta failed", "err", err)
	}

	carried := j.carryForward(ctx, tracked, seenThisTick, now)
	slog.Info("snapshot done", "tick", tick, "tracked", len(tracked),
		"fetched", len(seenThisTick), "landed", len(metrics), "carried_forward", carried, "new_creators", len(creators))
	return nil
}

// carryForward re-inserts the last known metric (stamped at `now`) for every
// tracked game missing from this tick, so a gap reads as a flat line rather than
// a fabricated spike (§1.2). Returns the count carried.
func (j *snapshotJob) carryForward(ctx context.Context, tracked []int64, seen map[int64]struct{}, now time.Time) int {
	missing := missingFrom(tracked, seen)
	if len(missing) == 0 {
		return 0
	}
	last, err := j.d.Store.LastMetrics(ctx, missing)
	if err != nil {
		slog.Warn("snapshot: carry-forward lookup failed", "err", err)
		return 0
	}
	var carried []store.Metric
	for _, id := range missing {
		m, ok := last[id]
		if !ok {
			continue // never had a metric — nothing to carry
		}
		m.CapturedAt = now // re-stamp at this tick
		carried = append(carried, m)
	}
	if err := j.d.Store.InsertMetrics(ctx, carried); err != nil {
		slog.Warn("snapshot: carry-forward insert failed", "err", err)
		return 0
	}
	return len(carried)
}

type batchResult struct {
	games []roblox.GameInfo
	votes []roblox.Votes
}

func ptr[T any](v T) *T { return &v }
