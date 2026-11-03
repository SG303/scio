"""Add the AI-formatting columns to an existing lectures table.

Fresh databases get them from create_all(); this only upgrades databases
created before lecture formatting existed. Idempotent (PRAGMA check).
"""
import logging
import os
import sqlite3
from typing import Optional

from app.config import get_settings

logger = logging.getLogger(__name__)

COLUMNS = {
    "original_content": "TEXT",
    "formatted_at": "DATETIME",
}


def migrate(db_path: Optional[str] = None) -> None:
    db_path = db_path or get_settings().database_path
    if not os.path.exists(db_path):
        return
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='lectures'")
        if cursor.fetchone() is None:
            return
        cursor.execute("PRAGMA table_info(lectures)")
        existing = {row[1] for row in cursor.fetchall()}
        for name, sql_type in COLUMNS.items():
            if name not in existing:
                cursor.execute(f"ALTER TABLE lectures ADD COLUMN {name} {sql_type}")
                logger.info("Added '%s' column to lectures table", name)
        conn.commit()
    finally:
        conn.close()
