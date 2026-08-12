package jobs

import (
	"context"
	"log/slog"
	"time"

	"monkyesuite/worker/internal/roblox"
	"monkyesuite/worker/internal/store"
)

// discoverJob polls the 9 Explore sorts each tick: upserts new games, records
// each game's best rank + the top-50-per-sort snapshots, and emits debounced
// sort_appearance / sort_exit lifecycle events. Isolated from snapshot (§1.5):
// a panic or error here is recovered/logged and never reaches the snapshot job.
type discoverJob struct{ d Deps }

func (j *discoverJob) Name() string { return "discover" }

func (j *discoverJob) Run(ctx context.Context, tick uint64) (err error) {
	if j.d.Store == nil {
		slog.Warn("discover skipped: no store")
		return nil
	}
	// Discover has the most volatile response shape — recover so a decode panic
	// yields "no discovery this tick" instead of crashing the loop.
	defer func() {
		if r := recover(); r != nil {
			slog.Error("discover recovered from panic", "tick", tick, "panic", r)
			err = nil
		}
	}()

	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	now := time.Now().UTC()

	// Previous sorted set, read before we clear it, so we can diff exits.
	prev, err := j.d.Store.GamesInSort(ctx)
	if err != nil {
		return err
	}

	// Fan out the 9 sorts concurrently under the shared limiter.
	results := roblox.Fanout(ctx, len(roblox.SortCategories), roblox.SortCategories,
		func(ctx context.Context, sortID string) ([]roblox.SortEntry, error) {
			return j.d.Client.GetSortContent(ctx, sortID)
		})

	var seeds []store.GameSeed
	best := map[int64]store.SortPos{}
	var snaps []store.SortSnap
	present := map[int64]struct{}{}
	seedSeen := map[int64]struct{}{}

	for _, r := range results {
		if r.Err != nil {
			slog.Warn("discover sort failed", "sort", roblox.SortCategories[r.Index], "err", r.Err)
			continue
		}
		sortName := roblox.SortCategories[r.Index]
		for i, e := range r.Value {
			if e.IsSponsored {
				continue // skip sponsored (§1.1)
			}
			rank := i + 1 // response order IS the rank
			present[e.UniverseID] = struct{}{}
			if _, ok := seedSeen[e.UniverseID]; !ok {
				seedSeen[e.UniverseID] = struct{}{}
				seeds = append(seeds, store.GameSeed{
					UniverseID: e.UniverseID, RootPlaceID: e.RootPlaceID,
					Name: e.Name, Source: "discover",
				})
			}
			// best = lowest rank across all sorts this tick
			if cur, ok := best[e.UniverseID]; !ok || rank < cur.Rank {
				best[e.UniverseID] = store.SortPos{Sort: sortName, Rank: rank}
			}
			if rank <= 50 { // top-50 per category
				snaps = append(snaps, store.SortSnap{
					UniverseID: e.UniverseID, SortName: sortName, Rank: rank, CapturedAt: now,
				})
			}
		}
	}

	if len(present) == 0 {
		slog.Warn("discover: no games this tick (all sorts failed?)", "tick", tick)
		return nil
	}

	// Must upsert games before FK-bearing writes (sort_snapshots, lifecycle).
	if err := j.d.Store.UpsertGames(ctx, seeds); err != nil {
		return err
	}
	if err := j.d.Store.ApplyBestSorts(ctx, best); err != nil {
		return err
	}
	if err := j.d.Store.InsertSortSnapshots(ctx, snaps); err != nil {
		return err
	}
	if pruned, err := j.d.Store.PruneSortSnapshots(ctx, now.Add(-24*time.Hour)); err != nil {
		slog.Warn("discover: prune failed", "err", err)
	} else if pruned > 0 {
		slog.Info("discover: pruned old sort snapshots", "rows", pruned)
	}

	j.prewarmIcons(ctx, seeds)
	j.emitLifecycle(ctx, prev, present, now)
	slog.Info("discover done", "tick", tick, "games", len(present), "new_seeds", len(seeds), "snapshots", len(snaps))
	return nil
}

// prewarmIcons resolves 150×150 icons for newly-discovered games (batched 50)
// and stores the CDN URL on games.icon_url. Best-effort — a miss is retried next
// time the game is newly seeded.
func (j *discoverJob) prewarmIcons(ctx context.Context, seeds []store.GameSeed) {
	if len(seeds) == 0 {
		return
	}
	ids := make([]int64, len(seeds))
	for i, s := range seeds {
		ids[i] = s.UniverseID
	}
	for _, batch := range chunk(ids, roblox.GamesBatchLimit) {
		icons, err := j.d.Client.GetGameIcons(ctx, batch)
		if err != nil {
			slog.Warn("discover: icon prewarm failed", "err", err)
			continue
		}
		if err := j.d.Store.SetIcons(ctx, icons); err != nil {
			slog.Warn("discover: set icons failed", "err", err)
		}
	}
}

// emitLifecycle diffs the present set against the previous tick's sorted set:
// entries emit sort_appearance (debounced 24h via games.last_sort_seen), exits
// emit sort_exit.
func (j *discoverJob) emitLifecycle(ctx context.Context, prev, present map[int64]struct{}, now time.Time) {
	var entered []int64
	for id := range present {
		if _, was := prev[id]; !was {
			entered = append(entered, id)
		}
	}
	var exited []int64
	for id := range prev {
		if _, still := present[id]; !still {
			exited = append(exited, id)
		}
	}

	var evs []store.LifecycleEvent
	var touched []int64
	if len(entered) > 0 {
		lastSeen, err := j.d.Store.LastSortSeen(ctx, entered)
		if err != nil {
			slog.Warn("discover: last_sort_seen lookup failed", "err", err)
		} else {
			for _, id := range entered {
				if t, ok := lastSeen[id]; ok && now.Sub(t) < 24*time.Hour {
					continue // debounced
				}
				evs = append(evs, store.LifecycleEvent{UniverseID: id, Type: "sort_appearance", DetectedAt: now})
				touched = append(touched, id)
			}
		}
	}
	for _, id := range exited {
		evs = append(evs, store.LifecycleEvent{UniverseID: id, Type: "sort_exit", DetectedAt: now})
	}
	if err := j.d.Store.InsertLifecycleEvents(ctx, evs); err != nil {
		slog.Warn("discover: lifecycle insert failed", "err", err)
		return
	}
	if err := j.d.Store.TouchSortSeen(ctx, touched); err != nil {
		slog.Warn("discover: touch last_sort_seen failed", "err", err)
	}
}
