package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// sendBatch runs a pgx.Batch and returns the first error encountered. Used for
// the many small idempotent upserts each job issues.
func (s *Store) sendBatch(ctx context.Context, b *pgx.Batch) error {
	if b.Len() == 0 {
		return nil
	}
	br := s.pool.SendBatch(ctx, b)
	return br.Close()
}

// LifecycleEvent is a discrete detected transition (sort_appearance, sort_exit,
// update_shipped, …). Analytical events are re-derivable; these ingestion-time
// ones (sort/event signals) are emitted here at observation time.
type LifecycleEvent struct {
	UniverseID int64
	Type       string
	DetectedAt time.Time
	Magnitude  *float64
	Meta       []byte // json, optional
}

// InsertLifecycleEvents appends detected transitions.
func (s *Store) InsertLifecycleEvents(ctx context.Context, evs []LifecycleEvent) error {
	if len(evs) == 0 {
		return nil
	}
	b := &pgx.Batch{}
	for _, e := range evs {
		b.Queue(
			`insert into lifecycle_events (universe_id, type, detected_at, magnitude, meta)
			 values ($1,$2,$3,$4,$5)`,
			e.UniverseID, e.Type, e.DetectedAt, e.Magnitude, e.Meta,
		)
	}
	return s.sendBatch(ctx, b)
}
