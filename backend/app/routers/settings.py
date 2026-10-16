from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import get_settings
from app.database import get_db
from app.models import Setting
from app.schemas.settings import AppSettingsResponse, AppSettingsUpdate

router = APIRouter(prefix="/api/settings", tags=["settings"])

VERIFICATION_MODEL_KEY = "verification_model"


async def get_verification_model(db: AsyncSession) -> str:
    """Effective verification model: settings table, else config default."""
    result = await db.execute(
        select(Setting).where(Setting.key == VERIFICATION_MODEL_KEY)
    )
    row = result.scalar_one_or_none()
    return row.value if row and row.value else get_settings().verification_model


@router.get("", response_model=AppSettingsResponse)
async def get_app_settings(db: AsyncSession = Depends(get_db)):
    """Get the app settings (config defaults with stored overrides applied)."""
    return AppSettingsResponse(verification_model=await get_verification_model(db))


@router.put("", response_model=AppSettingsResponse)
async def update_app_settings(
    payload: AppSettingsUpdate, db: AsyncSession = Depends(get_db)
):
    """Update app settings; values are persisted in the settings table."""
    result = await db.execute(
        select(Setting).where(Setting.key == VERIFICATION_MODEL_KEY)
    )
    row = result.scalar_one_or_none()
    if row is not None:
        row.value = payload.verification_model
    else:
        db.add(Setting(key=VERIFICATION_MODEL_KEY, value=payload.verification_model))
    await db.commit()
    return AppSettingsResponse(verification_model=payload.verification_model)
