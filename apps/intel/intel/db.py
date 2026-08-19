"""Connection helper.

Connects as monkye_service (same role as the Go worker): intel only reads and
writes GLOBAL tables, so RLS must never filter it. DATABASE_URL is the service
role's connection string, injected by Railway.
"""

import os

import psycopg


def connect() -> psycopg.Connection:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    # autocommit off: each job commits its own transaction, so a failed job
    # never leaves a partial run behind.
    return psycopg.connect(url)
