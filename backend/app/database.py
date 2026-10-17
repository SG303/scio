from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.config import get_settings
import os

# P6.4b: a concurrent writer waits up to this long for the file lock
# instead of failing immediately with "database is locked"
BUSY_TIMEOUT_MS = 5000

settings = get_settings()

# Ensure data directory exists
os.makedirs(os.path.dirname(settings.database_path), exist_ok=True)

DATABASE_URL = f"sqlite+aiosqlite:///{settings.database_path}"

engine = create_async_engine(
    DATABASE_URL,
    echo=settings.debug,
    connect_args={"check_same_thread": False}
)


@event.listens_for(engine.sync_engine, "connect")
def set_sqlite_pragmas(dbapi_connection, connection_record):
    """Apply per-connection SQLite settings on every new raw connection.

    WAL lets a long-running read transaction (e.g. one held open across
    an AI call) coexist with commits of other endpoints instead of
    blocking them; busy_timeout makes competing writers wait briefly
    rather than erroring out. Both are idempotent, and WAL is persisted
    in the database file. In-memory engines (used by tests with their
    own engines) bypass this — they only run on this module's app engine.
    """
    cursor = dbapi_connection.cursor()
    cursor.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()

async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

