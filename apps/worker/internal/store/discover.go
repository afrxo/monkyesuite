package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// GameSeed is a new game discovered in a sort (specs/01 §1.1).
type GameSeed struct {
	UniverseID  int64
	RootPlaceID int64
	Name        string
	Source      string // "discover"
}

// UpsertGames inserts newly-discovered games, leaving existing rows untouched
// (ON CONFLICT (universe_id) DO NOTHING). firstSeenAt/lastSeenAt default now.
func (s *Store) UpsertGames(ctx context.Context, seeds []GameSeed) error {
	if len(seeds) == 0 {
		return nil
	}
	b := &pgx.Batch{}
	for _, g := range seeds {
		b.Queue(
			`insert into games (universe_id, root_place_id, name, source, is_tracked)
			 values ($1,$2,$3,$4,true)
			 on conflict (universe_id) do nothing`,
			g.UniverseID, g.RootPlaceID, g.Name, g.Source,
		)
	}
	return s.sendBatch(ctx, b)
}

// SortPos is a game's best (lowest) rank and the sort it holds it in.
type SortPos struct {
	Sort string
	Rank int
}

// ApplyBestSorts sets games.current_sort/current_sort_rank to the best rank each
// game holds this tick, and CLEARS both for every tracked game not present in
// any sort this tick. Done in one transaction so the board never reads a
// half-updated sort state.
func (s *Store) ApplyBestSorts(ctx context.Context, best map[int64]SortPos) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Clear everyone first; the present games are re-set below.
	if _, err := tx.Exec(ctx,
		`update games set current_sort = null, current_sort_rank = null
		 where current_sort is not null`); err != nil {
		return err
	}
	b := &pgx.Batch{}
	for id, pos := range best {
		b.Queue(
			`update games set current_sort = $2, current_sort_rank = $3, last_seen_at = now()
			 where universe_id = $1`,
			id, pos.Sort, pos.Rank,
		)
	}
	if err := tx.SendBatch(ctx, b).Close(); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// SortSnap is one (universe, sort, rank) observation for sort_snapshots.
type SortSnap struct {
	UniverseID int64
	SortName   string
	Rank       int
	CapturedAt time.Time
}

// InsertSortSnapshots appends the top-50-per-sort observations, idempotent on
// (universe_id, sort_name, captured_at).
func (s *Store) InsertSortSnapshots(ctx context.Context, snaps []SortSnap) error {
	if len(snaps) == 0 {
		return nil
	}
	b := &pgx.Batch{}
	for _, sn := range snaps {
		b.Queue(
			`insert into sort_snapshots (universe_id, sort_name, rank, captured_at)
			 values ($1,$2,$3,$4)
			 on conflict (universe_id, sort_name, captured_at) do nothing`,
			sn.UniverseID, sn.SortName, sn.Rank, sn.CapturedAt,
		)
	}
	return s.sendBatch(ctx, b)
}

// PruneSortSnapshots deletes rows older than the cutoff (~24h retention).
func (s *Store) PruneSortSnapshots(ctx context.Context, olderThan time.Time) (int64, error) {
	ct, err := s.pool.Exec(ctx, `delete from sort_snapshots where captured_at < $1`, olderThan)
	if err != nil {
		return 0, err
	}
	return ct.RowsAffected(), nil
}

// GamesInSort returns the universeIds that currently hold a sort position — the
// PREVIOUS tick's sorted set, read before ApplyBestSorts clears it, so discover
// can diff entries/exits for lifecycle events.
func (s *Store) GamesInSort(ctx context.Context) (map[int64]struct{}, error) {
	rows, err := s.pool.Query(ctx, `select universe_id from games where current_sort is not null`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]struct{}{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = struct{}{}
	}
	return out, rows.Err()
}

// LastSortSeen returns games.last_sort_seen for the given ids (missing/null →
// absent), used to debounce sort_appearance events by 24h.
func (s *Store) LastSortSeen(ctx context.Context, ids []int64) (map[int64]time.Time, error) {
	out := map[int64]time.Time{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx,
		`select universe_id, last_sort_seen from games
		 where universe_id = any($1) and last_sort_seen is not null`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var t time.Time
		if err := rows.Scan(&id, &t); err != nil {
			return nil, err
		}
		out[id] = t
	}
	return out, rows.Err()
}

// TouchSortSeen stamps games.last_sort_seen = now() for the given ids (call on
// debounced sort_appearance).
func (s *Store) TouchSortSeen(ctx context.Context, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := s.pool.Exec(ctx, `update games set last_sort_seen = now() where universe_id = any($1)`, ids)
	return err
}

// TrackedWithoutIcon returns tracked-game universeIds missing icon_url, capped
// at `limit`. Pulse consumes icon_url directly on read; a nightly backfill call
// keeps stragglers from the discover-only prewarm path filled in.
func (s *Store) TrackedWithoutIcon(ctx context.Context, limit int) ([]int64, error) {
	if limit <= 0 {
		limit = 500
	}
	rows, err := s.pool.Query(ctx,
		`select universe_id from games
		 where is_tracked and icon_url is null
		 order by first_seen_at desc
		 limit $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]int64, 0, limit)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// SetIcons updates games.icon_url for the resolved icons.
func (s *Store) SetIcons(ctx context.Context, icons map[int64]string) error {
	if len(icons) == 0 {
		return nil
	}
	b := &pgx.Batch{}
	for id, url := range icons {
		b.Queue(`update games set icon_url = $2 where universe_id = $1`, id, url)
	}
	return s.sendBatch(ctx, b)
}
