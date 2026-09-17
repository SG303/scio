import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func, text
from typing import List, Any, Dict

from app.database import get_db
from app.models import AIModel, TestConfig, FlashcardDeck, Subject
from app.schemas.ai_model import AIModelCreate, AIModelUpdate, AIModelResponse
from app.services.openrouter import fetch_openrouter_models

router = APIRouter(prefix="/api/models", tags=["ai_models"])
logger = logging.getLogger(__name__)

# Default models to seed the database
# Increment this version when you change DEFAULT_MODELS to force re-seeding
MODELS_VERSION = 2

DEFAULT_MODELS = [
    {
        "name": "Grok 4.1 Fast",
        "openrouter_id": "x-ai/grok-4.1-fast",
        "description": "xAI's fast model, great for quick generations"
    },
    {
        "name": "Gemini 2.5 Flash",
        "openrouter_id": "google/gemini-2.5-flash",
        "description": "Google's fast and efficient model"
    },
    {
        "name": "Claude Haiku 4.5",
        "openrouter_id": "anthropic/claude-haiku-4.5",
        "description": "Anthropic's fast and affordable model"
    },
    {
        "name": "Claude Sonnet 4.5",
        "openrouter_id": "anthropic/claude-sonnet-4.5",
        "description": "Anthropic's balanced model, excellent for analysis"
    },
    {
        "name": "GPT-5.1",
        "openrouter_id": "openai/gpt-5.1",
        "description": "OpenAI's advanced model with strong reasoning"
    },
    {
        "name": "O4 Mini High",
        "openrouter_id": "openai/o4-mini-high",
        "description": "OpenAI's efficient reasoning model"
    },
    {
        "name": "DeepSeek V3.2",
        "openrouter_id": "deepseek/deepseek-v3.2",
        "description": "Cost-effective model with strong performance"
    }
]


async def seed_default_models(db: AsyncSession):
    """Seed default AI models - replaces old defaults with new ones.

    P5.3f: only models flagged is_default are replaced on re-seed —
    user-added models are never touched, regardless of their provider.
    Uses transaction safety to ensure atomic operations.
    """
    from app.models import Setting

    try:
        # P5.3f: existing installations may lack the is_default column —
        # add it idempotently before the ORM uses it
        result = await db.execute(text("PRAGMA table_info(ai_models)"))
        columns = {row[1] for row in result.fetchall()}
        if "is_default" not in columns:
            await db.execute(
                text("ALTER TABLE ai_models ADD COLUMN is_default BOOLEAN DEFAULT 0")
            )
            await db.commit()

        # Check current models version in database
        try:
            result = await db.execute(select(Setting).where(Setting.key == "models_version"))
            version_setting = result.scalar_one_or_none()
            current_version = int(version_setting.value) if version_setting else 0
        except Exception:
            # Settings table might not exist or other error - assume version 0
            current_version = 0
            version_setting = None

        # If version matches, no need to re-seed
        if current_version >= MODELS_VERSION:
            return

        # Get default model IDs
        default_ids = set(m["openrouter_id"] for m in DEFAULT_MODELS)

        # Delete stale defaults — only rows flagged is_default; user-added
        # models are never matched here
        await db.execute(
            delete(AIModel).where(
                AIModel.is_default.is_(True), AIModel.openrouter_id.not_in(default_ids)
            )
        )

        # Add or re-flag the current default models
        result = await db.execute(select(AIModel))
        existing_models = {m.openrouter_id: m for m in result.scalars().all()}
        for model_data in DEFAULT_MODELS:
            existing = existing_models.get(model_data["openrouter_id"])
            if existing is not None:
                existing.is_default = True
            else:
                db.add(AIModel(is_default=True, **model_data))
        
        # Update version
        try:
            if version_setting:
                version_setting.value = str(MODELS_VERSION)
            else:
                db.add(Setting(key="models_version", value=str(MODELS_VERSION)))
        except Exception:
            pass  # Settings table might not exist yet
        
        await db.commit()
        
    except Exception as e:
        logger.error(f"Failed to seed default models: {e}")
        await db.rollback()
        # Don't raise - seeding failure shouldn't prevent app startup


@router.get("", response_model=List[Dict[str, Any]])
async def list_models(
    enabled_only: bool = False,
    db: AsyncSession = Depends(get_db)
):
    """List all AI models with OpenRouter pricing info"""
    query = select(AIModel)
    if enabled_only:
        query = query.where(AIModel.is_enabled.is_(True))
    query = query.order_by(AIModel.name)
    
    result = await db.execute(query)
    db_models = result.scalars().all()
    
    # Fetch OpenRouter data
    openrouter_data = await fetch_openrouter_models()
    
    # Merge data
    models = []
    for model in db_models:
        model_dict = {
            "id": model.id,
            "name": model.name,
            "openrouter_id": model.openrouter_id,
            "description": model.description,
            "is_enabled": model.is_enabled,
            "created_at": model.created_at,
            "pricing": None,
            "context_length": None
        }
        
        # Add pricing and context length if available
        if model.openrouter_id in openrouter_data:
            or_model = openrouter_data[model.openrouter_id]
            model_dict["pricing"] = or_model.get("pricing")
            model_dict["context_length"] = or_model.get("context_length")
            
        models.append(model_dict)
        
    return models


@router.get("/{model_id}", response_model=Dict[str, Any])
async def get_model(model_id: int, db: AsyncSession = Depends(get_db)):
    """Get a specific AI model with OpenRouter pricing info"""
    result = await db.execute(select(AIModel).where(AIModel.id == model_id))
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    
    # Fetch OpenRouter data
    openrouter_data = await fetch_openrouter_models()
    
    model_dict = {
        "id": model.id,
        "name": model.name,
        "openrouter_id": model.openrouter_id,
        "description": model.description,
        "is_enabled": model.is_enabled,
        "created_at": model.created_at,
        "pricing": None,
        "context_length": None
    }
    
    # Add pricing and context length if available
    if model.openrouter_id in openrouter_data:
        or_model = openrouter_data[model.openrouter_id]
        model_dict["pricing"] = or_model.get("pricing")
        model_dict["context_length"] = or_model.get("context_length")
        
    return model_dict


@router.post("", response_model=AIModelResponse)
async def create_model(model: AIModelCreate, db: AsyncSession = Depends(get_db)):
    """Add a new AI model"""
    # Check if model with same openrouter_id exists
    result = await db.execute(
        select(AIModel).where(AIModel.openrouter_id == model.openrouter_id)
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Model with this OpenRouter ID already exists")
    
    db_model = AIModel(**model.model_dump())
    db.add(db_model)
    await db.commit()
    await db.refresh(db_model)
    return db_model


@router.put("/{model_id}", response_model=AIModelResponse)
async def update_model(
    model_id: int,
    model: AIModelUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update an AI model"""
    result = await db.execute(select(AIModel).where(AIModel.id == model_id))
    db_model = result.scalar_one_or_none()
    if not db_model:
        raise HTTPException(status_code=404, detail="Model not found")
    
    update_data = model.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_model, key, value)
    
    await db.commit()
    await db.refresh(db_model)
    return db_model


@router.delete("/{model_id}")
async def delete_model(model_id: int, db: AsyncSession = Depends(get_db)):
    """Delete an AI model.

    P5.3e: refused with 409 while the model is still referenced by test
    configs, flashcard decks or subjects — the message names the references.
    """
    result = await db.execute(select(AIModel).where(AIModel.id == model_id))
    db_model = result.scalar_one_or_none()
    if not db_model:
        raise HTTPException(status_code=404, detail="Model not found")

    references = []
    for label, model_cls in (
        ("test config", TestConfig),
        ("flashcard deck", FlashcardDeck),
        ("subject", Subject),
    ):
        count_result = await db.execute(
            select(func.count()).select_from(model_cls).where(
                model_cls.ai_model_id == model_id
            )
        )
        count = count_result.scalar() or 0
        if count > 0:
            references.append(f"{count} {label}{'s' if count != 1 else ''}")

    if references:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Model is still referenced by {', '.join(references)}. "
                "Reassign or delete those first."
            ),
        )

    await db.delete(db_model)
    await db.commit()
    return {"message": "Model deleted successfully"}
