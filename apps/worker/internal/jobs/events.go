package jobs

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"monkyesuite/worker/internal/roblox"
	"monkyesuite/worker/internal/store"
)

// EventsConcurrency bounds the virtual-events fan-out width.
const EventsConcurrency = 10

// updateShippedWindow is how recently an event must have gone live to emit an
// update_shipped lifecycle event on first ingestion (§1.3, ~1h).
const updateShippedWindow = time.Hour

// eventsJob polls each game's virtual events, bucketed so a game is checked
// ~once per 12 ticks (universeId % 12 == tick % 12), spreading load across the
// hour (§1.3).
type eventsJob struct{ d Deps }

func (j *eventsJob) Name() string { return "events" }

func (j *eventsJob) Run(ctx context.Context, tick uint64) error {
	if j.d.Store == nil {
		slog.Warn("events skipped: no store")
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()

	tracked, err := j.d.Store.TrackedUniverseIDs(ctx)
	if err != nil {
		return err
	}
	bucket := int64(tick % 12)
	var due []int64
	for _, id := range tracked {
		if id%12 == bucket {
			due = append(due, id)
		}
	}
	if len(due) == 0 {
		slog.Info("events: no games in bucket", "tick", tick, "bucket", bucket)
		return nil
	}

	now := time.Now().UTC()
	results := roblox.Fanout(ctx, EventsConcurrency, due,
		func(ctx context.Context, id int64) (universeEvents, error) {
			evs, err := j.d.Client.GetVirtualEvents(ctx, id)
			return universeEvents{universeID: id, events: evs}, err
		})

	var shipped []store.LifecycleEvent
	total := 0
	for _, r := range results {
		if r.Err != nil {
			slog.Warn("events: fetch failed", "universe", due[r.Index], "err", r.Err)
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
	slog.Info("events done", "tick", tick, "bucket", bucket, "games", len(due), "events", total, "shipped", len(shipped))
	return nil
}

// resolveThumbnail resolves the first thumbnail mediaId to a CDN URL.
func (j *eventsJob) resolveThumbnail(ctx context.Context, row *store.GameEvent, e roblox.VirtualEvent) {
	if len(e.Thumbnails) == 0 || e.Thumbnails[0].MediaID == 0 {
		return
	}
	urls, err := j.d.Client.GetAssetThumbnails(ctx, []int64{e.Thumbnails[0].MediaID})
	if err != nil {
		slog.Warn("events: thumbnail resolve failed", "event", e.ID, "err", err)
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
