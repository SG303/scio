from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import get_settings
from app.database import get_db
from app.models import AIModel, Setting
from app.schemas.settings import (
    AppSettingsResponse,
    AppSettingsUpdate,
    BackupCreateResponse,
    BackupListResponse,
)
from app.services import db_backup
from app.services.default_model import get_default_ai_model_id, set_default_ai_model_id

router = APIRouter(prefix="/api/settings", tags=["settings"])

VERIFICATION_MODEL_KEY = "verification_model"


async def get_verification_model(db: AsyncSession) -> str:
    """Effective verification model: settings table, else config default."""
    result = await db.execute(select(Setting).where(Setting.key == VERIFICATION_MODEL_KEY))
    row = result.scalar_one_or_none()
    return row.value if row and row.value else get_settings().verification_model


async def _current_settings(db: AsyncSession) -> AppSettingsResponse:
    return AppSettingsResponse(
        verification_model=await get_verification_model(db),
        default_ai_model_id=await get_default_ai_model_id(db),
    )


@router.get("", response_model=AppSettingsResponse)
async def get_app_settings(db: AsyncSession = Depends(get_db)):
    """Get the app settings (config defaults with stored overrides applied)."""
    return await _current_settings(db)


@router.put("", response_model=AppSettingsResponse)
async def update_app_settings(payload: AppSettingsUpdate, db: AsyncSession = Depends(get_db)):
    """Update app settings; values are persisted in the settings table."""
    if payload.verification_model is not None:
        result = await db.execute(select(Setting).where(Setting.key == VERIFICATION_MODEL_KEY))
        row = result.scalar_one_or_none()
        if row is not None:
            row.value = payload.verification_model
        else:
            db.add(Setting(key=VERIFICATION_MODEL_KEY, value=payload.verification_model))

    if "default_ai_model_id" in payload.model_fields_set:
        if payload.default_ai_model_id is not None:
            model = await db.get(AIModel, payload.default_ai_model_id)
            if model is None or not model.is_enabled:
                raise HTTPException(status_code=400, detail="AI model not available")
        await set_default_ai_model_id(db, payload.default_ai_model_id)

    await db.commit()
    return await _current_settings(db)


@router.get("/backups", response_model=BackupListResponse)
async def list_backups():
    """List the automatic database backups, newest first."""
    return BackupListResponse(backups=db_backup.list_backups(get_settings().database_path))


@router.post("/backups", response_model=BackupCreateResponse)
async def create_backup():
    """Create a database backup immediately and return it."""
    try:
        info = await db_backup.create_backup(get_settings().database_path)
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Database backup failed: {error}",
        )
    return BackupCreateResponse(backup=info)
