"""Tests for default AI model seeding (re-seed and text sync).

Seeding replaces stale defaults and syncs name/description of models that
already exist, so description fixes reach existing installations.
"""
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.models import Base, AIModel, Setting
from app.routers.ai_models import DEFAULT_MODELS, MODELS_VERSION, seed_default_models

SONNET_ID = "anthropic/claude-sonnet-5.5"


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db:
        yield db
    await engine.dispose()


async def _set_version(session, value: int):
    row = (
        await session.execute(select(Setting).where(Setting.key == "models_version"))
    ).scalar_one_or_none()
    if row is not None:
        row.value = str(value)
    else:
        session.add(Setting(key="models_version", value=str(value)))
    await session.commit()


@pytest.mark.asyncio
async def test_fresh_seed_adds_all_defaults(session):
    await seed_default_models(session)

    rows = (await session.execute(select(AIModel))).scalars().all()
    assert {m.openrouter_id for m in rows} == {m["openrouter_id"] for m in DEFAULT_MODELS}
    assert all(m.is_default for m in rows)


@pytest.mark.asyncio
async def test_reseed_syncs_name_and_description(session):
    await seed_default_models(session)

    row = (
        await session.execute(select(AIModel).where(AIModel.openrouter_id == SONNET_ID))
    ).scalar_one()
    row.description = "stale description with old pricing"
    row.name = "Stale Name"
    await _set_version(session, MODELS_VERSION - 1)

    await seed_default_models(session)

    expected = next(m for m in DEFAULT_MODELS if m["openrouter_id"] == SONNET_ID)
    assert row.description == expected["description"]
    assert row.name == expected["name"]
    assert row.is_default is True


@pytest.mark.asyncio
async def test_reseed_leaves_user_models_alone(session):
    session.add(
        AIModel(name="My Model", openrouter_id="my/custom-model", description="mine")
    )
    await session.commit()
    await _set_version(session, 0)

    await seed_default_models(session)

    row = (
        await session.execute(
            select(AIModel).where(AIModel.openrouter_id == "my/custom-model")
        )
    ).scalar_one()
    assert row.description == "mine"
    assert row.is_default is False
