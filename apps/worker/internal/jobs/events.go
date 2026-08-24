package jobs

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"monkyesuite/worker/internal/roblox"
	"monkyesuite/worker/internal/sched"
	"monkyesuite/worker/internal/store"
)

// EventsConcurrency bounds the virtual-events fan-out width.
const EventsConcurrency = 10

// EventsTickInterval is the cadence at which the events job fires, expressed
// in ticks of the base 5-min loop. 36 * 5min = 3h. Was 1 (every tick) with a
// 12-way universeId bucket that spread the fan-out over an hour; empirically
// the event flag is slow-moving enough that a full sweep every 3h keeps
// signal quality while cutting the roblox call rate by ~36×. Cron mode
// ignores this — the cron schedule is the authority there.
const EventsTickInterval = 36

// updateShippedWindow is how recently an event must have gone live to emit an
// update_shipped lifecycle event on first ingestion (§1.3, ~1h).
const updateShippedWindow = time.Hour

// eventsJob polls each tracked game's virtual events. Fires every 3h in the
// persistent loop (see EventsTickInterval) and on whatever schedule the
// events cron service is configured with; in either mode it sweeps the full
// tracked set in one run, fanned out at EventsConcurrency.
type eventsJob struct{ d Deps }

func (j *eventsJob) Name() string { return "events" }

func (j *eventsJob) Run(ctx context.Context, tick uint64) (sched.Result, error) {
	// Loop mode: skip until the 3h cadence lands. Cron mode always passes
	// tick=0, so this branch is a no-op there.
	if tick != 0 && tick%EventsTickInterval != 0 {
		return sched.Result{Skipped: true, Metrics: eventsMetrics(int64(tick), 0, 0)}, nil
	}
	if j.d.Store == nil {
		slog.Warn("events skipped: no store")
		return sched.Result{Skipped: true, Metrics: eventsMetrics(int64(tick), 0, 0)}, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()

	tracked, err := j.d.Store.TrackedUniverseIDs(ctx)
	if err != nil {
		return sched.Result{Metrics: eventsMetrics(int64(tick), 0, 0)}, err
	}
	due := tracked
	if len(due) == 0 {
		slog.Info("events: no tracked games", "tick", tick)
		return sched.Result{Metrics: eventsMetrics(int64(tick), 0, 0)}, nil
	}

	now := time.Now().UTC()
	results := roblox.Fanout(ctx, EventsConcurrency, due,
		func(ctx context.Context, id int64) (universeEvents, error) {
			evs, err := j.d.Client.GetVirtualEvents(ctx, id)
			return universeEvents{universeID: id, events: evs}, err
		})

	var shipped []store.LifecycleEvent
	total := 0
	// Per-failure warns floor Railway's 500/sec log cap whenever Roblox
	// rate-limits the batch — every universe in the fanout logs a line at the
	// same instant. Aggregate: one representative sample + a count at the end.
	var fetchFailed int
	var fetchSampleErr error
	var fetchSampleID int64
	for _, r := range results {
		if r.Err != nil {
			if fetchFailed == 0 {
				fetchSampleErr = r.Err
				fetchSampleID = due[r.Index]
			}
			fetchFailed++
			continue
		}
		for _, e := range r.Value.events {
			isNew, err := j.d.Store.EventExists(ctx, e.ID)
			if err != nil {
				slog.Warn("events: exists check failed", "event", e.ID, "err", err)
				continue
			}
			firstIngest := !isNew

			row := toEventRow(r.Value.universeID, e)
			j.resolveThumbnail(ctx, &row, e)
			if err := j.d.Store.UpsertGameEvent(ctx, row); err != nil {
				slog.Warn("events: upsert failed", "event", e.ID, "err", err)
				continue
			}
			total++

			// update_shipped: first time we ingest an event that went live within
			// the last ~1h.
			if firstIngest && e.EventTime.StartUTC != nil {
				start := e.EventTime.StartUTC.UTC()
				if !start.After(now) && now.Sub(start) <= updateShippedWindow {
					shipped = append(shipped, store.LifecycleEvent{
						UniverseID: r.Value.universeID, Type: "update_shipped", DetectedAt: now,
					})
				}
			}
		}
	}
	if err := j.d.Store.InsertLifecycleEvents(ctx, shipped); err != nil {
		slog.Warn("events: lifecycle insert failed", "err", err)
	}
	if fetchFailed > 0 {
		slog.Warn("events: fetch failed batch", "count", fetchFailed,
			"sample_universe", fetchSampleID, "sample_err", fetchSampleErr)
	}
	slog.Info("events done", "tick", tick, "games", len(due),
		"events", total, "shipped", len(shipped), "fetch_failed", fetchFailed)
	return sched.Result{
		RowsWritten: total + len(shipped),
		Metrics:     eventsMetrics(int64(tick), len(due), total),
	}, nil
}

// eventsMetrics is the §9.6 contract for this job. `bucket` is kept as the
// field name for panel-schema stability even though the job no longer polls
// a modulo bucket — the value is now the tick at fire time, useful for
// checking the 3h cadence is honored.
func eventsMetrics(bucket int64, gamesPolled, eventsUpserted int) map[string]any {
	return map[string]any{
		"bucket":         bucket,
		"gamesPolled":    gamesPolled,
		"eventsUpserted": eventsUpserted,
	}
}

// resolveThumbnail resolves the first thumbnail mediaId to a CDN URL. The
// per-event warn was moved to Debug because a rate-limited tick logs one per
// event and floors Railway's 500/sec cap. Failures are non-fatal (the row
// still upserts without a thumbnail), so the debug drop-in loses no signal
// the system acts on.
func (j *eventsJob) resolveThumbnail(ctx context.Context, row *store.GameEvent, e roblox.VirtualEvent) {
	if len(e.Thumbnails) == 0 || e.Thumbnails[0].MediaID == 0 {
		return
	}
	urls, err := j.d.Client.GetAssetThumbnails(ctx, []int64{e.Thumbnails[0].MediaID})
	if err != nil {
		slog.Debug("events: thumbnail resolve failed", "event", e.ID, "err", err)
		return
	}
	if u, ok := urls[e.Thumbnails[0].MediaID]; ok {
		row.ThumbnailURL = u
	}
}

func toEventRow(universeID int64, e roblox.VirtualEvent) store.GameEvent {
	cats, _ := json.Marshal(e.EventCategories)
	return store.GameEvent{
		EventID:    e.ID,
		UniverseID: universeID,
		Title:      e.Title,
		Subtitle:   e.Subtitle,
		Tagline:    e.Tagline,
		StartUTC:   e.EventTime.StartUTC,
		EndUTC:     e.EventTime.EndUTC,
		HostID:     e.Host.HostID,
		HostName:   e.Host.HostName,
		Categories: cats,
		Status:     e.EventStatus,
		CreatedUTC: e.CreatedUTC,
		UpdatedUTC: e.UpdatedUTC,
	}
}

type universeEvents struct {
	universeID int64
	events     []roblox.VirtualEvent
}
