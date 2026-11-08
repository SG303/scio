"""Global default AI model: settings API, resolution order, delete protection."""

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import models
from app.database import Base
from app.routers import ai_models as ai_models_router
from app.routers import lectures as lectures_router
from app.routers.settings import get_app_settings, update_app_settings
from app.schemas.lecture import LectureFormatRequest
from app.schemas.settings import AppSettingsUpdate
from app.services.default_model import resolve_ai_model_id


@pytest.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with factory() as session:
            session.add_all(
                [
                    models.AIModel(name="Global", openrouter_id="test/global"),
                    models.AIModel(name="Subject", openrouter_id="test/subject"),
                    models.AIModel(name="Off", openrouter_id="test/off", is_enabled=False),
                ]
            )
            session.add(models.Subject(title="Marketing"))
            session.add(models.Lecture(subject_id=1, title="Week 1", content="notes"))
            await session.commit()
            yield session
    finally:
        await engine.dispose()


async def test_default_is_unset_at_first(db):
    assert (await get_app_settings(db)).default_ai_model_id is None


async def test_set_and_clear_default(db):
    saved = await update_app_settings(AppSettingsUpdate(default_ai_model_id=1), db)
    assert saved.default_ai_model_id == 1
    assert (await get_app_settings(db)).default_ai_model_id == 1

    cleared = await update_app_settings(AppSettingsUpdate(default_ai_model_id=None), db)
    assert cleared.default_ai_model_id is None


async def test_updating_only_the_verification_model_keeps_the_default(db):
    await update_app_settings(AppSettingsUpdate(default_ai_model_id=1), db)
    saved = await update_app_settings(AppSettingsUpdate(verification_model="x/y"), db)
    assert (saved.verification_model, saved.default_ai_model_id) == ("x/y", 1)


@pytest.mark.parametrize("model_id", [99, 3])
async def test_unknown_or_disabled_model_cannot_be_the_default(db, model_id):
    with pytest.raises(HTTPException) as exc:
        await update_app_settings(AppSettingsUpdate(default_ai_model_id=model_id), db)
    assert exc.value.status_code == 400


async def test_resolution_order_is_explicit_then_subject_then_global(db):
    assert await resolve_ai_model_id(db, None, None) is None
    await update_app_settings(AppSettingsUpdate(default_ai_model_id=1), db)
    assert await resolve_ai_model_id(db, None, None) == 1
    assert await resolve_ai_model_id(db, None, 2) == 2
    assert await resolve_ai_model_id(db, 3, 2) == 3


async def test_format_uses_the_global_default_without_subject_model(db, monkeypatch):
    seen = {}

    async def fake_format(markdown, model_id):
        seen["model"] = model_id
        return "formatted"

    monkeypatch.setattr(lectures_router, "format_lecture", fake_format)
    await update_app_settings(AppSettingsUpdate(default_ai_model_id=1), db)

    await lectures_router.format_lecture_notes(1, LectureFormatRequest(), db)
    assert seen["model"] == "test/global"

    subject = await db.get(models.Subject, 1)
    subject.ai_model_id = 2
    await db.commit()
    await lectures_router.format_lecture_notes(1, LectureFormatRequest(), db)
    assert seen["model"] == "test/subject"


async def test_the_global_default_model_cannot_be_deleted(db):
    await update_app_settings(AppSettingsUpdate(default_ai_model_id=1), db)
    with pytest.raises(HTTPException) as exc:
        await ai_models_router.delete_model(1, db)
    assert exc.value.status_code == 409
    assert "default" in exc.value.detail
