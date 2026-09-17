"""
P6.2: Progress endpoints for long-running AI generations.

The generation endpoints accept an optional ``progress_token`` query
param and report progress into the in-memory store; the frontend polls
``GET /api/generation/progress/{token}`` while waiting and can cancel via
``POST /api/generation/progress/{token}/cancel``.
"""

import logging

from fastapi import APIRouter, HTTPException

from app.services import generation_progress

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/generation", tags=["generation"])


@router.get("/progress/{token}")
async def get_progress(token: str):
    """Poll a generation's progress (404 once the token expired)."""
    entry = generation_progress.get(token)
    if entry is None:
        raise HTTPException(status_code=404, detail="Unknown or expired progress token")
    return entry


@router.post("/progress/{token}/cancel")
async def cancel_generation(token: str):
    """Request cancellation of a running generation.

    Cancellation is checked between AI batches — a single call that is
    already waiting on OpenRouter finishes in the background and its
    result is discarded.
    """
    cancellation_status = generation_progress.cancel(token)
    if cancellation_status is None:
        raise HTTPException(status_code=404, detail="Unknown or expired progress token")
    if cancellation_status != "cancellation_requested":
        raise HTTPException(
            status_code=409,
            detail=f"Generation is already {cancellation_status}",
        )
    return {"status": cancellation_status}
