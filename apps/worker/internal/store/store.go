// Package store holds the pgx queries/writers, one concern per global table.
//
// The worker connects as the SERVICE role (RLS bypass) — it writes only global
// scraped tables and must never be filtered (specs/06). Schema is owned by
// packages/database (Drizzle); the worker trusts the existing tables and never
// redefines them.
//
// Scaffold: connection config only. The pgxpool is wired in phase 01.
package store

// Store wraps the Postgres connection pool. Fields wired in phase 01.
type Store struct {
	// pool *pgxpool.Pool
}

// New returns a scaffold store. Real construction opens a pgxpool against the
// SERVICE-role DATABASE_URL. Lands with phase 01.
func New() *Store { return &Store{} }
