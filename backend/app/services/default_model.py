"""Global default AI model (Settings → AI models).

Fallback of last resort: an explicit choice wins, then the subject's model,
then this one. The id lives in the settings table, so no migration is needed.
"""

from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Setting

DEFAULT_AI_MODEL_KEY = "default_ai_model_id"


async def get_default_ai_model_id(db: AsyncSession) -> Optional[int]:
    """The stored global default model id, or None when none is set."""
    value = (
        await db.execute(select(Setting.value).where(Setting.key == DEFAULT_AI_MODEL_KEY))
    ).scalar_one_or_none()
    return int(value) if value and value.isdigit() else None


async def set_default_ai_model_id(db: AsyncSession, model_id: Optional[int]) -> None:
    """Store (or clear, with None) the global default. Caller commits."""
    row = (
        await db.execute(select(Setting).where(Setting.key == DEFAULT_AI_MODEL_KEY))
    ).scalar_one_or_none()
    value = str(model_id) if model_id is not None else None
    if row is not None:
        row.value = value
    else:
        db.add(Setting(key=DEFAULT_AI_MODEL_KEY, value=value))


async def resolve_ai_model_id(db: AsyncSession, *preferred: Optional[int]) -> Optional[int]:
    """First truthy id of ``preferred`` (explicit, then subject, ...), else the global default."""
    for model_id in preferred:
        if model_id:
            return model_id
    return await get_default_ai_model_id(db)
