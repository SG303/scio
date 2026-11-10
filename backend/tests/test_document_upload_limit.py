"""Document uploads: size limit."""

import io
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app.routers import documents as documents_router


@pytest.fixture
async def db(tmp_path, monkeypatch):
    monkeypatch.setattr(documents_router, "settings", SimpleNamespace(uploads_path=str(tmp_path)))
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with session_factory() as session:
            yield session
    finally:
        await engine.dispose()


def _upload(size: int) -> UploadFile:
    return UploadFile(file=io.BytesIO(b"a" * size), filename="book.txt")


def test_limit_is_300_mb():
    assert documents_router.MAX_FILE_SIZE == 300 * 1024 * 1024


async def test_file_at_the_limit_is_accepted(db, monkeypatch):
    monkeypatch.setattr(documents_router, "MAX_FILE_SIZE", 10)
    document = await documents_router.upload_document("Book", "textbook", _upload(10), db)
    assert document.content == "a" * 10


async def test_file_over_the_limit_is_rejected(db, monkeypatch, tmp_path):
    monkeypatch.setattr(documents_router, "MAX_FILE_SIZE", 10)
    with pytest.raises(HTTPException) as exc:
        await documents_router.upload_document("Book", "textbook", _upload(11), db)
    assert exc.value.status_code == 413
    assert list(tmp_path.iterdir()) == []
