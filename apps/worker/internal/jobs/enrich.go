package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/sync/errgroup"

	"monkyesuite/worker/internal/roblox"
	"monkyesuite/worker/internal/sched"
	"monkyesuite/worker/internal/store"
	"monkyesuite/worker/internal/telemetry"
)

const (
	// EnrichConcurrency is the claim-pool width (§1.4: ~5).
	EnrichConcurrency = 5
	// EnrichRetryBudget dead-letters a job after this many attempts (§1.4: 3).
	EnrichRetryBudget = 3
	// enrichRetryBackoff delays a requeued (non-exhausted) job.
	enrichRetryBackoff = 10 * time.Minute
	// portfolioVisitFloor / portfolio blocklist filter studio games (§1.4).
	portfolioVisitFloor = 10_000
)

var portfolioBlocklist = []string{"[ASSETS]", "[TESTING]"}

// drainBudget bounds one background drain so a daily enrich can't run forever;
// unclaimed rows are picked up on the next daily tick.
const drainBudget = 55 * time.Minute

// enrichJob fans every tracked game + creator into enrich_jobs, then drains the
// queue with a small pool claiming rows FOR UPDATE SKIP LOCKED. Runs ~daily. The
// enqueue is inline (fast); the drain runs DETACHED in a background goroutine so
// the thousands of gated, slow enrichment calls never block the 5-min tick loop
// (§1.5 "a tick must never overrun"; §1.4 "runs daily without blocking ticks").
// A single-flight guard means a later daily tick won't start a second drain
// while one is still in flight — it just tops up the queue.
type enrichJob struct {
	d        Deps
	client   *roblox.Client // enrich-budget view: shares the ceiling, adds the sub-budget
	draining atomic.Bool
}

func (j *enrichJob) Name() string { return "enrich" }

// Tier marks enrich as drawing from the independent enrich limiter pool, so the
// admin panel can split token consumption by tier and verify the critical path's
// reservation is holding (specs/01 §1.0, specs/09 §9.4.3).
func (j *enrichJob) Tier() string { return sched.TierEnrich }

// DrainJobName is the job_runs name for the detached drain. It is recorded
// separately from the `enrich` enqueue row on purpose: the enqueue is two cheap
// writes inside the tick, while the drain is thousands of gated calls running
// long after the tick returned. Folding them into one row would either lose the
// drain's call counters (the enrich tier would read as zero in the limiter
// panel) or misattribute its duration to the tick.
const DrainJobName = "enrich-drain"

func (j *enrichJob) Run(ctx context.Context, tick uint64) (sched.Result, error) {
	if j.d.Store == nil {
		slog.Warn("enrich skipped: no store")
		return sched.Result{Skipped: true, Metrics: enrichMetrics(drainCounts{})}, nil
	}
	// Enqueue quickly under a short deadline; this part is allowed to block the
	// tick because it's a couple of cheap writes.
	enqCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	tracked, err := j.d.Store.TrackedUniverseIDs(enqCtx)
	if err != nil {
		return sched.Result{Metrics: enrichMetrics(drainCounts{})}, err
	}
	if err := j.d.Store.EnqueueEnrich(enqCtx, "universe", tracked); err != nil {
		return sched.Result{Metrics: enrichMetrics(drainCounts{})}, err
	}
	creators, err := j.d.Store.TrackedCreatorRefs(enqCtx)
	if err != nil {
		return sched.Result{Metrics: enrichMetrics(drainCounts{})}, err
	}
	creatorIDs := make([]int64, len(creators))
	for i, c := range creators {
		creatorIDs[i] = c.CreatorID
	}
	if err := j.d.Store.EnqueueEnrich(enqCtx, "creator", creatorIDs); err != nil {
		return sched.Result{Metrics: enrichMetrics(drainCounts{})}, err
	}
	slog.Info("enrich enqueued", "tick", tick, "universes", len(tracked), "creators", len(creatorIDs))

	// The enqueue row carries the §9.6 enrich keys at zero (the drain hasn't run
	// yet) plus what this phase actually did.
	m := enrichMetrics(drainCounts{})
	m["enqueuedUniverses"] = len(tracked)
	m["enqueuedCreators"] = len(creatorIDs)
	res := sched.Result{RowsWritten: len(tracked) + len(creatorIDs), Metrics: m}

	// Drain detached. ctx here is the long-lived loop context (cancelled only on
	// worker shutdown), NOT the per-tick deadline — so returning now lets the
	// next tick fire while the drain continues in the background.
	if !j.draining.CompareAndSwap(false, true) {
		slog.Info("enrich: drain already in flight, queue topped up", "tick", tick)
		return res, nil
	}
	go func() {
		defer j.draining.Store(false)
		drainCtx, cancel := context.WithTimeout(ctx, drainBudget)
		defer cancel()
		j.runDrain(drainCtx, tick)
	}()
	return res, nil
}

// runDrain executes the detached drain and records its own job_runs row. The
// scheduler can't do it: by the time the drain finishes, the tick that spawned
// it returned long ago.
func (j *enrichJob) runDrain(ctx context.Context, tick uint64) {
	ctr := telemetry.NewCounter()
	started := time.Now().UTC()
	counts := j.drain(telemetry.WithCounter(ctx, ctr))
	finished := time.Now().UTC()
	slog.Info("enrich drain finished", "processed", counts.claimed, "done", counts.done, "failed", counts.failed)

	run := sched.Run{
		Job:         DrainJobName,
		Tick:        tick,
		Tier:        sched.TierEnrich,
		StartedAt:   started,
		FinishedAt:  finished,
		DurationMs:  int(finished.Sub(started).Milliseconds()),
		Status:      "ok",
		RowsWritten: counts.done,
		Metrics:     ctr.Fold(enrichMetrics(counts)),
	}
	// Detached from the drain budget: a drain that ended because its context
	// expired must still be able to report that it did.
	wctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	if err := j.d.Store.RecordJobRun(wctx, run); err != nil {
		slog.Warn("enrich: drain job_runs write failed", "err", err)
	}
}

// drainCounts tallies one drain. Per-kind is split because the two kinds fail
// for different upstreams: `universe` failures point at rotunnel, `creator`
// failures at the Studio/Groups endpoints (specs/09 §9.4.2).
type drainCounts struct {
	claimed, done, failed  int
	byKindDone, byKindFail map[string]int
}

// drainTally is the concurrent accumulator behind drainCounts — the drain pool
// records from EnrichConcurrency goroutines at once.
type drainTally struct {
	mu sync.Mutex
	c  drainCounts
}

func (t *drainTally) record(kind string, ok bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.c.byKindDone == nil {
		t.c.byKindDone, t.c.byKindFail = map[string]int{}, map[string]int{}
	}
	t.c.claimed++
	if ok {
		t.c.done++
		t.c.byKindDone[kind]++
		return
	}
	t.c.failed++
	t.c.byKindFail[kind]++
}

func (t *drainTally) snapshot() drainCounts {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.c
}

// drain runs EnrichConcurrency workers, each claiming rows until the queue is
// empty or ctx expires.
func (j *enrichJob) drain(ctx context.Context) drainCounts {
	var tally drainTally
	g, gctx := errgroup.WithContext(ctx)
	for i := 0; i < EnrichConcurrency; i++ {
		g.Go(func() error {
			for {
				if gctx.Err() != nil {
					return nil
				}
				jb, err := j.d.Store.ClaimEnrichJob(gctx)
				if err != nil {
					slog.Warn("enrich: claim failed", "err", err)
					return nil
				}
				if jb == nil {
					return nil // queue drained
				}
				tally.record(jb.Kind, j.process(gctx, jb))
			}
		})
	}
	_ = g.Wait()
	return tally.snapshot()
}

// process runs one claimed job and marks it done or failed (with dead-lettering
// once the retry budget is spent). Reports whether it succeeded.
func (j *enrichJob) process(ctx context.Context, jb *store.EnrichJob) bool {
	var err error
	switch jb.Kind {
	case "universe":
		err = j.enrichUniverse(ctx, jb.TargetID)
	case "creator":
		err = j.enrichCreator(ctx, jb.TargetID)
	default:
		err = fmt.Errorf("unknown job kind %q", jb.Kind)
		slog.Warn("enrich: unknown job kind", "kind", jb.Kind)
	}
	if err != nil {
		slog.Warn("enrich: job failed", "kind", jb.Kind, "target", jb.TargetID, "attempts", jb.Attempts, "err", err)
		// The cause rides onto the row: a dead-letter with attempts but no reason
		// is unactionable in the admin queue panel (specs/09 §9.4.2).
		if ferr := j.d.Store.FailEnrich(ctx, jb.ID, jb.Attempts, EnrichRetryBudget, enrichRetryBackoff, err); ferr != nil {
			slog.Warn("enrich: mark-failed errored", "id", jb.ID, "err", ferr)
		}
		return false
	}
	if err := j.d.Store.CompleteEnrich(ctx, jb.ID); err != nil {
		slog.Warn("enrich: mark-done errored", "id", jb.ID, "err", err)
	}
	return true
}

// enrichMetrics is the §9.6 contract for the enrich job and its drain.
func enrichMetrics(c drainCounts) map[string]any {
	done, fail := c.byKindDone, c.byKindFail
	if done == nil {
		done = map[string]int{}
	}
	if fail == nil {
		fail = map[string]int{}
	}
	return map[string]any{
		"claimed":    c.claimed,
		"done":       c.done,
		"failed":     c.failed,
		"byKindDone": done,
		"byKindFail": fail,
	}
}

// enrichUniverse refreshes monetization SKUs + place metadata for one game.
func (j *enrichJob) enrichUniverse(ctx context.Context, universeID int64) error {
	// Gamepasses (rotunnel, gated → fail soft).
	if passes, err := j.client.GetGamePasses(ctx, universeID); err != nil {
		slog.Warn("enrich: gamepasses failed", "universe", universeID, "err", err)
	} else {
		rows := make([]store.GamePassRow, 0, len(passes))
		for _, p := range passes {
			rows = append(rows, store.GamePassRow{PassID: p.PassID, UniverseID: universeID, Name: p.Name, PriceRobux: p.PriceRobux})
		}
		if err := j.d.Store.UpsertGamePasses(ctx, rows); err != nil {
			return err
		}
	}
	// Dev products.
	if products, err := j.client.GetDevProducts(ctx, universeID); err != nil {
		slog.Warn("enrich: dev-products failed", "universe", universeID, "err", err)
	} else {
		rows := make([]store.DevProductRow, 0, len(products))
		for _, p := range products {
			rows = append(rows, store.DevProductRow{ProductID: p.ProductID, UniverseID: universeID, Name: p.Name, PriceRobux: p.PriceRobux})
		}
		if err := j.d.Store.UpsertDevProducts(ctx, rows); err != nil {
			return err
		}
	}
	// Games API again → maxPlayers, playableDevices.
	if games, err := j.client.GetGames(ctx, []int64{universeID}); err == nil && len(games) == 1 {
		g := games[0]
		devices, _ := json.Marshal(g.PlayableDevices)
		mp := g.MaxPlayers
		if err := j.d.Store.UpdateGameEnrichment(ctx, universeID, nil, devices, "", &mp); err != nil {
			return err
		}
	}
	return nil
}

// enrichCreator refreshes a creator's studio portfolio + group meta.
func (j *enrichJob) enrichCreator(ctx context.Context, creatorID int64) error {
	ctype, err := j.d.Store.CreatorType(ctx, creatorID)
	if err != nil {
		return err
	}
	kind := "users"
	if strings.EqualFold(ctype, "Group") {
		kind = "groups"
	}
	games, err := j.client.GetCreatorGames(ctx, kind, creatorID)
	if err != nil {
		slog.Warn("enrich: creator games failed", "creator", creatorID, "err", err)
	} else {
		var rows []store.PortfolioRow
		for _, g := range games {
			if g.Visits < portfolioVisitFloor || blocked(g.Name) {
				continue
			}
			rows = append(rows, store.PortfolioRow{CreatorID: creatorID, UniverseID: g.UniverseID, Name: g.Name, Visits: g.Visits})
		}
		if err := j.d.Store.UpsertCreatorPortfolio(ctx, rows); err != nil {
			return err
		}
	}
	// Group meta (groups only).
	if kind == "groups" {
		if meta, err := j.client.GetGroup(ctx, creatorID); err != nil {
			slog.Warn("enrich: group meta failed", "creator", creatorID, "err", err)
		} else {
			mc := meta.MemberCount
			if err := j.d.Store.UpdateCreatorMeta(ctx, creatorID, &mc, meta.HasVerifiedBadge); err != nil {
				return err
			}
		}
	}
	return nil
}

func blocked(name string) bool {
	up := strings.ToUpper(name)
	for _, b := range portfolioBlocklist {
		if strings.Contains(up, b) {
			return true
		}
	}
	return false
}
