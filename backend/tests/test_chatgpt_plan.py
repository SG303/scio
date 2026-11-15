"""Tests for the ChatGPT subscription provider (app/services/chatgpt_plan.py).

OpenAI is never contacted: the token endpoint, the streamed Responses call
and the model list are replaced by fakes. Credentials go to a temporary
data directory.
"""

import base64
import json
import os
import stat
import time
from urllib.parse import parse_qs, urlencode, urlparse

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import get_settings
from app.models import AIModel, Base
from app.routers.ai_models import seed_chatgpt_models
from app.services import chatgpt_plan
from app.services.openrouter_client import chat_completion_json

ISSUED_CLIENT = "oaiapp_test123"


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "database_path", str(tmp_path / "scio.db"))
    chatgpt_plan.cancel_login()
    monkeypatch.setattr(chatgpt_plan, "_models_cache", None)
    return tmp_path


def _jwt(claims: dict) -> str:
    def part(data: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()

    return f"{part({'alg': 'RS256'})}.{part(claims)}.signature"


def _tokens(nonce: str, client_id: str = ISSUED_CLIENT, scope: str = chatgpt_plan.SCOPES) -> dict:
    return {
        "access_token": "access-1",
        "refresh_token": "refresh-1",
        "expires_in": 3600,
        "scope": scope,
        "token_type": "Bearer",
        "id_token": _jwt(
            {
                "iss": chatgpt_plan.ISSUER,
                "aud": [client_id],
                "nonce": nonce,
                "exp": time.time() + 600,
                "sub": "user-1",
                "email": "me@example.com",
            }
        ),
    }


@pytest.fixture
def token_endpoint(monkeypatch):
    """Fake token endpoint; set .response to a callable(data) -> httpx.Response."""

    class Endpoint:
        calls: list[dict] = []
        response = None

    async def fake_post(data):
        Endpoint.calls.append(data)
        return Endpoint.response(data)

    Endpoint.calls = []
    monkeypatch.setattr(chatgpt_plan, "_post_token", fake_post)
    return Endpoint


def _callback(url: str, **overrides) -> str:
    params = parse_qs(urlparse(url).query)
    query = {"code": "auth-code", "state": params["state"][0], "client_id": ISSUED_CLIENT}
    query.update(overrides)
    return f"{chatgpt_plan.REDIRECT_URI}?{urlencode({k: v for k, v in query.items() if v})}"


def _nonce(url: str) -> str:
    return parse_qs(urlparse(url).query)["nonce"][0]


async def _sign_in(token_endpoint) -> None:
    url = chatgpt_plan.start_login()
    nonce = _nonce(url)
    token_endpoint.response = lambda data: httpx.Response(200, json=_tokens(nonce))
    await chatgpt_plan.complete_login(_callback(url))


def test_first_sign_in_registers_dynamically():
    url = chatgpt_plan.start_login()
    params = parse_qs(urlparse(url).query)
    assert url.startswith(chatgpt_plan.AUTHORIZE_URL)
    assert params["client_id"] == ["dynamic_agent_client"]
    assert params["agent_name_hint"] == ["Scio"]
    assert params["redirect_uri"] == ["http://127.0.0.1:1455/auth/callback"]
    assert "chatgpt.tokens.use.direct" in params["scope"][0]
    assert params["code_challenge_method"] == ["S256"]
    assert params["ext_agent_host_id"][0].startswith("urn:uuid:")
    assert chatgpt_plan.login_pending()


async def test_sign_in_stores_tokens_privately(token_endpoint, data_dir):
    await _sign_in(token_endpoint)

    exchange = token_endpoint.calls[0]
    assert exchange["grant_type"] == "authorization_code"
    assert exchange["client_id"] == ISSUED_CLIENT
    assert exchange["code"] == "auth-code"
    assert exchange["redirect_uri"] == chatgpt_plan.REDIRECT_URI

    creds_path = data_dir / chatgpt_plan.CREDENTIALS_FILE
    assert stat.S_IMODE(os.stat(creds_path).st_mode) == 0o600
    assert json.loads(creds_path.read_text())["refresh_token"] == "refresh-1"
    status = chatgpt_plan.get_status()
    assert status == {"logged_in": True, "email": "me@example.com", "login_pending": False}
    # Tokens never show up in the status
    assert "access-1" not in json.dumps(status)


async def test_later_sign_in_reuses_issued_client(token_endpoint):
    await _sign_in(token_endpoint)
    params = parse_qs(urlparse(chatgpt_plan.start_login()).query)
    assert params["client_id"] == [ISSUED_CLIENT]
    assert "agent_name_hint" not in params


async def test_wrong_state_is_rejected(token_endpoint):
    url = chatgpt_plan.start_login()
    with pytest.raises(ValueError, match="does not belong"):
        await chatgpt_plan.complete_login(_callback(url, state="other"))
    assert token_endpoint.calls == []
    # The pending sign-in survives a wrong paste
    assert chatgpt_plan.login_pending()


async def test_denied_access_does_not_exchange_code(token_endpoint):
    url = chatgpt_plan.start_login()
    with pytest.raises(ValueError, match="access_denied"):
        await chatgpt_plan.complete_login(_callback(url, code="", error="access_denied"))
    assert token_endpoint.calls == []


async def test_missing_plan_scope_is_rejected(token_endpoint):
    url = chatgpt_plan.start_login()
    nonce = _nonce(url)
    token_endpoint.response = lambda data: httpx.Response(
        200, json=_tokens(nonce, scope="openid profile email offline_access")
    )
    with pytest.raises(ValueError, match="did not allow"):
        await chatgpt_plan.complete_login(_callback(url))
    assert chatgpt_plan.get_status()["logged_in"] is False


async def test_wrong_nonce_is_rejected(token_endpoint):
    url = chatgpt_plan.start_login()
    token_endpoint.response = lambda data: httpx.Response(200, json=_tokens("other-nonce"))
    with pytest.raises(ValueError, match="invalid sign-in token"):
        await chatgpt_plan.complete_login(_callback(url))
    assert chatgpt_plan.get_status()["logged_in"] is False


async def test_expiring_token_is_refreshed(token_endpoint, data_dir):
    await _sign_in(token_endpoint)
    creds_path = data_dir / chatgpt_plan.CREDENTIALS_FILE
    creds = json.loads(creds_path.read_text())
    creds["expires_at"] = time.time() + 10
    creds_path.write_text(json.dumps(creds))

    token_endpoint.response = lambda data: httpx.Response(
        200,
        json={
            "access_token": "access-2",
            "refresh_token": "refresh-2",
            "expires_in": 3600,
            "scope": chatgpt_plan.SCOPES,
        },
    )
    assert await chatgpt_plan._access_token() == "access-2"
    refresh = token_endpoint.calls[-1]
    assert refresh["grant_type"] == "refresh_token"
    assert refresh["refresh_token"] == "refresh-1"
    assert refresh["client_id"] == ISSUED_CLIENT
    stored = json.loads(creds_path.read_text())
    assert stored["refresh_token"] == "refresh-2"
    assert stored["email"] == "me@example.com"


async def test_dead_refresh_token_signs_out(token_endpoint, data_dir):
    await _sign_in(token_endpoint)
    token_endpoint.response = lambda data: httpx.Response(400, json={"error": "invalid_grant"})
    with pytest.raises(ValueError, match="expired"):
        await chatgpt_plan._access_token(force_refresh=True)
    assert chatgpt_plan.get_status()["logged_in"] is False


async def test_generation_not_connected():
    with pytest.raises(ValueError, match="not connected"):
        await chatgpt_plan.chat_completion("chatgpt-subscription/gpt-x", "sys", "user")


@pytest.fixture
def responses_api(monkeypatch):
    """Fake streamed Responses call; .results is a list of return tuples."""

    class Api:
        payloads: list[dict] = []
        tokens: list[str] = []
        results: list[tuple] = []

    async def fake_stream(token, payload):
        Api.tokens.append(token)
        Api.payloads.append(json.loads(json.dumps(payload)))
        return Api.results.pop(0)

    Api.payloads, Api.tokens = [], []
    monkeypatch.setattr(chatgpt_plan, "_stream_response", fake_stream)
    return Api


async def test_generation_routes_through_openrouter_client(token_endpoint, responses_api):
    await _sign_in(token_endpoint)
    responses_api.results = [(200, '{"questions": []}', None)]

    text = await chat_completion_json(
        "chatgpt-subscription/gpt-6.1-sol", "Answer in JSON.", "Make questions.", 0.7
    )

    assert text == '{"questions": []}'
    payload = responses_api.payloads[0]
    assert payload["model"] == "gpt-6.1-sol"
    assert payload["store"] is False
    assert payload["stream"] is True
    assert payload["input"][0] == {"role": "developer", "content": "Answer in JSON."}
    assert payload["text"] == {"format": {"type": "json_object"}}
    assert "temperature" not in payload
    assert responses_api.tokens == ["access-1"]


async def test_usage_limit_has_clear_message(token_endpoint, responses_api):
    await _sign_in(token_endpoint)
    error = json.dumps(
        {"error": {"code": "subscription_sharing_usage_limit_exceeded", "message": "limit"}}
    )
    responses_api.results = [(429, "", error)]
    with pytest.raises(ValueError, match="plan limit is reached"):
        await chatgpt_plan.chat_completion("chatgpt-subscription/gpt-x", "json", "user")


async def test_rejected_token_is_refreshed_once(token_endpoint, responses_api):
    await _sign_in(token_endpoint)
    token_endpoint.response = lambda data: httpx.Response(
        200, json={"access_token": "access-2", "refresh_token": "refresh-2", "expires_in": 3600}
    )
    responses_api.results = [(401, "", '{"detail": "unauthorized"}'), (200, "{}", None)]
    assert await chatgpt_plan.chat_completion("chatgpt-subscription/gpt-x", "json", "u") == "{}"
    assert responses_api.tokens == ["access-1", "access-2"]


async def test_format_rejection_retries_without_format(token_endpoint, responses_api):
    await _sign_in(token_endpoint)
    error = json.dumps(
        {"type": "error", "error": {"message": "Unsupported parameter: text.format", "code": None}}
    )
    responses_api.results = [(200, "", error), (200, "{}", None)]
    assert await chatgpt_plan.chat_completion("chatgpt-subscription/gpt-x", "json", "u") == "{}"
    assert "text" not in responses_api.payloads[1]


async def test_seeds_top_plan_models_once(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    plan_models = [
        {"slug": f"gpt-{i}", "name": f"GPT {i}", "context_length": 272000} for i in range(5)
    ]

    async def fake_list_models():
        return plan_models

    monkeypatch.setattr(chatgpt_plan, "list_models", fake_list_models)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db:
        await seed_chatgpt_models(db)
        ids = set((await db.execute(select(AIModel.openrouter_id))).scalars().all())
        assert ids == {f"chatgpt-subscription/gpt-{i}" for i in range(3)}

        # A model the user deleted is not re-added on the next sign-in
        model = (
            await db.execute(
                select(AIModel).where(AIModel.openrouter_id == "chatgpt-subscription/gpt-0")
            )
        ).scalar_one()
        await db.delete(model)
        await db.commit()
        await seed_chatgpt_models(db)
        count = len((await db.execute(select(AIModel.openrouter_id))).scalars().all())
        assert count == 2
    await engine.dispose()
