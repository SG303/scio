"""Shared subject lookups for the generation endpoints.

Keeps subject validation and the per-subject dedupe source in one place, so
creating material inside a subject behaves the same whether it starts from
the subject page or from the regular create wizards.
"""
from typing import List, Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Flashcard, FlashcardDeck, Question, Subject, Test, TestConfig


async def ensure_subject_exists(db: AsyncSession, subject_id: Optional[int]) -> None:
    """404 for an unknown subject id — SQLite has foreign_keys=OFF, so a bad
    id would otherwise be stored silently as a dangling reference."""
    if subject_id is None:
        return
    result = await db.execute(select(Subject.id).where(Subject.id == subject_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Subject not found")


async def existing_subject_questions(db: AsyncSession, subject_id: int) -> List[str]:
    """All question texts already generated for a subject (dedupe input)."""
    result = await db.execute(
        select(Question.question_text)
        .join(Test, Question.test_id == Test.id)
        .join(TestConfig, Test.config_id == TestConfig.id)
        .where(TestConfig.subject_id == subject_id)
    )
    return [row[0] for row in result.fetchall()]


async def existing_subject_fronts(db: AsyncSession, subject_id: int) -> List[str]:
    """All flashcard fronts already generated for a subject (dedupe input)."""
    result = await db.execute(
        select(Flashcard.front)
        .join(FlashcardDeck, Flashcard.deck_id == FlashcardDeck.id)
        .where(FlashcardDeck.subject_id == subject_id)
    )
    return [row[0] for row in result.fetchall()]
