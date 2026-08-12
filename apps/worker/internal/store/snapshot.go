package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// TrackedUniverseIDs returns every tracked game's universeId — the set snapshot
// fetches each tick.
func (s *Store) TrackedUniverseIDs(ctx context.Context) ([]int64, error) {
	rows, err := s.pool.Query(ctx, `select universe_id from games where is_tracked order by universe_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// Metric is one immutable landing-layer row for game_metrics.
type Metric struct {
	UniverseID     int64
	CapturedAt     time.Time
	Playing        *int
	Visits         *int64
	FavoritedCount *int64
	UpVotes        *int64
	DownVotes      *int64
	ActiveEvent    bool
	Raw            []byte // full untrimmed payload
}

// InsertMetrics appends raw snapshots, idempotent on (universe_id, captured_at).
// The raw layer is immutable — ON CONFLICT DO NOTHING, never update.
func (s *Store) InsertMetrics(ctx context.Context, metrics []Metric) error {
	if len(metrics) == 0 {
		return nil
	}
	b := &pgx.Batch{}
	for _, m := range metrics {
		b.Queue(
			`insert into game_metrics
			   (universe_id, captured_at, playing, visits, favorited_count, up_votes, down_votes, active_event, raw)
			 values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
			 on conflict (universe_id, captured_at) do nothing`,
			m.UniverseID, m.CapturedAt, m.Playing, m.Visits, m.FavoritedCount,
			m.UpVotes, m.DownVotes, m.ActiveEvent, m.Raw,
		)
	}
	return s.sendBatch(ctx, b)
}

// LastMetrics returns the most recent metric row per universe for the given ids
// — the source for carry-forward when a game is missing from a tick.
func (s *Store) LastMetrics(ctx context.Context, ids []int64) (map[int64]Metric, error) {
	out := map[int64]Metric{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx,
		`select distinct on (universe_id)
		   universe_id, captured_at, playing, visits, favorited_count, up_votes, down_votes, active_event
		 from game_metrics
		 where universe_id = any($1)
		 order by universe_id, captured_at desc`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var m Metric
		if err := rows.Scan(&m.UniverseID, &m.CapturedAt, &m.Playing, &m.Visits,
			&m.FavoritedCount, &m.UpVotes, &m.DownVotes, &m.ActiveEvent); err != nil {
			return nil, err
		}
		out[m.UniverseID] = m
	}
	return out, rows.Err()
}

// Creator is a newly-seen creator dimension row.
type Creator struct {
	CreatorID        int64
	Type             string
	Name             string
	HasVerifiedBadge bool
}

// InsertCreators inserts newly-seen creators only (ON CONFLICT DO NOTHING).
func (s *Store) InsertCreators(ctx context.Context, creators []Creator) error {
	if len(creators) == 0 {
		return nil
	}
	b := &pgx.Batch{}
	for _, c := range creators {
		b.Queue(
			`insert into creators (creator_id, type, name, has_verified_badge)
			 values ($1,$2,$3,$4)
			 on conflict (creator_id) do nothing`,
			c.CreatorID, c.Type, c.Name, c.HasVerifiedBadge,
		)
	}
	return s.sendBatch(ctx, b)
}

// GameMeta is the slowly-changing metadata refreshed conditionally on snapshot.
type GameMeta struct {
	UniverseID  int64
	Genre       string
	CreatorID   int64
	CreatorType string
	CreatorName string
	Created     *time.Time
	Updated     *time.Time
}

// UpdateGameMeta writes metadata only when a value actually changed
// (`is distinct from`), so an unchanged tick is a no-op write.
func (s *Store) UpdateGameMeta(ctx context.Context, metas []GameMeta) error {
	if len(metas) == 0 {
		return nil
	}
	b := &pgx.Batch{}
	for _, m := range metas {
		b.Queue(
			`update games set
			   roblox_genre = $2, creator_id = $3, creator_type = $4, creator_name = $5,
			   created_at = coalesce($6, created_at), updated_at = coalesce($7, updated_at)
			 where universe_id = $1
			   and (roblox_genre is distinct from $2
			     or creator_id is distinct from $3
			     or creator_type is distinct from $4
			     or creator_name is distinct from $5
			     or updated_at is distinct from coalesce($7, updated_at))`,
			m.UniverseID, m.Genre, m.CreatorID, m.CreatorType, m.CreatorName, m.Created, m.Updated,
		)
	}
	return s.sendBatch(ctx, b)
}
