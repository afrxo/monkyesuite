package store

import (
	"context"
	"time"
)

// DemandTerm is one active row of the curated bridge (demand_terms). kind is
// "game" (mapped to UniverseID) or "theme" (mapped to GenreLabel) — specs/04 §4.1.
type DemandTerm struct {
	ID         string
	Term       string
	Kind       string
	UniverseID *int64  // set for kind="game"
	GenreLabel *string // set for kind="theme"
}

// ActiveDemandTerms returns every active term the daily demand job snapshots.
// Theme terms sort first so that on quota exhaustion the game terms are the ones
// deferred to the next day (§4.2). Within a kind, ordering is stable by term.
func (s *Store) ActiveDemandTerms(ctx context.Context) ([]DemandTerm, error) {
	rows, err := s.pool.Query(ctx,
		`select id::text, term, kind, universe_id, genre_label
		   from demand_terms
		  where is_active
		  order by (kind = 'theme') desc, term`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DemandTerm
	for rows.Next() {
		var t DemandTerm
		if err := rows.Scan(&t.ID, &t.Term, &t.Kind, &t.UniverseID, &t.GenreLabel); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// DemandSnapshot is one daily off-platform interest row (demand_snapshots).
// All measures are nullable: a failed YouTube or Trends fetch lands the row with
// nulls rather than skipping it, so every active term is snapshotted daily (§4.3
// acceptance).
type DemandSnapshot struct {
	TermID         string
	CapturedAt     time.Time
	YtVideoCount7d *int
	YtViewDelta7d  *int64
	TrendsScore    *float64
}

// UpsertDemandSnapshot writes one daily row, idempotent on (term_id, captured_at).
// captured_at is the UTC day, so a same-day re-run refreshes the row in place
// rather than duplicating it — unlike the immutable game_metrics landing layer,
// demand_snapshots is a once-per-day measure that a re-run may legitimately
// update with a fuller reading.
func (s *Store) UpsertDemandSnapshot(ctx context.Context, snap DemandSnapshot) error {
	_, err := s.pool.Exec(ctx,
		`insert into demand_snapshots
		   (term_id, captured_at, yt_video_count_7d, yt_view_delta_7d, trends_score)
		 values ($1,$2,$3,$4,$5)
		 on conflict (term_id, captured_at) do update set
		   yt_video_count_7d = excluded.yt_video_count_7d,
		   yt_view_delta_7d  = excluded.yt_view_delta_7d,
		   trends_score      = excluded.trends_score`,
		snap.TermID, snap.CapturedAt, snap.YtVideoCount7d, snap.YtViewDelta7d, snap.TrendsScore,
	)
	return err
}
