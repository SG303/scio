"""Tests for automatic SQLite database backups.

Covers the backup service (validated file creation, retention pruning,
collision handling, cycle function), the /api/settings/backups endpoints
and their exact response shape as consumed later by the frontend.
"""
import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.schemas.settings import BackupCreateResponse, BackupListResponse
from app.routers import settings as settings_router
from app.services import db_backup


@pytest.fixture
def source_db(tmp_path):
    """A small real SQLite database created via stdlib sqlite3."""
    db_path = tmp_path / "scio.db"
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT)")
    conn.executemany("INSERT INTO notes (text) VALUES (?)", [(f"note {i}",) for i in range(3)])
    conn.commit()
    conn.close()
    return db_path


def _stub_settings(monkeypatch, database_path):
    """Point the settings router at a custom database path."""

    class FakeSettings:
        pass

    fake = FakeSettings()
    fake.database_path = str(database_path)
    monkeypatch.setattr(settings_router, "get_settings", lambda: fake)


# --- (a) create_backup produces a valid SQLite file -------------------------


async def test_create_backup_writes_valid_verified_db(source_db):
    info = await db_backup.create_backup(str(source_db))

    backup_path = source_db.parent / "backups" / info["file_name"]
    assert backup_path.is_file()
    assert info["file_name"].startswith("scio-backup-")
    assert info["file_name"].endswith(".db")
    assert info["size_bytes"] == backup_path.stat().st_size
    assert info["size_bytes"] > 0

    # The copy is a genuine, intact database containing our data
    conn = sqlite3.connect(backup_path)
    assert conn.execute("PRAGMA quick_check").fetchone()[0] == "ok"
    rows = conn.execute("SELECT text FROM notes ORDER BY id").fetchall()
    conn.close()
    assert rows == [("note 0",), ("note 1",), ("note 2",)]


async def test_create_backup_missing_db_raises(source_db):
    missing = source_db.parent / "does-not-exist.db"
    with pytest.raises(Exception):
        await db_backup.create_backup(str(missing))


async def test_create_backup_same_second_collision_suffix(source_db, tmp_path):
    backup_dir = db_backup.get_backup_dir(str(source_db))
    backup_dir.mkdir(parents=True)
    existing = backup_dir / "scio-backup-20260101-000000.db"
    existing.write_bytes(b"stale")

    path = db_backup._unique_target_path(backup_dir, datetime(2026, 1, 1))

    assert path != existing
    assert path.name == "scio-backup-20260101-000000-1.db"


# --- (b) retention: keep the newest RETENTION_KEEP, delete the rest ---------


def _touch_backup_files(backup_dir, count):
    for i in range(count):
        path = backup_dir / f"scio-backup-20260101-{i:06d}.db"
        path.write_bytes(b"x" * (i + 1))
        os.utime(path, (1000 + i, 1000 + i))


def test_prune_keeps_newest_retention_keep(tmp_path):
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    _touch_backup_files(backup_dir, 16)

    deleted = db_backup.prune_old_backups(backup_dir)

    remaining = sorted(p.name for p in backup_dir.iterdir())
    assert len(remaining) == db_backup.RETENTION_KEEP == 14
    # The 14 newest survive in place, the two oldest are gone
    assert remaining == [f"scio-backup-20260101-{i:06d}.db" for i in range(2, 16)]
    assert sorted(deleted) == [f"scio-backup-20260101-{i:06d}.db" for i in range(0, 2)]


def test_list_backups_returns_only_backup_files_newest_first(tmp_path):
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    _touch_backup_files(backup_dir, 3)
    (backup_dir / "scio-backup-20260101-000003.dbx").write_bytes(b"not a backup")
    (backup_dir / "unrelated-backup-20260101-000003.db").write_bytes(b"wrong prefix")
    (backup_dir / "scio-backup-20260101-000003.db-shm").write_bytes(b"wal sidecar")

    backups = db_backup.list_backups(str(tmp_path / "scio.db"))

    assert [b["file_name"] for b in backups] == [
        f"scio-backup-20260101-{i:06d}.db" for i in (2, 1, 0)
    ]
    assert backups[0]["size_bytes"] == 3


def test_list_backups_without_dir_is_empty(tmp_path):
    assert db_backup.list_backups(str(tmp_path / "scio.db")) == []


# --- (d) single backup cycle, independent of the 24h loop -------------------


async def test_run_backup_cycle_creates_and_prunes(source_db):
    backup_dir = db_backup.get_backup_dir(str(source_db))
    backup_dir.mkdir(parents=True)
    _touch_backup_files(backup_dir, 16)

    info = await db_backup.run_backup_cycle(str(source_db))

    assert info is not None
    assert info["file_name"].startswith("scio-backup-")
    files = list(backup_dir.iterdir())
    assert len(files) == db_backup.RETENTION_KEEP
    # The fresh backup itself survived the retention run
    assert (backup_dir / info["file_name"]).is_file()


async def test_run_backup_cycle_errors_are_logged_not_raised(
    source_db, monkeypatch, caplog
):
    async def failing_create_backup(_):
        raise RuntimeError("boom")

    monkeypatch.setattr(db_backup, "create_backup", failing_create_backup)

    assert await db_backup.run_backup_cycle(str(source_db)) is None
    assert "Automatic database backup failed" in caplog.text


# --- (c) endpoints against the configured database path ---------------------


async def test_post_creates_backup_and_get_lists_it(tmp_path, source_db, monkeypatch):
    _stub_settings(monkeypatch, source_db)

    created = await settings_router.create_backup()
    listing = await settings_router.list_backups()

    # Exact frontend contract shapes
    created_json = json.loads(BackupCreateResponse.model_validate(created).model_dump_json())
    assert created_json == {
        "backup": {
            "file_name": created_json["backup"]["file_name"],
            "size_bytes": created_json["backup"]["size_bytes"],
            "created_at": created_json["backup"]["created_at"],
        }
    }
    assert created_json["backup"]["file_name"].startswith("scio-backup-")

    listing_json = json.loads(BackupListResponse.model_validate(listing).model_dump_json())
    assert [b["file_name"] for b in listing_json["backups"]] == [
        created_json["backup"]["file_name"]
    ]
    assert listing_json["backups"][0]["size_bytes"] > 0
    assert listing_json["backups"][0]["created_at"].endswith("+00:00")


async def test_list_endpoint_newest_first(tmp_path, source_db, monkeypatch):
    _stub_settings(monkeypatch, source_db)
    backup_dir = db_backup.get_backup_dir(str(source_db))
    backup_dir.mkdir(parents=True)
    _touch_backup_files(backup_dir, 3)

    listing = await settings_router.list_backups()

    assert [b.file_name for b in listing.backups] == [
        f"scio-backup-20260101-{i:06d}.db" for i in (2, 1, 0)
    ]


async def test_post_endpoint_failure_returns_500_with_detail(tmp_path, monkeypatch):
    _stub_settings(monkeypatch, tmp_path / "does-not-exist.db")

    with pytest.raises(HTTPException) as error:
        await settings_router.create_backup()
    assert error.value.status_code == 500
    assert "Database backup failed" in error.value.detail
