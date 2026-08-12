package store

import (
	"context"
	"time"
)

// GameEvent is one virtual-event row for upsert (specs/01 §1.3).
type GameEvent struct {
	EventID      string
	UniverseID   int64
	Title        string
	Subtitle     string
	Tagline      string
	StartUTC     *time.Time
	EndUTC       *time.Time
	HostID       int64
	HostName     string
	Categories   []byte // json
	ThumbnailURL string
	Status       string
	CreatedUTC   *time.Time
	UpdatedUTC   *time.Time
}

// EventExists reports whether we've already ingested this event id — the gate
// for emitting update_shipped only on first ingestion.
func (s *Store) EventExists(ctx context.Context, eventID string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `select exists(select 1 from game_events where event_id = $1)`, eventID).Scan(&exists)
	return exists, err
}

// UpsertGameEvent inserts or updates the full event row on its natural key.
func (s *Store) UpsertGameEvent(ctx context.Context, e GameEvent) error {
	_, err := s.pool.Exec(ctx,
		`insert into game_events
		   (event_id, universe_id, title, subtitle, tagline, start_utc, end_utc,
		    host_id, host_name, categories, thumbnail_url, status, created_utc, updated_utc)
		 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		 on conflict (event_id) do update set
		   title = excluded.title, subtitle = excluded.subtitle, tagline = excluded.tagline,
		   start_utc = excluded.start_utc, end_utc = excluded.end_utc,
		   host_id = excluded.host_id, host_name = excluded.host_name,
		   categories = excluded.categories,
		   thumbnail_url = coalesce(excluded.thumbnail_url, game_events.thumbnail_url),
		   status = excluded.status, updated_utc = excluded.updated_utc`,
		e.EventID, e.UniverseID, e.Title, e.Subtitle, e.Tagline, e.StartUTC, e.EndUTC,
		e.HostID, e.HostName, e.Categories, nullifyEmpty(e.ThumbnailURL), e.Status, e.CreatedUTC, e.UpdatedUTC,
	)
	return err
}

func nullifyEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
