"""Contract tests for material generation inside subjects (P5.2 / Landmine 4).

A failed AI generation must leave no TestConfig/FlashcardDeck row behind,
and the AI call must run *before* the first database write (no open
SQLite write transaction while the OpenRouter call is in flight).
Mirrors the behaviour of the create-and-generate endpoints in
tests.py / flashcards.py.
"""
import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app import models
from app.routers import subjects as subjects_router
from app.schemas.subject import (
    GenerateFlashcardsInSubjectRequest, GenerateTestInSubjectRequest
)

FAKE_QUESTIONS = [
    {
        "question": f"Question {i}",
        "choices": ["A", "B", "C", "D"],
        "correct_answer": 0,
        "explanation": "Because",
    }
    for i in range(1, 3)
]

FAKE_CARDS = [
    {"front": f"Front {i}", "back": f"Back {i}"} for i in range(1, 3)
]


@pytest.fixture
async def subject_db():
    """In-memory DB with one subject and one enabled AI model."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with session_factory() as db:
            model = models.AIModel(name="Test Model", openrouter_id="test/model")
            subject = models.Subject(title="History", ai_model=model)
            db.add_all([model, subject])
            await db.commit()
            yield db, subject, model
    finally:
        await engine.dispose()


async def _row_count(db, model_cls):
    result = await db.execute(select(func.count()).select_from(model_cls))
    return result.scalar_one()


async def test_failed_test_generation_leaves_no_config(subject_db, monkeypatch):
    """A failing generator must leave no TestConfig/Test/Question rows."""
    db, subject, model = subject_db

    async def failing_generate(**kwargs):
        raise RuntimeError("OpenRouter down")

    monkeypatch.setattr(subjects_router, "generate_test_questions", failing_generate)

    with pytest.raises(HTTPException) as error:
        await subjects_router.generate_test_in_subject(
            subject.id,
            GenerateTestInSubjectRequest(title="Chapter 1", num_questions=2),
            db,
        )

    assert error.value.status_code == 500
    assert await _row_count(db, models.TestConfig) == 0
    assert await _row_count(db, models.Test) == 0
    assert await _row_count(db, models.Question) == 0


async def test_successful_test_generation_writes_after_ai_call(subject_db, monkeypatch):
    """Nothing may be written before the AI call; success persists all rows."""
    db, subject, model = subject_db

    async def fake_generate(**kwargs):
        # The first write (config insert) must not have happened yet
        assert await _row_count(db, models.TestConfig) == 0
        assert await _row_count(db, models.FlashcardDeck) == 0
        return FAKE_QUESTIONS

    monkeypatch.setattr(subjects_router, "generate_test_questions", fake_generate)

    response = await subjects_router.generate_test_in_subject(
        subject.id,
        GenerateTestInSubjectRequest(title="Chapter 1", num_questions=2),
        db,
    )

    assert response.status == "generated"
    assert response.config_title == "Chapter 1"
    assert response.total_questions == 2
    assert await _row_count(db, models.TestConfig) == 1
    assert await _row_count(db, models.Test) == 1
    assert await _row_count(db, models.Question) == 2
    # config and test belong to the subject
    config = (await db.execute(select(models.TestConfig))).scalar_one()
    assert config.subject_id == subject.id
    assert (await db.execute(select(models.Test))).scalar_one().config_id == config.id


async def test_failed_flashcard_generation_leaves_no_deck(subject_db, monkeypatch):
    """A failing generator must leave no FlashcardDeck/Flashcard rows."""
    db, subject, model = subject_db

    async def failing_generate(**kwargs):
        raise RuntimeError("OpenRouter down")

    monkeypatch.setattr(subjects_router, "generate_flashcards", failing_generate)

    with pytest.raises(HTTPException) as error:
        await subjects_router.generate_flashcards_in_subject(
            subject.id,
            GenerateFlashcardsInSubjectRequest(title="Terms", num_cards=2),
            db,
        )

    assert error.value.status_code == 500
    assert await _row_count(db, models.FlashcardDeck) == 0
    assert await _row_count(db, models.Flashcard) == 0


async def test_successful_flashcard_generation_writes_after_ai_call(subject_db, monkeypatch):
    """Nothing may be written before the AI call; success persists all rows."""
    db, subject, model = subject_db

    async def fake_generate(**kwargs):
        # The first write (deck insert) must not have happened yet
        assert await _row_count(db, models.FlashcardDeck) == 0
        assert await _row_count(db, models.TestConfig) == 0
        return FAKE_CARDS

    monkeypatch.setattr(subjects_router, "generate_flashcards", fake_generate)

    response = await subjects_router.generate_flashcards_in_subject(
        subject.id,
        GenerateFlashcardsInSubjectRequest(title="Terms", num_cards=2),
        db,
    )

    assert response.deck_id is not None
    assert response.cards_generated == 2
    assert len(response.cards) == 2
    assert await _row_count(db, models.FlashcardDeck) == 1
    assert await _row_count(db, models.Flashcard) == 2
    deck = (await db.execute(select(models.FlashcardDeck))).scalar_one()
    assert deck.subject_id == subject.id
