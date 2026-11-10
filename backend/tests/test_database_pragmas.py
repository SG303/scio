"""Test the app's SQLite connection listener against a temporary database.

A long-lived read transaction (held open across an AI call) must not block
commits of other endpoints, so the app engine's connections run in WAL mode
with a busy_timeout instead of the default journal mode.
"""

import pytest
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import create_async_engine

from app.database import BUSY_TIMEOUT_MS, set_sqlite_pragmas
from app.database import engine as app_engine


@pytest.fixture
async def engine(tmp_path):
    assert event.contains(app_engine.sync_engine, "connect", set_sqlite_pragmas)
    # Avoid SQLite's default 5 s timeout masking a missing busy_timeout pragma.
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'scio.db'}", connect_args={"timeout": 0}
    )
    event.listen(engine.sync_engine, "connect", set_sqlite_pragmas)
    try:
        yield engine
    finally:
        await engine.dispose()


async def test_connections_run_in_wal_mode(engine):
    async with engine.connect() as connection:
        journal_mode = (await connection.execute(text("PRAGMA journal_mode"))).scalar()
        assert journal_mode == "wal"


async def test_connections_have_busy_timeout(engine):
    async with engine.connect() as connection:
        busy_timeout = (await connection.execute(text("PRAGMA busy_timeout"))).scalar()
        assert busy_timeout == BUSY_TIMEOUT_MS
