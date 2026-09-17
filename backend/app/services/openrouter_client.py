"""Shared OpenRouter client for JSON generation calls.

Sends response_format json_object on every call so models return valid
JSON (roadmap P1.2). Some OpenRouter models do not support
response_format; on the corresponding API error the request is retried
once without it — generation keeps working, the parser's fallback path
handles non-JSON output.
"""

import logging
from typing import Any, Dict, Optional

import httpx

from app.config import get_settings

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
    """Call OpenRouter and return the raw assistant message content."""

    if not settings.openrouter_api_key:
        raise ValueError("OpenRouter API key is not configured")

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
        response = await _post(client, payload)

        if response.status_code == 400 and "response_format" in response.text:
            # Model does not support structured outputs — retry without
            # response_format and rely on the prompt + parser fallback
            logger.warning(
                "Model %s does not support response_format; retrying without it",
                model_id,
            )
            payload.pop("response_format")
            response = await _post(client, payload)

        if response.status_code != 200:
            logger.error("OpenRouter API error response: %s", response.text)
            raise ValueError(
                f"OpenRouter API error ({response.status_code}): {response.text}"
            )

        data = response.json()

        if "error" in data:
            logger.error("OpenRouter error: %s", data["error"])
            raise ValueError(f"OpenRouter error: {data['error']}")

        return data["choices"][0]["message"]["content"]


async def _post(client: httpx.AsyncClient, payload: Dict[str, Any]) -> httpx.Response:
    return await client.post(
        f"{settings.openrouter_base_url}/chat/completions",
        headers={
            "Authorization": f"Bearer {settings.openrouter_api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:8000",
            "X-Title": "Scio",
        },
        json=payload,
    )
