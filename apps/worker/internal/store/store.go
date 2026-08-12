// Package store holds the pgx writers, one concern per global table.
//
// The worker connects as the SERVICE role (RLS bypass) — it writes only global
// scraped tables and must never be filtered (specs/06). Schema is owned by
// packages/database (Drizzle); the worker trusts the existing tables and never
// redefines them. Aggregation stays in Postgres; this layer only lands raw.
package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Store wraps the Postgres connection pool.
type Store struct {
	pool *pgxpool.Pool
}

// New opens a pgxpool against the SERVICE-role DSN (DATABASE_URL) and verifies
// connectivity. The caller owns Close.
func New(ctx context.Context, dsn string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse dsn: %w", err)
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("open pool: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}
	return &Store{pool: pool}, nil
}

// Close releases the pool.
func (s *Store) Close() {
	if s != nil && s.pool != nil {
		s.pool.Close()
	}
}
