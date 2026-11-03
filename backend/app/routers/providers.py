"""AI provider connections: OpenRouter API key and Claude subscription."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.routers.ai_models import seed_subscription_models
from app.schemas.providers import (
    ClaudeLoginComplete,
    ClaudeLoginStart,
    ClaudeStatus,
    OpenRouterKeyStatus,
    OpenRouterKeyUpdate,
)
from app.services import claude_cli, openrouter_key

router = APIRouter(prefix="/api/providers", tags=["providers"])


async def _openrouter_status(db: AsyncSession) -> OpenRouterKeyStatus:
    key, source = await openrouter_key.get_effective_key(db)
    if not key:
        return OpenRouterKeyStatus(configured=False)
    return OpenRouterKeyStatus(
        configured=True, source=source, key_hint=openrouter_key.key_hint(key)
    )


@router.get("/openrouter", response_model=OpenRouterKeyStatus)
async def get_openrouter_status(db: AsyncSession = Depends(get_db)):
    return await _openrouter_status(db)


@router.put("/openrouter", response_model=OpenRouterKeyStatus)
async def set_openrouter_key(payload: OpenRouterKeyUpdate, db: AsyncSession = Depends(get_db)):
    """Check the key with OpenRouter, then store it in the settings table."""
    key = payload.api_key.strip()
    try:
        await openrouter_key.verify_key(key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await openrouter_key.store_key(db, key)
    return await _openrouter_status(db)


@router.delete("/openrouter", response_model=OpenRouterKeyStatus)
async def delete_openrouter_key(db: AsyncSession = Depends(get_db)):
    """Remove the key stored in the app (an environment key stays active)."""
    await openrouter_key.delete_key(db)
    return await _openrouter_status(db)


@router.get("/claude", response_model=ClaudeStatus)
async def get_claude_status():
    return await claude_cli.get_status()


@router.post("/claude/install", response_model=ClaudeStatus)
async def install_claude():
    try:
        await claude_cli.install()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return await claude_cli.get_status()


@router.post("/claude/login", response_model=ClaudeLoginStart)
async def start_claude_login():
    try:
        url = await claude_cli.start_login()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return ClaudeLoginStart(url=url)


@router.post("/claude/login/complete", response_model=ClaudeStatus)
async def complete_claude_login(payload: ClaudeLoginComplete, db: AsyncSession = Depends(get_db)):
    """Finish the sign-in; on first success the subscription models are added."""
    try:
        await claude_cli.complete_login(payload.code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await seed_subscription_models(db)
    return await claude_cli.get_status()


@router.post("/claude/login/cancel", response_model=ClaudeStatus)
async def cancel_claude_login():
    await claude_cli.cancel_login()
    return await claude_cli.get_status()


@router.post("/claude/logout", response_model=ClaudeStatus)
async def logout_claude():
    try:
        await claude_cli.logout()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return await claude_cli.get_status()
