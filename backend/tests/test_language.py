"""Output language of generated cards and questions.

The language is stored on subject, test config and deck. The subject's
language is the default of the generation endpoints inside it; a request
overrides it. None means "language of the material".
"""
import sqlite3

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import models
from app.database import Base
from app.migrations.add_language_columns import migrate
from app.routers import subjects as subjects_router
from app.schemas.subject import (
    GenerateFlashcardsInSubjectRequest,
    GenerateTestInSubjectRequest,
    SubjectCreate,
)
from app.services.flashcard_generator import build_flashcard_prompt
from app.services.language import clean_language, language_section
from app.services.test_generator import build_prompt

FAKE_QUESTIONS = [
    {"question": "Q1", "choices": ["A", "B", "C", "D"], "correct_answer": 0, "explanation": "x"}
]
FAKE_CARDS = [{"front": "F1", "back": "B1"}]


@pytest.fixture
async def subject_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with factory() as db:
            model = models.AIModel(name="Test Model", openrouter_id="test/model")
            subject = models.Subject(title="Marketing", ai_model=model, language="German")
            db.add_all([model, subject])
            await db.commit()
            yield db, subject
    finally:
        await engine.dispose()


def test_prompts_name_the_language():
    assert "in German" in build_prompt([], 3, 4, topic="Marketing", language="German")
    assert "in German" in build_flashcard_prompt([], 3, topic="Marketing", language="German")


def test_without_a_language_the_material_decides():
    for prompt in (
        build_prompt([], 3, 4, topic="Marketing"),
        build_flashcard_prompt([], 3, topic="Marketing"),
    ):
        assert "language of the study material or topic" in prompt


def test_blank_language_means_auto():
    assert clean_language("  ") is None
    assert clean_language(" French ") == "French"
    assert language_section("") == language_section(None)
    assert SubjectCreate(title="x", language="  ").language is None


async def test_subject_language_is_the_default_and_a_request_overrides_it(subject_db, monkeypatch):
    db, subject = subject_db
    seen = []

    async def fake_cards(**kwargs):
        seen.append(kwargs["language"])
        return FAKE_CARDS

    monkeypatch.setattr(subjects_router, "generate_flashcards", fake_cards)

    await subjects_router.generate_flashcards_in_subject(
        subject.id, GenerateFlashcardsInSubjectRequest(title="Terms", num_cards=1), db
    )
    await subjects_router.generate_flashcards_in_subject(
        subject.id,
        GenerateFlashcardsInSubjectRequest(title="Terms", num_cards=1, language="French"),
        db,
    )

    assert seen == ["German", "French"]
    decks = (await db.execute(select(models.FlashcardDeck).order_by(models.FlashcardDeck.id))).scalars()
    assert [deck.language for deck in decks] == ["German", "French"]


async def test_follow_up_generations_reuse_the_stored_language(subject_db, monkeypatch):
    db, subject = subject_db
    seen = []

    async def fake_questions(**kwargs):
        seen.append(("questions", kwargs["language"]))
        return FAKE_QUESTIONS

    async def fake_cards(**kwargs):
        seen.append(("cards", kwargs["language"]))
        return FAKE_CARDS

    monkeypatch.setattr(subjects_router, "generate_test_questions", fake_questions)
    monkeypatch.setattr(subjects_router, "generate_flashcards", fake_cards)

    test = await subjects_router.generate_test_in_subject(
        subject.id, GenerateTestInSubjectRequest(title="Exam", num_questions=1), db
    )
    deck = (
        await subjects_router.generate_flashcards_in_subject(
            subject.id, GenerateFlashcardsInSubjectRequest(title="Terms", num_cards=1), db
        )
    )
    seen.clear()
    from app.schemas.subject import AddCardsRequest, AddQuestionsRequest

    await subjects_router.add_questions_to_test_config(
        subject.id, test.config_id, AddQuestionsRequest(num_questions=1), db
    )
    await subjects_router.add_cards_to_deck(subject.id, deck.deck_id, AddCardsRequest(num_cards=1), db)

    assert seen == [("questions", "German"), ("cards", "German")]


def test_migration_adds_language_once(tmp_path):
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    for table in ("subjects", "test_configs", "flashcard_decks"):
        conn.execute(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY)")
    conn.commit()
    conn.close()

    migrate(str(path))
    migrate(str(path))  # idempotent

    conn = sqlite3.connect(path)
    for table in ("subjects", "test_configs", "flashcard_decks"):
        assert "language" in {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    conn.close()


async def test_create_and_generate_deck_stores_and_uses_the_language(subject_db, monkeypatch):
    from app.routers import flashcards as flashcards_router
    from app.schemas.flashcard import CreateAndGenerateDeckRequest

    db, _ = subject_db
    seen = []

    async def fake_cards(**kwargs):
        seen.append(kwargs["language"])
        return FAKE_CARDS

    monkeypatch.setattr(flashcards_router, "generate_flashcards", fake_cards)

    response = await flashcards_router.create_and_generate_deck(
        CreateAndGenerateDeckRequest(title="Terms", num_cards=1, ai_model_id=1, language="Italian"),
        db,
    )

    assert seen == ["Italian"]
    assert response.deck.language == "Italian"
