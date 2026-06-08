"""Periodic SQLite backups for the single-instance deployment."""

from __future__ import annotations

import asyncio
from datetime import datetime
import os
from pathlib import Path
import sqlite3

from database import DATA_DIR


BACKUP_DIR = Path(__file__).resolve().parents[2] / "storage" / "backups"
DATABASE_PATH = DATA_DIR / "pinterest.db"


def backup_database(retention_count: int = 7) -> Path | None:
    if not DATABASE_PATH.exists():
        return None
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    destination = BACKUP_DIR / f"pinterest_{datetime.utcnow():%Y%m%d_%H%M%S}.db"
    with sqlite3.connect(DATABASE_PATH) as source, sqlite3.connect(destination) as target:
        source.backup(target)

    backups = sorted(
        BACKUP_DIR.glob("pinterest_*.db"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for stale in backups[max(1, retention_count):]:
        stale.unlink(missing_ok=True)
    return destination


async def run_database_backup_loop(stop_event: asyncio.Event) -> None:
    interval = max(
        300,
        int(os.getenv("DATABASE_BACKUP_INTERVAL_SECONDS", "86400")),
    )
    retention = max(
        1,
        int(os.getenv("DATABASE_BACKUP_RETENTION_COUNT", "7")),
    )
    while not stop_event.is_set():
        try:
            await asyncio.to_thread(backup_database, retention)
        except Exception:
            # A failed backup must not stop the application or future attempts.
            pass
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval)
        except asyncio.TimeoutError:
            continue
