"""intel_insights writer.

Idempotent on (kind, subject_key, computed_at): a re-run at the same
computed_at overwrites its own rows and never duplicates. History is kept 14
days for auditing ("what did intel say last Tuesday"), then pruned — the API
only ever reads the latest run per kind.
"""

import json
from datetime import datetime, timedelta, timezone
from typing import Any

import psycopg

RETENTION = timedelta(days=14)

UPSERT = """
insert into intel_insights
  (kind, subject_type, subject_key, rank, score, headline, evidence, computed_at)
values (%s, %s, %s, %s, %s, %s, %s::jsonb, %s)
on conflict (kind, subject_key, computed_at) do update set
  rank = excluded.rank,
  score = excluded.score,
  headline = excluded.headline,
  evidence = excluded.evidence
"""


def write_insights(
    conn: psycopg.Connection,
    kind: str,
    computed_at: datetime,
    rows: list[dict[str, Any]],
) -> None:
    """rows: [{subject_type, subject_key, score, headline, evidence}] in rank
    order (rank is assigned here from list position)."""
    with conn.cursor() as cur:
        for rank, row in enumerate(rows, start=1):
            cur.execute(
                UPSERT,
                (
                    kind,
                    row["subject_type"],
                    row["subject_key"],
                    rank,
                    row["score"],
                    row["headline"],
                    json.dumps(row["evidence"]),
                    computed_at,
                ),
            )
        cur.execute(
            "delete from intel_insights where kind = %s and computed_at < %s",
            (kind, datetime.now(timezone.utc) - RETENTION),
        )
    conn.commit()
