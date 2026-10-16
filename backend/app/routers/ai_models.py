import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text
from typing import List, Any, Dict

from app.database import get_db
from app.models import AIModel, TestConfig, FlashcardDeck, Subject
from app.schemas.ai_model import AIModelCreate, AIModelUpdate, AIModelResponse
from app.services.openrouter import fetch_openrouter_models

router = APIRouter(prefix="/api/models", tags=["ai_models"])
logger = logging.getLogger(__name__)

# Default models to seed the database
# Increment this version when you change DEFAULT_MODELS to force re-seeding
MODELS_VERSION = 4

# Selection criteria (Oct 2026): the app sends whole documents as context and
# needs factually grounded questions/cards, so every default has >=1M context,
# supports response_format, and ranks well on document reasoning and
# hallucination benchmarks (AA GDP.pdf / AA-Omniscience). Pricing and context
# size are shown as separate fields in the UI and therefore stay out of the
# descriptions.
DEFAULT_MODELS = [
    {
        "name": "GPT-6.1 Sol",
        "openrouter_id": "openai/gpt-6.1-sol",
        "description": "OpenAI's strongest model for factual accuracy and document reasoning"
    },
    {
        "name": "Claude Sonnet 5.5",
        "openrouter_id": "anthropic/claude-sonnet-5.5",
        "description": "Anthropic's balanced model: excellent at grounded questions from documents, very low hallucination rate"
    },
    {
        "name": "Gemini 3.8 Flash",
        "openrouter_id": "google/gemini-3.8-flash",
        "description": "Google's fast all-rounder: strong document grounding at a low price"
    },
    {
        "name": "Claude Haiku 5.5",
        "openrouter_id": "anthropic/claude-haiku-5.5",
        "description": "Anthropic's budget model, great for high-volume generation"
    },
    {
        "name": "MiMo V2.6 Pro",
        "openrouter_id": "xiaomi/mimo-v2.6-pro",
        "description": "Best price-performance for very long documents"
    },
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
        # models are never matched here. P5.3e-consistent: a stale default that
        # is still referenced (subject/test config/deck) is kept and merely
        # un-flagged, since SQLite FKs are off and a plain delete would leave
        # dangling ai_model_id references.
        referenced_ids: set = set()
        for model_cls in (TestConfig, FlashcardDeck, Subject):
            ref_result = await db.execute(
                select(model_cls.ai_model_id)
                .where(model_cls.ai_model_id.is_not(None))
                .distinct()
            )
            referenced_ids.update(row[0] for row in ref_result.all())

        result = await db.execute(
            select(AIModel).where(
                AIModel.is_default.is_(True), AIModel.openrouter_id.not_in(default_ids)
            )
        )
        for stale in result.scalars().all():
            if stale.id in referenced_ids:
                stale.is_default = False
            else:
                await db.delete(stale)

        # Add or re-flag the current default models; existing rows also get
        # their name/description synced so text changes reach installations
        # that already carry the model
        result = await db.execute(select(AIModel))
        existing_models = {m.openrouter_id: m for m in result.scalars().all()}
        for model_data in DEFAULT_MODELS:
            existing = existing_models.get(model_data["openrouter_id"])
            if existing is not None:
                existing.is_default = True
                existing.name = model_data["name"]
                existing.description = model_data["description"]
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
