"""Automatic SQLite database backups (online-consistent copies).

Backups live in a "backups" folder next to the configured database file
(the Docker bind mount data/), named scio-backup-YYYYMMDD-HHMMSS.db.
Creation uses stdlib sqlite3's Connection.backup(), which yields a
consistent snapshot even while other connections write, and runs in a
worker thread so the event loop is never blocked. Every backup is
verified with PRAGMA quick_check before it counts as successful.
"""
import asyncio
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

# Scheduling: first backup ~1 minute after startup, then once a day.
BACKUP_INTERVAL_SECONDS = 24 * 3600
FIRST_BACKUP_DELAY_SECONDS = 60
# How many most-recent backup files to keep.
RETENTION_KEEP = 14

BACKUP_DIR_NAME = "backups"
BACKUP_FILE_PREFIX = "scio-backup-"
BACKUP_FILE_SUFFIX = ".db"


def get_backup_dir(database_path: str) -> Path:
    """Directory holding all backups: "<db parent>/backups"."""
    return Path(database_path).resolve().parent / BACKUP_DIR_NAME


def _unique_target_path(backup_dir: Path, now: datetime) -> Path:
    """Backup path for the current second; adds a counter suffix on
    collision (two backups within the same second)."""
    target = backup_dir / (
        f"{BACKUP_FILE_PREFIX}{now:%Y%m%d-%H%M%S}{BACKUP_FILE_SUFFIX}"
    )
    counter = 1
    while target.exists():
        target = backup_dir / (
            f"{BACKUP_FILE_PREFIX}{now:%Y%m%d-%H%M%S}-{counter}{BACKUP_FILE_SUFFIX}"
        )
        counter += 1
    return target


def _backup_files(backup_dir: Path) -> list[Path]:
    """All backup files (scio-backup-*.db) in the directory, newest first.

    Only files with the exact backup prefix and suffix are ever returned
    or scanned; anything else in the directory is left alone.
    """
    if not backup_dir.is_dir():
        return []
    files = [
        path
        for path in backup_dir.iterdir()
        if path.is_file()
        and path.name.startswith(BACKUP_FILE_PREFIX)
        and path.name.endswith(BACKUP_FILE_SUFFIX)
    ]
    # Newest first by mtime; name as tie-breaker for same-second files.
    files.sort(key=lambda path: (path.stat().st_mtime, path.name), reverse=True)
    return files


def _create_backup_sync(database_path: str) -> Path:
    """Blocking part of a backup: copy + integrity check. Returns the
    backup file path or raises."""
    source_path = Path(database_path)
    if not source_path.is_file():
        raise FileNotFoundError(f"Database file not found: {database_path}")

    backup_dir = get_backup_dir(database_path)
    backup_dir.mkdir(parents=True, exist_ok=True)
    target_path = _unique_target_path(backup_dir, datetime.now(timezone.utc))

    # Connect to an existing DB: the main DB is written live by the app,
    # so a plain file copy would risk a torn snapshot. Connection.backup()
    # produces an online-consistent copy instead (WAL handled internally).
    source = sqlite3.connect(source_path)
    target = sqlite3.connect(target_path)
    try:
        source.backup(target)
        check = target.execute("PRAGMA quick_check").fetchone()[0]
        if check != "ok":
            raise RuntimeError(f"Backup integrity check failed: {check}")
    finally:
        target.close()
        source.close()
    return target_path


async def create_backup(database_path: str) -> dict:
    """Create one verified backup and apply retention afterwards.

    The blocking sqlite work runs in a worker thread. Returns a dict
    shaped like schemas.settings.BackupInfo: file_name, size_bytes and
    created_at (ISO timestamp of the backup file, UTC offset included).
    """
    target_path = await asyncio.to_thread(_create_backup_sync, database_path)

    # Retention is best-effort: a failed prune must not void the fresh
    # backup, so it never propagates as an error.
    try:
        prune_old_backups(get_backup_dir(database_path))
    except Exception:
        logger.error("Backup retention cleanup failed", exc_info=True)

    stat = target_path.stat()
    return {
        "file_name": target_path.name,
        "size_bytes": stat.st_size,
        "created_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
    }


def list_backups(database_path: str) -> list[dict]:
    """All backups of the database, newest first (empty list if the
    backup directory does not exist yet)."""
    backups = []
    for path in _backup_files(get_backup_dir(database_path)):
        stat = path.stat()
        backups.append(
            {
                "file_name": path.name,
                "size_bytes": stat.st_size,
                "created_at": datetime.fromtimestamp(
                    stat.st_mtime, tz=timezone.utc
                ).isoformat(),
            }
        )
    return backups


def prune_old_backups(backup_dir: Path) -> list[str]:
    """Keep the RETENTION_KEEP newest backup files, delete the rest.
    Returns the file names that were deleted; only scio-backup-*.db
    files are ever touched."""
    files = _backup_files(backup_dir)
    deleted = []
    for path in files[RETENTION_KEEP:]:
        path.unlink()
        deleted.append(path.name)
    return deleted


async def run_backup_cycle(database_path: str) -> dict | None:
    """One scheduled backup cycle: create a verified backup, then prune.
    Callable directly (tests) independent of the 24h loop in main.py.
    Returns the backup info dict, or None when the backup failed
    (the error is logged and the loop keeps running)."""
    try:
        info = await create_backup(database_path)
    except Exception:
        logger.error("Automatic database backup failed", exc_info=True)
        return None
    logger.info(
        "Database backup created: %s (%d bytes)",
        info["file_name"],
        info["size_bytes"],
    )
    return info
