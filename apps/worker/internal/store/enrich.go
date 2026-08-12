package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// EnrichJob is a claimed row from the daily enrichment work queue (specs/01 §1.4).
type EnrichJob struct {
	ID       string
	Kind     string // "universe" | "creator"
	TargetID int64
	Attempts int
}

// EnqueueEnrich fans target ids into enrich_jobs as pending rows. Existing
// non-terminal rows for the same (kind,target) are left alone so a re-run
// doesn't pile duplicates on the queue.
func (s *Store) EnqueueEnrich(ctx context.Context, kind string, targetIDs []int64) error {
	if len(targetIDs) == 0 {
		return nil
	}
	b := &pgx.Batch{}
	for _, id := range targetIDs {
		b.Queue(
			`insert into enrich_jobs (kind, target_id, status)
			 select $1, $2, 'pending'
			 where not exists (
			   select 1 from enrich_jobs
			   where kind = $1 and target_id = $2 and status in ('pending','running'))`,
			kind, id,
		)
	}
	return s.sendBatch(ctx, b)
}

// ClaimEnrichJob atomically claims the oldest due pending job with
// FOR UPDATE SKIP LOCKED, flipping it to running. Returns (nil, nil) when the
// queue is empty. This is what lets a pool of goroutines drain the queue without
// double-processing a row.
func (s *Store) ClaimEnrichJob(ctx context.Context) (*EnrichJob, error) {
	var j EnrichJob
	err := s.pool.QueryRow(ctx,
		`update enrich_jobs set status = 'running', attempts = attempts + 1
		 where id = (
		   select id from enrich_jobs
		   where status = 'pending' and run_after <= now()
		   order by run_after
		   for update skip locked
		   limit 1)
		 returning id, kind, target_id, attempts`).Scan(&j.ID, &j.Kind, &j.TargetID, &j.Attempts)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &j, nil
}

// CompleteEnrich marks a claimed job done.
func (s *Store) CompleteEnrich(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx, `update enrich_jobs set status = 'done' where id = $1`, id)
	return err
}

// FailEnrich requeues a failed job with backoff, or dead-letters it as `failed`
// once attempts reach the retry budget (specs/01 §1.4).
func (s *Store) FailEnrich(ctx context.Context, id string, attempts, budget int, backoff time.Duration) error {
	if attempts >= budget {
		_, err := s.pool.Exec(ctx, `update enrich_jobs set status = 'failed' where id = $1`, id)
		return err
	}
	_, err := s.pool.Exec(ctx,
		`update enrich_jobs set status = 'pending', run_after = now() + $2::interval where id = $1`,
		id, backoff.String())
	return err
}

// GamePass / DevProduct writers ------------------------------------------------

// GamePassRow is a monetization SKU for upsert.
type GamePassRow struct {
	PassID     int64
	UniverseID int64
	Name       string
	PriceRobux *int
}

// UpsertGamePasses refreshes a universe's gamepasses.
func (s *Store) UpsertGamePasses(ctx context.Context, rows []GamePassRow) error {
	if len(rows) == 0 {
		return nil
	}
	b := &pgx.Batch{}
	for _, r := range rows {
		b.Queue(
			`insert into game_passes (pass_id, universe_id, name, price_robux, refreshed_at)
			 values ($1,$2,$3,$4, now())
			 on conflict (pass_id) do update set
			   name = excluded.name, price_robux = excluded.price_robux, refreshed_at = now()`,
			r.PassID, r.UniverseID, r.Name, r.PriceRobux,
		)
	}
	return s.sendBatch(ctx, b)
}

// DevProductRow is a developer-product SKU for upsert.
type DevProductRow struct {
	ProductID  int64
	UniverseID int64
	Name       string
	PriceRobux *int
}

// UpsertDevProducts refreshes a universe's developer products.
func (s *Store) UpsertDevProducts(ctx context.Context, rows []DevProductRow) error {
	if len(rows) == 0 {
		return nil
	}
	b := &pgx.Batch{}
	for _, r := range rows {
		b.Queue(
			`insert into dev_products (product_id, universe_id, name, price_robux, refreshed_at)
			 values ($1,$2,$3,$4, now())
			 on conflict (product_id) do update set
			   name = excluded.name, price_robux = excluded.price_robux, refreshed_at = now()`,
			r.ProductID, r.UniverseID, r.Name, r.PriceRobux,
		)
	}
	return s.sendBatch(ctx, b)
}

// UpdateGameEnrichment writes the daily place-detail columns onto games.
func (s *Store) UpdateGameEnrichment(ctx context.Context, universeID int64, supportedLanguages, playableDevices []byte, ageRecommendation string, maxPlayers *int) error {
	_, err := s.pool.Exec(ctx,
		`update games set
		   supported_languages = coalesce($2, supported_languages),
		   playable_devices    = coalesce($3, playable_devices),
		   age_recommendation  = coalesce(nullif($4,''), age_recommendation),
		   max_players         = coalesce($5, max_players)
		 where universe_id = $1`,
		universeID, supportedLanguages, playableDevices, ageRecommendation, maxPlayers)
	return err
}

// PortfolioRow is one creator_portfolio entry (universeId is NOT a FK).
type PortfolioRow struct {
	CreatorID  int64
	UniverseID int64
	Name       string
	Visits     int64
}

// UpsertCreatorPortfolio refreshes a creator's top games.
func (s *Store) UpsertCreatorPortfolio(ctx context.Context, rows []PortfolioRow) error {
	if len(rows) == 0 {
		return nil
	}
	b := &pgx.Batch{}
	for _, r := range rows {
		b.Queue(
			`insert into creator_portfolio (creator_id, universe_id, name, visits, refreshed_at)
			 values ($1,$2,$3,$4, now())
			 on conflict (creator_id, universe_id) do update set
			   name = excluded.name, visits = excluded.visits, refreshed_at = now()`,
			r.CreatorID, r.UniverseID, r.Name, r.Visits,
		)
	}
	return s.sendBatch(ctx, b)
}

// UpdateCreatorMeta refreshes group member count + verified badge.
func (s *Store) UpdateCreatorMeta(ctx context.Context, creatorID int64, memberCount *int, hasVerifiedBadge bool) error {
	_, err := s.pool.Exec(ctx,
		`update creators set member_count = coalesce($2, member_count), has_verified_badge = $3
		 where creator_id = $1`,
		creatorID, memberCount, hasVerifiedBadge)
	return err
}

// CreatorType returns a creator's "User"/"Group" type (empty if unknown), so
// the creator enrich job can pick the right studio-games endpoint.
func (s *Store) CreatorType(ctx context.Context, creatorID int64) (string, error) {
	var t string
	err := s.pool.QueryRow(ctx, `select coalesce(type,'') from creators where creator_id = $1`, creatorID).Scan(&t)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	return t, err
}

// CreatorRef is a creator id + type for the daily creator enrichment fan-out.
type CreatorRef struct {
	CreatorID int64
	Type      string
}

// TrackedCreatorRefs returns distinct creators referenced by tracked games — the
// set the daily `creator` enrich job fans out over.
func (s *Store) TrackedCreatorRefs(ctx context.Context) ([]CreatorRef, error) {
	rows, err := s.pool.Query(ctx,
		`select distinct creator_id, creator_type from games
		 where is_tracked and creator_id is not null and creator_type is not null`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CreatorRef
	for rows.Next() {
		var r CreatorRef
		if err := rows.Scan(&r.CreatorID, &r.Type); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
