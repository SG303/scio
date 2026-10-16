"""Tests for app settings persistence (verification model resolution).

The settings router reads the verification model from the settings table
with the config default as fallback; updating upserts the stored value.
"""
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.config import get_settings
from app.models import Base, Setting
from app.routers.settings import (
    VERIFICATION_MODEL_KEY,
    get_app_settings,
    get_verification_model,
    update_app_settings,
)
from app.schemas.settings import AppSettingsUpdate


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db:
        yield db
    await engine.dispose()


@pytest.mark.asyncio
async def test_fallback_to_config_default_when_unset(session):
    assert await get_verification_model(session) == get_settings().verification_model


@pytest.mark.asyncio
async def test_fallback_when_stored_value_is_empty(session):
    session.add(Setting(key=VERIFICATION_MODEL_KEY, value=""))
    await session.commit()
    assert await get_verification_model(session) == get_settings().verification_model


@pytest.mark.asyncio
async def test_stored_value_wins(session):
    session.add(Setting(key=VERIFICATION_MODEL_KEY, value="openai/gpt-6.1-sol"))
    await session.commit()
    assert await get_verification_model(session) == "openai/gpt-6.1-sol"


@pytest.mark.asyncio
async def test_update_persists_new_setting(session):
    response = await update_app_settings(
        AppSettingsUpdate(verification_model="google/gemini-3.8-flash"), session
    )
    assert response.verification_model == "google/gemini-3.8-flash"

    stored = (
        await session.execute(
            select(Setting).where(Setting.key == VERIFICATION_MODEL_KEY)
        )
    ).scalar_one()
    assert stored.value == "google/gemini-3.8-flash"
    assert await get_verification_model(session) == "google/gemini-3.8-flash"


@pytest.mark.asyncio
async def test_update_overwrites_existing_setting(session):
    await update_app_settings(
        AppSettingsUpdate(verification_model="anthropic/claude-haiku-5.5"), session
    )
    await update_app_settings(
        AppSettingsUpdate(verification_model="anthropic/claude-sonnet-5.5"), session
    )

    assert await get_verification_model(session) == "anthropic/claude-sonnet-5.5"
    count = (
        await session.execute(
            select(Setting).where(Setting.key == VERIFICATION_MODEL_KEY)
        )
    ).scalars().all()
    assert len(count) == 1


@pytest.mark.asyncio
async def test_get_endpoint_returns_effective_model(session):
    response = await get_app_settings(session)
    assert response.verification_model == get_settings().verification_model
