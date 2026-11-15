"""ChatGPT subscription provider via OpenAI's "Sign in with ChatGPT".

OpenAI officially lets open-source and locally hosted apps use a user's
ChatGPT plan for Responses API calls (developers.openai.com/siwc). Unlike
the Claude subscription (app/services/claude_cli.py), Scio therefore holds
the OAuth tokens itself:

- Sign-in is OAuth 2.0 with PKCE. The app registers itself on the first
  sign-in (client_id "dynamic_agent_client"); OpenAI returns an issued
  client ID that is reused for later sign-ins.
- OpenAI only redirects to a loopback address on the computer running the
  browser. Scio runs on a server, so the user copies that (unreachable)
  callback URL from the address bar and pastes it into Scio.
- Tokens live in a credentials file next to the database with owner-only
  permissions (0600), never in the database (DB backups must not contain
  them) and never in logs or API responses.
- Generation calls go to POST /v1/responses with store=false, stream=true.

Models served this way carry MODEL_PREFIX in their model ID
(e.g. "chatgpt-subscription/gpt-6.1-sol").
"""

import asyncio
import base64
import hashlib
import json
import logging
import os
import secrets
import time
import uuid
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse

import httpx

from app.config import get_settings
from app.models import utc_now

logger = logging.getLogger(__name__)

MODEL_PREFIX = "chatgpt-subscription/"

ISSUER = "https://auth.openai.com"
AUTHORIZE_URL = f"{ISSUER}/api/accounts/authorize"
TOKEN_URL = f"{ISSUER}/api/accounts/oauth/token"
OPENID_CONFIG_URL = f"{ISSUER}/.well-known/openid-configuration"
API_BASE = "https://api.openai.com/v1"
REDIRECT_URI = "http://127.0.0.1:1455/auth/callback"
DYNAMIC_CLIENT_ID = "dynamic_agent_client"
PLAN_SCOPE = "chatgpt.tokens.use.direct"
SCOPES = f"openid profile email offline_access resource.invoke {PLAN_SCOPE}"
APP_NAME = "Scio"

CREDENTIALS_FILE = "chatgpt-credentials.json"
REGISTRATION_FILE = "chatgpt-client.json"

AUTH_TIMEOUT_SECONDS = 30.0
# Whole documents go into one call and the models reason before answering
GENERATION_TIMEOUT_SECONDS = 600.0
# Refresh the access token (1 h lifetime) a bit before it expires
REFRESH_MARGIN_SECONDS = 300
MODELS_CACHE_SECONDS = 3600
# Models added after the first sign-in (highest priority in OpenAI's list)
SEEDED_MODEL_COUNT = 3

NOT_CONNECTED_MESSAGE = (
    "ChatGPT subscription is not connected. Connect it under Settings → AI providers."
)
USAGE_LIMIT_MESSAGE = (
    "Your ChatGPT plan limit is reached. Check your usage in ChatGPT under Settings → Usage "
    "and try again later, or pick another model."
)
TERMINAL_REFRESH_ERRORS = {
    "invalid_grant",
    "invalid_refresh_token",
    "token_expired",
    "refresh_token_expired",
    "refresh_token_invalidated",
    "refresh_token_reused",
}


def is_plan_model(model_id: str) -> bool:
    return model_id.startswith(MODEL_PREFIX)


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------


def _data_dir() -> str:
    return os.path.dirname(os.path.abspath(get_settings().database_path))


def _path(name: str) -> str:
    return os.path.join(_data_dir(), name)


def _read_json(name: str) -> dict[str, Any] | None:
    try:
        with open(_path(name), encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return None
    except (OSError, json.JSONDecodeError) as e:
        logger.warning("Could not read %s: %s", name, e)
        return None
    return data if isinstance(data, dict) else None


def _write_private_json(name: str, data: dict[str, Any]) -> None:
    """Write atomically with owner-only permissions."""
    os.makedirs(_data_dir(), exist_ok=True)
    target = _path(name)
    tmp = f"{target}.tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, target)


def _delete_credentials() -> None:
    try:
        os.remove(_path(CREDENTIALS_FILE))
    except FileNotFoundError:
        pass


def _registration() -> dict[str, Any]:
    """Host ID (stable per installation) and the client ID OpenAI issued.

    Neither is a secret; they only identify this Scio installation.
    """
    data = _read_json(REGISTRATION_FILE) or {}
    if not data.get("host_id"):
        data["host_id"] = f"urn:uuid:{uuid.uuid4()}"
        _write_private_json(REGISTRATION_FILE, data)
    return data


# ---------------------------------------------------------------------------
# Sign-in
# ---------------------------------------------------------------------------


@dataclass
class _PendingLogin:
    state: str
    nonce: str
    verifier: str
    # None on the first registration, else the client ID to reuse
    client_id: str | None


_pending: _PendingLogin | None = None
_token_lock = asyncio.Lock()


def login_pending() -> bool:
    return _pending is not None


def start_login() -> str:
    """Return the OpenAI authorization URL for a fresh sign-in attempt."""
    global _pending
    registration = _registration()
    client_id = registration.get("client_id")
    verifier = secrets.token_urlsafe(64)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    )
    _pending = _PendingLogin(
        state=secrets.token_urlsafe(24),
        nonce=secrets.token_urlsafe(24),
        verifier=verifier,
        client_id=client_id,
    )
    params = {
        "client_id": client_id or DYNAMIC_CLIENT_ID,
        "ext_agent_host_id": registration["host_id"],
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "resource": API_BASE,
        "state": _pending.state,
        "nonce": _pending.nonce,
        "code_challenge_method": "S256",
        "code_challenge": challenge,
    }
    if client_id is None:
        params["agent_name_hint"] = APP_NAME
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


def cancel_login() -> None:
    global _pending
    _pending = None


def _decode_jwt_payload(token: str) -> dict[str, Any]:
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload))
    except (IndexError, ValueError):
        raise ValueError("OpenAI returned an unreadable sign-in token. Please try again.")


def _validate_id_token(id_token: str, client_id: str, nonce: str) -> dict[str, Any]:
    """Check issuer, audience, expiry and nonce of the ID token.

    The token comes straight from OpenAI's token endpoint over TLS, which
    OpenID Connect accepts in place of a signature check (Core 1.0, 3.1.3.7),
    so no JWT library is needed.
    """
    claims = _decode_jwt_payload(id_token)
    audience = claims.get("aud")
    audiences = audience if isinstance(audience, list) else [audience]
    if (
        claims.get("iss") != ISSUER
        or client_id not in audiences
        or claims.get("nonce") != nonce
        or float(claims.get("exp", 0)) < time.time()
        or not claims.get("sub")
    ):
        raise ValueError("OpenAI returned an invalid sign-in token. Please try again.")
    return claims


def _scopes(value: Any) -> set[str]:
    if isinstance(value, list):
        return {str(s) for s in value}
    return set(str(value or "").split())


async def _post_token(data: dict[str, str]) -> httpx.Response:
    async with httpx.AsyncClient(timeout=AUTH_TIMEOUT_SECONDS) as client:
        return await client.post(TOKEN_URL, data=data)


def _store_tokens(
    tokens: dict[str, Any], client_id: str, email: str | None, subject: str | None
) -> None:
    _write_private_json(
        CREDENTIALS_FILE,
        {
            "client_id": client_id,
            "email": email,
            "subject": subject,
            "id_token": tokens.get("id_token"),
            "access_token": tokens["access_token"],
            "refresh_token": tokens["refresh_token"],
            "scopes": sorted(_scopes(tokens.get("scope"))),
            "expires_at": time.time() + float(tokens.get("expires_in") or 3600),
            "saved_at": utc_now().isoformat(),
        },
    )


async def complete_login(callback_url: str) -> None:
    """Exchange the code from the pasted callback URL for tokens."""
    global _pending
    pending = _pending
    if pending is None:
        raise ValueError("No sign-in in progress. Please start the sign-in again.")

    query = dict(parse_qsl(urlparse(callback_url.strip()).query))
    if query.get("state") != pending.state:
        raise ValueError(
            "This address does not belong to the current sign-in. Copy the whole address "
            "from the browser after signing in, or start over."
        )
    _pending = None
    if "error" in query:
        raise ValueError(f"OpenAI did not allow the sign-in ({query['error']}).")
    code = query.get("code")
    if not code:
        raise ValueError("The address contains no sign-in code. Please start over.")

    issued = query.get("client_id")
    if pending.client_id is None:
        if not issued or issued == DYNAMIC_CLIENT_ID:
            raise ValueError("OpenAI did not finish registering Scio. Please start over.")
        client_id = issued
    else:
        if issued and issued != pending.client_id:
            raise ValueError("OpenAI returned a different app registration. Please start over.")
        client_id = pending.client_id

    response = await _post_token(
        {
            "grant_type": "authorization_code",
            "client_id": client_id,
            "code": code,
            "code_verifier": pending.verifier,
            "redirect_uri": REDIRECT_URI,
            "resource": API_BASE,
        }
    )
    if response.status_code != 200:
        logger.error("ChatGPT code exchange failed: HTTP %s", response.status_code)
        raise ValueError("OpenAI rejected the sign-in code. Please start over.")
    tokens = response.json()

    if PLAN_SCOPE not in _scopes(tokens.get("scope") or query.get("scope")):
        raise ValueError(
            "The sign-in did not allow Scio to use your ChatGPT plan. Start over and "
            "allow plan usage on OpenAI's page."
        )
    claims = _validate_id_token(tokens.get("id_token") or "", client_id, pending.nonce)

    registration = _registration()
    registration["client_id"] = client_id
    _write_private_json(REGISTRATION_FILE, registration)
    _store_tokens(tokens, client_id, claims.get("email"), claims.get("sub"))
    logger.info("ChatGPT subscription connected")


async def _access_token(force_refresh: bool = False) -> str:
    """Valid access token; refreshes it (serialized) when it is about to expire."""
    async with _token_lock:
        creds = _read_json(CREDENTIALS_FILE)
        if not creds:
            raise ValueError(NOT_CONNECTED_MESSAGE)
        if not force_refresh and creds["expires_at"] - time.time() > REFRESH_MARGIN_SECONDS:
            return creds["access_token"]

        response = await _post_token(
            {
                "grant_type": "refresh_token",
                "client_id": creds["client_id"],
                "refresh_token": creds["refresh_token"],
                "resource": API_BASE,
            }
        )
        if response.status_code != 200:
            try:
                error = response.json().get("error")
            except ValueError:
                error = None
            if isinstance(error, dict):
                error = error.get("code")
            if error in TERMINAL_REFRESH_ERRORS:
                logger.warning("ChatGPT refresh token is no longer valid (%s)", error)
                _delete_credentials()
                raise ValueError(
                    "The ChatGPT sign-in has expired. Sign in again under Settings → AI providers."
                )
            logger.error("ChatGPT token refresh failed: HTTP %s", response.status_code)
            raise ValueError("Could not renew the ChatGPT sign-in. Please try again later.")

        tokens = response.json()
        _store_tokens(
            {**tokens, "id_token": tokens.get("id_token") or creds.get("id_token")},
            creds["client_id"],
            creds.get("email"),
            creds.get("subject"),
        )
        return tokens["access_token"]


async def logout() -> None:
    """Revoke the refresh token at OpenAI, then delete the local tokens."""
    global _models_cache
    _models_cache = None
    creds = _read_json(CREDENTIALS_FILE)
    _delete_credentials()
    if not creds:
        return
    try:
        async with httpx.AsyncClient(timeout=AUTH_TIMEOUT_SECONDS) as client:
            config = (await client.get(OPENID_CONFIG_URL)).json()
            response = await client.post(
                config["revocation_endpoint"],
                data={
                    "token": creds["refresh_token"],
                    "token_type_hint": "refresh_token",
                    "client_id": creds["client_id"],
                },
            )
        if response.status_code != 200:
            raise ValueError(f"HTTP {response.status_code}")
    except (httpx.HTTPError, ValueError, KeyError) as e:
        logger.warning("Could not revoke the ChatGPT sign-in at OpenAI: %s", e)
        raise ValueError(
            "Signed out of Scio, but OpenAI could not confirm it. To be sure, disconnect Scio "
            "in ChatGPT under Settings → Connected apps."
        )


def get_status() -> dict[str, Any]:
    """Sign-in state (no secrets)."""
    creds = _read_json(CREDENTIALS_FILE)
    return {
        "logged_in": creds is not None,
        "email": creds.get("email") if creds else None,
        "login_pending": login_pending(),
    }


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

_models_cache: tuple[float, list[dict[str, Any]]] | None = None


async def list_models() -> list[dict[str, Any]]:
    """Models the plan offers, highest priority first (cached for an hour).

    Each entry: {"slug", "name", "context_length"}. Empty when not connected
    or when OpenAI cannot be reached.
    """
    global _models_cache
    if _models_cache and time.time() - _models_cache[0] < MODELS_CACHE_SECONDS:
        return _models_cache[1]
    if _read_json(CREDENTIALS_FILE) is None:
        return []
    try:
        token = await _access_token()
        async with httpx.AsyncClient(timeout=AUTH_TIMEOUT_SECONDS) as client:
            response = await client.get(
                f"{API_BASE}/models", headers={"Authorization": f"Bearer {token}"}
            )
        response.raise_for_status()
        raw = response.json().get("models") or []
    except (httpx.HTTPError, ValueError) as e:
        logger.warning("Could not load the ChatGPT plan models: %s", e)
        return []

    listed = sorted(
        (m for m in raw if m.get("visibility") == "list" and m.get("slug")),
        key=lambda m: m.get("priority", 999),
    )
    models = [
        {
            "slug": m["slug"],
            "name": m.get("display_name") or m["slug"],
            "context_length": m.get("context_window"),
        }
        for m in listed
    ]
    _models_cache = (time.time(), models)
    return models


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------


def _completed_text(event: dict[str, Any]) -> str:
    response = event.get("response") or {}
    return "".join(
        part.get("text", "")
        for item in response.get("output") or []
        if item.get("type") == "message"
        for part in item.get("content") or []
        if part.get("type") == "output_text"
    )


def _error_message(code: str | None, message: str | None) -> str:
    if code == "subscription_sharing_usage_limit_exceeded":
        return USAGE_LIMIT_MESSAGE
    if code == "subscription_sharing_user_not_eligible":
        return "Your ChatGPT plan cannot be used in other apps."
    return f"ChatGPT subscription error: {message or code or 'unknown error'}"


async def _stream_response(token: str, payload: dict[str, Any]) -> tuple[int, str, str | None]:
    """Run one streamed request: (HTTP status, output text, error text)."""
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    async with (
        httpx.AsyncClient(timeout=GENERATION_TIMEOUT_SECONDS) as client,
        client.stream("POST", f"{API_BASE}/responses", headers=headers, json=payload) as response,
    ):
        if response.status_code != 200:
            body = (await response.aread()).decode(errors="replace")
            return response.status_code, "", body
        async for line in response.aiter_lines():
            if not line.startswith("data:"):
                continue
            try:
                event = json.loads(line[5:])
            except json.JSONDecodeError:
                continue
            kind = event.get("type")
            if kind == "response.completed":
                return 200, _completed_text(event), None
            if kind in ("error", "response.failed", "response.incomplete"):
                return 200, "", json.dumps(event)
    return 200, "", "The answer ended before it was complete."


def _parse_error(body: str) -> tuple[str | None, str | None]:
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return None, body[:300]
    error = data.get("error") or (data.get("response") or {}).get("error") or {}
    if isinstance(error, dict):
        return error.get("code"), error.get("message")
    return None, str(data.get("detail") or error)[:300]


async def chat_completion(model_id: str, system_prompt: str, user_prompt: str) -> str:
    """Send one prompt to the Responses API and return the assistant text.

    The system prompt goes in as a developer message (the preview does not
    support system items). json_object mode needs the word "json" in the
    input, which Scio's prompts contain; if a model rejects the format the
    request is retried once without it, like openrouter_client does.
    """
    payload: dict[str, Any] = {
        "model": model_id[len(MODEL_PREFIX) :],
        "store": False,
        "stream": True,
        "input": [
            {"role": "developer", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "text": {"format": {"type": "json_object"}},
    }

    token = await _access_token()
    try:
        status, text, error = await _stream_response(token, payload)
        if status == 401:
            token = await _access_token(force_refresh=True)
            status, text, error = await _stream_response(token, payload)
        if error and "text.format" in error:
            logger.warning("Model %s rejected text.format; retrying without it", model_id)
            payload.pop("text")
            status, text, error = await _stream_response(token, payload)
    except httpx.TimeoutException:
        raise ValueError("ChatGPT did not answer in time. Please try again.")
    except httpx.HTTPError as e:
        raise ValueError(f"Could not reach ChatGPT: {e}")

    if error is not None:
        code, message = _parse_error(error)
        logger.error("ChatGPT subscription error (HTTP %s): %s %s", status, code, message)
        if status == 401:
            raise ValueError(NOT_CONNECTED_MESSAGE)
        raise ValueError(_error_message(code, message))
    return text
