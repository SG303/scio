"""Add new_card_order (order of new cards in the study queue) to
flashcard_decks. Fresh databases get the column from create_all(); this
upgrades existing ones. Idempotent (PRAGMA check). Existing decks keep the
previous behaviour ("created" = oldest first)."""

import logging
import os
import sqlite3

from app.config import get_settings

logger = logging.getLogger(__name__)


def migrate(db_path: str | None = None) -> None:
    db_path = db_path or get_settings().database_path
    if not os.path.exists(db_path):
        return
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='flashcard_decks'"
        )
        if cursor.fetchone() is None:
            return
        cursor.execute("PRAGMA table_info(flashcard_decks)")
        if "new_card_order" not in {row[1] for row in cursor.fetchall()}:
            cursor.execute(
                "ALTER TABLE flashcard_decks "
                "ADD COLUMN new_card_order VARCHAR(20) NOT NULL DEFAULT 'created'"
            )
            logger.info("Added 'new_card_order' column to flashcard_decks")
        conn.commit()
    finally:
        conn.close()
