package store

import (
	"context"
	_ "embed"
	"time"
)

// The derive queries live as .sql files and run entirely in Postgres. The Go
// layer only triggers them — it never reads the raw series into memory. That is
// the CPU strategy (specs/02): aggregation in the database, not the process. If
// any aggregation appeared in Go here, it would be a bug.
var (
	//go:embed sql/derive_stats.sql
	sqlDeriveStats string
	//go:embed sql/lifecycle_emit.sql
	sqlLifecycleEmit string
	//go:embed sql/trend_drift.sql
	sqlTrendDrift string
)

// DeriveStats recomputes game_stats for every tracked game as of computedAt,
// purely in SQL. Returns the number of stat rows written (0 on a same-tick
// re-run — idempotent on (universe_id, computed_at)).
func (s *Store) DeriveStats(ctx context.Context, computedAt time.Time) (int64, error) {
	ct, err := s.pool.Exec(ctx, sqlDeriveStats, computedAt)
	if err != nil {
		return 0, err
	}
	return ct.RowsAffected(), nil
}

// EmitLifecycleChanges inserts analytical lifecycle_events for games whose
// stage changed on this tick (emit-on-change). Returns the number emitted.
func (s *Store) EmitLifecycleChanges(ctx context.Context, computedAt time.Time) (int64, error) {
	ct, err := s.pool.Exec(ctx, sqlLifecycleEmit, computedAt)
	if err != nil {
		return 0, err
	}
	return ct.RowsAffected(), nil
}

// TrendRow is one confirmed tag direction from the daily trend-drift query.
type TrendRow struct {
	Axis           string
	Slug           string
	RisingCarriers int
	TotalCarriers  int
}

// TrendDrift runs the confirmation-rule query (multi-game AND growth) in SQL and
// returns the tags that clear the minRising threshold. Read-only.
func (s *Store) TrendDrift(ctx context.Context, minRising int) ([]TrendRow, error) {
	rows, err := s.pool.Query(ctx, sqlTrendDrift, minRising)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TrendRow
	for rows.Next() {
		var r TrendRow
		if err := rows.Scan(&r.Axis, &r.Slug, &r.RisingCarriers, &r.TotalCarriers); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
