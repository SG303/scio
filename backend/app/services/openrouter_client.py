"""Shared OpenRouter client for JSON generation calls.

Sends response_format json_object on every call so models return valid
JSON (roadmap P1.2). Some OpenRouter models do not support
response_format; on the corresponding API error the request is retried
once without it — generation keeps working, the parser's fallback path
handles non-JSON output.

Models with the Claude subscription prefix are routed to the Claude Code
CLI instead (app/services/claude_cli.py); their callers stay unchanged.
"""

import logging
from typing import Any, Dict, Optional

import httpx

from app.config import get_settings
from app.services import claude_cli
from app.services.openrouter_key import load_effective_key

logger = logging.getLogger(__name__)
settings = get_settings()

REQUEST_TIMEOUT_SECONDS = 120.0


async def chat_completion_json(
    model_id: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    max_tokens: Optional[int] = None,
) -> str:
    """Call the model and return the raw assistant message content.

    temperature and max_tokens only apply to OpenRouter; the Claude Code
    CLI does not expose them.
    """

    if claude_cli.is_subscription_model(model_id):
        return await claude_cli.chat_completion(model_id, system_prompt, user_prompt)

    api_key = await load_effective_key()
    if not api_key:
        raise ValueError(
            "OpenRouter API key is not configured. Add it under Settings → AI providers."
        )

    payload: Dict[str, Any] = {
        "model": model_id,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "response_format": {"type": "json_object"},
    }
    if max_tokens is not None:
        payload["max_tokens"] = max_tokens

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        response = await _post(client, payload, api_key)

        if response.status_code == 400 and "response_format" in response.text:
            # Model does not support structured outputs — retry without
            # response_format and rely on the prompt + parser fallback
            logger.warning(
                "Model %s does not support response_format; retrying without it",
                model_id,
            )
            payload.pop("response_format")
            response = await _post(client, payload, api_key)

        if response.status_code != 200:
            logger.error("OpenRouter API error response: %s", response.text)
            raise ValueError(f"OpenRouter API error ({response.status_code}): {response.text}")

        data = response.json()

        if "error" in data:
            logger.error("OpenRouter error: %s", data["error"])
            raise ValueError(f"OpenRouter error: {data['error']}")

        return data["choices"][0]["message"]["content"]


async def _post(client: httpx.AsyncClient, payload: Dict[str, Any], api_key: str) -> httpx.Response:
    return await client.post(
        f"{settings.openrouter_base_url}/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": settings.http_referer,
            "X-Title": "Scio",
        },
        json=payload,
    )
