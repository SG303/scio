"""Add chapter columns (parent_document_id, page_start, page_end) to
documents. Fresh databases get them from create_all(); this upgrades
existing ones. Idempotent (PRAGMA check)."""
import logging
import os
import sqlite3
from typing import Optional

from app.config import get_settings

logger = logging.getLogger(__name__)

COLUMNS = (
    ("parent_document_id", "INTEGER REFERENCES documents(id)"),
    ("page_start", "INTEGER"),
    ("page_end", "INTEGER"),
)


def migrate(db_path: Optional[str] = None) -> None:
    db_path = db_path or get_settings().database_path
    if not os.path.exists(db_path):
        return
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='documents'")
        if cursor.fetchone() is None:
            return
        cursor.execute("PRAGMA table_info(documents)")
        existing = {row[1] for row in cursor.fetchall()}
        for name, definition in COLUMNS:
            if name not in existing:
                cursor.execute(f"ALTER TABLE documents ADD COLUMN {name} {definition}")
                logger.info("Added '%s' column to documents", name)
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS ix_documents_parent_document_id "
            "ON documents(parent_document_id)"
        )
        conn.commit()
    finally:
        conn.close()
