from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.config import get_settings
import os

settings = get_settings()

# Ensure data directory exists
os.makedirs(os.path.dirname(settings.database_path), exist_ok=True)

DATABASE_URL = f"sqlite+aiosqlite:///{settings.database_path}"

engine = create_async_engine(
    DATABASE_URL,
    echo=settings.debug,
    connect_args={"check_same_thread": False}
)

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

