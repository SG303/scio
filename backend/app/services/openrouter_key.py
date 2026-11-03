"""OpenRouter API key management.

The key can be stored in the settings table (entered in the web UI) or
set via the OPENROUTER_API_KEY environment variable. A key stored in the
app wins; the environment variable is the fallback.
"""

from typing import Optional, Tuple

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import async_session
from app.models import Setting

OPENROUTER_KEY_SETTING = "openrouter_api_key"

SOURCE_APP = "app"
SOURCE_ENVIRONMENT = "environment"


async def _stored_row(db: AsyncSession) -> Optional[Setting]:
    result = await db.execute(select(Setting).where(Setting.key == OPENROUTER_KEY_SETTING))
    return result.scalar_one_or_none()


async def get_effective_key(db: AsyncSession) -> Tuple[str, Optional[str]]:
    """Return (key, source); ("", None) when no key is configured."""
    row = await _stored_row(db)
    if row and row.value:
        return row.value, SOURCE_APP
    env_key = get_settings().openrouter_api_key
    if env_key:
        return env_key, SOURCE_ENVIRONMENT
    return "", None


async def load_effective_key() -> str:
    """Effective key for a generation call (short read-only session)."""
    async with async_session() as db:
        key, _ = await get_effective_key(db)
    return key


async def store_key(db: AsyncSession, key: str) -> None:
    row = await _stored_row(db)
    if row is not None:
        row.value = key
    else:
        db.add(Setting(key=OPENROUTER_KEY_SETTING, value=key))
    await db.commit()


async def delete_key(db: AsyncSession) -> None:
    row = await _stored_row(db)
    if row is not None:
        await db.delete(row)
        await db.commit()


def key_hint(key: str) -> str:
    """Last characters only — the full key never leaves the backend."""
    return f"…{key[-4:]}" if len(key) > 8 else "…"


async def verify_key(key: str) -> None:
    """Ask OpenRouter whether the key is valid (free, no generation)."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{get_settings().openrouter_base_url}/key",
                headers={"Authorization": f"Bearer {key}"},
            )
    except httpx.HTTPError:
        raise ValueError("Could not reach OpenRouter to check the key. Please try again.")
    if response.status_code in (401, 403):
        raise ValueError("OpenRouter rejected this API key. Please check it and try again.")
    if response.status_code != 200:
        raise ValueError(f"OpenRouter key check failed (HTTP {response.status_code}).")
