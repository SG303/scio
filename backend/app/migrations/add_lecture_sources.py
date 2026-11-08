"""Add lecture_ids (lecture notes as generation source) to test_configs and
flashcard_decks. Fresh databases get the column from create_all(); this
upgrades existing ones. Idempotent (PRAGMA check)."""

import logging
import os
import sqlite3
from typing import Optional

from app.config import get_settings

logger = logging.getLogger(__name__)

TABLES = ("test_configs", "flashcard_decks")


def migrate(db_path: Optional[str] = None) -> None:
    db_path = db_path or get_settings().database_path
    if not os.path.exists(db_path):
        return
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        for table in TABLES:
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,))
            if cursor.fetchone() is None:
                continue
            cursor.execute(f"PRAGMA table_info({table})")
            if "lecture_ids" not in {row[1] for row in cursor.fetchall()}:
                cursor.execute(f"ALTER TABLE {table} ADD COLUMN lecture_ids JSON")
                logger.info("Added 'lecture_ids' column to %s", table)
        conn.commit()
    finally:
        conn.close()
