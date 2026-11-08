"""Tests for provider settings: OpenRouter key management and the one-time
seeding of the Claude subscription models.

OpenRouter itself is never contacted: key verification and the chat
endpoint are replaced by fakes.
"""

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import get_settings
from app.models import AIModel, Base, Setting
from app.routers import providers
from app.routers.ai_models import SUBSCRIPTION_MODELS, seed_subscription_models
from app.schemas.providers import OpenRouterKeyUpdate
from app.services import openrouter_client, openrouter_key


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db:
        yield db
    await engine.dispose()


@pytest.fixture
def env_key(monkeypatch):
    def _set(value: str):
        monkeypatch.setattr(get_settings(), "openrouter_api_key", value)

    _set("")
    return _set


@pytest.fixture
def accept_any_key(monkeypatch):
    async def fake_verify(key):
        return None

    monkeypatch.setattr(openrouter_key, "verify_key", fake_verify)


async def test_no_key_configured(session, env_key):
    status = await providers.get_openrouter_status(session)
    assert status.configured is False
    assert status.key_hint is None


async def test_environment_key_is_fallback(session, env_key):
    env_key("sk-or-env-0000000001234")
    status = await providers.get_openrouter_status(session)
    assert status.configured is True
    assert status.source == "environment"
    assert status.key_hint == "…1234"


async def test_stored_key_wins_and_is_never_returned(session, env_key, accept_any_key):
    env_key("sk-or-env-0000000001234")
    status = await providers.set_openrouter_key(
        OpenRouterKeyUpdate(api_key="  sk-or-app-0000000005678  "), session
    )
    assert status.source == "app"
    assert status.key_hint == "…5678"
    assert "sk-or-app" not in status.model_dump_json()
    assert await openrouter_key.get_effective_key(session) == ("sk-or-app-0000000005678", "app")


async def test_delete_falls_back_to_environment(session, env_key, accept_any_key):
    env_key("sk-or-env-0000000001234")
    await providers.set_openrouter_key(
        OpenRouterKeyUpdate(api_key="sk-or-app-0000000005678"), session
    )
    status = await providers.delete_openrouter_key(session)
    assert status.source == "environment"
    assert status.key_hint == "…1234"


async def test_rejected_key_is_not_stored(session, env_key, monkeypatch):
    async def reject(key):
        raise ValueError("OpenRouter rejected this API key.")

    monkeypatch.setattr(openrouter_key, "verify_key", reject)

    with pytest.raises(HTTPException) as exc:
        await providers.set_openrouter_key(
            OpenRouterKeyUpdate(api_key="sk-or-bad-000000000"), session
        )
    assert exc.value.status_code == 400
    assert (await providers.get_openrouter_status(session)).configured is False


async def test_openrouter_call_uses_effective_key(monkeypatch):
    sent = {}

    async def fake_load():
        return "sk-or-app-0000000005678"

    class FakeResponse:
        status_code = 200
        text = ""

        def json(self):
            return {"choices": [{"message": {"content": "{}"}}]}

    async def fake_post(client, payload, api_key):
        sent["api_key"] = api_key
        return FakeResponse()

    monkeypatch.setattr(openrouter_client, "load_effective_key", fake_load)
    monkeypatch.setattr(openrouter_client, "_post", fake_post)

    content = await openrouter_client.chat_completion_json(
        model_id="openai/gpt-6.1-sol", system_prompt="s", user_prompt="u", temperature=0.7
    )
    assert content == "{}"
    assert sent["api_key"] == "sk-or-app-0000000005678"


async def test_openrouter_call_without_key_names_settings(monkeypatch):
    async def fake_load():
        return ""

    monkeypatch.setattr(openrouter_client, "load_effective_key", fake_load)
    with pytest.raises(ValueError, match="Settings → AI providers"):
        await openrouter_client.chat_completion_json(
            model_id="openai/gpt-6.1-sol", system_prompt="s", user_prompt="u", temperature=0.7
        )


async def test_subscription_models_are_seeded_once(session):
    await seed_subscription_models(session)
    ids = set((await session.execute(select(AIModel.openrouter_id))).scalars().all())
    assert ids == {m["openrouter_id"] for m in SUBSCRIPTION_MODELS}

    # A model the user deleted is not re-added on the next sign-in
    sonnet = (
        await session.execute(
            select(AIModel).where(AIModel.openrouter_id == "claude-subscription/sonnet")
        )
    ).scalar_one()
    await session.delete(sonnet)
    await session.commit()

    await seed_subscription_models(session)
    ids = set((await session.execute(select(AIModel.openrouter_id))).scalars().all())
    assert "claude-subscription/sonnet" not in ids
    assert len(ids) == len(SUBSCRIPTION_MODELS) - 1


async def test_subscription_seed_keeps_existing_models(session):
    session.add(AIModel(name="My Opus", openrouter_id="claude-subscription/opus"))
    await session.commit()

    await seed_subscription_models(session)

    opus = (
        (
            await session.execute(
                select(AIModel).where(AIModel.openrouter_id == "claude-subscription/opus")
            )
        )
        .scalars()
        .all()
    )
    assert [m.name for m in opus] == ["My Opus"]
    flag = (
        await session.execute(
            select(Setting).where(Setting.key == "claude_subscription_models_seeded")
        )
    ).scalar_one()
    assert flag.value == "1"
