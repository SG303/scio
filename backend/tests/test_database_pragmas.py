"""Tests for the per-connection SQLite pragmas on the app engine (P6.4b).

A long-lived read transaction (held open across an AI call) must not block
commits of other endpoints, so the app engine's connections run in WAL mode
with a busy_timeout instead of the default journal mode.
"""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.database import BUSY_TIMEOUT_MS, async_session


async def test_app_engine_connections_run_in_wal_mode():
    async with async_session() as session:
        journal_mode = (await session.execute(text("PRAGMA journal_mode"))).scalar()
        assert journal_mode == "wal"


async def test_app_engine_connections_have_busy_timeout():
    async with async_session() as session:
        busy_timeout = (await session.execute(text("PRAGMA busy_timeout"))).scalar()
        assert busy_timeout == BUSY_TIMEOUT_MS
