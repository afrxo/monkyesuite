"""Entry point: python -m intel.run

Runs each intel job in its own transaction with its own failure domain — one
broken job never blanks the other sections (same isolation principle as the
worker's discover-vs-snapshot split). Exit code 0 if at least one job landed,
1 if everything failed (so Railway cron alerting fires on total loss only).
"""

import json
import sys
import time
from datetime import datetime, timezone

from . import db
from .jobs import movement, trend_confidence, watchlist

JOBS = [
    ("trend_confidence", trend_confidence.run),
    ("movement", movement.run),
    ("watch", watchlist.run),
]


def log(**fields: object) -> None:
    print(json.dumps({"ts": datetime.now(timezone.utc).isoformat(), **fields}))


def main() -> int:
    computed_at = datetime.now(timezone.utc)
    conn = db.connect()
    succeeded = 0
    try:
        for name, job in JOBS:
            started = time.monotonic()
            try:
                count = job(conn, computed_at)
                log(job=name, status="ok", rows=count,
                    duration_ms=round((time.monotonic() - started) * 1000))
                succeeded += 1
            except Exception as exc:  # noqa: BLE001 — job isolation is the point
                conn.rollback()
                log(job=name, status="error", error=str(exc),
                    duration_ms=round((time.monotonic() - started) * 1000))
    finally:
        conn.close()
    return 0 if succeeded > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
