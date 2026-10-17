"""Tests for default AI model seeding (re-seed and text sync).

Seeding replaces stale defaults and syncs name/description of models that
already exist, so description fixes reach existing installations.
"""
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app import models
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


async def test_reseed_deletes_unreferenced_stale_default(session):
    """A stale default no longer referenced by any subject/config/deck is
    removed on re-seed — nobody can lose a usable reference."""
    await seed_default_models(session)
    stale = AIModel(
        name="Old Default",
        openrouter_id="old/stale-model",
        description="previous generation default",
        is_default=True,
    )
    session.add(stale)
    await session.commit()
    stale_id = stale.id
    await _set_version(session, MODELS_VERSION - 1)

    await seed_default_models(session)

    row = (
        await session.execute(select(AIModel).where(AIModel.id == stale_id))
    ).scalar_one_or_none()
    assert row is None


async def test_reseed_keeps_referenced_stale_default(session):
    """A stale default still referenced by a test config or subject is kept
    (SQLite FKs are off — deleting it would leave dangling ai_model_id rows
    that break later generations) and merely un-flagged. Neutral references
    to still-current defaults are untouched."""
    await seed_default_models(session)
    sonnet = (
        await session.execute(
            select(AIModel).where(AIModel.openrouter_id == SONNET_ID)
        )
    ).scalar_one()
    stale = AIModel(
        name="Old Default",
        openrouter_id="old/stale-model",
        description="previous generation default",
        is_default=True,
    )
    session.add(stale)
    await session.flush()
    config = models.TestConfig(
        title="Config",
        num_questions=1,
        num_choices=4,
        ai_model_id=stale.id,
        document_ids=[],
    )
    subject = models.Subject(title="Subject", ai_model_id=stale.id)
    session.add_all([config, subject])
    await session.commit()
    stale_id = stale.id
    sonnet_id = sonnet.id
    await _set_version(session, MODELS_VERSION - 1)

    await seed_default_models(session)

    row = (
        await session.execute(select(AIModel).where(AIModel.id == stale_id))
    ).scalar_one()
    assert row.is_default is False
    # References stayed intact (no dangling ids) …
    config_after = (
        await session.execute(select(models.TestConfig).order_by(models.TestConfig.id))
    ).scalars().first()
    assert config_after.ai_model_id == stale_id
    subject_after = (
        await session.execute(select(models.Subject).order_by(models.Subject.id))
    ).scalars().first()
    assert subject_after.ai_model_id == stale_id
    # … and the still-current default is untouched
    sonnet_after = (
        await session.execute(select(AIModel).where(AIModel.id == sonnet_id))
    ).scalar_one()
    assert sonnet_after.is_default is True
